"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@clawe/backend";
import { cn } from "@clawe/ui/lib/utils";
import { ScrollArea } from "@clawe/ui/components/scroll-area";
import { useChat } from "@/hooks/use-chat";
import { useAutoScroll } from "@/hooks/use-auto-scroll";
import { useApiClient } from "@/hooks/use-api-client";
import { ChatHeader } from "./chat-header";
import { ChatMessages } from "./chat-messages";
import { ChatInput } from "./chat-input";
import { ChatScrollButton } from "./chat-scroll-button";
import type { MentionAgent } from "./chat-input";
import type { ChatAttachment } from "./types";

type OpenclawAgentRecord = {
  agentId?: string;
  sessionKey: string;
  convexAgent?: {
    id?: string;
    name?: string;
    emoji?: string;
    status?: "online" | "offline";
  } | null;
  openclawAgent?: {
    id?: string;
    name?: string;
    identity?: {
      name?: string;
      emoji?: string;
    };
  };
};

type OpenclawAgentsResponse = {
  ok?: boolean;
  agents?: OpenclawAgentRecord[];
};

const DEFAULT_MENTION_AGENTS: MentionAgent[] = [
  {
    id: "default-clawe",
    name: "Clawe",
    sessionKey: "agent:main:main",
    emoji: "🦞",
    status: "offline",
  },
  {
    id: "default-inky",
    name: "Inky",
    sessionKey: "agent:inky:main",
    emoji: "✍️",
    status: "offline",
  },
  {
    id: "default-pixel",
    name: "Pixel",
    sessionKey: "agent:pixel:main",
    emoji: "🎨",
    status: "offline",
  },
  {
    id: "default-scout",
    name: "Scout",
    sessionKey: "agent:scout:main",
    emoji: "🔎",
    status: "offline",
  },
];

const prettifyAgentName = (raw?: string): string => {
  if (!raw) return "Agent";
  return raw
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

export type ChatProps = {
  sessionKey: string;
  mode?: "panel" | "full";
  onClose?: () => void;
  className?: string;
  /** Hide the header (title and border) */
  hideHeader?: boolean;
  /** Auto-send this message when history is empty after loading */
  autoSendMessage?: string;
};

export const Chat = ({
  sessionKey,
  mode = "full",
  onClose,
  className,
  hideHeader = false,
  autoSendMessage,
}: ChatProps) => {
  const {
    messages,
    input,
    setInput,
    error,
    sendMessage,
    loadHistory,
    abort,
    isLoading,
    isStreaming,
  } = useChat({ sessionKey });
  const apiClient = useApiClient();
  const agents = useQuery(api.agents.list, {});
  const [openclawAgents, setOpenclawAgents] = useState<MentionAgent[]>([]);

  const { scrollRef, showScrollButton, scrollToBottom } = useAutoScroll();
  const autoSendTriggered = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const loadOpenclawAgents = async () => {
      try {
        const { data } = await apiClient.get<OpenclawAgentsResponse>(
          "/api/tenant/agents/openclaw",
        );
        if (!data?.ok || !Array.isArray(data.agents) || cancelled) return;

        const mapped: MentionAgent[] = data.agents
          .filter((entry): entry is OpenclawAgentRecord => !!entry?.sessionKey)
          .map((entry) => {
            const id =
              entry.convexAgent?.id ||
              `openclaw:${entry.sessionKey || entry.agentId || "agent"}`;
            const status =
              entry.convexAgent?.status === "online" ||
              entry.convexAgent?.status === "offline"
                ? entry.convexAgent.status
                : "offline";
            const name =
              entry.convexAgent?.name ||
              entry.openclawAgent?.identity?.name ||
              entry.openclawAgent?.name ||
              prettifyAgentName(entry.agentId);
            const emoji =
              entry.convexAgent?.emoji || entry.openclawAgent?.identity?.emoji;

            return {
              id,
              name,
              sessionKey: entry.sessionKey,
              emoji,
              status,
            };
          });

        if (mapped.length === 0) return;
        setOpenclawAgents(mapped);
      } catch {
        // Ignore fallback source failures; Convex list remains primary.
      }
    };

    void loadOpenclawAgents();

    return () => {
      cancelled = true;
    };
  }, [apiClient]);

  const mentionAgents = useMemo(() => {
    const merged = new Map<string, MentionAgent>();

    for (const agent of agents ?? []) {
      if (!agent.sessionKey) continue;
      merged.set(agent.sessionKey, {
        id: agent._id,
        name: agent.name,
        sessionKey: agent.sessionKey,
        emoji: agent.emoji,
        status: agent.status,
      });
    }

    for (const agent of openclawAgents) {
      if (!agent.sessionKey || merged.has(agent.sessionKey)) continue;
      merged.set(agent.sessionKey, agent);
    }

    if (merged.size === 0) {
      for (const agent of DEFAULT_MENTION_AGENTS) {
        merged.set(agent.sessionKey, agent);
      }
    }

    return [...merged.values()];
  }, [agents, openclawAgents]);

  // Load history on mount
  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Auto-send message when history is empty (only once)
  useEffect(() => {
    if (
      autoSendMessage &&
      !autoSendTriggered.current &&
      !isLoading &&
      messages.length === 0
    ) {
      autoSendTriggered.current = true;
      sendMessage(autoSendMessage);
    }
  }, [autoSendMessage, isLoading, messages.length, sendMessage]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && mode === "panel" && onClose) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mode, onClose]);

  const handleSend = async (text: string, attachments?: ChatAttachment[]) => {
    await sendMessage(text, attachments);
  };

  const handleStop = () => {
    abort();
  };

  return (
    <div
      className={cn(
        "bg-background flex h-full flex-col",
        mode === "panel" && "border-l",
        mode === "full" && "mx-auto w-full max-w-5xl px-4 md:px-6 lg:px-8",
        className,
      )}
    >
      {!hideHeader && (
        <ChatHeader mode={mode} onClose={onClose} isStreaming={isStreaming} />
      )}

      <div className="relative min-h-0 flex-1">
        <ScrollArea ref={scrollRef} className="h-full">
          <ChatMessages
            messages={messages}
            isLoading={isLoading}
            isStreaming={isStreaming}
            error={error}
          />
        </ScrollArea>

        {showScrollButton && (
          <ChatScrollButton onClick={() => scrollToBottom()} />
        )}
      </div>

      <ChatInput
        value={input}
        onChange={setInput}
        onSend={handleSend}
        onStop={handleStop}
        mentionAgents={mentionAgents}
        isLoading={isLoading}
        isStreaming={isStreaming}
      />
    </div>
  );
};
