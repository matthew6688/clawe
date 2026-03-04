// Watcher configuration

import { logger } from "./logger.js";

export const POLL_INTERVAL_MS = 2000; // Check every 2 seconds

function parseNumber(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

// Environment validation
export function validateEnv(): void {
  const required = ["CONVEX_URL", "WATCHER_TOKEN"];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    logger.fatal({ missing }, "Missing required environment variables");
    process.exit(1);
  }
}

export const config = {
  convexUrl: process.env.CONVEX_URL || "",
  watcherToken: process.env.WATCHER_TOKEN || "",
  pollIntervalMs: POLL_INTERVAL_MS,
  notificationSendTimeoutSeconds: parseNumber(
    process.env.WATCHER_NOTIFICATION_SEND_TIMEOUT_SECONDS,
    20,
    5,
    120,
  ),
  notificationStaleAfterMs: parseNumber(
    process.env.WATCHER_NOTIFICATION_STALE_AFTER_MS,
    15 * 60 * 1000,
    10 * 1000,
    24 * 60 * 60 * 1000,
  ),
  notificationMaxPerAgentPerLoop: parseNumber(
    process.env.WATCHER_NOTIFICATION_MAX_PER_AGENT_PER_LOOP,
    2,
    1,
    20,
  ),
};
