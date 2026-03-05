"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Send, Square, Paperclip } from "lucide-react";
import { cn } from "@clawe/ui/lib/utils";
import { Button } from "@clawe/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@clawe/ui/components/tooltip";
import { ChatInputTextarea } from "./chat-input-textarea";
import { ChatAttachments } from "./chat-attachments";
import type { ChatAttachment } from "./types";

const MAX_IMAGE_SIZE = 1024;
const IMAGE_QUALITY = 0.8;
const MENTION_WORD_CHAR = /[a-zA-Z0-9:_-]/;
const MENTION_TOKEN_ALLOWED = /^[a-zA-Z0-9:_-]*$/;

export type MentionAgent = {
  id: string;
  name: string;
  sessionKey: string;
  emoji?: string;
  status?: "online" | "offline";
};

type MentionOption = MentionAgent & {
  handle: string;
};

type ActiveMention = {
  start: number;
  end: number;
  query: string;
};

const normalizeHandle = (value: string): string => value.trim().toLowerCase();
const BROADCAST_MENTION_OPTION: MentionOption = {
  id: "broadcast-agent",
  name: "All Agents",
  sessionKey: "mention:broadcast:agent",
  emoji: "🤝",
  status: "online",
  handle: "agent",
};

const deriveMentionHandle = (agent: MentionAgent): string => {
  const parts = agent.sessionKey.split(":");
  const shortFromSession = parts[1]?.trim();
  if (shortFromSession) return normalizeHandle(shortFromSession);

  const fallbackFromName = agent.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (fallbackFromName) return fallbackFromName;
  return normalizeHandle(agent.sessionKey);
};

const findActiveMention = (
  text: string,
  caretPosition: number,
): ActiveMention | null => {
  if (caretPosition < 0 || caretPosition > text.length) return null;

  const beforeCaret = text.slice(0, caretPosition);
  const mentionStart = beforeCaret.lastIndexOf("@");
  if (mentionStart === -1) return null;

  const previousChar = mentionStart > 0 ? text[mentionStart - 1] : "";
  if (previousChar && MENTION_WORD_CHAR.test(previousChar)) return null;

  const query = beforeCaret.slice(mentionStart + 1);
  if (!MENTION_TOKEN_ALLOWED.test(query)) return null;

  return {
    start: mentionStart,
    end: caretPosition,
    query: query.toLowerCase(),
  };
};

/**
 * Compress an image file to reduce payload size.
 */
async function compressImage(file: File): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    img.onload = () => {
      let { width, height } = img;

      if (width > MAX_IMAGE_SIZE || height > MAX_IMAGE_SIZE) {
        if (width > height) {
          height = (height / width) * MAX_IMAGE_SIZE;
          width = MAX_IMAGE_SIZE;
        } else {
          width = (width / height) * MAX_IMAGE_SIZE;
          height = MAX_IMAGE_SIZE;
        }
      }

      canvas.width = width;
      canvas.height = height;
      ctx?.drawImage(img, 0, 0, width, height);

      resolve(canvas.toDataURL("image/jpeg", IMAGE_QUALITY));
    };

    img.onerror = () => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
    };

    const reader = new FileReader();
    reader.onload = () => {
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export type ChatInputProps = {
  value: string;
  onChange: (value: string) => void;
  onSend: (text: string, attachments?: ChatAttachment[]) => void;
  onStop?: () => void;
  mentionAgents?: MentionAgent[];
  isLoading?: boolean;
  isStreaming?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
};

export const ChatInput = ({
  value,
  onChange,
  onSend,
  onStop,
  mentionAgents = [],
  isLoading,
  isStreaming,
  disabled,
  placeholder = "Send a message...",
  className,
}: ChatInputProps) => {
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [activeMention, setActiveMention] = useState<ActiveMention | null>(
    null,
  );
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const canSend =
    !disabled &&
    !isLoading &&
    !isStreaming &&
    (value.trim() || attachments.length > 0);
  const showStop = isStreaming && onStop;
  const mentionOptions = useMemo(() => {
    const options: MentionOption[] = [BROADCAST_MENTION_OPTION];
    const seenSessionKeys = new Set<string>();

    for (const agent of mentionAgents) {
      if (!agent.sessionKey || seenSessionKeys.has(agent.sessionKey)) continue;
      seenSessionKeys.add(agent.sessionKey);
      options.push({
        ...agent,
        handle: deriveMentionHandle(agent),
      });
    }

    return options;
  }, [mentionAgents]);

  const filteredMentionOptions = useMemo(() => {
    if (activeMention === null) return [];

    return mentionOptions.filter((agent) => {
      if (!activeMention.query) return true;
      const query = activeMention.query;
      return (
        agent.handle.includes(query) ||
        agent.name.toLowerCase().includes(query) ||
        agent.sessionKey.toLowerCase().includes(query)
      );
    });
  }, [activeMention, mentionOptions]);
  const isMentionMenuOpen = filteredMentionOptions.length > 0;

  const updateMentionState = useCallback(
    (nextValue?: string) => {
      const textarea = textareaRef.current;
      if (!textarea) {
        setActiveMention(null);
        return;
      }

      const text = nextValue ?? value;
      const selectionStart = textarea.selectionStart ?? text.length;
      setActiveMention(findActiveMention(text, selectionStart));
    },
    [value],
  );

  const selectMention = useCallback(
    (option: MentionOption) => {
      if (!activeMention) return;

      const before = value.slice(0, activeMention.start);
      const after = value.slice(activeMention.end);
      const mentionText = `@${option.handle}`;
      const trailingSpace = /^\s/.test(after) ? "" : " ";
      const nextValue = `${before}${mentionText}${trailingSpace}${after}`;
      const nextCursor = before.length + mentionText.length + trailingSpace.length;

      onChange(nextValue);
      setActiveMention(null);
      setActiveMentionIndex(0);

      requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        textarea.focus();
        textarea.setSelectionRange(nextCursor, nextCursor);
      });
    },
    [activeMention, onChange, value],
  );

  const insertBroadcastMention = useCallback(() => {
    const hasText = value.length > 0;
    const needsLeadingSpace = hasText && !/\s$/.test(value);
    const nextValue = `${value}${needsLeadingSpace ? " " : ""}@agent `;

    onChange(nextValue);
    setActiveMention(null);
    setActiveMentionIndex(0);

    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const cursor = nextValue.length;
      textarea.focus();
      textarea.setSelectionRange(cursor, cursor);
    });
  }, [onChange, value]);

  const handleSend = useCallback(() => {
    if (!canSend) return;
    onSend(value, attachments.length > 0 ? attachments : undefined);
    setAttachments([]);
    setActiveMention(null);
    setActiveMentionIndex(0);
  }, [canSend, value, attachments, onSend]);

  const handleInputChange = useCallback(
    (nextValue: string) => {
      onChange(nextValue);
      updateMentionState(nextValue);
    },
    [onChange, updateMentionState],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (isMentionMenuOpen) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setActiveMentionIndex((prev) =>
            Math.min(prev + 1, filteredMentionOptions.length - 1),
          );
          return;
        }

        if (e.key === "ArrowUp") {
          e.preventDefault();
          setActiveMentionIndex((prev) => Math.max(prev - 1, 0));
          return;
        }

        if (e.key === "Escape") {
          e.preventDefault();
          setActiveMention(null);
          setActiveMentionIndex(0);
          return;
        }

        if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
          e.preventDefault();
          const option =
            filteredMentionOptions[activeMentionIndex] ??
            filteredMentionOptions[0];
          if (option) {
            selectMention(option);
          }
          return;
        }
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [
      activeMentionIndex,
      filteredMentionOptions,
      handleSend,
      isMentionMenuOpen,
      selectMention,
    ],
  );

  const handleAttachmentAdd = useCallback(async (files: FileList) => {
    const imageFiles = Array.from(files).filter((f) =>
      f.type.startsWith("image/"),
    );

    const processed = await Promise.all(
      imageFiles.map(async (file) => ({
        id: `att_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        file,
        dataUrl: await compressImage(file),
        mimeType: "image/jpeg",
        name: file.name,
      })),
    );

    setAttachments((prev) => [...prev, ...processed]);
  }, []);

  const handleAttachmentRemove = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((att) => att.id !== id));
  }, []);

  const handleFileSelect = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.onchange = (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (files) {
        handleAttachmentAdd(files);
      }
    };
    input.click();
  }, [handleAttachmentAdd]);

  const handleCursorEvent = useCallback(() => {
    updateMentionState();
  }, [updateMentionState]);

  useEffect(() => {
    if (!value) {
      setActiveMention(null);
      setActiveMentionIndex(0);
    }
  }, [value]);

  useEffect(() => {
    if (!isMentionMenuOpen) {
      if (activeMentionIndex !== 0) {
        setActiveMentionIndex(0);
      }
      return;
    }

    if (activeMentionIndex >= filteredMentionOptions.length) {
      setActiveMentionIndex(filteredMentionOptions.length - 1);
    }
  }, [activeMentionIndex, filteredMentionOptions.length, isMentionMenuOpen]);

  return (
    <div className={cn("bg-background border-t px-4 py-3", className)}>
      {attachments.length > 0 && (
        <ChatAttachments
          attachments={attachments}
          onRemove={handleAttachmentRemove}
          className="mb-3"
        />
      )}

      <div className="flex items-end gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleFileSelect}
              disabled={disabled || isLoading || isStreaming}
              className="h-10 w-10 shrink-0"
            >
              <Paperclip className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Attach image</TooltipContent>
        </Tooltip>

        <div className="relative flex-1">
          <div className="mb-1 flex items-center">
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground inline-flex items-center rounded-md border px-2 py-0.5 text-xs"
              onClick={insertBroadcastMention}
              disabled={disabled || isLoading || isStreaming}
            >
              @agent
            </button>
          </div>

          {isMentionMenuOpen && (
            <div
              role="listbox"
              aria-label="Mention suggestions"
              className="bg-popover absolute bottom-full left-0 right-0 z-20 mb-2 max-h-56 overflow-y-auto rounded-lg border p-1 shadow-lg"
            >
              {filteredMentionOptions.map((option, index) => (
                <button
                  type="button"
                  key={option.sessionKey}
                  role="option"
                  aria-selected={index === activeMentionIndex}
                  className={cn(
                    "hover:bg-accent hover:text-accent-foreground flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                    index === activeMentionIndex &&
                      "bg-accent text-accent-foreground",
                  )}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectMention(option);
                  }}
                >
                  <span className="text-base leading-none">
                    {option.emoji || "🤖"}
                  </span>
                  <span className="flex-1 truncate">{option.name}</span>
                  <span className="text-muted-foreground text-xs">
                    @{option.handle}
                  </span>
                </button>
              ))}
            </div>
          )}

          <ChatInputTextarea
            ref={textareaRef}
            value={value}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onKeyUp={handleCursorEvent}
            onSelect={handleCursorEvent}
            onClick={handleCursorEvent}
            placeholder={placeholder}
            disabled={disabled || isLoading || isStreaming}
            className="flex-1"
          />
        </div>

        {showStop ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="secondary"
                size="icon"
                onClick={onStop}
                className="h-10 w-10 shrink-0"
              >
                <Square className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Stop generating</TooltipContent>
          </Tooltip>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                onClick={handleSend}
                disabled={!canSend}
                className="h-10 w-10 shrink-0"
              >
                <Send className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Send message</TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
};
