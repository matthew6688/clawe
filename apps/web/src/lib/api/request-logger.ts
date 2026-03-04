import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { logger as baseLogger } from "@/lib/logger";

type RequestLogDetails = Record<string, unknown>;

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
