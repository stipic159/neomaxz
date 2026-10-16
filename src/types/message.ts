export interface MessageKey {
  chatId: string;
  id: string;
  fromMe: boolean;
}

export interface AnyMessageContent {
  text?: string;
  replyToMessageId?: string;
  attaches?: any[];
}

export interface MaxMessage {
  key: MessageKey;
  chatId: string;
  id: string;
  fromMe: boolean;
  senderId?: string;
  senderName?: string;
  text: string;
  timestamp: number;
  replyToMessageId?: string;
  attaches: any[];
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
    timestamp,
    replyToMessageId,
    attaches: Array.isArray(msgObj.attaches) ? msgObj.attaches : [],
    raw,
  };
}
