import { useCallback, useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { ChatArea } from "./chat-area";
import { CommandMenu } from "./command-menu";
import { Nav } from "./nav";
import { Sidebar } from "./sidebar";
import { useToast } from "@/hooks/use-toast";
import { initialConversations } from "@/data/initial-conversations";
import { soundEffects } from "@/lib/sound-effects";
import { Conversation, Message, Reaction } from "@/types";

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

  const commandMenuRef = useRef<{ setOpen: (open: boolean) => void }>(null);
  // Bump version when replacing seed data so old localStorage blobs are not merged in
  const STORAGE_KEY = "dialogueConversations_v3";
  const typingStatus = null;

  const selectConversation = useCallback(
    (conversationId: string | null) => {
      if (conversationId === null) {
        setActiveConversation(null);
        window.history.pushState({}, "", "/");
        return;
      }

      const selectedConversation = conversations.find(
        (conversation) => conversation.id === conversationId
      );

      if (!selectedConversation) {
        window.history.pushState({}, "", "/");

        if (conversations.length > 0) {
          const fallbackConversation = conversations[0];
          setActiveConversation(fallbackConversation.id);
          window.history.pushState({}, "", `?id=${fallbackConversation.id}`);
        } else {
          setActiveConversation(null);
        }
        return;
      }

      setActiveConversation(conversationId);
      setIsNewConversation(false);
      window.history.pushState({}, "", `?id=${conversationId}`);
    },
    [conversations]
  );

  useEffect(() => {
    if (
      activeConversation &&
      !conversations.some((conversation) => conversation.id === activeConversation)
    ) {
      if (conversations.length > 0) {
        selectConversation(conversations[0].id);
      } else {
        selectConversation(null);
      }
    }
  }, [activeConversation, conversations, selectConversation]);

  useEffect(() => {
    if (conversations.length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
    }
  }, [conversations]);

  useEffect(() => {
    const handleResize = () => {
      const nextIsMobileView = window.innerWidth < 768;
      if (isMobileView !== nextIsMobileView) {
        setIsMobileView(nextIsMobileView);

        if (!nextIsMobileView && !activeConversation && lastActiveConversation) {
          selectConversation(lastActiveConversation);
        }
      }
    };

    handleResize();
    setIsLayoutInitialized(true);
    window.addEventListener("resize", handleResize);

    return () => window.removeEventListener("resize", handleResize);
  }, [
    activeConversation,
    isMobileView,
    lastActiveConversation,
    selectConversation,
  ]);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    const urlParams = new URLSearchParams(window.location.search);
    const urlConversationId = urlParams.get("id");
    let allConversations = [...initialConversations];

    if (saved) {
      try {
        const parsedConversations = JSON.parse(saved);

        if (!Array.isArray(parsedConversations)) {
          return;
        }

        const initialIds = new Set(initialConversations.map((conv) => conv.id));
        const userConversations: Conversation[] = [];
        const modifiedInitialConversations = new Map<string, Conversation>();

        for (const savedConversation of parsedConversations as Conversation[]) {
          if (initialIds.has(savedConversation.id)) {
            modifiedInitialConversations.set(
              savedConversation.id,
              savedConversation
            );
          } else {
            userConversations.push(savedConversation);
          }
        }

        allConversations = allConversations.map((conversation) =>
          modifiedInitialConversations.get(conversation.id) ?? conversation
        );
        allConversations = [...allConversations, ...userConversations];
      } catch (error) {
        console.error("Error parsing saved conversations:", error);
      }
    }

    setConversations(allConversations);

    if (
      urlConversationId &&
      allConversations.some((conversation) => conversation.id === urlConversationId)
    ) {
      setActiveConversation(urlConversationId);
      return;
    }

    if (isMobileView) {
      window.history.pushState({}, "", "/");
      setActiveConversation(null);
      return;
    }

    if (allConversations.length > 0) {
      setActiveConversation(allConversations[0].id);
    }
  }, [isMobileView]);

  useEffect(() => {
    if (activeConversation) {
      setLastActiveConversation(activeConversation);
      setConversations((prev) =>
        prev.map((conversation) =>
          conversation.id === activeConversation
            ? { ...conversation, unreadCount: 0 }
            : conversation
        )
      );
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

  const createNewConversation = (recipientNames: string[]) => {
    const recipients = recipientNames.map((name) => ({
      id: uuidv4(),
      name,
    }));

    const newConversation: Conversation = {
      id: uuidv4(),
      recipients,
      messages: [],
      lastMessageTime: new Date().toISOString(),
      unreadCount: 0,
      hideAlerts: false,
    };

    setConversations((prev) => {
      const updatedConversations = [newConversation, ...prev];
      setActiveConversation(newConversation.id);
      setIsNewConversation(false);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedConversations));
      return updatedConversations;
    });

    window.history.pushState({}, "", `?id=${newConversation.id}`);
  };

  const updateConversationRecipients = (
    conversationId: string,
    recipientNames: string[]
  ) => {
    setConversations((prev) => {
      const currentConversation = prev.find(
        (conversation) => conversation.id === conversationId
      );
      if (!currentConversation) return prev;

      const currentNames = currentConversation.recipients.map((r) => r.name);
      const added = recipientNames.filter((name) => !currentNames.includes(name));
      const removed = currentNames.filter(
        (name) => !recipientNames.includes(name)
      );

      const timestamp = new Date().toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });

      const systemMessages: Message[] = [
        ...removed.map((name) => ({
          id: uuidv4(),
          content: `${timestamp}\n${name} was removed from the conversation`,
          sender: "system" as const,
          timestamp,
        })),
        ...added.map((name) => ({
          id: uuidv4(),
          content: `${timestamp}\n${name} was added to the conversation`,
          sender: "system" as const,
          timestamp,
        })),
      ];

      const newRecipients = recipientNames.map((name) => {
        const existingRecipient = currentConversation.recipients.find(
          (recipient) => recipient.name === name
        );
        return existingRecipient ?? { id: uuidv4(), name };
      });

      return prev.map((conversation) =>
        conversation.id === conversationId
          ? {
              ...conversation,
              recipients: newRecipients,
              messages: [...conversation.messages, ...systemMessages],
              lastMessageTime: new Date().toISOString(),
            }
          : conversation
      );
    });
  };

  const handleSendMessage = (messageHtml: string, conversationId?: string) => {
    const messageText = extractMessageContent(messageHtml);
    if (!messageText.trim()) return;

    const message: Message = {
      id: uuidv4(),
      content: messageText,
      htmlContent: messageHtml,
      sender: "me",
      timestamp: new Date().toISOString(),
    };

    if (!conversationId || isNewConversation) {
      const recipients = recipientInput
        .split(",")
        .map((recipient) => recipient.trim())
        .filter(Boolean)
        .map((name) => ({ id: uuidv4(), name }));

      if (recipients.length === 0) return;

      const newConversation: Conversation = {
        id: uuidv4(),
        recipients,
        messages: [message],
        lastMessageTime: new Date().toISOString(),
        unreadCount: 0,
        hideAlerts: false,
      };

      setConversations((prev) => {
        const updatedConversations = [newConversation, ...prev];
        setActiveConversation(newConversation.id);
        setIsNewConversation(false);
        setRecipientInput("");
        clearMessageDraft("new");
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedConversations));
        return updatedConversations;
      });

      window.history.pushState({}, "", `?id=${newConversation.id}`);
      return;
    }

    const conversation = conversations.find(
      (existingConversation) => existingConversation.id === conversationId
    );
    if (!conversation) return;

    const updatedConversation: Conversation = {
      ...conversation,
      messages: [...conversation.messages, message],
      lastMessageTime: new Date().toISOString(),
      unreadCount: 0,
    };

    setConversations((prev) => {
      const updatedConversations = prev.map((existingConversation) =>
        existingConversation.id === conversationId
          ? updatedConversation
          : existingConversation
      );
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedConversations));
      return updatedConversations;
    });

    setActiveConversation(conversationId);
    setIsNewConversation(false);
    window.history.pushState({}, "", `?id=${conversationId}`);
    clearMessageDraft(conversationId);
  };

  const handleDeleteConversation = (id: string) => {
    setConversations((prevConversations) => {
      const newConversations = prevConversations.filter(
        (conversation) => conversation.id !== id
      );

      localStorage.setItem(STORAGE_KEY, JSON.stringify(newConversations));

      if (id === activeConversation && newConversations.length > 0) {
        const sortedConversations = [...prevConversations].sort((a, b) => {
          if (a.pinned && !b.pinned) return -1;
          if (!a.pinned && b.pinned) return 1;
          return (
            new Date(b.lastMessageTime).getTime() -
            new Date(a.lastMessageTime).getTime()
          );
        });

        const deletedIndex = sortedConversations.findIndex(
          (conversation) => conversation.id === id
        );
        const fallbackConversation =
          deletedIndex === sortedConversations.length - 1
            ? sortedConversations[deletedIndex - 1]
            : sortedConversations[deletedIndex + 1];

        selectConversation(fallbackConversation?.id ?? null);
      } else if (newConversations.length === 0) {
        selectConversation(null);
      }

      return newConversations;
    });

    toast({ description: "Conversation deleted" });
  };

  const handleUpdateConversation = (
    nextConversations: Conversation[],
    updateType?: "pin" | "mute"
  ) => {
    const updatedConversation = nextConversations.find(
      (conversation) => conversation.id === activeConversation
    );

    setConversations(nextConversations);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextConversations));

    if (!updatedConversation) return;

    if (updateType === "pin") {
      toast({
        description: updatedConversation.pinned
          ? "Conversation pinned"
          : "Conversation unpinned",
      });
    }

    if (updateType === "mute") {
      toast({
        description: updatedConversation.hideAlerts
          ? "Conversation muted"
          : "Conversation unmuted",
      });
    }
  };

  const handleReaction = useCallback((messageId: string, reaction: Reaction) => {
    setConversations((prevConversations) =>
      prevConversations.map((conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) => {
          if (message.id !== messageId) return message;

          const existingReaction = message.reactions?.find(
            (currentReaction) =>
              currentReaction.sender === reaction.sender &&
              currentReaction.type === reaction.type
          );

          if (existingReaction) {
            return {
              ...message,
              reactions:
                message.reactions?.filter(
                  (currentReaction) =>
                    !(
                      currentReaction.sender === reaction.sender &&
                      currentReaction.type === reaction.type
                    )
                ) || [],
            };
          }

          const otherReactions =
            message.reactions?.filter(
              (currentReaction) => currentReaction.sender !== reaction.sender
            ) || [];

          return {
            ...message,
            reactions: [...otherReactions, reaction],
          };
        }),
      }))
    );
  }, []);

  const handleUpdateConversationName = useCallback(
    (name: string) => {
      setConversations((prevConversations) =>
        prevConversations.map((conversation) =>
          conversation.id === activeConversation
            ? { ...conversation, name }
            : conversation
        )
      );
    },
    [activeConversation]
  );

  const handleHideAlertsChange = useCallback(
    (hide: boolean) => {
      setConversations((prevConversations) =>
        prevConversations.map((conversation) =>
          conversation.id === activeConversation
            ? { ...conversation, hideAlerts: hide }
            : conversation
        )
      );
    },
    [activeConversation]
  );

  const handleSoundToggle = useCallback(() => {
    soundEffects.toggleSound();
    setSoundEnabled(soundEffects.isEnabled());
  }, []);

  const totalUnreadCount = conversations.reduce(
    (total, conversation) => total + (conversation.unreadCount || 0),
    0
  );

  if (!isLayoutInitialized) {
    return null;
  }

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
        onDeleteConversation={handleDeleteConversation}
        onUpdateConversation={handleUpdateConversation}
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
              onDeleteConversation={handleDeleteConversation}
              onUpdateConversation={handleUpdateConversation}
              isMobileView={isMobileView}
              searchTerm={searchTerm}
              onSearchChange={setSearchTerm}
              typingStatus={typingStatus}
              isCommandMenuOpen={isCommandMenuOpen}
              onScroll={setIsScrolled}
              onSoundToggle={handleSoundToggle}
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
            className={`h-full flex-1 ${
              isMobileView && !activeConversation && !isNewConversation
                ? "hidden"
                : "block"
            }`}
          >
            <ChatArea
              isNewChat={isNewConversation}
              activeConversation={
                activeConversation
                  ? conversations.find(
                      (conversation) => conversation.id === activeConversation
                    )
                  : undefined
              }
              recipientInput={recipientInput}
              setRecipientInput={setRecipientInput}
              isMobileView={isMobileView}
              onBack={() => {
                setIsNewConversation(false);
                selectConversation(null);
              }}
              onSendMessage={handleSendMessage}
              onReaction={handleReaction}
              typingStatus={typingStatus}
              conversationId={activeConversation || ""}
              onUpdateConversationRecipients={updateConversationRecipients}
              onCreateConversation={createNewConversation}
              onUpdateConversationName={handleUpdateConversationName}
              onHideAlertsChange={handleHideAlertsChange}
              messageDraft={
                isNewConversation
                  ? messageDrafts["new"] || ""
                  : messageDrafts[activeConversation || ""] || ""
              }
              onMessageDraftChange={handleMessageDraftChange}
              unreadCount={totalUnreadCount}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
