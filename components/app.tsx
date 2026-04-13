import { useCallback, useEffect, useRef, useState } from "react";
import { ChatArea } from "./chat-area";
import { CommandMenu } from "./command-menu";
import { Nav } from "./nav";
import { Sidebar } from "./sidebar";
import { useToast } from "@/hooks/use-toast";
import { soundEffects } from "@/lib/sound-effects";
import { toUiConversation } from "@/lib/chat-adapters";
import type {
  Chat,
  CreateChatRequest,
  ChatResponse,
  CreateChatResponse,
  ListChatsResponse,
  MessagesResponse,
  ReadChatResponse,
  SendMessageResponse,
} from "@/lib/server/models";
import type { Conversation, Message } from "@/types";

const AGENT_SERVICE_URL =
  process.env.NEXT_PUBLIC_AGENT_SERVICE_URL ?? "http://localhost:8000";
const INITIAL_AGENT_GREETING = "hey! hows it going?";
const INITIAL_AGENT_GREETING_DELAY_MS = 3000;

type AgentStreamEventType =
  | "typing.started"
  | "message.persisted"
  | "message.delivered"
  | "message.read"
  | "task.started"
  | "task.update"
  | "task.completed"
  | "run.completed"
  | "error";

type AgentRunStatus =
  | "message_sent"
  | "task_completed"
  | "in_progress"
  | "failed"
  | "skipped";

type AgentRunCompletedPayload = {
  status: AgentRunStatus;
  message_ids: string[];
  messages: string[];
  tool_summary?: Record<string, unknown>;
};

type AgentStreamEvent = {
  type: AgentStreamEventType;
  run_id: string;
  chat_id?: string;
  message_id?: string;
  text?: string;
  error?: string;
  reason?: string;
  created_at: string;
  payload?: Record<string, unknown> | AgentRunCompletedPayload;
};

type AgentRunState = {
  running: boolean;
  pending: boolean;
};

const messageStatusRank: Record<NonNullable<Message["status"]>, number> = {
  delivered: 1,
  read: 2,
};

const mergeMessageStatus = (
  current: Message["status"],
  next: NonNullable<Message["status"]>
): NonNullable<Message["status"]> => {
  if (!current) return next;
  return messageStatusRank[next] >= messageStatusRank[current] ? next : current;
};

const mergeOptionalMessageStatus = (
  current: Message["status"],
  next: Message["status"]
): Message["status"] => {
  if (!next) return current;
  return mergeMessageStatus(current, next);
};

const mergeMessages = (current: Message[], incoming: Message[]) => {
  const byId = new Map<string, Message>();

  for (const message of current) {
    byId.set(message.id, message);
  }

  for (const message of incoming) {
    const existing = byId.get(message.id);
    byId.set(
      message.id,
      existing
        ? {
            ...existing,
            ...message,
            status:
              existing.sender === "me" || message.sender === "me"
                ? mergeOptionalMessageStatus(existing.status, message.status)
                : message.status,
          }
        : message
    );
  }

  return [...byId.values()].sort(
    (a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
};

const mergeConversation = (
  current: Conversation | undefined,
  incoming: Conversation
): Conversation => {
  if (!current) return incoming;

  return {
    ...incoming,
    messages: mergeMessages(current.messages, incoming.messages),
  };
};

const fetchJson = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(error?.error ?? "Request failed");
  }

  return response.json() as Promise<T>;
};

const parseSseBlock = (block: string): AgentStreamEvent | null => {
  const lines = block.split(/\r?\n/);
  const dataLines = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());

  if (dataLines.length === 0) return null;

  try {
    return JSON.parse(dataLines.join("\n")) as AgentStreamEvent;
  } catch {
    return null;
  }
};

const streamAgentResponse = async (
  conversationId: string,
  onEvent: (event: AgentStreamEvent) => Promise<void> | void
) => {
  const response = await fetch(`${AGENT_SERVICE_URL}/agent/respond/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: conversationId }),
  });

  if (!response.ok || !response.body) {
    const error = (await response.json().catch(() => null)) as
      | { detail?: string; error?: string }
      | null;
    throw new Error(error?.detail ?? error?.error ?? "Agent response failed");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? "";

    for (const block of blocks) {
      const event = parseSseBlock(block);
      if (event) await onEvent(event);
    }
  }

  buffer += decoder.decode();
  const trailingEvent = parseSseBlock(buffer);
  if (trailingEvent) await onEvent(trailingEvent);
};

function messageFromAgentPersistedEvent(
  event: AgentStreamEvent,
  conversation: Conversation
): Message | null {
  if (!event.message_id || event.text == null) return null;
  const payload = event.payload as {
    from_handle?: string;
    created_at?: string;
    is_from_me?: boolean;
    is_delivered?: boolean;
    is_read?: boolean;
  } | null;
  const isFromMe = payload?.is_from_me === true;
  const status = isFromMe
    ? payload?.is_read
      ? "read"
      : payload?.is_delivered
        ? "delivered"
        : undefined
    : undefined;
  const fallbackHandle = conversation.recipients[0]?.name ?? "Agent";
  return {
    id: event.message_id,
    content: event.text,
    sender: isFromMe ? "me" : (payload?.from_handle ?? fallbackHandle),
    timestamp: payload?.created_at ?? new Date().toISOString(),
    status,
  };
}

export default function App() {
  const { toast } = useToast();
  const [isNewConversation, setIsNewConversation] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<string | null>(
    null
  );
  const [lastActiveConversation, setLastActiveConversation] = useState<
    string | null
  >(null);
  const [messageDrafts, setMessageDrafts] = useState<Record<string, string>>(
    {}
  );
  const [recipientInput, setRecipientInput] = useState("");
  const [isMobileView, setIsMobileView] = useState(false);
  const [isLayoutInitialized, setIsLayoutInitialized] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [isCommandMenuOpen, setIsCommandMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(soundEffects.isEnabled());
  const [isLoadingChats, setIsLoadingChats] = useState(true);
  const [agentTypingConversationId, setAgentTypingConversationId] = useState<
    string | null
  >(null);

  const commandMenuRef = useRef<{ setOpen: (open: boolean) => void }>(null);
  const agentRunsByChatRef = useRef<Record<string, AgentRunState>>({});
  const initialAgentGreetingChatIdRef = useRef<string | null>(null);
  const typingConversation = agentTypingConversationId
    ? conversations.find((conversation) => conversation.id === agentTypingConversationId)
    : null;
  const typingStatus =
    agentTypingConversationId && typingConversation
      ? {
          conversationId: agentTypingConversationId,
          recipient: typingConversation.recipients[0]?.name ?? "Agent",
        }
      : null;
  const selectedConversation = activeConversation
    ? conversations.find((conversation) => conversation.id === activeConversation)
    : undefined;

  const loadChatWithMessages = useCallback(async (chat: Chat) => {
    const { messages } = await fetchJson<MessagesResponse>(
      `/api/chats/${chat.id}/messages`
    );
    return toUiConversation({ chat, messages });
  }, []);

  const markMessageStatusLocally = useCallback(
    (
      conversationId: string,
      messageId: string,
      status: NonNullable<Message["status"]>
    ) => {
      setConversations((prev) =>
        prev.map((conversation) => {
          if (conversation.id !== conversationId) return conversation;

          let didChange = false;
          const nextConversation = {
            ...conversation,
            messages: conversation.messages.map((message) => {
              if (message.id !== messageId || message.sender !== "me") {
                return message;
              }

              const nextStatus = mergeMessageStatus(message.status, status);
              if (nextStatus === message.status) return message;
              didChange = true;
              return { ...message, status: nextStatus };
            }),
          };
          return didChange ? nextConversation : conversation;
        })
      );
    },
    []
  );

  const markLatestUserMessageReadLocally = useCallback(
    (conversationId: string) => {
      setConversations((prev) =>
        prev.map((conversation) => {
          if (conversation.id !== conversationId) return conversation;

          const latestUserMessage = [...conversation.messages]
            .reverse()
            .find((message) => message.sender === "me");
          if (!latestUserMessage) return conversation;

          let didChange = false;
          const nextConversation = {
            ...conversation,
            messages: conversation.messages.map((message) => {
              if (message.id !== latestUserMessage.id) return message;

              const nextStatus = mergeMessageStatus(message.status, "read");
              if (nextStatus === message.status) return message;
              didChange = true;
              return { ...message, status: nextStatus };
            }),
          };

          return didChange ? nextConversation : conversation;
        })
      );
    },
    []
  );

  const clearStreamState = useCallback((conversationId: string) => {
    setAgentTypingConversationId((current) =>
      current === conversationId ? null : current
    );
  }, []);

  const loadChats = useCallback(async () => {
    const { chats } = await fetchJson<ListChatsResponse>("/api/chats");
    const hydratedConversations = await Promise.all(
      chats.map((chat) => loadChatWithMessages(chat))
    );

    setConversations((prev) =>
      hydratedConversations.map((conversation) =>
        mergeConversation(
          prev.find((item) => item.id === conversation.id),
          conversation
        )
      )
    );
    return hydratedConversations;
  }, [loadChatWithMessages]);

  const loadOneChat = useCallback(async (conversationId: string) => {
    const [{ chat }, { messages }] = await Promise.all([
      fetchJson<ChatResponse>(`/api/chats/${conversationId}`),
      fetchJson<MessagesResponse>(`/api/chats/${conversationId}/messages`),
    ]);
    const conversation = toUiConversation({ chat, messages });

    setConversations((prev) => {
      const exists = prev.some((item) => item.id === conversation.id);
      if (!exists) return [conversation, ...prev];

      return prev.map((item) =>
        item.id === conversation.id ? mergeConversation(item, conversation) : item
      );
    });

    return conversation;
  }, []);

  const markConversationRead = useCallback(async (conversationId: string) => {
    const { chat, messages } = await fetchJson<ReadChatResponse>(
      `/api/chats/${conversationId}/read`,
      { method: "POST" }
    );
    const conversation = toUiConversation({ chat, messages });

    setConversations((prev) =>
      prev.map((item) =>
        item.id === conversationId ? mergeConversation(item, conversation) : item
      )
    );
  }, []);

  const handleAgentStreamEvent = useCallback(
    async (conversationId: string, event: AgentStreamEvent) => {
      if (event.type === "typing.started") {
        setAgentTypingConversationId(conversationId);
        markLatestUserMessageReadLocally(conversationId);
        return;
      }

      if (event.type === "message.persisted") {
        clearStreamState(conversationId);
        setConversations((prev) =>
          prev.map((conversation) => {
            if (conversation.id !== conversationId) return conversation;
            const message = messageFromAgentPersistedEvent(event, conversation);
            if (
              !message ||
              conversation.messages.some((item) => item.id === message.id)
            ) {
              return conversation;
            }
            return {
              ...conversation,
              messages: [...conversation.messages, message],
            };
          })
        );
        return;
      }

      if (event.type === "message.delivered" && event.message_id) {
        markMessageStatusLocally(conversationId, event.message_id, "delivered");
        return;
      }

      if (event.type === "message.read" && event.message_id) {
        markMessageStatusLocally(conversationId, event.message_id, "read");
        return;
      }

      if (event.type === "run.completed") {
        clearStreamState(conversationId);
        await loadOneChat(conversationId);
        return;
      }

      if (event.type === "error") {
        console.error("Agent stream event error:", event.error);
        toast({ description: "Agent response failed" });
        return;
      }
    },
    [
      clearStreamState,
      loadOneChat,
      markLatestUserMessageReadLocally,
      markMessageStatusLocally,
      toast,
    ]
  );

  const startAgentResponse = useCallback(
    (conversationId: string) => {
      const state =
        agentRunsByChatRef.current[conversationId] ??
        (agentRunsByChatRef.current[conversationId] = {
          running: false,
          pending: false,
        });

      if (state.running) {
        state.pending = true;
        return;
      }

      state.running = true;

      const run = async () => {
        try {
          await streamAgentResponse(conversationId, (event) =>
            handleAgentStreamEvent(conversationId, event)
          );
        } catch (error) {
          console.error("Error triggering agent response:", error);
          toast({ description: "Agent response failed" });
        } finally {
          const latestState = agentRunsByChatRef.current[conversationId];
          if (!latestState) return;

          latestState.running = false;
          clearStreamState(conversationId);

          if (latestState.pending) {
            latestState.pending = false;
            startAgentResponse(conversationId);
          }
        }
      };

      void run();
    },
    [clearStreamState, handleAgentStreamEvent, toast]
  );

  const selectConversation = useCallback(
    (conversationId: string | null) => {
      if (conversationId === null) {
        setActiveConversation(null);
        window.history.pushState({}, "", "/");
        return;
      }

      setActiveConversation(conversationId);
      setIsNewConversation(false);
      window.history.pushState({}, "", `?id=${conversationId}`);

      void loadOneChat(conversationId).then(() =>
        markConversationRead(conversationId).catch((error) => {
          console.error("Error marking conversation read:", error);
        })
      );
    },
    [loadOneChat, markConversationRead]
  );

  useEffect(() => {
    const handleResize = () => {
      const nextIsMobileView = window.innerWidth < 768;
      setIsMobileView(nextIsMobileView);

      if (!nextIsMobileView && !activeConversation && lastActiveConversation) {
        selectConversation(lastActiveConversation);
      }
    };

    handleResize();
    setIsLayoutInitialized(true);
    window.addEventListener("resize", handleResize);

    return () => window.removeEventListener("resize", handleResize);
  }, [activeConversation, lastActiveConversation, selectConversation]);

  useEffect(() => {
    if (!isLayoutInitialized) return;

    const initializeChats = async () => {
      try {
        setIsLoadingChats(true);
        const loadedConversations = await loadChats();
        const urlParams = new URLSearchParams(window.location.search);
        const urlConversationId = urlParams.get("id");

        if (
          urlConversationId &&
          loadedConversations.some(
            (conversation) => conversation.id === urlConversationId
          )
        ) {
          selectConversation(urlConversationId);
          return;
        }

        if (isMobileView) {
          window.history.pushState({}, "", "/");
          setActiveConversation(null);
          return;
        }

        if (loadedConversations.length > 0) {
          selectConversation(loadedConversations[0].id);
        }
      } catch (error) {
        console.error("Error loading chats:", error);
        toast({ description: "Unable to load chats" });
      } finally {
        setIsLoadingChats(false);
      }
    };

    void initializeChats();
  }, [isLayoutInitialized, isMobileView, loadChats, selectConversation, toast]);

  useEffect(() => {
    if (activeConversation) {
      setLastActiveConversation(activeConversation);
    }
  }, [activeConversation]);

  useEffect(() => {
    if (isLoadingChats) return;

    const agentConversation = conversations.find(
      (conversation) => conversation.isAgentChat
    );

    if (!agentConversation || agentConversation.messages.length > 0) return;
    if (initialAgentGreetingChatIdRef.current) return;

    initialAgentGreetingChatIdRef.current = agentConversation.id;

    const timeoutId = window.setTimeout(async () => {
      try {
        const { messages } = await fetchJson<MessagesResponse>(
          `/api/chats/${agentConversation.id}/messages`
        );

        if (messages.length > 0) return;

        await fetchJson<SendMessageResponse>(
          `/api/chats/${agentConversation.id}/messages`,
          {
            method: "POST",
            body: JSON.stringify({
              text: INITIAL_AGENT_GREETING,
              direction: "inbound",
              sender_handle: agentConversation.recipients[0]?.name ?? "Pepper",
            }),
          }
        );
        await loadOneChat(agentConversation.id);
      } catch (error) {
        initialAgentGreetingChatIdRef.current = null;
        console.error("Error sending initial agent greeting:", error);
      }
    }, INITIAL_AGENT_GREETING_DELAY_MS);

    return () => {
      window.clearTimeout(timeoutId);
      if (initialAgentGreetingChatIdRef.current === agentConversation.id) {
        initialAgentGreetingChatIdRef.current = null;
      }
    };
  }, [conversations, isLoadingChats, loadOneChat]);

  useEffect(() => {
    setSoundEnabled(soundEffects.isEnabled());
  }, []);

  const handleMessageDraftChange = (
    conversationId: string,
    message: string
  ) => {
    setMessageDrafts((prev) => ({
      ...prev,
      [conversationId]: message,
    }));
  };

  const clearMessageDraft = (conversationId: string) => {
    setMessageDrafts((prev) => {
      const nextDrafts = { ...prev };
      delete nextDrafts[conversationId];
      return nextDrafts;
    });
  };

  const extractMessageContent = (htmlContent: string) => {
    const temp = document.createElement("div");
    temp.innerHTML = htmlContent;
    return temp.textContent || "";
  };

  const handleSendMessage = async (
    messageHtml: string,
    conversationId?: string
  ) => {
    const messageText = extractMessageContent(messageHtml);
    if (!messageText.trim()) return;

    try {
      if (!conversationId || isNewConversation) {
        const handles = recipientInput
          .split(",")
          .map((recipient) => recipient.trim())
          .filter(Boolean);

        if (handles.length === 0) return;

        const payload: CreateChatRequest = {
          handles,
          text: messageText,
        };
        const { chat, message } = await fetchJson<CreateChatResponse>(
          "/api/chats",
          {
            method: "POST",
            body: JSON.stringify(payload),
          }
        );
        const newConversation = toUiConversation({
          chat,
          messages: [message],
        });

        setConversations((prev) => [newConversation, ...prev]);
        setActiveConversation(chat.id);
        setIsNewConversation(false);
        setRecipientInput("");
        clearMessageDraft("new");
        window.history.pushState({}, "", `?id=${chat.id}`);
        return;
      }

      const { chat } = await fetchJson<SendMessageResponse>(
        `/api/chats/${conversationId}/messages`,
        {
          method: "POST",
          body: JSON.stringify({ text: messageText }),
        }
      );

      await loadOneChat(conversationId);
      setActiveConversation(conversationId);
      setIsNewConversation(false);
      window.history.pushState({}, "", `?id=${conversationId}`);
      clearMessageDraft(conversationId);

      if (chat.is_agent_chat) {
        startAgentResponse(conversationId);
      }
    } catch (error) {
      console.error("Error sending message:", error);
      toast({ description: "Unable to send message" });
    }
  };

  const handleUnsupportedConversationAction = useCallback(() => {
    toast({ description: "This action is outside milestone one" });
  }, [toast]);

  const handleSoundToggle = useCallback(() => {
    soundEffects.toggleSound();
    setSoundEnabled(soundEffects.isEnabled());
  }, []);

  const totalUnreadCount = conversations.reduce(
    (total, conversation) => total + (conversation.unreadCount || 0),
    0
  );

  return (
    <div className="flex h-dvh">
      <CommandMenu
        ref={commandMenuRef}
        conversations={conversations}
        activeConversation={activeConversation}
        onNewChat={() => {
          setIsNewConversation(true);
          setActiveConversation(null);
          window.history.pushState({}, "", "/");
        }}
        onSelectConversation={selectConversation}
        onDeleteConversation={handleUnsupportedConversationAction}
        onUpdateConversation={handleUnsupportedConversationAction}
        onOpenChange={setIsCommandMenuOpen}
        soundEnabled={soundEnabled}
        onSoundToggle={handleSoundToggle}
      />
      <main className="flex h-dvh w-full flex-col bg-background">
        <div className="flex h-full flex-1">
          <div
            className={`h-full w-full flex-shrink-0 sm:w-[320px] ${
              isMobileView && (activeConversation || isNewConversation)
                ? "hidden"
                : "block sm:border-r dark:border-foreground/20"
            }`}
          >
            <Sidebar
              conversations={conversations}
              activeConversation={activeConversation}
              onSelectConversation={selectConversation}
              onDeleteConversation={handleUnsupportedConversationAction}
              onUpdateConversation={handleUnsupportedConversationAction}
              isMobileView={isMobileView}
              searchTerm={searchTerm}
              onSearchChange={setSearchTerm}
              typingStatus={typingStatus}
              isCommandMenuOpen={isCommandMenuOpen}
              onScroll={setIsScrolled}
              onSoundToggle={handleSoundToggle}
              loadingFallback={
                isLoadingChats && conversations.length === 0 ? (
                  <ChatListLoadingState />
                ) : undefined
              }
            >
              <Nav
                onNewChat={() => {
                  setIsNewConversation(true);
                  selectConversation(null);
                  setRecipientInput("");
                  handleMessageDraftChange("new", "");
                }}
                isMobileView={isMobileView}
                isScrolled={isScrolled}
              />
            </Sidebar>
          </div>
          <div
            className={`relative h-full flex-1 ${
              isMobileView && !activeConversation && !isNewConversation
                ? "hidden"
                : "block"
            }`}
          >
            <ChatArea
              isNewChat={isNewConversation}
              activeConversation={selectedConversation}
              recipientInput={recipientInput}
              setRecipientInput={setRecipientInput}
              isMobileView={isMobileView}
              onBack={() => {
                setIsNewConversation(false);
                selectConversation(null);
              }}
              onSendMessage={handleSendMessage}
              typingStatus={typingStatus}
              conversationId={activeConversation || ""}
              messageDraft={
                isNewConversation
                  ? messageDrafts["new"] || ""
                  : messageDrafts[activeConversation || ""] || ""
              }
              onMessageDraftChange={handleMessageDraftChange}
              unreadCount={totalUnreadCount}
            />
            {isLoadingChats && conversations.length === 0 ? (
              <ThreadLoadingState />
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}

function ChatListLoadingState() {
  return (
    <div className="px-4 pt-4 space-y-5" aria-label="Loading chats">
      <div className="space-y-2">
        <div className="h-3 w-24 rounded bg-muted-foreground/15 animate-pulse" />
        <div className="grid grid-cols-3 gap-4">
          {[0, 1, 2].map((item) => (
            <div key={item} className="flex flex-col items-center gap-2">
              <div className="h-14 w-14 rounded-full bg-muted-foreground/15 animate-pulse" />
              <div className="h-2.5 w-12 rounded bg-muted-foreground/15 animate-pulse" />
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-3">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-muted-foreground/15 animate-pulse" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-2/5 rounded bg-muted-foreground/15 animate-pulse" />
              <div className="h-2.5 w-4/5 rounded bg-muted-foreground/10 animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ThreadLoadingState() {
  return (
    <div
      className="pointer-events-none absolute inset-0 bg-background"
      aria-label="Loading conversation"
    >
      <div className="h-full px-6 pt-20 pb-24 flex flex-col justify-end gap-4">
        <div className="max-w-[70%] space-y-2">
          <div className="h-4 w-24 rounded bg-muted-foreground/15 animate-pulse" />
          <div className="h-10 w-64 max-w-full rounded-[18px] bg-muted-foreground/15 animate-pulse" />
        </div>
        <div className="ml-auto h-10 w-56 max-w-[70%] rounded-[18px] bg-[#0A7CFF]/25 animate-pulse" />
        <div className="h-10 w-72 max-w-[75%] rounded-[18px] bg-muted-foreground/15 animate-pulse" />
        <div className="ml-auto h-10 w-48 max-w-[65%] rounded-[18px] bg-[#0A7CFF]/25 animate-pulse" />
      </div>
    </div>
  );
}
