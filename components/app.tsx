import { useCallback, useEffect, useRef, useState } from "react";
import { ChatArea } from "./chat-area";
import { CommandMenu } from "./command-menu";
import { Nav } from "./nav";
import { Sidebar } from "./sidebar";
import { useToast } from "@/hooks/use-toast";
import { connectRealtime } from "@/lib/client/realtime";
import { soundEffects } from "@/lib/sound-effects";
import { toUiConversation, toUiMessage } from "@/lib/chat-adapters";
import type {
  Chat,
  CreateChatRequest,
  CreateChatResponse,
  ListChatsResponse,
  Message as ApiMessage,
  MessagesResponse,
  ReadChatResponse,
  SendMessageResponse,
} from "@/lib/server/models";
import type { BrowserEvent } from "@/types/realtime";
import type { Conversation, Message } from "@/types";

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
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isLoadingChats, setIsLoadingChats] = useState(true);
  const [agentTypingConversationId, setAgentTypingConversationId] = useState<
    string | null
  >(null);

  const commandMenuRef = useRef<{ setOpen: (open: boolean) => void }>(null);
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

  const setActiveConversationId = useCallback((conversationId: string | null) => {
    setActiveConversation(conversationId);
  }, []);

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

  const applyCreatedMessage = useCallback(
    (chat: Chat, message: ApiMessage) => {
      setConversations((prev) => {
        const uiMessage = toUiMessage(message, chat);
        const nextConversation = toUiConversation({
          chat,
          messages: [message],
        });
        const exists = prev.some((conversation) => conversation.id === chat.id);

        if (!exists) return [nextConversation, ...prev];

        return prev.map((conversation) =>
          conversation.id === chat.id
            ? {
                ...conversation,
                name: chat.display_name,
                messages: mergeMessages(conversation.messages, [uiMessage]),
                lastMessageTime: chat.updated_at,
                unreadCount: chat.unread_count ?? 0,
                isAgentChat: chat.is_agent_chat ?? false,
              }
            : conversation
        );
      });
    },
    []
  );

  const loadChatWithMessages = useCallback(async (chat: Chat) => {
    const { messages } = await fetchJson<MessagesResponse>(
      `/api/chats/${chat.id}/messages`
    );
    return toUiConversation({ chat, messages });
  }, []);

  const loadChats = useCallback(async () => {
    const { chats } = await fetchJson<ListChatsResponse>("/api/chats");
    const loadedConversations = await Promise.all(
      chats.map((chat) => loadChatWithMessages(chat))
    );

    setConversations((prev) =>
      loadedConversations.map((conversation) =>
        mergeConversation(
          prev.find((item) => item.id === conversation.id),
          conversation
        )
      )
    );
    return loadedConversations;
  }, [loadChatWithMessages]);

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

  const handleBrowserEvent = useCallback(
    (event: BrowserEvent) => {
      if (event.kind === "typing") {
        if (event.state === "started") {
          setAgentTypingConversationId(event.chat_id);
          markLatestUserMessageReadLocally(event.chat_id);
        } else {
          setAgentTypingConversationId((current) =>
            current === event.chat_id ? null : current
          );
        }
        return;
      }

      if (event.kind === "message.created") {
        applyCreatedMessage(event.chat, event.message);
        return;
      }

      if (event.kind === "chat.updated") {
        setConversations((prev) =>
          prev.map((conv) =>
            conv.id === event.chat_id
              ? {
                  ...conv,
                  name: event.chat.display_name,
                  lastMessageTime: event.chat.updated_at,
                  unreadCount: event.chat.unread_count ?? 0,
                }
              : conv
          )
        );
      }
    },
    [applyCreatedMessage, markLatestUserMessageReadLocally]
  );

  const handleRealtimeOpen = useCallback(
    async ({ isReconnect }: { isReconnect: boolean }) => {
      setAgentTypingConversationId(null);
      if (!isReconnect) return;
      await loadChats();
    },
    [loadChats]
  );

  useEffect(() => {
    return connectRealtime(handleBrowserEvent, { onOpen: handleRealtimeOpen });
  }, [handleBrowserEvent, handleRealtimeOpen]);

  const selectConversation = useCallback(
    (conversationId: string | null) => {
      if (conversationId === null) {
        setActiveConversationId(null);
        window.history.pushState({}, "", "/");
        return;
      }

      setActiveConversationId(conversationId);
      setIsNewConversation(false);
      window.history.pushState({}, "", `?id=${conversationId}`);

      void markConversationRead(conversationId).catch((error) => {
        console.error("Error marking conversation read:", error);
      });
    },
    [markConversationRead, setActiveConversationId]
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
          setActiveConversationId(urlConversationId);
          setIsNewConversation(false);
          window.history.pushState({}, "", `?id=${urlConversationId}`);
          await markConversationRead(urlConversationId);
          return;
        }

        if (isMobileView) {
          window.history.pushState({}, "", "/");
          setActiveConversationId(null);
          return;
        }

        if (loadedConversations.length > 0) {
          const defaultConversationId = loadedConversations[0].id;
          setActiveConversationId(defaultConversationId);
          setIsNewConversation(false);
          window.history.pushState({}, "", `?id=${defaultConversationId}`);
          await markConversationRead(defaultConversationId);
        }
      } catch (error) {
        console.error("Error loading chats:", error);
        toast({ description: "Unable to load chats" });
      } finally {
        setIsLoadingChats(false);
      }
    };

    void initializeChats();
  }, [
    isLayoutInitialized,
    isMobileView,
    loadChats,
    markConversationRead,
    setActiveConversationId,
    toast,
  ]);

  useEffect(() => {
    if (activeConversation) {
      setLastActiveConversation(activeConversation);
    }
  }, [activeConversation]);

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
        applyCreatedMessage(chat, message);
        setActiveConversationId(chat.id);
        setIsNewConversation(false);
        setRecipientInput("");
        clearMessageDraft("new");
        window.history.pushState({}, "", `?id=${chat.id}`);
        return;
      }

      const response = await fetchJson<SendMessageResponse>(
        `/api/chats/${conversationId}/messages`,
        {
          method: "POST",
          body: JSON.stringify({ text: messageText }),
        }
      );

      applyCreatedMessage(response.chat, response.message);
      setActiveConversationId(conversationId);
      setIsNewConversation(false);
      window.history.pushState({}, "", `?id=${conversationId}`);
      clearMessageDraft(conversationId);
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
          setActiveConversationId(null);
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
