import type { InboundFrame, OutboundFrame } from "../protocol/frame.js";
import type { ConnectionState } from "./connection.js";

export interface PresenceUpdate {
  chatId: string;
  userId: string;
  isTyping: boolean;
}

export interface MaxEvents {
  'connection.update': Partial<ConnectionState> & { qr?: string };
  'creds.update': Record<string, any>;
  'frame.inbound': InboundFrame;
  'frame.outbound': OutboundFrame;
  'presence.update': PresenceUpdate;
  'messages.upsert': { messages: any[]; type: 'notify' | 'append' };
  'messages.update': any[];
  'error': Error;
}

export type EventKey = keyof MaxEvents;
export type EventListener<K extends EventKey> = (data: MaxEvents[K]) => void | Promise<void>;
