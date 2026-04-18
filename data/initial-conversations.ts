import { Conversation } from "../types";

const getTimeAgo = (minutes: number) => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - minutes);
  return date.toISOString();
};

/** Generic starter threads for local development */
export const initialConversations: Conversation[] = [
  {
    id: "a0000001-0000-4000-8000-000000000001",
    isAgentChat: true,
    recipients: [
      {
        id: "b0000001-0000-4000-8000-000000000001",
        name: "Pepper",
      },
    ],
    lastMessageTime: getTimeAgo(0),
    unreadCount: 0,
    pinned: true,
    messages: [],
  },
  {
    id: "a0000002-0000-4000-8000-000000000002",
    recipients: [
      {
        id: "b0000002-0000-4000-8000-000000000002",
        name: "Jane Smith",
      },
    ],
    lastMessageTime: getTimeAgo(12),
    unreadCount: 1,
    pinned: true,
    hideAlerts: true,
    messages: [
      {
        id: "c0000004-0000-4000-8000-000000000004",
        content: "Can we move our check-in to tomorrow morning?",
        sender: "Jane Smith",
        timestamp: getTimeAgo(30),
      },
      {
        id: "c0000005-0000-4000-8000-000000000005",
        content: "Yep, tomorrow morning works for me.",
        sender: "me",
        timestamp: getTimeAgo(25),
      },
      {
        id: "c0000006-0000-4000-8000-000000000006",
        content: "Perfect, I will send a calendar invite.",
        sender: "Jane Smith",
        timestamp: getTimeAgo(12),
      },
    ],
  },
  {
    id: "a0000003-0000-4000-8000-000000000003",
    recipients: [
      {
        id: "b0000003-0000-4000-8000-000000000003",
        name: "Alex Brown",
      },
    ],
    lastMessageTime: getTimeAgo(26),
    unreadCount: 0,
    pinned: true,
    messages: [
      {
        id: "c0000007-0000-4000-8000-000000000007",
        content: "Draft looked great. I left two notes in the doc.",
        sender: "Alex Brown",
        timestamp: getTimeAgo(55),
      },
      {
        id: "c0000008-0000-4000-8000-000000000008",
        content: "Thanks, I'll address those tonight.",
        sender: "me",
        timestamp: getTimeAgo(42),
      },
      {
        id: "c0000009-0000-4000-8000-000000000009",
        content: "Awesome, no rush.",
        sender: "Alex Brown",
        timestamp: getTimeAgo(26),
      },
    ],
  },
  {
    id: "a0000004-0000-4000-8000-000000000004",
    recipients: [
      {
        id: "b0000004-0000-4000-8000-000000000004",
        name: "Taylor Lee",
      },
    ],
    lastMessageTime: getTimeAgo(75),
    unreadCount: 0,
    pinned: false,
    messages: [
      {
        id: "c0000010-0000-4000-8000-000000000010",
        content: "Lunch this week?",
        sender: "Taylor Lee",
        timestamp: getTimeAgo(90),
      },
      {
        id: "c0000011-0000-4000-8000-000000000011",
        content: "Sure, Thursday works.",
        sender: "me",
        timestamp: getTimeAgo(75),
      },
    ],
  },
];
