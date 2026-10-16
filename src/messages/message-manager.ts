import { OPCODES } from "../protocol/opcodes.js";
import type { SocketClient } from "../socket/socket-client.js";
import { MediaManager } from "../media/media-manager.js";
import { parseMarkdown } from "./formatting.js";
import {
  toBigIntId,
  normalizeMessage,
  type AnyMessageContent,
  type MaxMessage,
  type MessageElement,
} from "../types/message.js";
import type { MessageAttachment } from "../types/media.js";

export class MessageManager {
  private cidCounter = 0n;
  private mediaManager: MediaManager;

  constructor(mediaManager?: MediaManager) {
    this.mediaManager = mediaManager ?? new MediaManager();
  }

  public getMediaManager(): MediaManager {
    return this.mediaManager;
  }

  private nextCid(): bigint {
    this.cidCounter = (this.cidCounter + 1n) % 1000n;
    return BigInt(Date.now()) * 1000n + this.cidCounter;
  }

  /**
   * Sends a message to a chat (0x0040 MSG_SEND).
   * Supports plain text, markdown formatting, media attachments, buttons, polls, and scheduling.
   */
  public async sendMessage(
    client: SocketClient,
    chatId: string | number | bigint,
    content: AnyMessageContent,
    currentUserId?: string
  ): Promise<MaxMessage> {
    const bigChatId = toBigIntId(chatId);
    const cid = this.nextCid();

    const attaches: MessageAttachment[] = Array.isArray(content.attaches)
      ? [...content.attaches]
      : [];

    let rawText = content.text ?? content.caption;

    // 1. Process media attachments if specified in Baileys style
    if (content.image) {
      const photo = await this.mediaManager.uploadPhoto(client, content.image);
      attaches.push(photo);
    }

    if (content.document) {
      const doc = await this.mediaManager.uploadFile(client, content.document, {
        fileName: content.fileName,
        mimeType: content.mimetype,
      });
      attaches.push(doc);
    }

    if (content.video) {
      const video = await this.mediaManager.uploadVideo(client, content.video, {
        fileName: content.fileName,
      });
      attaches.push(video);
    }

    if (content.audio) {
      const audio = await this.mediaManager.uploadAudio(client, content.audio, content.ptt);
      attaches.push(audio);
    }

    if (content.videoNote) {
      const videoNote = await this.mediaManager.uploadVideoNote(client, content.videoNote);
      attaches.push(videoNote);
    }

    // 2. Process inline buttons / keyboard
    if (content.buttons && content.buttons.length > 0) {
      attaches.push({
        type: 'INLINE_KEYBOARD',
        buttons: content.buttons,
      });
    }

    // 3. Process poll
    if (content.poll) {
      attaches.push({
        type: 'POLL',
        question: content.poll.question,
        options: content.poll.options.map((opt, idx) => ({
          id: String(idx + 1),
          text: opt,
        })),
        multipleAnswers: Boolean(content.poll.multipleAnswers),
        anonymous: Boolean(content.poll.anonymous),
      });
    }

    // 4. Format text and entities
    let textToSend: string | null = null;
    let elementsToSend: MessageElement[] = [];

    if (typeof rawText === 'string') {
      if (content.elements && content.elements.length > 0) {
        textToSend = rawText;
        elementsToSend = content.elements;
      } else if (content.parseMode === 'none') {
        textToSend = rawText;
      } else {
        const parsed = parseMarkdown(rawText);
        textToSend = parsed.text;
        elementsToSend = parsed.elements;
      }
    }

    // 5. Quoting reply link
    const link = content.replyToMessageId
      ? {
          type: "REPLY",
          messageId: toBigIntId(content.replyToMessageId),
          chatId: bigChatId,
        }
      : null;

    // 6. Scheduling
    let sendAt: bigint | null = null;
    if (content.sendAt) {
      const ts = typeof content.sendAt === 'number'
        ? content.sendAt
        : content.sendAt.getTime();
      sendAt = BigInt(ts);
    }

    const payload: Record<string, any> = {
      chatId: bigChatId,
      message: {
        text: textToSend,
        cid,
        elements: elementsToSend,
        attaches,
        link,
      },
      notify: true,
    };

    if (sendAt !== null) {
      payload.sendAt = sendAt;
    }

    const res = await client.query({
      opcode: OPCODES.MSG_SEND,
      payload,
    });

    const responseMsg = res.payload?.message ?? {};
    const messageId = String(responseMsg.id ?? '');

    return normalizeMessage(
      {
        chatId: String(chatId),
        id: messageId,
        message: {
          id: responseMsg.id,
          text: textToSend ?? '',
          elements: elementsToSend,
          cid,
          time: responseMsg.time ?? Date.now(),
          attaches: responseMsg.attaches ?? attaches,
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
    newText: string,
    options: { parseMode?: 'markdown' | 'none'; elements?: MessageElement[] } = {}
  ): Promise<void> {
    let textToSend = newText;
    let elementsToSend: MessageElement[] = [];

    if (options.elements && options.elements.length > 0) {
      elementsToSend = options.elements;
    } else if (options.parseMode !== 'none') {
      const parsed = parseMarkdown(newText);
      textToSend = parsed.text;
      elementsToSend = parsed.elements;
    }

    await client.query({
      opcode: OPCODES.MSG_EDIT,
      payload: {
        chatId: toBigIntId(chatId),
        messageId: toBigIntId(messageId),
        text: textToSend,
        elements: elementsToSend,
        attachments: [],
      },
    });
  }

  /**
   * Deletes one or more messages (0x0042 MSG_DELETE).
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
      opcode: OPCODES.MSG_REACTION,
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
      opcode: OPCODES.MSG_CANCEL_REACTION,
      payload: {
        chatId: toBigIntId(chatId),
        messageId: toBigIntId(messageId),
      },
    });
  }

  /**
   * Marks messages in a chat as read (0x0045 MSG_READ).
   */
  public async markChatRead(
    client: SocketClient,
    chatId: string | number | bigint,
    messageIds: Array<string | number | bigint> = [],
    fromTimestamp: number = Date.now()
  ): Promise<void> {
    await client.query({
      opcode: OPCODES.MSG_READ,
      payload: {
        chatId: toBigIntId(chatId),
        messageIds: messageIds.map(toBigIntId),
        markTime: BigInt(fromTimestamp),
      },
    });
  }

  /**
   * Pins a message in a chat (0x0047 MSG_PIN).
   */
  public async pinMessage(
    client: SocketClient,
    chatId: string | number | bigint,
    messageId: string | number | bigint,
    notify = false
  ): Promise<void> {
    await client.query({
      opcode: OPCODES.MSG_PIN,
      payload: {
        chatId: toBigIntId(chatId),
        messageId: toBigIntId(messageId),
        notify,
      },
    });
  }

  /**
   * Unpins a message in a chat (0x0048 MSG_UNPIN).
   */
  public async unpinMessage(
    client: SocketClient,
    chatId: string | number | bigint,
    messageId: string | number | bigint
  ): Promise<void> {
    await client.query({
      opcode: OPCODES.MSG_UNPIN,
      payload: {
        chatId: toBigIntId(chatId),
        messageId: toBigIntId(messageId),
      },
    });
  }

  /**
   * Sends button callback response to server (0x0076 MSG_CALLBACK).
   */
  public async sendCallback(
    client: SocketClient,
    chatId: string | number | bigint,
    messageId: string | number | bigint,
    callbackId: string,
    payload?: string
  ): Promise<void> {
    await client.query({
      opcode: OPCODES.MSG_CALLBACK,
      payload: {
        chatId: toBigIntId(chatId),
        messageId: toBigIntId(messageId),
        callbackId,
        payload: payload ?? null,
      },
    });
  }

  /**
   * Forwards messages from one chat to another.
   */
  public async forwardMessages(
    client: SocketClient,
    targetChatId: string | number | bigint,
    sourceChatId: string | number | bigint,
    messageIds: Array<string | number | bigint>,
    currentUserId?: string
  ): Promise<MaxMessage[]> {
    const results: MaxMessage[] = [];
    const bigTarget = toBigIntId(targetChatId);
    const bigSource = toBigIntId(sourceChatId);

    for (const msgId of messageIds) {
      const cid = this.nextCid();
      const res = await client.query({
        opcode: OPCODES.MSG_SEND,
        payload: {
          chatId: bigTarget,
          message: {
            text: null,
            cid,
            elements: [],
            attaches: [],
            link: {
              type: "FORWARD",
              messageId: toBigIntId(msgId),
              chatId: bigSource,
            },
          },
          notify: true,
        },
      });

      const responseMsg = res.payload?.message ?? {};
      results.push(
        normalizeMessage(
          {
            chatId: String(targetChatId),
            id: String(responseMsg.id ?? ''),
            message: {
              id: responseMsg.id,
              cid,
              time: responseMsg.time ?? Date.now(),
              link: {
                type: "FORWARD",
                messageId: toBigIntId(msgId),
                chatId: bigSource,
              },
            },
            fromMe: true,
          },
          currentUserId
        )
      );
    }

    return results;
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

  /**
   * Downloads media attachment associated with a message or attachment descriptor.
   */
  public async downloadMedia(
    client: SocketClient,
    target: MaxMessage | MessageAttachment | Record<string, any>
  ): Promise<Buffer> {
    return this.mediaManager.downloadMedia(client, target);
  }
}
