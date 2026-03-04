import { ConvexHttpClient } from "convex/browser";
import { api } from "@clawe/backend";
import {
  cronList,
  cronAdd,
  cronUpdate,
  checkHealth,
  type SquadhubConnection,
  type CronAddJob,
  type CronJob,
} from "@clawe/shared/squadhub";
import { getServerEnvValue } from "@/lib/runtime-config";

/**
 * Default agent definitions for new tenants.
 */
const DEFAULT_AGENTS = [
  {
    id: "main",
    name: "Clawe",
    emoji: "\u{1F99E}",
    role: "Squad Lead",
    cron: "0,15,30,45 * * * *",
  },
  {
    id: "inky",
    name: "Inky",
    emoji: "\u270D\uFE0F",
    role: "Writer",
    cron: "3,18,33,48 * * * *",
  },
  {
    id: "pixel",
    name: "Pixel",
    emoji: "\u{1F3A8}",
    role: "Designer",
    cron: "7,22,37,52 * * * *",
  },
  {
    id: "scout",
    name: "Scout",
    emoji: "\u{1F50D}",
    role: "SEO",
    cron: "11,26,41,56 * * * *",
  },
];

const HEARTBEAT_MESSAGE =
  "HEARTBEAT_PULSE: respond with exactly HEARTBEAT_OK. Do not create tasks, files, plans, or delegation.";
const HEARTBEAT_TIMEOUT_SECONDS = 45;

type HeartbeatCronMode = "off" | "legacy";

function resolveHeartbeatCronMode(
  value: string | undefined,
): HeartbeatCronMode {
  const normalized = value?.trim().toLowerCase();
  return normalized === "legacy" ? "legacy" : "off";
}

const HEARTBEAT_CRON_MODE = resolveHeartbeatCronMode(
  getServerEnvValue("CLAWE_HEARTBEAT_CRON_MODE"),
);

function isManagedHeartbeatJob(job: CronJob): boolean {
  return DEFAULT_AGENTS.some((agent) => job.name === `${agent.id}-heartbeat`);
}

/**
 * Default routines seeded for new tenants.
 */
const SEED_ROUTINES = [
  {
    title: "Weekly Performance Review",
    description:
      "Review last week's content performance, engagement metrics, and campaign results. Identify top-performing pieces and areas for improvement.",
    priority: "normal" as const,
    schedule: { type: "weekly" as const, daysOfWeek: [1], hour: 9, minute: 0 },
    color: "emerald",
  },
  {
    title: "Morning Brief",
    description: "Prepare daily morning brief for the team",
    priority: "high" as const,
    schedule: {
      type: "weekly" as const,
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      hour: 8,
      minute: 0,
    },
    color: "amber",
  },
  {
    title: "Competitor Scan",
    description: "Scan competitor activities and updates",
    priority: "normal" as const,
    schedule: {
      type: "weekly" as const,
      daysOfWeek: [1, 4],
      hour: 10,
      minute: 0,
    },
    color: "rose",
  },
];

type ProvisionResult = {
  agents: number;
  crons: number;
  routines: number;
  errors: string[];
};

/**
 * Register default agents in Convex.
 */
async function registerAgents(convex: ConvexHttpClient): Promise<{
  count: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let count = 0;

  for (const agent of DEFAULT_AGENTS) {
    const sessionKey = `agent:${agent.id}:main`;
    try {
      await convex.mutation(api.agents.upsert, {
        name: agent.name,
        role: agent.role,
        sessionKey,
        emoji: agent.emoji,
      });
      count++;
    } catch (err) {
      errors.push(
        `Failed to register ${agent.name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { count, errors };
}

/**
 * Setup heartbeat cron jobs on the squadhub gateway.
 */
async function setupCrons(connection: SquadhubConnection): Promise<{
  count: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let count = 0;

  const result = await cronList(connection);
  if (!result.ok) {
    return {
      count: 0,
      errors: [`Failed to list crons: ${result.error?.message}`],
    };
  }

  const jobs = result.result.details.jobs as CronJob[];
  const existingJobsByName = new Map(jobs.map((job) => [job.name, job]));

  if (HEARTBEAT_CRON_MODE === "off") {
    for (const job of jobs) {
      if (!isManagedHeartbeatJob(job)) continue;
      count++;

      if (!job.enabled) continue;

      const disableResult = await cronUpdate(connection, job.id, {
        enabled: false,
      });
      if (!disableResult.ok) {
        errors.push(
          `Failed to disable ${job.name}: ${disableResult.error?.message}`,
        );
      }
    }

    return { count, errors };
  }

  for (const agent of DEFAULT_AGENTS) {
    const cronName = `${agent.id}-heartbeat`;
    const existing = existingJobsByName.get(cronName);

    if (existing) {
      count++;
      const existingTimeout =
        existing.payload.kind === "agentTurn"
          ? existing.payload.timeoutSeconds
          : undefined;
      const needsUpdate =
        !existing.enabled ||
        existing.schedule.kind !== "cron" ||
        existing.schedule.expr !== agent.cron ||
        existing.sessionTarget !== "isolated" ||
        existing.payload.kind !== "agentTurn" ||
        existing.payload.message !== HEARTBEAT_MESSAGE ||
        existingTimeout !== HEARTBEAT_TIMEOUT_SECONDS;

      if (!needsUpdate) continue;

      const updateResult = await cronUpdate(connection, existing.id, {
        enabled: true,
        schedule: { kind: "cron", expr: agent.cron },
        sessionTarget: "isolated",
        payload: {
          kind: "agentTurn",
          message: HEARTBEAT_MESSAGE,
          timeoutSeconds: HEARTBEAT_TIMEOUT_SECONDS,
        },
        delivery: { mode: "none" },
      });

      if (!updateResult.ok) {
        errors.push(`Failed to update ${cronName}: ${updateResult.error?.message}`);
      }
      continue;
    }

    const job: CronAddJob = {
      name: cronName,
      agentId: agent.id,
      enabled: true,
      schedule: { kind: "cron", expr: agent.cron },
      sessionTarget: "isolated",
      payload: {
        kind: "agentTurn",
        message: HEARTBEAT_MESSAGE,
        timeoutSeconds: HEARTBEAT_TIMEOUT_SECONDS,
      },
      delivery: { mode: "none" },
    };

    const addResult = await cronAdd(connection, job);
    if (addResult.ok) {
      count++;
    } else {
      errors.push(`Failed to add ${cronName}: ${addResult.error?.message}`);
    }
  }

  return { count, errors };
}

/**
 * Seed default routines if none exist.
 */
async function seedRoutines(convex: ConvexHttpClient): Promise<{
  count: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let count = 0;

  const existing = await convex.query(api.routines.list, {});
  if (existing.length > 0) {
    return { count: existing.length, errors: [] };
  }

  for (const routine of SEED_ROUTINES) {
    try {
      await convex.mutation(api.routines.create, routine);
      count++;
    } catch (err) {
      errors.push(
        `Failed to create routine "${routine.title}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { count, errors };
}

/**
 * Run full tenant provisioning setup:
 * 1. Register default agents in Convex
 * 2. Configure heartbeat cron jobs when squadhub is reachable
 * 3. Seed default routines in Convex
 */
export async function setupTenant(
  connection: SquadhubConnection,
  convexUrl: string,
  authToken?: string,
): Promise<ProvisionResult> {
  const convex = new ConvexHttpClient(convexUrl);
  if (authToken) {
    convex.setAuth(authToken);
  }
  const allErrors: string[] = [];

  // Register agents
  const agentResult = await registerAgents(convex);
  allErrors.push(...agentResult.errors);

  // Setup crons only when squadhub is reachable
  let cronResult: { count: number; errors: string[] } = {
    count: 0,
    errors: [],
  };
  const health = await checkHealth(connection);
  if (health.ok) {
    cronResult = await setupCrons(connection);
    allErrors.push(...cronResult.errors);
  } else {
    allErrors.push(`Squadhub not reachable: ${health.error?.message}`);
  }

  // Seed routines
  const routineResult = await seedRoutines(convex);
  allErrors.push(...routineResult.errors);

  return {
    agents: agentResult.count,
    crons: cronResult.count,
    routines: routineResult.count,
    errors: allErrors,
  };
}
