import { cn } from "@/lib/utils";
import { Message, ReactionType, Reaction } from "../types";
import { Conversation } from "../types";
import {
  useCallback,
  useEffect,
  useState,
  useRef,
  type ReactNode,
} from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useTheme } from "next-themes";
import Image from "next/image";
import { soundEffects } from "@/lib/sound-effects";
import { Icons } from "./icons";
import { SilencedNotificationsMessage } from "./silenced-notifications-message";

// Props for the MessageBubble component
interface MessageBubbleProps {
  message: Message;
  previousMessage?: Message;
  /** Same sender as the visually previous bubble (hide name / stack). */
  isGroupedWithPrev?: boolean;
  /** Same sender as the visually next bubble (hide tail; rectangle stack). */
  isGroupedWithNext?: boolean;
  isLastUserMessage?: boolean;
  conversation?: Conversation;
  isTyping?: boolean;
  onReaction?: (messageId: string, reaction: Reaction) => void;
  onOpenChange?: (isOpen: boolean) => void;
  onReactionComplete?: () => void;
  justSent?: boolean;
  isMobileView?: boolean;
}

const typingAnimation = `
@keyframes blink {
  0% { opacity: 0.3; }
  20% { opacity: 1; }
  100% { opacity: 0.3; }
}
`;

function ReceiptLabel({
  status,
  justSent,
}: {
  status?: "delivered" | "read";
  justSent: boolean;
}) {
  if (!status) return null;
  const label = status === "read" ? "Read" : "Delivered";
  const [displayLabel, setDisplayLabel] = useState(label);
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    if (label === displayLabel) return;

    setIsVisible(false);
    const swapTimer = window.setTimeout(() => {
      setDisplayLabel(label);
      setIsVisible(true);
    }, 180);

    return () => window.clearTimeout(swapTimer);
  }, [displayLabel, label]);

  return (
    <span
      className={cn(
        "inline-block transition-opacity duration-200 ease-out",
        isVisible ? "opacity-100" : "opacity-0",
        justSent && "animate-scale-in",
      )}
    >
      {displayLabel}
    </span>
  );
}

export function MessageBubble({
  message,
  previousMessage,
  isGroupedWithPrev = false,
  isGroupedWithNext = false,
  isLastUserMessage,
  conversation,
  isTyping,
  onReaction,
  onOpenChange,
  onReactionComplete,
  justSent = false,
  isMobileView = false,
}: MessageBubbleProps) {
  // Determine message sender type and display name
  const isSystemMessage = message.sender === "system";
  const isMe = message.sender === "me";
  const showRecipientName =
    !isGroupedWithPrev &&
    !isMe &&
    !isSystemMessage &&
    previousMessage?.sender !== message.sender;
  const recipientName = showRecipientName ? message.sender : null;
  const showBubbleTail = !isSystemMessage && !isGroupedWithNext;
  const primaryRecipientName = conversation?.recipients[0]?.name;
  const silencedLabel =
    primaryRecipientName && message.content === "Notifications silenced"
      ? `${primaryRecipientName} has notification silenced`
      : message.content;

  // Map of reaction types to their SVG paths for the menu
  const { theme, systemTheme } = useTheme();
  const effectiveTheme = theme === "system" ? systemTheme : theme;

  const menuReactionIcons = {
    heart: "/reactions/heart-gray.svg",
    like: "/reactions/like-gray.svg",
    dislike: "/reactions/dislike-gray.svg",
    laugh: "/reactions/laugh-gray.svg",
    emphasize: "/reactions/emphasize-gray.svg",
    question: "/reactions/question-gray.svg",
  };

  // State to control the Popover open state and animation
  const [isOpen, setIsOpen] = useState(false);
  const openTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Handler for menu state changes
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        // Menu is closing
        setIsOpen(false);
        onOpenChange?.(false);
      } else {
        // Only open if we're not in a closing state
        if (openTimeoutRef.current) {
          clearTimeout(openTimeoutRef.current);
        }
        openTimeoutRef.current = setTimeout(() => {
          setIsOpen(true);
          onOpenChange?.(true);
        }, 10);
      }
    },
    [onOpenChange],
  );

  // Handler for when a reaction is clicked
  const handleReaction = useCallback(
    (type: ReactionType) => {
      if (onReaction) {
        // Create reaction with current timestamp
        const reaction: Reaction = {
          type,
          sender: "me",
          timestamp: new Date().toISOString(),
        };

        // Play sound for any reaction action
        soundEffects.playReactionSound();

        // Send reaction to parent
        onReaction(message.id, reaction);

        // Close menu and focus input with delay
        setTimeout(() => {
          setIsOpen(false);
          onOpenChange?.(false);
          onReactionComplete?.();
        }, 500);
      }
    },
    [message.id, onReaction, onOpenChange, onReactionComplete],
  );

  // Check if a specific reaction type is already active for the current user
  const isReactionActive = (type: ReactionType) => {
    return (
      message.reactions?.some((r) => r.type === type && r.sender === "me") ??
      false
    );
  };

  const prepareContent = (
    content: string,
    sender: string,
    mentions = message.mentions,
  ) => {
    if (!mentions?.length) return content;

    const colorClass =
      sender === "me" ? "" : "text-[#0A7CFF] dark:text-[#0A7CFF]";
    const nodes: ReactNode[] = [];
    let cursor = 0;

    mentions
      .slice()
      .sort((a, b) => (a.start ?? 0) - (b.start ?? 0))
      .forEach((mention, index) => {
        if (
          typeof mention.start !== "number" ||
          typeof mention.end !== "number" ||
          mention.start < cursor ||
          mention.start < 0 ||
          mention.end > content.length ||
          mention.end <= mention.start
        ) {
          return;
        }

        if (mention.start > cursor) {
          nodes.push(content.slice(cursor, mention.start));
        }

        nodes.push(
          <span
            key={`mention-${mention.id}-${index}`}
            className={cn("font-semibold", colorClass)}
          >
            {content.slice(mention.start, mention.end)}
          </span>,
        );

        cursor = mention.end;
      });

    if (cursor < content.length) {
      nodes.push(content.slice(cursor));
    }

    return <span>{nodes}</span>;
  };

  // Helper function to get reaction verb
  const getReactionVerb = (type: ReactionType) => {
    switch (type) {
      case "heart":
        return "loved";
      case "like":
        return "liked";
      case "dislike":
        return "disliked";
      case "laugh":
        return "laughed at";
      case "emphasize":
        return "emphasized";
      case "question":
        return "questioned";
      default:
        return "reacted to";
    }
  };

  // Helper function to format reactions into a sentence
  const formatReactions = (reactions: Reaction[]) => {
    const sortedReactions = [...reactions].sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    return sortedReactions
      .map((reaction, index) => {
        const name = reaction.sender === "me" ? "You" : reaction.sender;
        const verb = getReactionVerb(reaction.type);

        if (index === 0) {
          return `${name} ${verb} this message`;
        }
        if (index === sortedReactions.length - 1) {
          return ` ${name} ${verb} this message`;
        }
        return `${name} ${verb} this message`;
      })
      .join(", ");
  };

  const rightBubbleSvg =
    effectiveTheme === "dark"
      ? "/message-bubbles/right-bubble-dark.svg"
      : "/message-bubbles/right-bubble-light.svg";
  const leftBubbleSvg =
    effectiveTheme === "dark"
      ? "/message-bubbles/left-bubble-dark.svg"
      : "/message-bubbles/left-bubble-light.svg";
  const rightNoTailSvg =
    effectiveTheme === "dark"
      ? "/message-bubbles/right-no-tail-dark.svg"
      : "/message-bubbles/right-no-tail-light.svg";
  const leftNoTailSvg =
    effectiveTheme === "dark"
      ? "/message-bubbles/left-no-tail-dark.svg"
      : "/message-bubbles/left-no-tail-light.svg";
  const typingIndicatorSvg =
    effectiveTheme === "dark"
      ? "/typing-bubbles/chat-typing-dark.svg"
      : "/typing-bubbles/chat-typing-light.svg";

  const bubbleBorderImageSource = isTyping && showBubbleTail
    ? typingIndicatorSvg
    : isMe
    ? showBubbleTail
      ? rightBubbleSvg
      : rightNoTailSvg
    : showBubbleTail
      ? leftBubbleSvg
      : leftNoTailSvg;

  const bubbleBorderImageSlice = showBubbleTail
    ? isMe
      ? "31 43 31 31"
      : "31 31 31 43"
    : "31 31 31 31";
  const bubbleEdgeCoverInset =
    !isMe || isTyping ? "inset-[-17px]" : "inset-[-22px]";
  const getReactionIconSvg = (
    reactionFromMe: boolean,
    messageFromMe: boolean,
    reactionType: ReactionType,
    isMobileView: boolean,
    overlay?: boolean,
  ) => {
    const orientation = messageFromMe ? "left" : "right";
    const baseVariant = effectiveTheme === "dark" ? "dark" : "light";

    // If overlay is true, always use the base variant without "-blue"
    if (overlay) {
      return `/reactions/${orientation}-${baseVariant}-${reactionType}-overlay.svg`;
    }

    // Otherwise, if the reaction is from me and we're in mobile view, use the blue variant
    const variant =
      reactionFromMe && isMobileView ? `${baseVariant}-blue` : baseVariant;

    return `/reactions/${orientation}-${variant}-${reactionType}.svg`;
  };

  const getReactionStyle = (
    reaction: Reaction,
    isMe: boolean,
    isMobileView: boolean,
  ) => {
    const iconUrl = getReactionIconSvg(
      reaction.sender === "me",
      isMe,
      reaction.type,
      isMobileView,
    );

    const mobileStyle = {
      backgroundImage: `url('${iconUrl}')`,
      backgroundSize: "contain",
      backgroundRepeat: "no-repeat",
      backgroundPosition: "center",
    };

    if (isMobileView || reaction.sender !== "me") {
      return mobileStyle;
    }

    return {
      WebkitMaskImage: `url('${iconUrl}')`,
      maskImage: `url('${iconUrl}')`,
      WebkitMaskSize: "contain",
      maskSize: "contain",
      WebkitMaskRepeat: "no-repeat",
      maskRepeat: "no-repeat",
      WebkitMaskPosition: "center",
      maskPosition: "center",
      background: "linear-gradient(to bottom, #47B5FF, #0A7CFF)",
      backgroundAttachment: "fixed",
    };
  };

  return (
    <div className="flex w-full flex-col relative z-10">
      {/* Spacer before messages */}
      <div className="h-1 bg-background" />
      {/* Extra space between messages with reactions */}
      <div
        className={`overflow-hidden transition-[height] duration-500 ease-in-out ${
          message.reactions && message.reactions.length > 0
            ? message.sender === "me"
              ? "h-4"
              : "h-2"
            : "h-0"
        } bg-background`}
      />

      {/* Show recipient name for messages from others */}
      {recipientName && (
        <div className="text-[10px] text-muted-foreground pl-4 pb-0.5 bg-background">
          {recipientName}
        </div>
      )}

      <div className="flex">
        {/* Left spacer for blue messages */}
        {isMe && <div className="flex-1 bg-background" />}
        {/* Message bubble container */}
        {isSystemMessage ? (
          message.type === "silenced" ? (
            <SilencedNotificationsMessage>
              {silencedLabel}
            </SilencedNotificationsMessage>
          ) : (
            <div
              className={cn(
                "w-full flex justify-center py-2 px-3",
                isSystemMessage && "bg-background",
              )}
            >
              <div className="text-[12px] text-muted-foreground text-center whitespace-pre-line max-w-[80%]">
                {message.content}
              </div>
            </div>
          )
        ) : (
          <div
            className={cn(
              "group relative max-w-[75%] break-words flex-none",
              showBubbleTail
                ? isMe
                  ? cn(
                      "border-[17px] border-solid border-r-[22px] border-transparent text-white",
                      isMobileView
                        ? "bg-[#0A7CFF]"
                        : "bg-[linear-gradient(#47B5FF,#0A7CFF)] bg-fixed",
                    )
                  : "border-[17px] border-solid border-l-[22px] border-transparent bg-gray-100 dark:bg-[#404040] text-gray-900 dark:text-gray-100"
                : isMe
                  ? cn(
                      "mr-[5px] border-[17px] border-solid border-transparent text-white",
                      isMobileView
                        ? "bg-[#0A7CFF]"
                        : "bg-[linear-gradient(#47B5FF,#0A7CFF)] bg-fixed",
                    )
                  : "ml-[5px] border-[17px] border-solid border-transparent bg-gray-100 dark:bg-[#404040] text-gray-900 dark:text-gray-100",
            )}
            style={{
              borderImageSlice: bubbleBorderImageSlice,
              borderImageSource: `url('${bubbleBorderImageSource}')`,
            }}
          >
            {showBubbleTail ? (
              <div
                aria-hidden
                className={cn(
                  "pointer-events-none absolute border-r-[0.5px] border-background",
                  bubbleEdgeCoverInset,
                )}
              />
            ) : null}
            <div className="-my-2.5 -mx-1">
              {/* Message content or typing indicator */}
              {isTyping ? (
                <div className="relative flex flex-col">
                  <div className="text-[14px] flex items-center">
                    <div
                      className={cn(
                        "flex h-[20px] min-w-[34px] items-center justify-center gap-[4px]",
                        showBubbleTail
                          ? isMe
                            ? isMobileView
                              ? "bg-[#0A7CFF]"
                              : "bg-[linear-gradient(#47B5FF,#0A7CFF)] bg-fixed"
                            : "bg-gray-100 dark:bg-[#404040]"
                          : "bg-transparent",
                      )}
                    >
                      <style>{typingAnimation}</style>
                      <div
                        className="w-1.5 h-1.5 rounded-full bg-gray-500 dark:bg-gray-300"
                        style={{ animation: "blink 1.4s infinite linear" }}
                      />
                      <div
                        className="w-1.5 h-1.5 rounded-full bg-gray-500 dark:bg-gray-300"
                        style={{
                          animation: "blink 1.4s infinite linear 0.2s",
                        }}
                      />
                      <div
                        className="w-1.5 h-1.5 rounded-full bg-gray-500 dark:bg-gray-300"
                        style={{
                          animation: "blink 1.4s infinite linear 0.4s",
                        }}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="relative">
                  {onReaction ? (
                    <Popover
                      open={isOpen}
                      modal={true}
                      onOpenChange={handleOpenChange}
                    >
                      <PopoverTrigger asChild>
                        <div className="flex flex-col cursor-pointer">
                          <div className="text-[14px] flex items-center">
                            {prepareContent(
                              message.content,
                              message.sender,
                            )}
                          </div>
                        </div>
                      </PopoverTrigger>

                      {/* Reaction menu */}
                      <PopoverContent
                        className="flex p-2 gap-2 w-fit rounded-full bg-gray-100 dark:bg-[#404040] z-50 reaction-menu"
                        align={isMe ? "end" : "start"}
                        alignOffset={-8}
                        side="top"
                        sideOffset={20}
                      >
                        {/* Reaction buttons */}
                        {Object.entries(menuReactionIcons).map(
                          ([type, icon]) => (
                            <button
                              key={type}
                              onClick={() => {
                                handleReaction(type as ReactionType);
                              }}
                              className={cn(
                                "inline-flex items-center justify-center rounded-full w-8 h-8 aspect-square p-0 cursor-pointer text-base transition-all duration-200 ease-out text-gray-500 [@media(hover:hover)]:hover:scale-125 flex-shrink-0",
                                isReactionActive(type as ReactionType)
                                  ? "bg-[#0A7CFF] text-white scale-110"
                                  : "",
                              )}
                            >
                              <Image
                                src={
                                  isReactionActive(type as ReactionType)
                                    ? icon
                                        .replace("-gray", "-white")
                                        .replace("-dark", "-white")
                                    : icon
                                }
                                width={16}
                                height={16}
                                alt={`${type} reaction`}
                                style={
                                  type === "emphasize"
                                    ? { transform: "scale(0.75)" }
                                    : type === "question"
                                      ? { transform: "scale(0.6)" }
                                      : undefined
                                }
                              />
                            </button>
                          ),
                        )}
                      </PopoverContent>
                    </Popover>
                  ) : (
                    <div className="flex flex-col cursor-pointer">
                      <div className="text-[14px] flex items-center">
                        {prepareContent(
                          message.content,
                          message.sender,
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {/* Display existing reactions */}
              {message.reactions && message.reactions.length > 0 && (
                <div
                  className={cn(
                    "absolute -top-8 flex",
                    isMe ? "-left-8" : "-right-8",
                    isMe ? "flex-row" : "flex-row-reverse",
                  )}
                >
                  {[...message.reactions]
                    .sort(
                      (a, b) =>
                        new Date(a.timestamp).getTime() -
                        new Date(b.timestamp).getTime(),
                    )
                    .map((reaction, index, array) => (
                      <Popover
                        key={`${reaction.type}-${reaction.sender}-${reaction.timestamp}`}
                      >
                        <PopoverTrigger>
                          <div
                            key={`${reaction.type}-${reaction.sender}-${reaction.timestamp}`}
                            className={cn(
                              "w-8 h-8 flex items-center justify-center text-sm relative cursor-pointer",
                              index !== array.length - 1 &&
                                (isMe ? "-mr-7" : "-ml-7"),
                            )}
                            style={{
                              ...getReactionStyle(
                                reaction,
                                isMe,
                                isMobileView,
                              ),
                              zIndex: array.length - index,
                            }}
                          >
                            {reaction.sender === "me" && !isMobileView && (
                              <Image
                                src={getReactionIconSvg(
                                  reaction.sender === "me",
                                  isMe,
                                  reaction.type,
                                  isMobileView,
                                  true,
                                )}
                                width={32}
                                height={32}
                                alt={`${reaction.type} reaction`}
                                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10"
                              />
                            )}
                          </div>
                        </PopoverTrigger>
                        <PopoverContent className="w-fit max-w-[200px] break-words px-3 py-1.5 bg-gray-100 dark:bg-[#404040] border-gray-100 dark:border-[#404040]">
                          <p className="text-sm">
                            {formatReactions(message.reactions || [])}
                          </p>
                        </PopoverContent>
                      </Popover>
                    ))}
                </div>
              )}
            </div>
          </div>
        )}
        {/* Outgoing row has no flex sibling past the bubble (incoming has flex-1); gutter hides edge spill. */}
        {!isSystemMessage && isMe && (
          <div
            className="w-px shrink-0 self-stretch bg-background"
            aria-hidden
          />
        )}
        {/* Right spacer for gray messages */}
        {!isSystemMessage && !isMe && <div className="flex-1 bg-background" />}
      </div>

      {/* Show "Delivered" for last message from current user */}
      {isMe && isLastUserMessage && !isTyping && (
        <div className="text-[10px] text-gray-500 pt-1 pr-1 bg-background text-right">
          <ReceiptLabel status={message.status} justSent={justSent} />
        </div>
      )}
      {/* Spacer after messages */}
      <div className="h-1 bg-background" />
    </div>
  );
}
