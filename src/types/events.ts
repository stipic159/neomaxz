import type { InboundFrame, OutboundFrame } from "../protocol/frame.js";
import type { ConnectionState } from "./connection.js";
import type { MaxMessage } from "./message.js";

export interface PresenceUpdate {
  chatId: string;
  userId: string;
  isTyping: boolean;
}

export interface ReadReceipt {
  chatId: string;
  userId: string;
  messageIds?: string[];
  markTime: number;
}

export interface AttachmentReadyEvent {
  chatId?: string;
  fileId?: string;
  photoToken?: string;
  videoId?: string;
  url?: string;
  raw: any;
}

export interface MaxEvents {
  'connection.update': Partial<ConnectionState> & { qr?: string };
  'creds.update': Record<string, any>;
  'frame.inbound': InboundFrame;
  'frame.outbound': OutboundFrame;
  'presence.update': PresenceUpdate;
  'messages.upsert': { messages: MaxMessage[]; type: 'notify' | 'append' };
  'messages.update': any[];
  'messages.read': ReadReceipt;
  'attachment.ready': AttachmentReadyEvent;
  'error': Error;
}

export type EventKey = keyof MaxEvents;
export type EventListener<K extends EventKey> = (data: MaxEvents[K]) => void | Promise<void>;
