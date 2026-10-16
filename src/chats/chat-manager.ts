import { OPCODES } from "../protocol/opcodes.js";
import type { SocketClient } from "../socket/socket-client.js";
import { toBigIntId } from "../types/message.js";
import {
  normalizeChat,
  type MaxChat,
  type ChatMember,
  type CreateChatOptions,
  type SetChatInfoOptions,
} from "../types/chat.js";

export class ChatManager {
  /**
   * Retrieves active chats / dialogs of the current user (0x0035 CHATS_LIST).
   */
  public async getChats(
    client: SocketClient,
    options: { fromTimestamp?: number; count?: number } = {}
  ): Promise<MaxChat[]> {
    const payload: Record<string, any> = {
      count: options.count ?? 50,
    };

    if (options.fromTimestamp !== undefined) {
      payload.from = BigInt(options.fromTimestamp);
    }

    const res = await client.query({
      opcode: OPCODES.CHATS_LIST,
      payload,
    });

    const list: any[] = Array.isArray(res.payload?.chats)
      ? res.payload.chats
      : Array.isArray(res.payload)
      ? res.payload
      : [];

    return list.map(normalizeChat);
  }

  /**
   * Retrieves detailed chat information by chatId (0x0033 CHAT_INFO).
   */
  public async getChat(
    client: SocketClient,
    chatId: string | number | bigint
  ): Promise<MaxChat> {
    const res = await client.query({
      opcode: OPCODES.CHAT_INFO,
      payload: {
        chatId: toBigIntId(chatId),
      },
    });

    const raw = res.payload?.chat ?? res.payload ?? {};
    return normalizeChat(raw);
  }

  /**
   * Creates a new group chat or channel (0x003c CHAT_CREATE).
   */
  public async createChat(
    client: SocketClient,
    options: CreateChatOptions
  ): Promise<MaxChat> {
    const userIds = (options.userIds ?? []).map(toBigIntId);

    const res = await client.query({
      opcode: OPCODES.CHAT_CREATE,
      payload: {
        title: options.title,
        userIds,
        description: options.description ?? '',
        type: options.isChannel ? 'CHANNEL' : 'GROUP',
      },
    });

    const raw = res.payload?.chat ?? res.payload ?? {};
    return normalizeChat(raw);
  }

  /**
   * Updates title, description, or avatar of a chat (0x0037 CHAT_SET_INFO).
   */
  public async setChatInfo(
    client: SocketClient,
    chatId: string | number | bigint,
    options: SetChatInfoOptions
  ): Promise<void> {
    const payload: Record<string, any> = {
      chatId: toBigIntId(chatId),
    };

    if (options.title !== undefined) payload.title = options.title;
    if (options.description !== undefined) payload.description = options.description;
    if (options.avatarToken !== undefined) payload.photoToken = options.avatarToken;

    await client.query({
      opcode: OPCODES.CHAT_SET_INFO,
      payload,
    });
  }

  /**
   * Fetches members of a chat (0x003b CHAT_MEMBERS).
   */
  public async getChatMembers(
    client: SocketClient,
    chatId: string | number | bigint,
    options: { count?: number; offset?: number } = {}
  ): Promise<ChatMember[]> {
    const res = await client.query({
      opcode: OPCODES.CHAT_MEMBERS,
      payload: {
        chatId: toBigIntId(chatId),
        count: options.count ?? 50,
        offset: options.offset ?? 0,
      },
    });

    const rawMembers: any[] = Array.isArray(res.payload?.members)
      ? res.payload.members
      : Array.isArray(res.payload?.participants)
      ? res.payload.participants
      : [];

    return rawMembers.map((m) => ({
      userId: String(m.userId ?? m.id ?? ''),
      role: (String(m.role ?? 'MEMBER').toUpperCase() as any),
      name: m.name ?? m.firstName ?? undefined,
      avatarUrl: m.avatarUrl ?? m.icon ?? undefined,
      joinedAt: m.joinedAt ? Number(m.joinedAt) : undefined,
      canPin: Boolean(m.canPin ?? false),
      canDelete: Boolean(m.canDelete ?? false),
    }));
  }

  /**
   * Adds one or more members to a group chat.
   */
  public async addChatMembers(
    client: SocketClient,
    chatId: string | number | bigint,
    userIds: Array<string | number | bigint>
  ): Promise<void> {
    await client.query({
      opcode: OPCODES.CHAT_MEMBERS,
      payload: {
        chatId: toBigIntId(chatId),
        action: 'ADD',
        userIds: userIds.map(toBigIntId),
      },
    });
  }

  /**
   * Removes (kicks) a member from a group chat.
   */
  public async removeChatMember(
    client: SocketClient,
    chatId: string | number | bigint,
    userId: string | number | bigint
  ): Promise<void> {
    await client.query({
      opcode: OPCODES.CHAT_MEMBERS,
      payload: {
        chatId: toBigIntId(chatId),
        action: 'REMOVE',
        userId: toBigIntId(userId),
      },
    });
  }

  /**
   * Leaves a chat or channel (0x003a CHAT_LEAVE).
   */
  public async leaveChat(
    client: SocketClient,
    chatId: string | number | bigint
  ): Promise<void> {
    await client.query({
      opcode: OPCODES.CHAT_LEAVE,
      payload: {
        chatId: toBigIntId(chatId),
      },
    });
  }

  /**
   * Deletes a chat (0x0034 CHAT_DELETE).
   */
  public async deleteChat(
    client: SocketClient,
    chatId: string | number | bigint
  ): Promise<void> {
    await client.query({
      opcode: OPCODES.CHAT_DELETE,
      payload: {
        chatId: toBigIntId(chatId),
      },
    });
  }

  /**
   * Generates or fetches an invite link for a chat (0x003e CHAT_INVITE_LINK).
   */
  public async createInviteLink(
    client: SocketClient,
    chatId: string | number | bigint
  ): Promise<string> {
    const res = await client.query({
      opcode: OPCODES.CHAT_INVITE_LINK,
      payload: {
        chatId: toBigIntId(chatId),
      },
    });

    const link = res.payload?.link ?? res.payload?.inviteLink ?? res.payload?.url;
    if (!link) {
      throw new Error(`Failed to generate invite link: ${JSON.stringify(res.payload)}`);
    }

    return String(link);
  }

  /**
   * Joins a chat using an invite link or invite token (0x003f CHAT_JOIN_LINK).
   */
  public async joinByLink(
    client: SocketClient,
    inviteLinkOrCode: string
  ): Promise<MaxChat> {
    const res = await client.query({
      opcode: OPCODES.CHAT_JOIN_LINK,
      payload: {
        link: inviteLinkOrCode,
      },
    });

    const raw = res.payload?.chat ?? res.payload ?? {};
    return normalizeChat(raw);
  }
}
