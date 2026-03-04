import type { NextRequest } from "next/server";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "@clawe/backend";
import type { Id } from "@clawe/backend/dataModel";
import { sessionsSend } from "@clawe/shared/squadhub";
import { getAuthenticatedTenant } from "@/lib/api/tenant-auth";
import { getConnection } from "@/lib/squadhub/connection";
import { getServerEnvValue } from "@/lib/runtime-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_KIMI_MODEL = "k2p5";
const DEMO_FALLBACK_ENABLED =
  (getServerEnvValue("CLAWE_EDITION") ?? "oss") !== "cloud";
const MAIN_SESSION_KEY = "agent:main:main";
const BROADCAST_MENTION_TOKENS = new Set(["all", "team", "squad", "everyone"]);
const LIGHTWEIGHT_MESSAGES = new Set([
  "hi",
  "hey",
  "hello",
  "test",
  "ping",
  "ok",
  "okay",
]);
const MENTION_PATTERN = /(^|[^a-zA-Z0-9:_-])@([a-zA-Z0-9:_-]+)/;

type ChatRole = "system" | "user" | "assistant";
type ChatMessage = { role: ChatRole; content: string };
type AgentSummary = {
  name: string;
  sessionKey: string;
  status?: string;
};
type MentionTarget = AgentSummary & {
  token: string;
};
type ConvexMutationFn = ConvexHttpClient["mutation"];
type NotificationId = Id<"notifications">;
type SpecialistReply = {
  name: string;
  response: string;
};
type AutoCollabMode = "off" | "intent" | "main" | "always";
type MentionDispatchMode = "async" | "sync";

function resolveAutoCollabMode(mode: string | undefined): AutoCollabMode {
  const normalized = mode?.trim().toLowerCase();
  if (
    normalized === "off" ||
    normalized === "intent" ||
    normalized === "main" ||
    normalized === "always"
  ) {
    return normalized;
  }
  return "main";
}

const AUTO_COLLAB_MODE = resolveAutoCollabMode(
  getServerEnvValue("CLAWE_AUTO_COLLAB_MODE"),
);

function resolveMentionDispatchMode(
  mode: string | undefined,
): MentionDispatchMode {
  const normalized = mode?.trim().toLowerCase();
  return normalized === "async" ? "async" : "sync";
}

const MENTION_DISPATCH_MODE = resolveMentionDispatchMode(
  getServerEnvValue("CLAWE_MENTION_DISPATCH_MODE"),
);

function parseTimeoutSeconds(
  rawValue: string | undefined,
  fallback: number,
): number {
  if (!rawValue) return fallback;
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(5, Math.min(parsed, 300));
}

const TARGET_DISPATCH_TIMEOUT_SECONDS = parseTimeoutSeconds(
  getServerEnvValue("CLAWE_TARGET_DISPATCH_TIMEOUT_SECONDS"),
  75,
);
const COLLAB_TARGET_DISPATCH_TIMEOUT_SECONDS = parseTimeoutSeconds(
  getServerEnvValue("CLAWE_COLLAB_DISPATCH_TIMEOUT_SECONDS"),
  120,
);
const DEFAULT_SESSION_SEND_TIMEOUT_SECONDS = parseTimeoutSeconds(
  getServerEnvValue("CLAWE_SESSION_SEND_TIMEOUT_SECONDS"),
  120,
);
const LEAD_SYNTHESIS_TIMEOUT_SECONDS = parseTimeoutSeconds(
  getServerEnvValue("CLAWE_LEAD_SYNTHESIS_TIMEOUT_SECONDS"),
  45,
);
const CHAT_DEBUG_ENABLED =
  (getServerEnvValue("CLAWE_CHAT_DEBUG") ?? "").trim().toLowerCase() ===
  "true";
const MARK_SYNC_NOTIFICATIONS_DELIVERED =
  (getServerEnvValue("CLAWE_MARK_SYNC_NOTIFICATIONS_DELIVERED") ?? "")
    .trim()
    .toLowerCase() === "true";
const REQUIRE_DELEGATION_CONFIRMATION =
  (getServerEnvValue("CLAWE_REQUIRE_DELEGATION_CONFIRMATION") ?? "true")
    .trim()
    .toLowerCase() !== "false";
const APPEND_LEAD_SYNTHESIS =
  (getServerEnvValue("CLAWE_APPEND_LEAD_SYNTHESIS") ?? "true")
    .trim()
    .toLowerCase() !== "false";

function debugChat(event: string, details: Record<string, unknown>) {
  if (!CHAT_DEBUG_ENABLED) return;
  console.info("[chat.debug]", event, details);
}

function toJsonResponse(status: number, error: string) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function coerceNotificationIds(value: unknown): NotificationId[] {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is NotificationId => typeof id === "string");
}

function normalizeMessages(messages: unknown[]): ChatMessage[] {
  return messages
    .map((m) => {
      if (!m || typeof m !== "object") return null;
      const role = (m as { role?: unknown }).role;
      const content = (m as { content?: unknown }).content;
      if (role !== "system" && role !== "user" && role !== "assistant") {
        return null;
      }
      if (typeof content !== "string" || !content.trim()) return null;
      return { role, content };
    })
    .filter((m): m is ChatMessage => m !== null);
}

function extractProviderError(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const maybeError = (payload as { error?: unknown }).error;
  if (!maybeError || typeof maybeError !== "object") return null;
  const message = (maybeError as { message?: unknown }).message;
  return typeof message === "string" ? message : null;
}

function isQuotaError(message: string | null): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    lower.includes("credit balance is too low") ||
    lower.includes("insufficient_quota") ||
    lower.includes("exceeded your current quota") ||
    lower.includes("insufficient balance")
  );
}

function isKimiKey(apiKey: string): boolean {
  return apiKey.startsWith("sk-kimi-");
}

function buildDemoFallbackReply(messages: ChatMessage[]): string {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const prompt = lastUser?.content?.trim() || "your message";
  return `Demo mode reply: I received "${prompt}". Add credits to Anthropic, OpenAI, or Kimi to enable real model responses.`;
}

function parseMentionsFromText(text: string): string[] {
  const mentionPattern = new RegExp(MENTION_PATTERN.source, "g");
  const mentions: string[] = [];
  let match: RegExpExecArray | null;

  while (true) {
    match = mentionPattern.exec(text);
    if (!match) break;
    const mention = match[2]?.trim();
    if (mention && !mentions.includes(mention)) {
      mentions.push(mention);
    }
  }

  return mentions;
}

function normalizeMentionToken(token: string): string {
  return token.trim().replace(/^@+/, "").toLowerCase();
}

function isAgentSessionKey(sessionKey: string): boolean {
  return /^agent:[^:]+:[^:]+$/i.test(sessionKey);
}

function isRoutableAgent(agent: AgentSummary): boolean {
  const isOnline =
    !agent.status || agent.status.toLowerCase().trim() === "online";
  return isOnline && isAgentSessionKey(agent.sessionKey);
}

function isMentionableAgent(agent: AgentSummary): boolean {
  return isAgentSessionKey(agent.sessionKey);
}

function shouldAutoCollaborate({
  sourceSessionKey,
  collaborationIntent,
  delegationConfirmed,
  hasMentions,
  teammateCount,
  userText,
}: {
  sourceSessionKey: string;
  collaborationIntent: boolean;
  delegationConfirmed: boolean;
  hasMentions: boolean;
  teammateCount: number;
  userText: string;
}): boolean {
  if (!isAgentSessionKey(sourceSessionKey)) return false;
  if (teammateCount <= 0) return false;
  if (hasMentions) return false;
  if (AUTO_COLLAB_MODE === "off") return false;

  const normalizedText = userText.trim().toLowerCase();
  if (!normalizedText || LIGHTWEIGHT_MESSAGES.has(normalizedText)) {
    return false;
  }
  if (
    REQUIRE_DELEGATION_CONFIRMATION &&
    sourceSessionKey === MAIN_SESSION_KEY &&
    !delegationConfirmed
  ) {
    return false;
  }

  if (AUTO_COLLAB_MODE === "always") return true;
  if (AUTO_COLLAB_MODE === "intent") return collaborationIntent;
  if (sourceSessionKey === MAIN_SESSION_KEY) return true;
  return collaborationIntent;
}

function isApproximateTokenMatch(token: string, candidate: string): boolean {
  if (!token || !candidate) return false;
  if (token === candidate) return true;
  // Support short "@ink" style handles for default agents like "inky".
  if (token.length >= 3 && candidate.startsWith(token)) return true;
  if (token.length < 4 || candidate.length < 4) return false;
  if (Math.abs(token.length - candidate.length) > 1) return false;
  if (token[0] !== candidate[0]) return false;

  let i = 0;
  let j = 0;
  let edits = 0;

  while (i < token.length && j < candidate.length) {
    if (token[i] === candidate[j]) {
      i++;
      j++;
      continue;
    }

    edits++;
    if (edits > 1) return false;

    if (token.length > candidate.length) {
      i++;
    } else if (token.length < candidate.length) {
      j++;
    } else {
      i++;
      j++;
    }
  }

  if (i < token.length || j < candidate.length) {
    edits++;
  }

  return edits <= 1;
}

function tokenizeText(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9:_-]+/g)
    .map((token) => token.trim())
    .filter(Boolean);
}

function inferImplicitMentionsFromText(
  text: string,
  agents: AgentSummary[],
  sourceSessionKey: string,
): string[] {
  const tokens = tokenizeText(text);
  const inferred = new Set<string>();

  for (const token of tokens) {
    if (BROADCAST_MENTION_TOKENS.has(token)) {
      inferred.add(token);
      continue;
    }

    for (const agent of agents) {
      if (agent.sessionKey === sourceSessionKey) continue;

      const sessionParts = agent.sessionKey.split(":");
      const agentId = sessionParts[1]?.toLowerCase() || "";
      const normalizedName = agent.name.toLowerCase();

      if (
        isApproximateTokenMatch(token, normalizedName) ||
        isApproximateTokenMatch(token, agentId)
      ) {
        inferred.add(token);
      }
    }
  }

  return [...inferred];
}

function isCollaborationIntent(text: string): boolean {
  return (
    /(?:\bcollaborat|\bdelegate|\bteam|\bmulti-agent|\bdivide\b|\bassign\b)/i.test(
      text,
    ) || /协作|分工|团队|一起|拆分任务|共同完成/.test(text)
  );
}

function isDelegationConfirmation(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  return (
    /(?:\b(?:go ahead|proceed|start(?:\s+now|\s+working)?|dispatch|delegate|assign|route|kick off|execute(?:\s+now)?|that'?s all|nothing else|no further (?:details|info|information|context)|no more (?:details|info|information|context))\b)/i.test(
      trimmed,
    ) || /开始分工|开始执行|现在分配|可以分配|去执行|不用再问|没有更多(?:信息|内容|补充)?|没其他(?:了|补充)?|就这些|以上/.test(trimmed)
  );
}

function buildClarificationOnlyPrompt(userMessage: string): string {
  return [
    "SYSTEM POLICY: clarification-only mode is active for this turn.",
    "Do NOT create tasks, do NOT assign/delegate work, and do NOT send notifications to other agents.",
    "First ask clarifying questions and summarize understanding.",
    "Only ask for explicit user confirmation to start delegation.",
    `User message: ${userMessage}`,
  ].join("\n\n");
}

function resolveMentionTargets(
  agents: AgentSummary[],
  mentions: string[],
  sourceSessionKey: string,
): MentionTarget[] {
  const targets = new Map<string, MentionTarget>();

  for (const rawMention of mentions) {
    const mention = normalizeMentionToken(rawMention);
    if (!mention) continue;

    if (BROADCAST_MENTION_TOKENS.has(mention)) {
      for (const agent of agents) {
        if (agent.sessionKey === sourceSessionKey) continue;
        targets.set(agent.sessionKey, {
          token: mention,
          name: agent.name,
          sessionKey: agent.sessionKey,
        });
      }
      continue;
    }

    for (const agent of agents) {
      if (agent.sessionKey === sourceSessionKey) continue;

      const sessionParts = agent.sessionKey.split(":");
      const agentId = sessionParts[1]?.toLowerCase() || "";
      const normalizedName = agent.name.toLowerCase();
      const normalizedSessionKey = agent.sessionKey.toLowerCase();

      if (
        mention === normalizedName ||
        mention === agentId ||
        mention === normalizedSessionKey ||
        isApproximateTokenMatch(mention, normalizedName) ||
        isApproximateTokenMatch(mention, agentId)
      ) {
        targets.set(agent.sessionKey, {
          token: mention,
          name: agent.name,
          sessionKey: agent.sessionKey,
        });
      }
    }
  }

  return [...targets.values()];
}

function stripMentions(text: string): string {
  const mentionPattern = new RegExp(MENTION_PATTERN.source, "g");
  return text.replace(mentionPattern, "$1 ").replace(/\s+/g, " ").trim();
}

function extractSessionsSendReply(
  result: Awaited<ReturnType<typeof sessionsSend>>,
): string | null {
  if (!result.ok) return null;

  const parseReplyPayload = (rawValue: string): string | null => {
    const raw = rawValue.trim();
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw) as {
        status?: unknown;
        reply?: unknown;
      };
      const parsedReply =
        typeof parsed?.reply === "string" ? parsed.reply.trim() : "";
      if (parsedReply) return parsedReply;
      if (typeof parsed?.status === "string" && parsed.status !== "ok") {
        return null;
      }
    } catch {
      // Non-JSON payloads are valid plain-text replies.
    }

    return raw;
  };

  const detailsResponse = (
    result.result.details as { response?: unknown } | undefined
  )?.response;
  if (typeof detailsResponse === "string" && detailsResponse.trim()) {
    const parsed = parseReplyPayload(detailsResponse);
    if (parsed) return parsed;
  }

  const text = result.result.content
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();

  if (!text) return null;
  return parseReplyPayload(text);
}

function buildQueuedDispatchReply(targets: MentionTarget[]): string {
  return `Routed to ${targets.map((target) => target.name).join(", ")}. They were notified and will pick this up shortly.`;
}

function buildLeadSynthesisPrompt({
  sourceName,
  userRequest,
  specialistReplies,
}: {
  sourceName: string;
  userRequest: string;
  specialistReplies: SpecialistReply[];
}): string {
  const updates = specialistReplies
    .map((reply, index) => `${index + 1}. ${reply.name}: ${reply.response}`)
    .join("\n");
  return [
    `You are ${sourceName}, the squad lead.`,
    "Create a concise team synthesis for the user with: goal, task split, and immediate next step.",
    `User request: ${userRequest || "(no explicit request provided)"}`,
    "Specialist updates:",
    updates,
  ].join("\n\n");
}

async function appendLeadSynthesis({
  tenant,
  sourceSessionKey,
  sourceName,
  userRequest,
  dispatchReply,
  specialistReplies,
}: {
  tenant: Parameters<typeof getConnection>[0];
  sourceSessionKey: string;
  sourceName: string;
  userRequest: string;
  dispatchReply: string;
  specialistReplies: SpecialistReply[];
}): Promise<{ reply: string; appended: boolean }> {
  if (!APPEND_LEAD_SYNTHESIS) return { reply: dispatchReply, appended: false };
  if (!isAgentSessionKey(sourceSessionKey)) {
    return { reply: dispatchReply, appended: false };
  }
  if (specialistReplies.length < 2) {
    return { reply: dispatchReply, appended: false };
  }

  try {
    const synthesisResult = await sessionsSend(
      getConnection(tenant),
      sourceSessionKey,
      buildLeadSynthesisPrompt({
        sourceName,
        userRequest,
        specialistReplies,
      }),
      LEAD_SYNTHESIS_TIMEOUT_SECONDS,
    );
    const synthesisText = extractSessionsSendReply(synthesisResult);
    if (!synthesisText) return { reply: dispatchReply, appended: false };

    return {
      reply: `${dispatchReply}\n\n${sourceName}: ${synthesisText}`,
      appended: true,
    };
  } catch {
    return { reply: dispatchReply, appended: false };
  }
}

function toMentionTarget(agent: AgentSummary, token: string): MentionTarget {
  return {
    token,
    name: agent.name,
    sessionKey: agent.sessionKey,
  };
}

async function dispatchMentionedMessage({
  sourceSessionKey,
  sourceName,
  message,
  targets,
  tenant,
  timeoutSeconds,
}: {
  sourceSessionKey: string;
  sourceName: string;
  message: string;
  targets: MentionTarget[];
  tenant: Parameters<typeof getConnection>[0];
  timeoutSeconds?: number;
}): Promise<{
  reply: string;
  successes: number;
  specialistReplies: SpecialistReply[];
}> {
  const connection = getConnection(tenant);
  const prompt =
    message.trim() || "You were mentioned with no additional text.";
  const responseLines: string[] = [];
  const specialistReplies: SpecialistReply[] = [];
  const dispatchResults = await Promise.all(
    targets.map(async (target) => {
      const routedPrompt = [
        `Message routed from ${sourceName} (${sourceSessionKey}).`,
        `Please respond as ${target.name}.`,
        `User request: ${prompt}`,
      ].join("\n\n");

      try {
        const result = await sessionsSend(
          connection,
          target.sessionKey,
          routedPrompt,
          timeoutSeconds ?? TARGET_DISPATCH_TIMEOUT_SECONDS,
        );
        return {
          target,
          response: extractSessionsSendReply(result),
        };
      } catch {
        return {
          target,
          response: null,
        };
      }
    }),
  );

  let successCount = 0;
  const pendingAgents: string[] = [];
  for (const item of dispatchResults) {
    if (item.response) {
      responseLines.push(`${item.target.name}: ${item.response}`);
      specialistReplies.push({
        name: item.target.name,
        response: item.response,
      });
      successCount++;
    } else {
      pendingAgents.push(item.target.name);
    }
  }

  debugChat("mention_dispatch_results", {
    sourceSessionKey,
    sourceName,
    targetCount: targets.length,
    successCount,
    pendingAgents,
  });

  if (responseLines.length > 0) {
    if (pendingAgents.length > 0) {
      responseLines.push(
        `Pending: ${pendingAgents.join(", ")} (still processing or timed out)`,
      );
    }
    return {
      reply: responseLines.join("\n\n"),
      successes: successCount,
      specialistReplies,
    };
  }

  return {
    reply: `Routed to ${targets.map((t) => t.name).join(", ")}. They were notified and will pick this up shortly.`,
    successes: 0,
    specialistReplies: [],
  };
}

async function notifyTargets({
  convex,
  sourceSessionKey,
  sourceName,
  dispatchMessage,
  targets,
}: {
  convex: { mutation: ConvexMutationFn };
  sourceSessionKey: string;
  sourceName: string;
  dispatchMessage: string;
  targets: MentionTarget[];
}): Promise<NotificationId[]> {
  if (targets.length === 0) return [];

  const content = `${sourceName}: ${dispatchMessage || "(no text provided)"}`;
  if (targets.length === 1) {
    const target = targets[0];
    if (!target) return [];
    const id = await convex.mutation(api.notifications.send, {
      targetSessionKey: target.sessionKey,
      sourceSessionKey,
      type: "message_received",
      content,
    });
    return typeof id === "string" ? [id as NotificationId] : [];
  }

  const ids = await convex.mutation(api.notifications.sendToMany, {
    targetSessionKeys: targets.map((target) => target.sessionKey),
    sourceSessionKey,
    type: "message_received",
    content,
  });
  return coerceNotificationIds(ids);
}

async function markNotificationsDelivered({
  convex,
  notificationIds,
}: {
  convex: { mutation: ConvexMutationFn };
  notificationIds: NotificationId[];
}) {
  if (notificationIds.length === 0) return;
  await convex.mutation(api.notifications.markDelivered, {
    notificationIds,
  });
}

async function callAnthropic(
  messages: ChatMessage[],
  apiKey: string,
): Promise<string> {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const thread = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  if (thread.length === 0) {
    throw new Error("No user/assistant messages provided");
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: DEFAULT_ANTHROPIC_MODEL,
      max_tokens: 1024,
      ...(system ? { system } : {}),
      messages: thread,
    }),
  });

  const payload = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };

  if (!response.ok) {
    throw new Error(
      extractProviderError(payload) ||
        `Anthropic request failed (${response.status})`,
    );
  }

  const text = (payload.content || [])
    .filter((c) => c?.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("");

  if (!text.trim()) {
    throw new Error("Anthropic returned an empty response");
  }

  return text;
}

async function callOpenAI(
  messages: ChatMessage[],
  apiKey: string,
): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEFAULT_OPENAI_MODEL,
      messages,
      stream: false,
    }),
  });

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };

  if (!response.ok) {
    throw new Error(
      extractProviderError(payload) ||
        `OpenAI request failed (${response.status})`,
    );
  }

  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim()) {
    return content;
  }
  if (Array.isArray(content)) {
    const text = content
      .filter(
        (c): c is { type: string; text?: string } =>
          !!c && typeof c === "object" && "type" in c && c.type === "text",
      )
      .map((c) => c.text || "")
      .join("");
    if (text.trim()) return text;
  }

  throw new Error("OpenAI returned an empty response");
}

async function callKimiCoding(
  messages: ChatMessage[],
  apiKey: string,
): Promise<string> {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const thread = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  if (thread.length === 0) {
    throw new Error("No user/assistant messages provided");
  }

  const response = await fetch("https://api.kimi.com/coding/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: getServerEnvValue("KIMI_MODEL") ?? DEFAULT_KIMI_MODEL,
      max_tokens: 1024,
      ...(system ? { system } : {}),
      messages: thread,
    }),
  });

  const payload = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };

  if (!response.ok) {
    throw new Error(
      extractProviderError(payload) ||
        `Kimi request failed (${response.status})`,
    );
  }

  const text = (payload.content || [])
    .filter((c) => c?.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("");

  if (!text.trim()) {
    throw new Error("Kimi returned an empty response");
  }

  return text;
}

/**
 * POST /api/chat
 * Primary path: route user message to Squadhub session (real agent execution).
 * Fallback path: direct provider response (Anthropic/OpenAI/Kimi) when session routing fails.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedTenant(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    const { messages, sessionKey, mentions, routedMessage } = body as {
      messages?: unknown[];
      sessionKey?: unknown;
      mentions?: unknown;
      routedMessage?: unknown;
    };

    if (!sessionKey || typeof sessionKey !== "string") {
      return toJsonResponse(400, "sessionKey is required");
    }

    if (!messages || !Array.isArray(messages)) {
      return toJsonResponse(400, "messages is required");
    }

    const normalizedMessages = normalizeMessages(messages);
    if (normalizedMessages.length === 0) {
      return toJsonResponse(400, "No valid messages provided");
    }

    const lastUserMessage = [...normalizedMessages]
      .reverse()
      .find((m) => m.role === "user");
    const lastUserContent = lastUserMessage?.content?.trim() || "";
    const explicitMentions = Array.isArray(mentions)
      ? mentions
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim())
          .filter(Boolean)
      : [];
    const extractedMentions = parseMentionsFromText(lastUserContent);
    const mergedMentions = [
      ...new Set([...explicitMentions, ...extractedMentions]),
    ];
    const dispatchMessage =
      (typeof routedMessage === "string" ? routedMessage : "").trim() ||
      stripMentions(lastUserContent) ||
      lastUserContent;

    const collaborationIntent = isCollaborationIntent(lastUserContent);
    const delegationConfirmed = isDelegationConfirmation(lastUserContent);
    const shouldInspectAgentRouting =
      mergedMentions.length > 0 ||
      collaborationIntent ||
      (isAgentSessionKey(sessionKey) && AUTO_COLLAB_MODE !== "off");
    const listedAgents = shouldInspectAgentRouting
      ? ((await auth.convex.query(api.agents.list, {})) as AgentSummary[])
      : [];
    const routableAgents = listedAgents.filter(isRoutableAgent);
    const mentionableAgents = listedAgents.filter(isMentionableAgent);
    const teammateAgents = routableAgents.filter(
      (agent) => agent.sessionKey !== sessionKey,
    );
    const inferredMentions =
      mergedMentions.length === 0
        ? inferImplicitMentionsFromText(
            lastUserContent,
            routableAgents,
            sessionKey,
          )
        : [];
    const routingMentions =
      mergedMentions.length > 0 ? mergedMentions : inferredMentions;
    const autoCollaborationRequested = shouldAutoCollaborate({
      sourceSessionKey: sessionKey,
      collaborationIntent,
      delegationConfirmed,
      hasMentions: routingMentions.length > 0,
      teammateCount: teammateAgents.length,
      userText: lastUserContent,
    });

    debugChat("routing_evaluated", {
      sourceSessionKey: sessionKey,
      hasExplicitMentions: mergedMentions.length > 0,
      routingMentions,
      collaborationIntent,
      delegationConfirmed,
      requireDelegationConfirmation: REQUIRE_DELEGATION_CONFIRMATION,
      autoCollaborationRequested,
      routableAgentCount: routableAgents.length,
      teammateAgentCount: teammateAgents.length,
    });

    let cachedSourceName: string | null = null;
    const getSourceName = async () => {
      if (cachedSourceName) return cachedSourceName;
      const sourceAgent = await auth.convex.query(api.agents.getBySessionKey, {
        sessionKey,
      });
      cachedSourceName =
        sourceAgent?.name ||
        (sessionKey === MAIN_SESSION_KEY ? "You" : sessionKey);
      return cachedSourceName;
    };

    if (routingMentions.length > 0) {
      const mentionTargets = resolveMentionTargets(
        mentionableAgents,
        routingMentions,
        sessionKey,
      );
      const targets = collaborationIntent
        ? [
            ...new Map(
              [
                ...mentionTargets,
                ...teammateAgents.map((agent) =>
                  toMentionTarget(agent, "auto-collab"),
                ),
              ].map((target) => [target.sessionKey, target]),
            ).values(),
          ]
        : mentionTargets;

      if (targets.length > 0) {
        const sourceName = await getSourceName();
        const targetSessionKeys = targets.map((target) => target.sessionKey);

        debugChat("mention_dispatch_started", {
          sourceSessionKey: sessionKey,
          sourceName,
          targetSessionKeys,
          targetCount: targets.length,
          collaborationIntent,
        });

        const notificationIds = await notifyTargets({
          convex: auth.convex,
          sourceSessionKey: sessionKey,
          sourceName,
          dispatchMessage,
          targets,
        });

        const isCollaborativeRoute = collaborationIntent || targets.length > 1;
        if (MENTION_DISPATCH_MODE === "async") {
          debugChat("mention_dispatch_completed", {
            sourceSessionKey: sessionKey,
            sourceName,
            targetSessionKeys,
            successCount: 0,
            isCollaborativeRoute,
            mode: "async",
          });
          return new Response(buildQueuedDispatchReply(targets), {
            status: 200,
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
              "X-Clawe-Mention-Routed": "true",
              "X-Clawe-Mention-Targets": targets
                .map((t) => t.sessionKey)
                .join(","),
              "X-Clawe-Mention-Successes": "0",
              "X-Clawe-Auto-Collab": isCollaborativeRoute ? "true" : "false",
              "X-Clawe-Collab-Async": "true",
            },
          });
        }

        if (MARK_SYNC_NOTIFICATIONS_DELIVERED) {
          await markNotificationsDelivered({
            convex: auth.convex,
            notificationIds,
          });
        }

        const dispatch = await dispatchMentionedMessage({
          sourceSessionKey: sessionKey,
          sourceName,
          message: dispatchMessage,
          targets,
          tenant: auth.tenant,
          timeoutSeconds: isCollaborativeRoute
            ? COLLAB_TARGET_DISPATCH_TIMEOUT_SECONDS
            : TARGET_DISPATCH_TIMEOUT_SECONDS,
        });
        const withSynthesis = await appendLeadSynthesis({
          tenant: auth.tenant,
          sourceSessionKey: sessionKey,
          sourceName,
          userRequest: dispatchMessage,
          dispatchReply: dispatch.reply,
          specialistReplies: dispatch.specialistReplies,
        });

        debugChat("mention_dispatch_completed", {
          sourceSessionKey: sessionKey,
          sourceName,
          targetSessionKeys,
          successCount: dispatch.successes,
          isCollaborativeRoute,
          mode: "sync",
          leadSynthesisAppended: withSynthesis.appended,
        });

        return new Response(withSynthesis.reply, {
          status: 200,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "X-Clawe-Mention-Routed": "true",
            "X-Clawe-Mention-Targets": targets
              .map((t) => t.sessionKey)
              .join(","),
            "X-Clawe-Mention-Successes": String(dispatch.successes),
            "X-Clawe-Auto-Collab": isCollaborativeRoute ? "true" : "false",
            "X-Clawe-Collab-Async": "false",
          },
        });
      }
    }

    if (autoCollaborationRequested) {
      const sourceName = await getSourceName();
      const collabTargets = teammateAgents.map((agent) =>
        toMentionTarget(agent, "auto-collab"),
      );

      if (collabTargets.length > 0) {
        const targetSessionKeys = collabTargets.map(
          (target) => target.sessionKey,
        );

        debugChat("auto_collab_dispatch_started", {
          sourceSessionKey: sessionKey,
          sourceName,
          targetSessionKeys,
          targetCount: collabTargets.length,
        });

        const notificationIds = await notifyTargets({
          convex: auth.convex,
          sourceSessionKey: sessionKey,
          sourceName,
          dispatchMessage,
          targets: collabTargets,
        });

        if (MENTION_DISPATCH_MODE === "async") {
          debugChat("auto_collab_dispatch_completed", {
            sourceSessionKey: sessionKey,
            sourceName,
            targetSessionKeys,
            successCount: 0,
            mode: "async",
          });

          return new Response(buildQueuedDispatchReply(collabTargets), {
            status: 200,
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
              "X-Clawe-Auto-Collab": "true",
              "X-Clawe-Mention-Targets": collabTargets
                .map((t) => t.sessionKey)
                .join(","),
              "X-Clawe-Mention-Successes": "0",
              "X-Clawe-Collab-Async": "true",
            },
          });
        }

        if (MARK_SYNC_NOTIFICATIONS_DELIVERED) {
          await markNotificationsDelivered({
            convex: auth.convex,
            notificationIds,
          });
        }

        const dispatch = await dispatchMentionedMessage({
          sourceSessionKey: sessionKey,
          sourceName,
          message: dispatchMessage,
          targets: collabTargets,
          tenant: auth.tenant,
          timeoutSeconds: COLLAB_TARGET_DISPATCH_TIMEOUT_SECONDS,
        });
        const withSynthesis = await appendLeadSynthesis({
          tenant: auth.tenant,
          sourceSessionKey: sessionKey,
          sourceName,
          userRequest: dispatchMessage,
          dispatchReply: dispatch.reply,
          specialistReplies: dispatch.specialistReplies,
        });

        debugChat("auto_collab_dispatch_completed", {
          sourceSessionKey: sessionKey,
          sourceName,
          targetSessionKeys,
          successCount: dispatch.successes,
          mode: "sync",
          leadSynthesisAppended: withSynthesis.appended,
        });

        return new Response(withSynthesis.reply, {
          status: 200,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "X-Clawe-Auto-Collab": "true",
            "X-Clawe-Mention-Targets": collabTargets
              .map((t) => t.sessionKey)
              .join(","),
            "X-Clawe-Mention-Successes": String(dispatch.successes),
            "X-Clawe-Collab-Async": "false",
          },
        });
      }
    }

    // Default chat path: send directly to the target session so agent logic
    // (tools, delegation, memory) runs inside Squadhub.
    const defaultMessage =
      (typeof routedMessage === "string" ? routedMessage : "").trim() ||
      stripMentions(lastUserContent) ||
      lastUserContent;
    if (defaultMessage) {
      const clarificationOnlyMode =
        sessionKey === MAIN_SESSION_KEY &&
        routingMentions.length === 0 &&
        REQUIRE_DELEGATION_CONFIRMATION &&
        !delegationConfirmed;
      const defaultDispatchMessage = clarificationOnlyMode
        ? buildClarificationOnlyPrompt(defaultMessage)
        : defaultMessage;

      debugChat("default_session_dispatch_started", {
        sourceSessionKey: sessionKey,
        messageLength: defaultMessage.length,
        clarificationOnlyMode,
      });

      try {
        const sessionDispatch = await sessionsSend(
          getConnection(auth.tenant),
          sessionKey,
          defaultDispatchMessage,
          DEFAULT_SESSION_SEND_TIMEOUT_SECONDS,
        );

        if (!sessionDispatch.ok) {
          debugChat("default_session_dispatch_error", {
            sourceSessionKey: sessionKey,
            error: sessionDispatch.error?.message ?? "unknown",
          });
        }

        const sessionReply = extractSessionsSendReply(sessionDispatch);
        if (sessionReply) {
          debugChat("default_session_dispatch_completed", {
            sourceSessionKey: sessionKey,
            replyLength: sessionReply.length,
          });
          return new Response(sessionReply, {
            status: 200,
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
              "X-Clawe-Session-Routed": "true",
              "X-Clawe-Session-Key": sessionKey,
              "X-Clawe-Clarification-Only": clarificationOnlyMode
                ? "true"
                : "false",
            },
          });
        }
      } catch (error) {
        debugChat("default_session_dispatch_exception", {
          sourceSessionKey: sessionKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      if (isAgentSessionKey(sessionKey)) {
        return new Response(
          "Agent queue is busy right now. Your message was accepted; progress will appear in Activity shortly.",
          {
            status: 200,
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
              "X-Clawe-Session-Routed": "true",
              "X-Clawe-Session-Key": sessionKey,
              "X-Clawe-Session-Queued": "true",
            },
          },
        );
      }
    }

    const anthropicApiKey = auth.tenant.anthropicApiKey?.trim();
    const storedOpenaiLikeKey = auth.tenant.openaiApiKey?.trim();
    const storedKimiKey = auth.tenant.kimiApiKey?.trim();
    const kimiApiKey =
      storedKimiKey ||
      getServerEnvValue("KIMI_API_KEY") ||
      (storedOpenaiLikeKey && isKimiKey(storedOpenaiLikeKey)
        ? storedOpenaiLikeKey
        : undefined);
    const openaiApiKey =
      storedOpenaiLikeKey && !isKimiKey(storedOpenaiLikeKey)
        ? storedOpenaiLikeKey
        : undefined;

    if (!anthropicApiKey && !openaiApiKey && !kimiApiKey) {
      return toJsonResponse(
        400,
        "No provider API key configured. Add Anthropic, OpenAI, or Kimi key in Settings > API Keys.",
      );
    }

    let text: string | null = null;
    let anthropicError: string | null = null;
    let openaiError: string | null = null;
    let kimiError: string | null = null;

    if (anthropicApiKey) {
      try {
        text = await callAnthropic(normalizedMessages, anthropicApiKey);
      } catch (error) {
        anthropicError =
          error instanceof Error ? error.message : "Anthropic request failed";
      }
    }

    if (!text && openaiApiKey) {
      try {
        text = await callOpenAI(normalizedMessages, openaiApiKey);
      } catch (error) {
        openaiError =
          error instanceof Error ? error.message : "OpenAI request failed";
      }
    }

    if (!text && kimiApiKey) {
      try {
        text = await callKimiCoding(normalizedMessages, kimiApiKey);
      } catch (error) {
        kimiError =
          error instanceof Error ? error.message : "Kimi request failed";
      }
    }

    if (!text) {
      const details = [anthropicError, openaiError, kimiError]
        .filter(Boolean)
        .join(" | ");
      debugChat("provider_fallback_failed", {
        sourceSessionKey: sessionKey,
        anthropicError,
        openaiError,
        kimiError,
      });
      if (
        DEMO_FALLBACK_ENABLED &&
        (isQuotaError(anthropicError) ||
          isQuotaError(openaiError) ||
          isQuotaError(kimiError))
      ) {
        return new Response(buildDemoFallbackReply(normalizedMessages), {
          status: 200,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "X-Clawe-Demo-Fallback": "quota",
          },
        });
      }

      return toJsonResponse(502, details || "No provider produced a response");
    }

    return new Response(text, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (error) {
    console.error("[chat] Error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return toJsonResponse(500, errorMessage);
  }
}
