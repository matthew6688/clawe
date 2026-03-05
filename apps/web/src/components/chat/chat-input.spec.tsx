import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatInput } from "./chat-input";

describe("ChatInput", () => {
  const defaultProps = {
    value: "",
    onChange: vi.fn(),
    onSend: vi.fn(),
  };

  const mentionAgents = [
    {
      id: "agent_inky",
      name: "Inky",
      sessionKey: "agent:inky:main",
      emoji: "✍️",
      status: "online" as const,
    },
    {
      id: "agent_scout",
      name: "Scout",
      sessionKey: "agent:scout:main",
      emoji: "🔎",
      status: "online" as const,
    },
  ];

  it("renders textarea with placeholder", () => {
    render(<ChatInput {...defaultProps} />);
    expect(
      screen.getByPlaceholderText("Send a message..."),
    ).toBeInTheDocument();
  });

  it("calls onChange when typing", () => {
    const onChange = vi.fn();
    render(<ChatInput {...defaultProps} onChange={onChange} />);

    fireEvent.change(screen.getByPlaceholderText("Send a message..."), {
      target: { value: "Hello" },
    });

    expect(onChange).toHaveBeenCalledWith("Hello");
  });

  it("disables send button when empty", () => {
    render(<ChatInput {...defaultProps} value="" />);

    const buttons = screen.getAllByRole("button");
    // The last button should be send (disabled when empty)
    const sendButton = buttons[buttons.length - 1];
    expect(sendButton).toBeDisabled();
  });

  it("enables send button when has content", () => {
    render(<ChatInput {...defaultProps} value="Hello" />);

    const buttons = screen.getAllByRole("button");
    const sendButton = buttons[buttons.length - 1];
    expect(sendButton).not.toBeDisabled();
  });

  it("calls onSend when send button clicked", () => {
    const onSend = vi.fn();
    render(<ChatInput {...defaultProps} value="Hello" onSend={onSend} />);

    const buttons = screen.getAllByRole("button");
    const sendButton = buttons[buttons.length - 1];
    if (sendButton) {
      fireEvent.click(sendButton);
    }

    expect(onSend).toHaveBeenCalledWith("Hello", undefined);
  });

  it("shows stop button when streaming", () => {
    const onStop = vi.fn();
    render(<ChatInput {...defaultProps} isStreaming onStop={onStop} />);

    // Should have attach button and stop button
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(2);
  });

  it("calls onStop when stop button clicked", () => {
    const onStop = vi.fn();
    render(<ChatInput {...defaultProps} isStreaming onStop={onStop} />);

    const buttons = screen.getAllByRole("button");
    const stopButton = buttons[buttons.length - 1];
    if (stopButton) {
      fireEvent.click(stopButton);
    }

    expect(onStop).toHaveBeenCalled();
  });

  it("disables input when loading", () => {
    render(<ChatInput {...defaultProps} isLoading />);

    expect(screen.getByPlaceholderText("Send a message...")).toBeDisabled();
  });

  it("disables input when streaming", () => {
    render(<ChatInput {...defaultProps} isStreaming />);

    expect(screen.getByPlaceholderText("Send a message...")).toBeDisabled();
  });

  it("shows attach button", () => {
    render(<ChatInput {...defaultProps} />);

    // First button should be attach
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });

  it("shows mention suggestions when typing @", () => {
    const onChange = vi.fn();
    render(
      <ChatInput
        {...defaultProps}
        onChange={onChange}
        mentionAgents={mentionAgents}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Send a message..."), {
      target: { value: "@" },
    });

    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getByText("All Agents")).toBeInTheDocument();
    expect(screen.getByText("Inky")).toBeInTheDocument();
    expect(screen.getByText("Scout")).toBeInTheDocument();
  });

  it("inserts selected mention handle into input", () => {
    const onChange = vi.fn();
    render(
      <ChatInput
        {...defaultProps}
        value="@"
        onChange={onChange}
        mentionAgents={mentionAgents}
      />,
    );

    const input = screen.getByPlaceholderText(
      "Send a message...",
    ) as HTMLTextAreaElement;
    input.setSelectionRange(1, 1);
    fireEvent.select(input);

    const inkyOption = screen.getByRole("option", { name: /Inky/i });
    fireEvent.mouseDown(inkyOption);

    expect(onChange).toHaveBeenCalledWith("@inky ");
  });

  it("inserts @agent broadcast mention from suggestions", () => {
    const onChange = vi.fn();
    render(
      <ChatInput
        {...defaultProps}
        value="@"
        onChange={onChange}
        mentionAgents={mentionAgents}
      />,
    );

    const input = screen.getByPlaceholderText(
      "Send a message...",
    ) as HTMLTextAreaElement;
    input.setSelectionRange(1, 1);
    fireEvent.select(input);

    const allAgentsOption = screen.getByRole("option", { name: /All Agents/i });
    fireEvent.mouseDown(allAgentsOption);

    expect(onChange).toHaveBeenCalledWith("@agent ");
  });

  it("inserts @agent from quick action button", () => {
    const onChange = vi.fn();
    render(
      <ChatInput
        {...defaultProps}
        value="Please help"
        onChange={onChange}
        mentionAgents={mentionAgents}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "@agent" }));
    expect(onChange).toHaveBeenCalledWith("Please help @agent ");
  });
});
