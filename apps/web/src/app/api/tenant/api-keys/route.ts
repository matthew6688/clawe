import type { NextRequest } from "next/server";
import { api } from "@clawe/backend";
import { getConfig, patchConfig } from "@clawe/shared/squadhub";
import { getAuthenticatedTenant } from "@/lib/api/tenant-auth";
import { createApiRequestLogger } from "@/lib/api/request-logger";

const PATCH_TIMEOUT_MS = 4000;
const DEFAULT_KIMI_MODEL = "kimi-coding/k2p5";
const DEFAULT_OPENAI_MODEL = "openai/gpt-4o-mini";
const DEFAULT_ANTHROPIC_MODEL = "anthropic/claude-sonnet-4-20250514";
const DEFAULT_GATEWAY_TOOLS = [
  "gateway",
  "sessions_list",
  "sessions_send",
  "message",
  "cron",
  "clawe_pairing",
];
const DEFAULT_AGENT_IDS = new Set(["main", "inky", "pixel", "scout"]);

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out after ${ms}ms`));
    }, ms);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function chooseAgentModel(keys: {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  kimiApiKey?: string;
}): string | undefined {
  if (keys.kimiApiKey) return DEFAULT_KIMI_MODEL;
  if (keys.openaiApiKey) return DEFAULT_OPENAI_MODEL;
  if (keys.anthropicApiKey) return DEFAULT_ANTHROPIC_MODEL;
  return undefined;
}

function patchDefaultAgentModels(
  config: Record<string, unknown> | undefined,
  model: string | undefined,
): Record<string, unknown>[] | undefined {
  if (!model || !config) return undefined;

  const agents = config.agents;
  if (!agents || typeof agents !== "object") return undefined;

  const list = (agents as { list?: unknown }).list;
  if (!Array.isArray(list)) return undefined;

  const updated = list.map((agent) => {
    if (!agent || typeof agent !== "object") return agent as never;

    const agentRecord = agent as Record<string, unknown>;
    const id = agentRecord.id;
    if (typeof id !== "string" || !DEFAULT_AGENT_IDS.has(id)) {
      return agentRecord;
    }

    return { ...agentRecord, model };
  });

  return updated as Record<string, unknown>[];
}

/**
 * POST /api/tenant/api-keys
 * Save tenant API keys and best-effort patch Squadhub config.
 */
export async function POST(request: NextRequest) {
  const reqLog = createApiRequestLogger(request, "tenant/api-keys");
  let auth: Awaited<ReturnType<typeof getAuthenticatedTenant>>;
  try {
    auth = await getAuthenticatedTenant(request);
  } catch (error) {
    return reqLog.fail(401, error, {
      operation: "api_keys.auth",
    });
  }
  if (auth.error) {
    return reqLog.finish(auth.error, "request.auth_failed");
  }

  try {
    const body = (await request.json()) as {
      anthropicApiKey?: string | null;
      openaiApiKey?: string | null;
      kimiApiKey?: string | null;
    };

    const anthropicApiKey = body.anthropicApiKey?.trim() || undefined;
    const inputOpenaiApiKey = body.openaiApiKey?.trim() || undefined;
    const inputKimiApiKey = body.kimiApiKey?.trim() || undefined;
    const kimiApiKey =
      inputKimiApiKey ||
      (inputOpenaiApiKey?.startsWith("sk-kimi-")
        ? inputOpenaiApiKey
        : undefined);
    const openaiApiKey =
      inputOpenaiApiKey && !inputOpenaiApiKey.startsWith("sk-kimi-")
        ? inputOpenaiApiKey
        : undefined;
    const effectiveKimiApiKey =
      kimiApiKey ||
      auth.tenant.kimiApiKey ||
      (auth.tenant.openaiApiKey?.startsWith("sk-kimi-")
        ? auth.tenant.openaiApiKey
        : undefined);
    const effectiveOpenaiApiKey =
      openaiApiKey ||
      (auth.tenant.openaiApiKey?.startsWith("sk-kimi-")
        ? undefined
        : auth.tenant.openaiApiKey);
    const effectiveAnthropicApiKey =
      anthropicApiKey || auth.tenant.anthropicApiKey;
    const preferredModel = chooseAgentModel({
      anthropicApiKey: effectiveAnthropicApiKey,
      openaiApiKey: effectiveOpenaiApiKey,
      kimiApiKey: effectiveKimiApiKey,
    });

    reqLog.log.info(
      {
        hasAnthropicInput: !!anthropicApiKey,
        hasOpenAIInput: !!openaiApiKey,
        hasKimiInput: !!kimiApiKey,
        preferredModel: preferredModel ?? null,
      },
      "api_keys.input_normalized",
    );

    await auth.convex.mutation(api.tenants.setApiKeys, {
      anthropicApiKey,
      openaiApiKey,
      kimiApiKey,
    });

    let patched = false;
    let patchError: string | undefined;

    if (auth.tenant.squadhubUrl && auth.tenant.squadhubToken) {
      try {
        reqLog.log.info(
          {
            patchTimeoutMs: PATCH_TIMEOUT_MS,
            hasTenantSquadhubConnection: true,
          },
          "api_keys.patch_started",
        );

        const env: Record<string, string> = {};
        if (anthropicApiKey) {
          env.ANTHROPIC_API_KEY = anthropicApiKey;
        }
        if (openaiApiKey) {
          env.OPENAI_API_KEY = openaiApiKey;
        }
        if (kimiApiKey) {
          env.KIMI_API_KEY = kimiApiKey;
        }

        await auth.convex.mutation(api.tenants.updateStatus, {
          status: auth.tenant.status,
          squadhubUrl: auth.tenant.squadhubUrl,
          squadhubToken: auth.tenant.squadhubToken,
        });

        const connection = {
          squadhubUrl: auth.tenant.squadhubUrl,
          squadhubToken: auth.tenant.squadhubToken,
        };

        let currentConfig: Record<string, unknown> | undefined;
        let baseHash: string | undefined;
        const configResult = await withTimeout(
          getConfig(connection),
          PATCH_TIMEOUT_MS,
        );
        if (configResult.ok) {
          const details = configResult.result.details as {
            config?: Record<string, unknown>;
            hash?: string;
          };
          currentConfig = details.config;
          baseHash = details.hash;
        }

        const patchPayload: Record<string, unknown> = {
          env,
          tools: {
            sessions: {
              visibility: "all",
            },
          },
          gateway: {
            tools: {
              allow: DEFAULT_GATEWAY_TOOLS,
            },
          },
        };

        const updatedAgents = patchDefaultAgentModels(
          currentConfig,
          preferredModel,
        );
        if (updatedAgents) {
          patchPayload.agents = { list: updatedAgents };
        }

        const patchResult = await withTimeout(
          patchConfig(connection, patchPayload, baseHash),
          PATCH_TIMEOUT_MS,
        );
        if (!patchResult.ok) {
          throw new Error(patchResult.error.message);
        }

        patched = true;
        reqLog.log.info(
          {
            patched,
            preferredModel: preferredModel ?? null,
          },
          "api_keys.patch_completed",
        );
      } catch (error) {
        patchError = error instanceof Error ? error.message : "Patch failed";
        reqLog.log.warn(
          {
            patchError,
          },
          "api_keys.patch_failed",
        );
      }
    } else {
      reqLog.log.info(
        {
          hasTenantSquadhubConnection: false,
        },
        "api_keys.patch_skipped",
      );
    }

    return reqLog.json(
      200,
      { ok: true, patched, patchError },
      "api_keys.saved",
      {
        patched,
        hasPatchError: !!patchError,
      },
    );
  } catch (error) {
    return reqLog.fail(500, error, {
      operation: "api_keys.save",
    });
  }
}
