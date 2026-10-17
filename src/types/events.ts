import type { InboundFrame, OutboundFrame } from "../protocol/frame.js";
import type { ConnectionState } from "./connection.js";
import type { MaxMessage } from "./message.js";
import type { PresenceAction, PresenceUpdate } from "./presence.js";

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
  'connection.update': Partial<ConnectionState> & { qr?: string; trackId?: string };
  'creds.update': Record<string, any>;
  'frame.inbound': InboundFrame;
  'frame.outbound': OutboundFrame;
  'presence.update': PresenceUpdate;
  'messages.upsert': { messages: MaxMessage[]; type: 'notify' | 'append' };
  'messages.update': any[];
  'messages.read': ReadReceipt;
  'attachment.ready': AttachmentReadyEvent;
  'sync.start': { fromTimestamp: number };
  'sync.complete': { syncedAt: number; count?: number };
  'error': Error;
}

export type EventKey = keyof MaxEvents;
export type EventListener<K extends EventKey> = (data: MaxEvents[K]) => void | Promise<void>;
