import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { logger as baseLogger } from "@/lib/logger";

type RequestLogDetails = Record<string, unknown>;
const REQUEST_LOG_FILE = process.env.CLAWE_REQUEST_LOG_FILE?.trim() || "";
let requestLogWriteQueue: Promise<void> = Promise.resolve();

function isSensitiveKey(key: string): boolean {
  return /(key|token|secret|password|authorization)/i.test(key);
}

function sanitizeQuery(request: NextRequest): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of request.nextUrl.searchParams.entries()) {
    if (isSensitiveKey(key)) {
      out[key] = "[redacted]";
      continue;
    }
    out[key] = value.length > 160 ? `${value.slice(0, 157)}...` : value;
  }
  return out;
}

function getClientIp(request: NextRequest): string | null {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstIp = forwardedFor.split(",")[0]?.trim();
    if (firstIp) return firstIp;
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  return realIp || null;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function writeRequestLogLine(record: Record<string, unknown>) {
  if (!REQUEST_LOG_FILE) return;

  requestLogWriteQueue = requestLogWriteQueue
    .then(async () => {
      const line = `${JSON.stringify(record)}\n`;
      await mkdir(path.dirname(REQUEST_LOG_FILE), { recursive: true });
      await appendFile(REQUEST_LOG_FILE, line, "utf8");
    })
    .catch((error) => {
      baseLogger.warn(
        {
          err: error,
          requestLogFile: REQUEST_LOG_FILE,
        },
        "request.log_file_write_failed",
      );
    });
}

export type ApiRequestLogger = ReturnType<typeof createApiRequestLogger>;

export function createApiRequestLogger(request: NextRequest, route: string) {
  const requestId = request.headers.get("x-request-id")?.trim() || randomUUID();
  const startedAt = Date.now();
  const log = baseLogger.child({
    component: "api",
    route,
    requestId,
    method: request.method,
    path: request.nextUrl.pathname,
  });

  log.info(
    {
      query: sanitizeQuery(request),
      userAgent: request.headers.get("user-agent") ?? null,
      clientIp: getClientIp(request),
    },
    "request.start",
  );
  writeRequestLogLine({
    ts: new Date().toISOString(),
    event: "request.start",
    route,
    requestId,
    method: request.method,
    path: request.nextUrl.pathname,
    query: sanitizeQuery(request),
    userAgent: request.headers.get("user-agent") ?? null,
    clientIp: getClientIp(request),
  });

  const finish = (
    response: Response,
    message = "request.complete",
    details: RequestLogDetails = {},
  ) => {
    response.headers.set("x-request-id", requestId);
    log.info(
      {
        status: response.status,
        durationMs: Date.now() - startedAt,
        ...details,
      },
      message,
    );
    writeRequestLogLine({
      ts: new Date().toISOString(),
      event: message,
      route,
      requestId,
      method: request.method,
      path: request.nextUrl.pathname,
      status: response.status,
      durationMs: Date.now() - startedAt,
      ...details,
    });
    return response;
  };

  const json = (
    status: number,
    payload: Record<string, unknown>,
    message = "request.complete",
    details: RequestLogDetails = {},
  ) => finish(NextResponse.json(payload, { status }), message, details);

  const fail = (
    status: number,
    error: unknown,
    details: RequestLogDetails = {},
  ) => {
    const message = toErrorMessage(error);
    log.error(
      {
        status,
        durationMs: Date.now() - startedAt,
        err: error,
        ...details,
      },
      "request.failed",
    );
    writeRequestLogLine({
      ts: new Date().toISOString(),
      event: "request.failed",
      route,
      requestId,
      method: request.method,
      path: request.nextUrl.pathname,
      status,
      durationMs: Date.now() - startedAt,
      error: message,
      ...details,
    });
    return finish(
      NextResponse.json({ ok: false, error: message, requestId }, { status }),
      "request.failed.response",
    );
  };

  return {
    requestId,
    log,
    finish,
    json,
    fail,
  };
}
