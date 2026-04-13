import { Message, Conversation, Reaction } from "../types";
import { MessageBubble } from "./message-bubble";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { soundEffects } from "@/lib/sound-effects";

/** First scroll after open: instant when returning in-session; smooth on cold load. */
let hasBeenMounted = false;

type MessageListRow =
  | { kind: "message"; message: Message }
  | { kind: "typing"; recipient: string };

interface MessageListProps {
  messages: Message[];
  conversation?: Conversation;
  typingStatus: { conversationId: string; recipient: string } | null;
  conversationId: string | null;
  onReaction?: (messageId: string, reaction: Reaction) => void;
  onReactionComplete?: () => void;
  messageInputRef?: React.RefObject<{ focus: () => void }>;
  isMobileView?: boolean;
}

export function MessageList({
  messages,
  conversation,
  typingStatus,
  conversationId,
  onReaction,
  onReactionComplete,
  messageInputRef,
  isMobileView,
}: MessageListProps) {
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [isAnyReactionMenuOpen, setIsAnyReactionMenuOpen] = useState(false);
  const [lastSentMessageId, setLastSentMessageId] = useState<string | null>(
    null,
  );
  const conversationReadyRef = useRef(false);
  const prevMessageCountRef = useRef(0);
  const messageListRef = useRef<HTMLDivElement>(null);
  const [wasAtBottom, setWasAtBottom] = useState(true);
  const shouldAutoScrollRef = useRef(true);

  const lastUserMessageIndex = messages.findLastIndex(
    (msg) => msg.sender === "me",
  );

  const agentStreamSender =
    conversation?.recipients[0]?.name ??
    (typingStatus?.conversationId === conversationId
      ? typingStatus.recipient
      : undefined) ??
    "Agent";

  const isTypingInThisConversation =
    typingStatus && typingStatus.conversationId === conversationId;
  const showGlobalTypingRow = Boolean(isTypingInThisConversation);
  const normalizeSender = (sender: string) => sender.trim().toLowerCase();
  const toSenderKey = (sender: string) => {
    if (sender === "me" || sender === "system") return sender;

    if (conversation?.isAgentChat && conversation.recipients.length === 1) {
      return `agent:${normalizeSender(conversation.recipients[0].name)}`;
    }

    return `participant:${normalizeSender(sender)}`;
  };

  const rows: MessageListRow[] = [
    ...messages.map((message) => ({ kind: "message" as const, message })),
    ...(showGlobalTypingRow
      ? [
          {
            kind: "typing" as const,
            recipient: typingStatus?.recipient ?? agentStreamSender,
          },
        ]
      : []),
  ];

  const rowSender = (row: MessageListRow) => {
    if (row.kind === "message") return row.message.sender;
    if (row.kind === "typing") return row.recipient;
    return agentStreamSender;
  };

  const rowIsSystem = (row: MessageListRow) =>
    row.kind === "message" && row.message.sender === "system";

  const rowToPreviewMessage = (row: MessageListRow): Message => {
    if (row.kind === "message") return row.message;
    if (row.kind === "typing") {
      return {
        id: "typing",
        content: "",
        sender: row.recipient,
        timestamp: "",
      };
    }
    const exhaustive: never = row;
    return exhaustive;
  };

  const isAtBottom = useCallback(() => {
    const viewport = messageListRef.current?.closest(
      "[data-radix-scroll-area-viewport]",
    ) as HTMLElement;
    if (!viewport) return true;

    const { scrollTop, scrollHeight, clientHeight } = viewport;
    return Math.abs(scrollHeight - clientHeight - scrollTop) < 336;
  }, []);

  useEffect(() => {
    const viewport = messageListRef.current?.closest(
      "[data-radix-scroll-area-viewport]",
    ) as HTMLElement;
    if (!viewport) return;

    let rafId = 0;
    const handleScroll = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        setWasAtBottom(isAtBottom());
      });
    };

    viewport.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      viewport.removeEventListener("scroll", handleScroll);
      cancelAnimationFrame(rafId);
    };
  }, [isAtBottom]);

  useEffect(() => {
    shouldAutoScrollRef.current = wasAtBottom || isAtBottom();
  }, [wasAtBottom, isAtBottom]);

  useEffect(() => {
    const viewport = messageListRef.current?.closest(
      "[data-radix-scroll-area-viewport]",
    ) as HTMLElement;
    if (!viewport) return;

    let isFirstScroll = true;

    const scrollToBottom = () => {
      let behavior: ScrollBehavior = "smooth";
      if (isFirstScroll && hasBeenMounted) {
        behavior = "instant";
      }
      if (isFirstScroll) {
        isFirstScroll = false;
        hasBeenMounted = true;
      }
      const scrollTarget = viewport.scrollHeight - viewport.clientHeight;
      viewport.scrollTo({
        top: scrollTarget,
        behavior,
      });
    };

    const resizeObserver = new ResizeObserver(() => {
      if (isFirstScroll || shouldAutoScrollRef.current) {
        scrollToBottom();
      }
    });

    const content = viewport.firstElementChild;
    if (content) {
      resizeObserver.observe(content);
    }

    return () => resizeObserver.disconnect();
  }, [conversationId]);

  useEffect(() => {
    conversationReadyRef.current = false;
    prevMessageCountRef.current = 0;
  }, [conversationId]);

  useEffect(() => {
    if (!conversationReadyRef.current) {
      conversationReadyRef.current = true;
      prevMessageCountRef.current = messages.length;
      return;
    }

    const isNewMessage = messages.length > prevMessageCountRef.current;
    prevMessageCountRef.current = messages.length;

    if (!isNewMessage || messages.length === 0) return;

    const lastMessage = messages[messages.length - 1];

    if (lastMessage.sender !== "me" && lastMessage.sender !== "system") {
      soundEffects.playReceivedSound();
    }

    if (lastMessage.sender === "me") {
      setLastSentMessageId(lastMessage.id);
      const timer = window.setTimeout(() => {
        setLastSentMessageId(null);
      }, 1000);
      return () => window.clearTimeout(timer);
    }
  }, [messages]);

  return (
    <div ref={messageListRef} className="flex-1 flex flex-col-reverse relative">
      <div className="flex-1 relative">
        {rows.map((row, index) => {
          const prevRow = index > 0 ? rows[index - 1] : undefined;
          const nextRow = index < rows.length - 1 ? rows[index + 1] : undefined;
          const isGroupedWithPrev =
            prevRow !== undefined &&
            !rowIsSystem(row) &&
            !rowIsSystem(prevRow) &&
            toSenderKey(rowSender(prevRow)) === toSenderKey(rowSender(row));
          const isGroupedWithNext =
            nextRow !== undefined &&
            !rowIsSystem(row) &&
            !rowIsSystem(nextRow) &&
            toSenderKey(rowSender(row)) === toSenderKey(rowSender(nextRow));

          if (row.kind === "message") {
            const { message } = row;
            const messageIndex = messages.findIndex((m) => m.id === message.id);
            return (
              <div
                key={message.id}
                data-message-id={message.id}
                className="relative"
              >
                {isAnyReactionMenuOpen && message.id !== activeMessageId && (
                  <div className="absolute inset-0 bg-white/90 dark:bg-[#1A1A1A]/90 pointer-events-none z-20" />
                )}
                <div className={cn(message.id === activeMessageId && "z-30")}>
                  <MessageBubble
                    message={message}
                    previousMessage={
                      prevRow ? rowToPreviewMessage(prevRow) : undefined
                    }
                    isGroupedWithPrev={isGroupedWithPrev}
                    isGroupedWithNext={isGroupedWithNext}
                    isLastUserMessage={messageIndex === lastUserMessageIndex}
                    conversation={conversation}
                    isTyping={false}
                    onReaction={onReaction}
                    onOpenChange={(isOpen) => {
                      setActiveMessageId(isOpen ? message.id : null);
                      setIsAnyReactionMenuOpen(isOpen);
                    }}
                    onReactionComplete={() => {
                      messageInputRef?.current?.focus();
                      onReactionComplete?.();
                    }}
                    justSent={message.id === lastSentMessageId}
                    isMobileView={isMobileView}
                  />
                </div>
              </div>
            );
          }

          if (row.kind === "typing") {
            const typingMessage = rowToPreviewMessage(row);
            return (
              <div key={`typing-${conversationId ?? "unknown"}`}>
                <MessageBubble
                  message={typingMessage}
                  previousMessage={
                    prevRow ? rowToPreviewMessage(prevRow) : undefined
                  }
                  isGroupedWithPrev={isGroupedWithPrev}
                  isGroupedWithNext={isGroupedWithNext}
                  isTyping={true}
                  conversation={conversation}
                  isMobileView={isMobileView}
                />
              </div>
            );
          }
        })}
      </div>
      <div className="h-2 bg-background" />
    </div>
  );
}
