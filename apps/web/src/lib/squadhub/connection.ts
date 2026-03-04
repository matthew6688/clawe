import type { SquadhubConnection } from "@clawe/shared/squadhub";
import type { Tenant } from "@clawe/backend/types";
import { getServerEnvValue } from "@/lib/runtime-config";

/**
 * Normalize localhost squadhub URLs to the server's configured URL.
 * This keeps old tenant records working after moving between host/dev/docker.
 */
export function normalizeSquadhubUrl(url?: string | null): string | undefined {
  if (!url) return undefined;

  const fallback = getServerEnvValue("SQUADHUB_URL");
  if (!fallback) return url;

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
      return fallback;
    }
    return url;
  } catch {
    return fallback;
  }
}

/**
 * Get the squadhub connection for a tenant.
 * If a tenant with squadhubUrl/squadhubToken is provided, uses those.
 * Otherwise falls back to env vars (self-hosted / dev).
 */
export function getConnection(tenant?: Tenant | null): SquadhubConnection {
  const tenantUrl = normalizeSquadhubUrl(tenant?.squadhubUrl);
  const envUrl = normalizeSquadhubUrl(getServerEnvValue("SQUADHUB_URL"));

  return {
    squadhubUrl: tenantUrl || envUrl || "http://localhost:18790",
    squadhubToken:
      tenant?.squadhubToken || getServerEnvValue("SQUADHUB_TOKEN") || "",
  };
}
