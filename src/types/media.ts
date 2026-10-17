import type { InlineButton } from "./buttons.js";

export type MediaSource =
  | Buffer
  | Uint8Array
  | string
  | { url: string }
  | { stream: NodeJS.ReadableStream; size?: number };

export interface PhotoAttachment {
  type: 'PHOTO';
  photoToken?: string;
  id?: string | bigint;
  url?: string;
  width?: number;
  height?: number;
}

export interface FileAttachment {
  type: 'FILE';
  fileId?: string | bigint;
  token?: string;
  name?: string;
  size?: number;
  url?: string;
  mime?: string;
}

export interface VideoAttachment {
  type: 'VIDEO';
  videoId?: string | bigint;
  token?: string;
  duration?: number;
  width?: number;
  height?: number;
  url?: string;
}

export interface AudioAttachment {
  type: 'AUDIO';
  audioId?: string | bigint;
  token?: string;
  duration?: number;
  waveform?: number[];
  ptt?: boolean;
  url?: string;
}

export interface VideoNoteAttachment {
  type: 'VIDEO_NOTE';
  videoNoteId?: string | bigint;
  token?: string;
  duration?: number;
  url?: string;
}

export interface InlineKeyboardAttachment {
  type: 'INLINE_KEYBOARD';
  buttons: InlineButton[][];
}

export interface PollOption {
  id: string;
  text: string;
  votes?: number;
}

export interface PollAttachment {
  type: 'POLL';
  id?: string | bigint;
  question: string;
  options: PollOption[];
  multipleAnswers?: boolean;
  anonymous?: boolean;
}

export type MessageAttachment =
  | PhotoAttachment
  | FileAttachment
  | VideoAttachment
  | AudioAttachment
  | VideoNoteAttachment
  | InlineKeyboardAttachment
  | PollAttachment
  | Record<string, any>;
