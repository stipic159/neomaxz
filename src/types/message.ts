import type { InlineButton } from "./buttons.js";
import type { MediaSource, MessageAttachment } from "./media.js";

export type MessageElementType =
  | 'BOLD'
  | 'ITALIC'
  | 'STRIKETHROUGH'
  | 'UNDERLINE'
  | 'CODE'
  | 'PRE'
  | 'SPOILER'
  | 'LINK'
  | 'MENTION';

export interface MessageElement {
  type: MessageElementType;
  offset: number;
  length: number;
  url?: string;
  userId?: string | bigint;
}

export interface PollInput {
  question: string;
  options: string[];
  multipleAnswers?: boolean;
  anonymous?: boolean;
}

export interface MessageKey {
  chatId: string;
  id: string;
  fromMe: boolean;
}

export interface AnyMessageContent {
  /** Text content of the message */
  text?: string;
  /** Reply quoting another message ID */
  replyToMessageId?: string | number | bigint;
  /** Raw elements / entities for text formatting */
  elements?: MessageElement[];
  /** Parse formatting from text automatically (default: 'markdown') */
  parseMode?: 'markdown' | 'none';
  /** Custom attachments */
  attaches?: MessageAttachment[];
  
  // Media attachments in Baileys style:
  image?: MediaSource;
  caption?: string;
  document?: MediaSource;
  fileName?: string;
  mimetype?: string;
  video?: MediaSource;
  audio?: MediaSource;
  ptt?: boolean; // Voice note
  videoNote?: MediaSource; // Round video

  // Interactive buttons and polls:
  buttons?: InlineButton[][];
  poll?: PollInput;

  // Scheduling:
  sendAt?: number | Date;
}

export interface MaxMessage {
  key: MessageKey;
  chatId: string;
  id: string;
  fromMe: boolean;
  senderId?: string;
  senderName?: string;
    text: string;
  elements?: MessageElement[];
  timestamp: number;
  replyToMessageId?: string;
  attaches: MessageAttachment[];
  raw: Record<string, any>;
}

export function toBigIntId(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' || typeof value === 'string') {
    return BigInt(value);
  }
  throw new TypeError(`Cannot convert value of type ${typeof value} to BigInt ID: ${String(value)}`);
}

export function normalizeMessage(raw: Record<string, any>, currentUserId?: string): MaxMessage {
  const msgObj = raw.message ?? raw;
  const id = String(msgObj.id ?? msgObj.messageId ?? raw.id ?? '');
  const chatId = String(raw.chatId ?? msgObj.chatId ?? '');
  const senderId = raw.sender ? String(raw.sender.id ?? raw.sender) : String(msgObj.senderId ?? msgObj.userId ?? '');

  const fromMe = Boolean(
    raw.fromMe ??
    (currentUserId && senderId === currentUserId) ??
    (msgObj.cid && !msgObj.id)
  );

  const text = msgObj.text ?? '';
  const timestamp = typeof msgObj.time === 'bigint' ? Number(msgObj.time) : (Number(msgObj.time ?? Date.now()));

  let replyToMessageId: string | undefined;
  if (msgObj.link?.type === 'REPLY' && msgObj.link.messageId) {
    replyToMessageId = String(msgObj.link.messageId);
  }

  const elements: MessageElement[] = Array.isArray(msgObj.elements)
    ? msgObj.elements
    : [];

  return {
    key: {
      chatId,
      id,
      fromMe,
    },
    chatId,
    id,
    fromMe,
    senderId,
    senderName: raw.sender?.name ?? raw.sender?.firstName ?? undefined,
    text,
    elements,
    timestamp,
    replyToMessageId,
    attaches: Array.isArray(msgObj.attaches) ? msgObj.attaches : [],
    raw,
  };
}
