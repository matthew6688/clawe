import path from "node:path";
import { promises as fs } from "node:fs";
import type { NextRequest } from "next/server";
import { api } from "@clawe/backend";
import type { Doc } from "@clawe/backend/dataModel";
import { getAuthenticatedTenant } from "@/lib/api/tenant-auth";
import { createApiRequestLogger } from "@/lib/api/request-logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORE_AGENT_FILES = [
  "AGENTS.md",
  "SOUL.md",
  "HEARTBEAT.md",
  "TOOLS.md",
  "USER.md",
  "MEMORY.md",
  "IDENTITY.md",
  "BOOTSTRAP.md",
] as const;
const SQUADHUB_ROOT_CANDIDATES = [
  "/squadhub-host",
  "/squadhub-data",
  path.resolve(process.cwd(), ".squadhub"),
];

type OpenclawAgentRecord = {
  id?: string;
  name?: string;
  model?: string;
  workspace?: string;
  identity?: {
    name?: string;
    emoji?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type OpenclawConfig = {
  env?: Record<string, unknown>;
  agents?: {
    defaults?: Record<string, unknown>;
    list?: OpenclawAgentRecord[];
  };
  [key: string]: unknown;
};

type SkillsSnapshot = {
  prompt?: string;
  skills?: unknown[];
  resolvedSkills?: unknown[];
  version?: number;
};

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function resolveSquadhubRoot() {
  for (const candidate of SQUADHUB_ROOT_CANDIDATES) {
    const configPath = path.join(candidate, "config", "openclaw.json");
    if (await pathExists(configPath)) {
      return { rootPath: candidate, configPath };
    }
  }
  return null;
}

function parseAgentIdFromSessionKey(sessionKey: string): string | null {
  const match = /^agent:([^:]+):[^:]+$/i.exec(sessionKey.trim());
  return match?.[1] ?? null;
}

function defaultWorkspaceForAgent(agentId: string): string {
  return agentId === "main" ? "/data/workspace" : `/data/workspace-${agentId}`;
}

function resolveWorkspaceHostPath(
  rootPath: string,
  workspacePath: string | undefined,
  agentId: string,
): string {
  const workspace = (workspacePath?.trim() || defaultWorkspaceForAgent(agentId))
    .replace(/\\/g, "/")
    .trim();

  if (workspace.startsWith("/data/")) {
    return path.resolve(rootPath, workspace.slice("/data/".length));
  }
  if (workspace === "/data") {
    return path.resolve(rootPath);
  }
  if (workspace.startsWith(rootPath)) {
    return path.resolve(workspace);
  }
  if (path.isAbsolute(workspace)) {
    throw new Error(`Unsupported absolute workspace path: ${workspace}`);
  }
  return path.resolve(rootPath, workspace);
}

function assertInsideRoot(rootPath: string, targetPath: string) {
  const root = path.resolve(rootPath);
  const target = path.resolve(targetPath);
  if (target === root) return;
  if (!target.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Path escapes squadhub root: ${targetPath}`);
  }
}

function normalizeEditableRelativePath(relativePath: string): string | null {
  const normalized = relativePath.replace(/\\/g, "/").trim();
  if (!normalized) return null;
  if (normalized.startsWith("/")) return null;
  if (normalized.includes("..")) return null;

  if (
    CORE_AGENT_FILES.includes(normalized as (typeof CORE_AGENT_FILES)[number]) ||
    normalized.startsWith("skills/")
  ) {
    return normalized;
  }
  return null;
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readTextFileIfExists(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

function maskValue(value: string): string {
  if (value.length <= 8) return "*".repeat(value.length);
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function sanitizeEnv(env: unknown): Record<string, unknown> | undefined {
  if (!env || typeof env !== "object") return undefined;
  const entries = Object.entries(env as Record<string, unknown>).map(
    ([key, value]) => {
      if (typeof value !== "string") return [key, value];
      if (/(key|token|secret|password)/i.test(key)) {
        return [key, maskValue(value)];
      }
      return [key, value];
    },
  );
  return Object.fromEntries(entries);
}

function sanitizeOpenclawConfig(config: OpenclawConfig): OpenclawConfig {
  return {
    ...config,
    ...(config.env ? { env: sanitizeEnv(config.env) } : {}),
  };
}

async function listWorkspaceSkillFiles(workspacePath: string): Promise<string[]> {
  const skillsPath = path.join(workspacePath, "skills");
  if (!(await pathExists(skillsPath))) return [];

  const entries = await fs.readdir(skillsPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => `skills/${entry.name}`)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

async function loadSkillsSnapshot(
  rootPath: string,
  agentId: string,
  sessionKey: string,
): Promise<SkillsSnapshot | null> {
  const sessionsPath = path.join(
    rootPath,
    "config",
    "agents",
    agentId,
    "sessions",
    "sessions.json",
  );
  if (!(await pathExists(sessionsPath))) return null;

  try {
    const sessions = await readJsonFile<Record<string, unknown>>(sessionsPath);
    const bySession = sessions[sessionKey];
    const firstEntry = Object.values(sessions)[0];
    const target =
      (bySession && typeof bySession === "object" ? bySession : undefined) ??
      (firstEntry && typeof firstEntry === "object" ? firstEntry : undefined);
    if (!target) return null;

    const snapshot = (target as { skillsSnapshot?: unknown }).skillsSnapshot;
    if (!snapshot || typeof snapshot !== "object") return null;
    return snapshot as SkillsSnapshot;
  } catch {
    return null;
  }
}

async function buildOpenclawAgentPayload({
  rootPath,
  openclawAgent,
  convexAgent,
}: {
  rootPath: string;
  openclawAgent?: OpenclawAgentRecord;
  convexAgent?: Doc<"agents">;
}) {
  const agentId =
    openclawAgent?.id ||
    (convexAgent ? parseAgentIdFromSessionKey(convexAgent.sessionKey) : null);
  if (!agentId) return null;

  const sessionKey = convexAgent?.sessionKey ?? `agent:${agentId}:main`;
  const workspacePath = openclawAgent?.workspace ?? defaultWorkspaceForAgent(agentId);
  const workspaceResolvedPath = resolveWorkspaceHostPath(
    rootPath,
    workspacePath,
    agentId,
  );
  assertInsideRoot(rootPath, workspaceResolvedPath);
  const workspaceExists = await pathExists(workspaceResolvedPath);

  const filesToRead = [
    ...CORE_AGENT_FILES,
    ...(workspaceExists
      ? await listWorkspaceSkillFiles(workspaceResolvedPath)
      : []),
  ];

  const files: Record<string, string> = {};
  for (const file of filesToRead) {
    const fullPath = path.join(workspaceResolvedPath, file);
    assertInsideRoot(rootPath, fullPath);
    files[file] = workspaceExists ? await readTextFileIfExists(fullPath) : "";
  }

  const skillsSnapshot = await loadSkillsSnapshot(rootPath, agentId, sessionKey);

  return {
    agentId,
    sessionKey,
    convexAgent: convexAgent
      ? {
          id: convexAgent._id,
          name: convexAgent.name,
          role: convexAgent.role,
          emoji: convexAgent.emoji,
          status: convexAgent.status,
        }
      : null,
    workspacePath,
    workspaceResolvedPath,
    workspaceExists,
    openclawAgent: openclawAgent ?? { id: agentId },
    files,
    skillsSnapshot,
  };
}

export async function GET(request: NextRequest) {
  const reqLog = createApiRequestLogger(request, "tenant/agents/openclaw.GET");
  let auth: Awaited<ReturnType<typeof getAuthenticatedTenant>>;
  try {
    auth = await getAuthenticatedTenant(request);
  } catch (error) {
    return reqLog.fail(401, error, {
      operation: "openclaw.get.auth",
    });
  }
  if (auth.error) {
    return reqLog.finish(auth.error, "request.auth_failed");
  }

  const resolved = await resolveSquadhubRoot();
  if (!resolved) {
    return reqLog.json(
      200,
      {
        ok: true,
        rootPath: null,
        configPath: null,
        config: null,
        agents: [],
        unavailable: "squadhub_state_root_missing",
      },
      "openclaw.root_missing",
    );
  }

  try {
    const searchParams = new URL(request.url).searchParams;
    const sessionKeyFilter = searchParams.get("sessionKey")?.trim();
    const openclawConfig = await readJsonFile<OpenclawConfig>(resolved.configPath);
    const openclawAgents = Array.isArray(openclawConfig.agents?.list)
      ? openclawConfig.agents?.list ?? []
      : [];
    const convexAgents = (await auth.convex.query(api.agents.list, {})) as Doc<"agents">[];

    const openclawById = new Map(
      openclawAgents
        .filter((agent) => !!agent?.id)
        .map((agent) => [agent.id as string, agent]),
    );
    const convexById = new Map(
      convexAgents
        .map((agent) => ({
          agentId: parseAgentIdFromSessionKey(agent.sessionKey),
          agent,
        }))
        .filter((item): item is { agentId: string; agent: Doc<"agents"> } =>
          Boolean(item.agentId),
        )
        .map((item) => [item.agentId, item.agent]),
    );

    const allAgentIds = new Set<string>([
      ...openclawById.keys(),
      ...convexById.keys(),
    ]);

    const payloads = await Promise.all(
      [...allAgentIds].map(async (agentId) => {
        const payload = await buildOpenclawAgentPayload({
          rootPath: resolved.rootPath,
          openclawAgent: openclawById.get(agentId),
          convexAgent: convexById.get(agentId),
        });
        return payload;
      }),
    );

    const agents = payloads
      .filter((payload): payload is NonNullable<typeof payload> => !!payload)
      .filter((payload) =>
        sessionKeyFilter ? payload.sessionKey === sessionKeyFilter : true,
      )
      .sort((a, b) =>
        a.sessionKey.localeCompare(b.sessionKey, undefined, {
          sensitivity: "base",
        }),
      );

    return reqLog.json(
      200,
      {
        ok: true,
        rootPath: resolved.rootPath,
        configPath: resolved.configPath,
        config: sanitizeOpenclawConfig(openclawConfig),
        agents,
      },
      "openclaw.loaded",
      {
        requestedSessionKey: sessionKeyFilter ?? null,
        openclawAgentCount: openclawAgents.length,
        convexAgentCount: convexAgents.length,
        responseAgentCount: agents.length,
      },
    );
  } catch (error) {
    return reqLog.fail(500, error, {
      operation: "openclaw.get",
    });
  }
}

export async function PATCH(request: NextRequest) {
  const reqLog = createApiRequestLogger(
    request,
    "tenant/agents/openclaw.PATCH",
  );
  let auth: Awaited<ReturnType<typeof getAuthenticatedTenant>>;
  try {
    auth = await getAuthenticatedTenant(request);
  } catch (error) {
    return reqLog.fail(401, error, {
      operation: "openclaw.patch.auth",
    });
  }
  if (auth.error) {
    return reqLog.finish(auth.error, "request.auth_failed");
  }

  const resolved = await resolveSquadhubRoot();
  if (!resolved) {
    return reqLog.json(
      500,
      {
        ok: false,
        error: "Unable to locate squadhub state root",
      },
      "openclaw.root_missing",
    );
  }

  try {
    const body = (await request.json()) as {
      sessionKey?: unknown;
      agentId?: unknown;
      openclawPatch?: unknown;
      files?: unknown;
    };

    const inputSessionKey =
      typeof body.sessionKey === "string" ? body.sessionKey.trim() : "";
    const inputAgentId =
      typeof body.agentId === "string" ? body.agentId.trim() : "";
    const agentIdFromSession = inputSessionKey
      ? parseAgentIdFromSessionKey(inputSessionKey)
      : null;
    const targetAgentId = inputAgentId || agentIdFromSession;

    if (!targetAgentId) {
      return reqLog.json(
        400,
        { ok: false, error: "agentId or sessionKey is required" },
        "openclaw.patch_missing_agent",
      );
    }

    const openclawPatch =
      body.openclawPatch && typeof body.openclawPatch === "object"
        ? (body.openclawPatch as Record<string, unknown>)
        : undefined;
    const filesPatch =
      body.files && typeof body.files === "object"
        ? (body.files as Record<string, unknown>)
        : undefined;

    if (!openclawPatch && !filesPatch) {
      return reqLog.json(
        400,
        {
          ok: false,
          error: "Provide openclawPatch and/or files",
        },
        "openclaw.patch_missing_payload",
      );
    }

    reqLog.log.info(
      {
        targetAgentId,
        hasOpenclawPatch: !!openclawPatch,
        filePatchCount: filesPatch ? Object.keys(filesPatch).length : 0,
      },
      "openclaw.patch_received",
    );

    const openclawConfig = await readJsonFile<OpenclawConfig>(resolved.configPath);
    const list = Array.isArray(openclawConfig.agents?.list)
      ? [...(openclawConfig.agents?.list ?? [])]
      : [];
    const existingIndex = list.findIndex((agent) => agent.id === targetAgentId);
    const existingAgent =
      existingIndex >= 0 ? { ...(list[existingIndex] ?? {}) } : { id: targetAgentId };

    if (openclawPatch) {
      const merged: OpenclawAgentRecord = { ...existingAgent, ...openclawPatch };
      if (
        openclawPatch.identity &&
        typeof openclawPatch.identity === "object" &&
        !Array.isArray(openclawPatch.identity)
      ) {
        merged.identity = {
          ...(existingAgent.identity ?? {}),
          ...(openclawPatch.identity as Record<string, unknown>),
        };
      }
      merged.id = targetAgentId;

      if (existingIndex >= 0) {
        list[existingIndex] = merged;
      } else {
        list.push(merged);
      }

      openclawConfig.agents = {
        ...(openclawConfig.agents ?? {}),
        list,
      };
      await writeJsonFile(resolved.configPath, openclawConfig);
    }

    if (filesPatch) {
      const currentAgent =
        list.find((agent) => agent.id === targetAgentId) ??
        existingAgent ??
        ({ id: targetAgentId } as OpenclawAgentRecord);
      const workspaceResolvedPath = resolveWorkspaceHostPath(
        resolved.rootPath,
        currentAgent.workspace,
        targetAgentId,
      );
      assertInsideRoot(resolved.rootPath, workspaceResolvedPath);
      await fs.mkdir(workspaceResolvedPath, { recursive: true });

      for (const [relativePath, value] of Object.entries(filesPatch)) {
        if (typeof value !== "string") continue;
        const normalized = normalizeEditableRelativePath(relativePath);
        if (!normalized) {
          return reqLog.json(
            400,
            {
              ok: false,
              error: `File path is not editable: ${relativePath}`,
            },
            "openclaw.patch_invalid_path",
            {
              targetAgentId,
              relativePath,
            },
          );
        }

        const fullPath = path.resolve(workspaceResolvedPath, normalized);
        assertInsideRoot(resolved.rootPath, fullPath);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, value, "utf8");
      }
    }

    const convexAgents = (await auth.convex.query(api.agents.list, {})) as Doc<"agents">[];
    const convexMatch = convexAgents.find(
      (agent) => parseAgentIdFromSessionKey(agent.sessionKey) === targetAgentId,
    );
    const openclawAgent =
      list.find((agent) => agent.id === targetAgentId) ??
      openclawConfig.agents?.list?.find((agent) => agent.id === targetAgentId);

    const payload = await buildOpenclawAgentPayload({
      rootPath: resolved.rootPath,
      openclawAgent,
      convexAgent: convexMatch,
    });

    return reqLog.json(
      200,
      {
        ok: true,
        agent: payload,
      },
      "openclaw.patch_saved",
      {
        targetAgentId,
        hasAgentPayload: !!payload,
      },
    );
  } catch (error) {
    return reqLog.fail(500, error, {
      operation: "openclaw.patch",
    });
  }
}
