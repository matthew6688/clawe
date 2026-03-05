"use client";

import { useRef, useCallback, useEffect, forwardRef } from "react";
import { cn } from "@clawe/ui/lib/utils";

export type ChatInputTextareaProps = {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onKeyUp?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSelect?: (e: React.SyntheticEvent<HTMLTextAreaElement>) => void;
  onClick?: (e: React.MouseEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
};

export const ChatInputTextarea = forwardRef<
  HTMLTextAreaElement,
  ChatInputTextareaProps
>(
  (
    {
      value,
      onChange,
      onKeyDown,
      onKeyUp,
      onSelect,
      onClick,
      placeholder,
      disabled,
      className,
    },
    forwardedRef,
  ) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const resize = useCallback(() => {
      const el = textareaRef.current;
      if (!el) return;
      if (!el.value) {
        el.style.height = "";
        return;
      }
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }, []);

    useEffect(() => {
      resize();
    }, [value, resize]);

    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        onChange(e.target.value);
      },
      [onChange],
    );

    const setRefs = useCallback(
      (node: HTMLTextAreaElement | null) => {
        textareaRef.current = node;

        if (!forwardedRef) return;
        if (typeof forwardedRef === "function") {
          forwardedRef(node);
          return;
        }
        forwardedRef.current = node;
      },
      [forwardedRef],
    );

    return (
      <textarea
        ref={setRefs}
        value={value}
        onChange={handleChange}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onSelect={onSelect}
        onClick={onClick}
        placeholder={placeholder}
        disabled={disabled}
        rows={1}
        className={cn(
          "border-input bg-background max-h-40 w-full resize-none overflow-y-auto rounded-lg border px-3 py-2",
          "placeholder:text-muted-foreground text-sm leading-relaxed",
          "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
      />
    );
  },
);

ChatInputTextarea.displayName = "ChatInputTextarea";
