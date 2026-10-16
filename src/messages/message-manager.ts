import { OPCODES } from "../protocol/opcodes.js";
import type { SocketClient } from "../socket/socket-client.js";
import {
  toBigIntId,
  normalizeMessage,
  type AnyMessageContent,
  type MaxMessage,
} from "../types/message.js";

export class MessageManager {
  private cidCounter = 0n;

  private nextCid(): bigint {
    this.cidCounter = (this.cidCounter + 1n) % 1000n;
    return BigInt(Date.now()) * 1000n + this.cidCounter;
  }

  /**
   * Sends a message to a chat (0x0040 MSG_SEND).
   */
  public async sendMessage(
    client: SocketClient,
    chatId: string | number | bigint,
    content: AnyMessageContent,
    currentUserId?: string
  ): Promise<MaxMessage> {
    const bigChatId = toBigIntId(chatId);
    const cid = this.nextCid();

    const link = content.replyToMessageId
      ? {
          type: "REPLY",
          messageId: toBigIntId(content.replyToMessageId),
          chatId: bigChatId,
        }
      : null;

    const res = await client.query({
      opcode: OPCODES.MSG_SEND,
      payload: {
        chatId: bigChatId,
        message: {
          text: content.text ?? null,
          cid,
          elements: [],
          attaches: content.attaches ?? [],
          link,
        },
        notify: true,
      },
    });

    const responseMsg = res.payload?.message ?? {};
    const messageId = String(responseMsg.id ?? '');

    return normalizeMessage(
      {
        chatId: String(chatId),
        id: messageId,
        message: {
          id: responseMsg.id,
          text: content.text ?? '',
          cid,
          time: responseMsg.time ?? Date.now(),
          attaches: responseMsg.attaches ?? content.attaches ?? [],
          link,
        },
        fromMe: true,
      },
      currentUserId
    );
  }

  /**
   * Edits an existing message (0x0043 MSG_EDIT).
   */
  public async editMessage(
    client: SocketClient,
    chatId: string | number | bigint,
    messageId: string | number | bigint,
    newText: string
  ): Promise<void> {
    await client.query({
      opcode: OPCODES.MSG_EDIT,
      payload: {
        chatId: toBigIntId(chatId),
        messageId: toBigIntId(messageId),
        text: newText,
        elements: [],
        attachments: [],
      },
    });
  }

  /**
   * Deletes one or more messages (0x0042 MSG_DELETE).
   * Note: MAX requires `messageIds` as an array of 64-bit integers.
   */
  public async deleteMessages(
    client: SocketClient,
    chatId: string | number | bigint,
    messageIds: Array<string | number | bigint>,
    forMe = false
  ): Promise<void> {
    if (messageIds.length === 0) return;

    await client.query({
      opcode: OPCODES.MSG_DELETE,
      payload: {
        chatId: toBigIntId(chatId),
        messageIds: messageIds.map(toBigIntId),
        forMe,
      },
    });
  }

  /**
   * Adds an emoji reaction to a message (0x0044 MSG_REACTION).
   */
  public async addReaction(
    client: SocketClient,
    chatId: string | number | bigint,
    messageId: string | number | bigint,
    emoji: string
  ): Promise<void> {
    await client.query({
      opcode: 0x0044, // MSG_REACTION
      payload: {
        chatId: toBigIntId(chatId),
        messageId: toBigIntId(messageId),
        reaction: {
          reactionType: "EMOJI",
          id: emoji,
        },
      },
    });
  }

  /**
   * Removes reaction from a message (0x0046 MSG_CANCEL_REACTION).
   */
  public async removeReaction(
    client: SocketClient,
    chatId: string | number | bigint,
    messageId: string | number | bigint
  ): Promise<void> {
    await client.query({
      opcode: 0x0046, // MSG_CANCEL_REACTION
      payload: {
        chatId: toBigIntId(chatId),
        messageId: toBigIntId(messageId),
      },
    });
  }

  /**
   * Fetches chat history newest-first (0x0031 CHAT_HISTORY).
   */
  public async getChatHistory(
    client: SocketClient,
    chatId: string | number | bigint,
    fromTimestamp: number = Date.now(),
    backward = 50,
    currentUserId?: string
  ): Promise<MaxMessage[]> {
    const res = await client.query({
      opcode: OPCODES.CHAT_HISTORY,
      payload: {
        chatId: toBigIntId(chatId),
        from: BigInt(fromTimestamp),
        backward,
        forward: 0,
      },
    });

    const rawMessages: any[] = Array.isArray(res.payload?.messages) ? res.payload.messages : [];
    return rawMessages.map((m) => normalizeMessage(m, currentUserId));
  }
}
