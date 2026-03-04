import path from "node:path";
import { promises as fs } from "node:fs";
import type { NextRequest } from "next/server";
import { getAuthenticatedTenant } from "@/lib/api/tenant-auth";
import { createApiRequestLogger } from "@/lib/api/request-logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 200;

type LogRecord = {
  ts?: string;
  event?: string;
  route?: string;
  requestId?: string;
  method?: string;
  path?: string;
  status?: number;
  durationMs?: number;
  [key: string]: unknown;
};

function parseLimit(value: string | null): number {
  if (!value) return DEFAULT_LIMIT;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(parsed, MAX_LIMIT));
}

function parseOptionalInt(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
}

function getLogPathCandidates(): string[] {
  const fromEnv = process.env.CLAWE_REQUEST_LOG_FILE?.trim();
  const candidates = [
    fromEnv,
    "/squadhub-host/logs/clawe-api.ndjson",
    path.resolve(process.cwd(), ".squadhub", "logs", "clawe-api.ndjson"),
  ].filter((value): value is string => !!value);
  return [...new Set(candidates)];
}

async function resolveExistingLogFile(): Promise<string | null> {
  for (const candidate of getLogPathCandidates()) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // try next
    }
  }
  return null;
}

function matchesFilter(
  record: LogRecord,
  filters: {
    route?: string;
    requestId?: string;
    event?: string;
    status?: number;
  },
) {
  if (filters.route) {
    const routeValue = String(record.route ?? "");
    if (!routeValue.toLowerCase().includes(filters.route.toLowerCase())) {
      return false;
    }
  }

  if (filters.requestId) {
    const requestIdValue = String(record.requestId ?? "");
    if (!requestIdValue.toLowerCase().includes(filters.requestId.toLowerCase())) {
      return false;
    }
  }

  if (filters.event) {
    const eventValue = String(record.event ?? "");
    if (!eventValue.toLowerCase().includes(filters.event.toLowerCase())) {
      return false;
    }
  }

  if (filters.status !== undefined) {
    if (typeof record.status !== "number") return false;
    if (record.status !== filters.status) return false;
  }

  return true;
}

export async function GET(request: NextRequest) {
  const reqLog = createApiRequestLogger(request, "tenant/logs/system.GET");

  let auth: Awaited<ReturnType<typeof getAuthenticatedTenant>>;
  try {
    auth = await getAuthenticatedTenant(request);
  } catch (error) {
    return reqLog.fail(401, error, {
      operation: "logs.auth",
    });
  }
  if (auth.error) {
    return reqLog.finish(auth.error, "request.auth_failed");
  }

  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = parseLimit(searchParams.get("limit"));
    const filters = {
      route: searchParams.get("route")?.trim() || undefined,
      requestId: searchParams.get("requestId")?.trim() || undefined,
      event: searchParams.get("event")?.trim() || undefined,
      status: parseOptionalInt(searchParams.get("status")),
    };

    const filePath = await resolveExistingLogFile();
    if (!filePath) {
      return reqLog.json(
        200,
        {
          ok: true,
          filePath: null,
          records: [],
          limit,
          filters,
          scannedLines: 0,
        },
        "logs.empty",
      );
    }

    const raw = await fs.readFile(filePath, "utf8");
    const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const records: LogRecord[] = [];

    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index];
      if (!line) continue;
      try {
        const parsed = JSON.parse(line) as LogRecord;
        if (!parsed || typeof parsed !== "object") continue;
        if (!matchesFilter(parsed, filters)) continue;
        records.push(parsed);
        if (records.length >= limit) break;
      } catch {
        // skip malformed line
      }
    }

    return reqLog.json(
      200,
      {
        ok: true,
        filePath,
        records,
        limit,
        filters,
        scannedLines: lines.length,
      },
      "logs.loaded",
      {
        returnedCount: records.length,
        scannedLines: lines.length,
      },
    );
  } catch (error) {
    return reqLog.fail(500, error, {
      operation: "logs.get",
    });
  }
}
