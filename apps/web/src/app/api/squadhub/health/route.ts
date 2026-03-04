import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { checkHealth } from "@clawe/shared/squadhub";
import { resolvePlugin } from "@/lib/plugins";
import { getAuthenticatedTenant } from "@/lib/api/tenant-auth";
import { getConnection } from "@/lib/squadhub/connection";
import { config } from "@/lib/config";
import { getServerEnvValue } from "@/lib/runtime-config";

// Track when each tenant's gateway was last known healthy.
// During a restart the process is briefly down (ECONNREFUSED), making
// an HTTP probe indistinguishable from a real outage. This lets us
// infer "restarting" when the gateway was healthy moments ago.
const lastHealthyAt = new Map<string, number>();
const RESTART_GRACE_MS = 30_000;

async function probeGatewayProcess(squadhubUrl: string): Promise<boolean> {
  try {
    await fetch(squadhubUrl, {
      method: "HEAD",
      signal: AbortSignal.timeout(3000),
    });
    return true;
  } catch {
    return false;
  }
}

async function isInfraRunning(
  tenantId: string,
  squadhubUrl: string,
): Promise<boolean> {
  try {
    if (config.isCloud) {
      const lifecycle = await resolvePlugin("squadhub-lifecycle");
      const status = await lifecycle.getStatus(tenantId);
      return status.running;
    }

    // Dev/OSS: HTTP probe — any response means the process is alive
    return await probeGatewayProcess(squadhubUrl);
  } catch {
    // Probe failed (ECONNREFUSED). Check if gateway was recently healthy —
    // during a restart the process is briefly down but should come back.
    const lastHealthy = lastHealthyAt.get(tenantId);
    if (lastHealthy && Date.now() - lastHealthy < RESTART_GRACE_MS) {
      return true;
    }
    return false;
  }
}

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof getAuthenticatedTenant>> | null = null;
  try {
    auth = await getAuthenticatedTenant(request);
  } catch {
    auth = null;
  }

  // Local/dev fallback: even without tenant auth we can still report
  // gateway process liveness for onboarding status widgets.
  if (!auth || auth.error) {
    if (config.isCloud) {
      return auth?.error ?? NextResponse.json({ ok: false }, { status: 401 });
    }

    const reachable = await probeGatewayProcess(
      getServerEnvValue("SQUADHUB_URL") || "http://localhost:18790",
    );
    return NextResponse.json(
      reachable
        ? { ok: true, degraded: true, auth: "fallback" }
        : { ok: false, restarting: false, auth: "fallback" },
    );
  }

  const connection = getConnection(auth.tenant);
  const result = await checkHealth(connection);

  if (result.ok) {
    lastHealthyAt.set(auth.tenant._id, Date.now());
    return NextResponse.json(result);
  }

  const infraRunning = await isInfraRunning(
    auth.tenant._id,
    connection.squadhubUrl,
  );

  // Newer OpenClaw builds may reject legacy HTTP tool calls even while the
  // gateway process itself is healthy. For onboarding, treat a reachable
  // gateway as online so the user can proceed.
  if (infraRunning) {
    lastHealthyAt.set(auth.tenant._id, Date.now());
    return NextResponse.json({ ok: true, degraded: true });
  }

  return NextResponse.json({ ...result, restarting: false });
}
