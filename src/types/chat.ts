import type { MaxMessage } from "./message.js";

export type ChatType = 'DIALOG' | 'GROUP' | 'CHANNEL';

export interface ChatPermissions {
  canSend?: boolean;
  canPin?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  canInvite?: boolean;
  isAdmin?: boolean;
}

export interface MaxChat {
  id: string;
  title: string;
  type: ChatType;
  avatarUrl?: string;
  description?: string;
  unreadCount: number;
  lastMessage?: MaxMessage;
  membersCount?: number;
  ownerId?: string;
  isArchived?: boolean;
  permissions?: ChatPermissions;
  raw: Record<string, any>;
}

export type ChatMemberRole = 'ADMIN' | 'MEMBER' | 'OWNER';

export interface ChatMember {
  userId: string;
  role: ChatMemberRole;
  name?: string;
  avatarUrl?: string;
  joinedAt?: number;
  canPin?: boolean;
  canDelete?: boolean;
}

export interface CreateChatOptions {
  title: string;
  userIds?: Array<string | number | bigint>;
  description?: string;
  isChannel?: boolean;
}

export interface SetChatInfoOptions {
  title?: string;
  description?: string;
  avatarToken?: string;
}

export function normalizeChat(raw: Record<string, any>): MaxChat {
  const id = String(raw.id ?? raw.chatId ?? '');
  const title = String(raw.title ?? raw.name ?? 'Chat');
  
  let type: ChatType = 'DIALOG';
  const rawType = String(raw.type ?? '').toUpperCase();
  if (rawType.includes('CHANNEL')) {
    type = 'CHANNEL';
  } else if (rawType.includes('GROUP') || rawType.includes('CHAT') || Array.isArray(raw.participants)) {
    type = 'GROUP';
  }

  return {
    id,
    title,
    type,
    avatarUrl: raw.avatarUrl ?? raw.icon ?? raw.avatar ?? undefined,
    description: raw.description ?? raw.about ?? undefined,
    unreadCount: Number(raw.unreadCount ?? raw.unread ?? 0),
    lastMessage: raw.lastMessage ? (raw.lastMessage as MaxMessage) : undefined,
    membersCount: raw.membersCount ?? raw.participantsCount ?? (Array.isArray(raw.participants) ? raw.participants.length : undefined),
    ownerId: raw.ownerId ? String(raw.ownerId) : undefined,
    isArchived: Boolean(raw.archived ?? false),
    permissions: raw.permissions,
    raw,
  };
}
