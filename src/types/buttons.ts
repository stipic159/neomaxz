export type ButtonType = 'CALLBACK' | 'URL' | 'QUICK_REPLY';

export interface CallbackButton {
  type: 'CALLBACK';
  text: string;
  payload: string;
}

export interface UrlButton {
  type: 'URL';
  text: string;
  url: string;
}

export interface QuickReplyButton {
  type: 'QUICK_REPLY';
  text: string;
  payload?: string;
}

export type InlineButton = CallbackButton | UrlButton | QuickReplyButton;
export type MessageKeyboard = InlineButton[][];
