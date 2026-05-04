import { create } from 'zustand';
import type { ChatMessage, ChatRoom } from '@/lib/chat';

interface ChatState {
  // Active state
  activeRoomId: string | null;
  rooms: ChatRoom[];
  messagesByRoom: Record<string, ChatMessage[]>;

  // Realtime state
  typingUsers: Record<string, string[]>; // roomId → member_id[]
  onlineUsers: string[]; // member_ids currently online

  // UI state
  replyingTo: ChatMessage | null;
  isRoomInfoOpen: boolean;
  isCreateRoomOpen: boolean;

  // Actions
  setActiveRoomId: (id: string | null) => void;
  setRooms: (rooms: ChatRoom[]) => void;
  updateRoom: (roomId: string, updates: Partial<ChatRoom>) => void;

  setMessages: (roomId: string, messages: ChatMessage[]) => void;
  prependMessages: (roomId: string, messages: ChatMessage[]) => void;
  addMessage: (roomId: string, message: ChatMessage) => void;
  updateMessage: (roomId: string, messageId: string, updates: Partial<ChatMessage>) => void;
  removeOptimisticMessage: (roomId: string, tempId: string) => void;

  setTypingUsers: (roomId: string, userIds: string[]) => void;
  setOnlineUsers: (userIds: string[]) => void;

  setReplyingTo: (message: ChatMessage | null) => void;
  setRoomInfoOpen: (open: boolean) => void;
  setCreateRoomOpen: (open: boolean) => void;

  decrementUnread: (roomId: string) => void;
  clearUnread: (roomId: string) => void;
  incrementUnread: (roomId: string) => void;

  reset: () => void;
}

const initialState = {
  activeRoomId: null,
  rooms: [],
  messagesByRoom: {},
  typingUsers: {},
  onlineUsers: [],
  replyingTo: null,
  isRoomInfoOpen: false,
  isCreateRoomOpen: false,
};

export const useChatStore = create<ChatState>((set) => ({
  ...initialState,

  setActiveRoomId: (activeRoomId) => set({ activeRoomId }),

  setRooms: (rooms) => set({ rooms }),

  updateRoom: (roomId, updates) =>
    set((state) => ({
      rooms: state.rooms.map((r) =>
        r.id === roomId ? { ...r, ...updates } : r
      ),
    })),

  setMessages: (roomId, messages) =>
    set((state) => ({
      messagesByRoom: {
        ...state.messagesByRoom,
        [roomId]: messages,
      },
    })),

  prependMessages: (roomId, messages) =>
    set((state) => ({
      messagesByRoom: {
        ...state.messagesByRoom,
        [roomId]: [...messages, ...(state.messagesByRoom[roomId] ?? [])],
      },
    })),

  addMessage: (roomId, message) =>
    set((state) => {
      const existing = state.messagesByRoom[roomId] ?? [];
      // Prevent duplicates
      if (existing.some((m) => m.id === message.id)) return state;

      // Update room's last_message and sort rooms
      const updatedRooms = state.rooms
        .map((r) =>
          r.id === roomId ? { ...r, last_message: message } : r
        )
        .sort((a, b) => {
          const aTime = a.last_message?.created_at ?? a.created_at;
          const bTime = b.last_message?.created_at ?? b.created_at;
          return new Date(bTime).getTime() - new Date(aTime).getTime();
        });

      return {
        messagesByRoom: {
          ...state.messagesByRoom,
          [roomId]: [...existing, message],
        },
        rooms: updatedRooms,
      };
    }),

  updateMessage: (roomId, messageId, updates) =>
    set((state) => ({
      messagesByRoom: {
        ...state.messagesByRoom,
        [roomId]: (state.messagesByRoom[roomId] ?? []).map((m) =>
          m.id === messageId ? { ...m, ...updates } : m
        ),
      },
    })),

  removeOptimisticMessage: (roomId, tempId) =>
    set((state) => ({
      messagesByRoom: {
        ...state.messagesByRoom,
        [roomId]: (state.messagesByRoom[roomId] ?? []).filter(
          (m) => m.id !== tempId
        ),
      },
    })),

  setTypingUsers: (roomId, userIds) =>
    set((state) => ({
      typingUsers: { ...state.typingUsers, [roomId]: userIds },
    })),

  setOnlineUsers: (onlineUsers) => set({ onlineUsers }),

  setReplyingTo: (replyingTo) => set({ replyingTo }),
  setRoomInfoOpen: (isRoomInfoOpen) => set({ isRoomInfoOpen }),
  setCreateRoomOpen: (isCreateRoomOpen) => set({ isCreateRoomOpen }),

  decrementUnread: (roomId) =>
    set((state) => ({
      rooms: state.rooms.map((r) =>
        r.id === roomId
          ? { ...r, unread_count: Math.max(0, (r.unread_count ?? 0) - 1) }
          : r
      ),
    })),

  clearUnread: (roomId) =>
    set((state) => ({
      rooms: state.rooms.map((r) =>
        r.id === roomId ? { ...r, unread_count: 0 } : r
      ),
    })),

  incrementUnread: (roomId) =>
    set((state) => ({
      rooms: state.rooms.map((r) =>
        r.id === roomId
          ? { ...r, unread_count: (r.unread_count ?? 0) + 1 }
          : r
      ),
    })),

  reset: () => set(initialState),
}));
