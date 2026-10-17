import { SocketClient, type SocketClientOptions } from "./socket/socket-client.js";
import { AuthManager, DEFAULT_USER_AGENT, type SubmitCodeResult } from "./session/auth-manager.js";
import { MessageManager } from "./messages/message-manager.js";
import { ChatManager } from "./chats/chat-manager.js";
import { ContactManager } from "./contacts/contact-manager.js";
import { PresenceManager } from "./presence/presence-manager.js";
import type { AuthenticationState } from "./session/auth-state.js";
import type { AnyMessageContent, MaxMessage, MessageElement } from "./types/message.js";
import type { MessageAttachment } from "./types/media.js";
import type { MaxChat, ChatMember, CreateChatOptions, SetChatInfoOptions } from "./types/chat.js";
import type { MaxContact, UpdateProfileOptions } from "./types/contact.js";
import type { PresenceAction } from "./types/presence.js";
import { normalizeMessage } from "./types/message.js";
import { TransportOptions, type ITransport, WebSocketTransport } from "./socket/transport.js";
import { OPCODES } from "./protocol/opcodes.js";

export interface MaxSocketConfig {
  auth: AuthenticationState;
  transport?: ITransport;
  transportOptions?: TransportOptions;
  timeoutMs?: number;
  keepAliveIntervalMs?: number;
  autoReconnect?: boolean;
  maxReconnectDelayMs?: number;
  maxGlobalPerSecond?: number;
  maxChatPerSecond?: number;
  userAgent?: typeof DEFAULT_USER_AGENT;
}

export function makeMaxSocket(config: MaxSocketConfig) {
  const transport = config.transport ?? new WebSocketTransport(config.transportOptions);
  const authManager = new AuthManager(config.auth);
  const messageManager = new MessageManager();
  const chatManager = new ChatManager();
  const contactManager = new ContactManager();
  const presenceManager = new PresenceManager();

  let lastLoginResult: { sessionToken?: string; profile?: any; chats?: any[] } | undefined;

  const socketClient = new SocketClient({
    transport,
    timeoutMs: config.timeoutMs,
    keepAliveIntervalMs: config.keepAliveIntervalMs,
    autoReconnect: config.autoReconnect,
    maxReconnectDelayMs: config.maxReconnectDelayMs,
    maxGlobalPerSecond: config.maxGlobalPerSecond,
    maxChatPerSecond: config.maxChatPerSecond,
    messageNormalizer: (payload) => normalizeMessage(payload, config.auth.creds.userId),
    onSessionHandshake: async (client) => {
      await authManager.initSession(client, config.userAgent);
      if (config.auth.creds.sessionToken) {
        lastLoginResult = await authManager.loginWithToken(client);
      }
    },
    onReconnectSync: async () => {
      if (socketClient.gapRecovery.getLastServerTime() > 0) {
        socketClient.ev.emit('sync.start', { fromTimestamp: socketClient.gapRecovery.getLastServerTime() });
        socketClient.ev.emit('sync.complete', { syncedAt: Date.now() });
      }
    },
  });

  // Re-emit creds updates when tokens change
  socketClient.ev.on("creds.update", (creds) => {
    Object.assign(config.auth.creds, creds);
  });

  const sock = {
    /** Event bus: connection.update, messages.upsert, messages.read, presence.update, creds.update, sync.start, sync.complete */
    ev: socketClient.ev,

    /** Current authentication state */
    authState: config.auth,

    /** Outbound request queue & rate limiter */
    queue: socketClient.queue,

    /** L7 RTT Circuit Breaker */
    circuitBreaker: socketClient.circuitBreaker,

    /** Gap recovery and message sync manager */
    gapRecovery: socketClient.gapRecovery,

    /** Outbound idempotency ledger */
    ledger: messageManager.ledger,

    /** Current user info after login */
    get user() {
      return {
        id: config.auth.creds.userId,
        name: config.auth.creds.name,
        phone: config.auth.creds.phone,
      };
    },

    /** Underlying socket client */
    rawClient: socketClient,

    /** Message manager instance */
    messages: messageManager,

    /** Media manager instance */
    media: messageManager.getMediaManager(),

    /** Chat manager instance */
    chats: chatManager,

    /** Contact manager instance */
    contacts: contactManager,

    /** Presence manager instance */
    presence: presenceManager,

    /**
     * Connects to MAX, executes INIT handshake, and logs in if sessionToken exists.
     * Handshake automatically re-executes upon any reconnect!
     */
    async connect(): Promise<{ sessionToken?: string; profile?: any; chats?: any[] } | void> {
      await socketClient.connect();
      return lastLoginResult;
    },

    // --- Authentication ---

    /**
     * Requests SMS verification code for a phone number
     */
    async requestAuthCode(phone: string): Promise<{ authToken: string }> {
      return authManager.requestAuthCode(socketClient, phone);
    },

    /**
     * Submits received SMS code
     */
    async submitAuthCode(code: string): Promise<SubmitCodeResult> {
      const res = await authManager.submitAuthCode(socketClient, code);
      if (res.status === "ok") {
        await authManager.loginWithToken(socketClient, res.sessionToken);
      }
      return res;
    },

    /**
     * Submits 2FA password (if required after submitAuthCode)
     */
    async submitPassword(password: string): Promise<string> {
      const token = await authManager.submitPassword(socketClient, password);
      await authManager.loginWithToken(socketClient, token);
      return token;
    },

    /**
     * Requests QR-code login payload (0x0018 QR_LOGIN_START)
     */
    async requestQrCode(): Promise<{ qr: string; trackId: string }> {
      return authManager.requestQrCode(socketClient);
    },

    /**
     * Polls QR-code approval status until user scans on mobile (0x0019 QR_LOGIN_CHECK)
     */
    async pollQrStatus(
      trackId?: string,
      options?: { timeoutMs?: number; intervalMs?: number }
    ): Promise<{ sessionToken: string }> {
      const res = await authManager.pollQrStatus(socketClient, trackId, options);
      await authManager.loginWithToken(socketClient, res.sessionToken);
      return res;
    },

    /**
     * Logs out from MAX and destroys credentials
     */
    async logout(): Promise<void> {
      return authManager.logout(socketClient);
    },

    /**
     * Disconnects the socket
     */
    end(): void {
      socketClient.disconnect();
    },

    // --- Messages & Media ---

    /**
     * Sends a text message, media, buttons, or poll to a chat
     */
    async sendMessage(
      chatId: string | number | bigint,
      content: AnyMessageContent
    ): Promise<MaxMessage> {
      return messageManager.sendMessage(
        socketClient,
        chatId,
        content,
        config.auth.creds.userId
      );
    },

    /**
     * Edits an existing message
     */
    async editMessage(
      chatId: string | number | bigint,
      messageId: string | number | bigint,
      newText: string,
      options: { parseMode?: 'markdown' | 'none'; elements?: MessageElement[] } = {}
    ): Promise<void> {
      return messageManager.editMessage(socketClient, chatId, messageId, newText, options);
    },

    /**
     * Deletes messages from a chat
     */
    async deleteMessages(
      chatId: string | number | bigint,
      messageIds: Array<string | number | bigint>,
      forMe = false
    ): Promise<void> {
      return messageManager.deleteMessages(socketClient, chatId, messageIds, forMe);
    },

    /**
     * Adds an emoji reaction to a message
     */
    async addReaction(
      chatId: string | number | bigint,
      messageId: string | number | bigint,
      emoji: string
    ): Promise<void> {
      return messageManager.addReaction(socketClient, chatId, messageId, emoji);
    },

    /**
     * Removes an emoji reaction from a message
     */
    async removeReaction(
      chatId: string | number | bigint,
      messageId: string | number | bigint
    ): Promise<void> {
      return messageManager.removeReaction(socketClient, chatId, messageId);
    },

    /**
     * Marks messages in a chat as read
     */
    async markChatRead(
      chatId: string | number | bigint,
      messageIds: Array<string | number | bigint> = [],
      fromTimestamp?: number
    ): Promise<void> {
      return messageManager.markChatRead(socketClient, chatId, messageIds, fromTimestamp);
    },

    /**
     * Pins a message in a chat
     */
    async pinMessage(
      chatId: string | number | bigint,
      messageId: string | number | bigint,
      notify = false
    ): Promise<void> {
      return messageManager.pinMessage(socketClient, chatId, messageId, notify);
    },

    /**
     * Unpins a message in a chat
     */
    async unpinMessage(
      chatId: string | number | bigint,
      messageId: string | number | bigint
    ): Promise<void> {
      return messageManager.unpinMessage(socketClient, chatId, messageId);
    },

    /**
     * Sends a callback query response when user clicks an inline button
     */
    async sendCallback(
      chatId: string | number | bigint,
      messageId: string | number | bigint,
      callbackId: string,
      payload?: string
    ): Promise<void> {
      return messageManager.sendCallback(socketClient, chatId, messageId, callbackId, payload);
    },

    /**
     * Forwards messages to another chat
     */
    async forwardMessages(
      targetChatId: string | number | bigint,
      sourceChatId: string | number | bigint,
      messageIds: Array<string | number | bigint>
    ): Promise<MaxMessage[]> {
      return messageManager.forwardMessages(
        socketClient,
        targetChatId,
        sourceChatId,
        messageIds,
        config.auth.creds.userId
      );
    },

    /**
     * Downloads media attachment associated with a message or attachment descriptor
     */
    async downloadMedia(
      target: MaxMessage | MessageAttachment | Record<string, any>
    ): Promise<Buffer> {
      return messageManager.downloadMedia(socketClient, target);
    },

    /**
     * Retrieves chat message history
     */
    async getChatHistory(
      chatId: string | number | bigint,
      fromTimestamp?: number,
      limit = 50
    ): Promise<MaxMessage[]> {
      return messageManager.getChatHistory(
        socketClient,
        chatId,
        fromTimestamp,
        limit,
        config.auth.creds.userId
      );
    },

    // --- Chats & Groups ---

    /**
     * Retrieves active chats / dialogs of the current user (0x0035 CHATS_LIST).
     */
    async getChats(
      options?: { fromTimestamp?: number; count?: number }
    ): Promise<MaxChat[]> {
      return chatManager.getChats(socketClient, options);
    },

    /**
     * Retrieves detailed chat information by chatId (0x0033 CHAT_INFO).
     */
    async getChat(
      chatId: string | number | bigint
    ): Promise<MaxChat> {
      return chatManager.getChat(socketClient, chatId);
    },

    /**
     * Creates a new group chat or channel (0x003c CHAT_CREATE).
     */
    async createChat(
      options: CreateChatOptions
    ): Promise<MaxChat> {
      return chatManager.createChat(socketClient, options);
    },

    /**
     * Updates title, description, or avatar of a chat (0x0037 CHAT_SET_INFO).
     */
    async setChatInfo(
      chatId: string | number | bigint,
      options: SetChatInfoOptions
    ): Promise<void> {
      return chatManager.setChatInfo(socketClient, chatId, options);
    },

    /**
     * Fetches members of a chat (0x003b CHAT_MEMBERS).
     */
    async getChatMembers(
      chatId: string | number | bigint,
      options?: { count?: number; offset?: number }
    ): Promise<ChatMember[]> {
      return chatManager.getChatMembers(socketClient, chatId, options);
    },

    /**
     * Adds one or more members to a group chat.
     */
    async addChatMembers(
      chatId: string | number | bigint,
      userIds: Array<string | number | bigint>
    ): Promise<void> {
      return chatManager.addChatMembers(socketClient, chatId, userIds);
    },

    /**
     * Removes (kicks) a member from a group chat.
     */
    async removeChatMember(
      chatId: string | number | bigint,
      userId: string | number | bigint
    ): Promise<void> {
      return chatManager.removeChatMember(socketClient, chatId, userId);
    },

    /**
     * Leaves a chat or channel (0x003a CHAT_LEAVE).
     */
    async leaveChat(
      chatId: string | number | bigint
    ): Promise<void> {
      return chatManager.leaveChat(socketClient, chatId);
    },

    /**
     * Deletes a chat (0x0034 CHAT_DELETE).
     */
    async deleteChat(
      chatId: string | number | bigint
    ): Promise<void> {
      return chatManager.deleteChat(socketClient, chatId);
    },

    /**
     * Generates or fetches an invitation link for a chat (0x003e CHAT_INVITE_LINK).
     */
    async createInviteLink(
      chatId: string | number | bigint
    ): Promise<string> {
      return chatManager.createInviteLink(socketClient, chatId);
    },

    /**
     * Joins a chat using an invitation link or invite token (0x003f CHAT_JOIN_LINK).
     */
    async joinByLink(
      inviteLinkOrCode: string
    ): Promise<MaxChat> {
      return chatManager.joinByLink(socketClient, inviteLinkOrCode);
    },

    // --- Contacts & Users ---

    /**
     * Looks up a user in MAX by their phone number (0x002e CONTACT_INFO_BY_PHONE).
     */
    async getContactByPhone(
      phone: string
    ): Promise<MaxContact | null> {
      return contactManager.getContactByPhone(socketClient, phone);
    },

    /**
     * Retrieves profile details for a specific user ID (0x0020 CONTACT_INFO).
     */
    async getUserProfile(
      userId: string | number | bigint
    ): Promise<MaxContact> {
      return contactManager.getUserProfile(socketClient, userId);
    },

    /**
     * Searches contacts within the user's address book and dialogs (0x0025 CONTACT_SEARCH).
     */
    async searchContacts(
      query: string
    ): Promise<MaxContact[]> {
      return contactManager.searchContacts(socketClient, query);
    },

    /**
     * Searches the global MAX directory by name or username (0x002c PUBLIC_SEARCH).
     */
    async publicSearch(
      query: string
    ): Promise<MaxContact[]> {
      return contactManager.publicSearch(socketClient, query);
    },

    /**
     * Adds a user to the address book (0x0029 CONTACT_ADD).
     */
    async addContact(
      phone: string,
      name: { firstName: string; lastName?: string }
    ): Promise<void> {
      return contactManager.addContact(socketClient, phone, name);
    },

    /**
     * Updates current user's profile info (0x0022 CONTACT_UPDATE).
     */
    async updateProfile(
      options: UpdateProfileOptions
    ): Promise<void> {
      return contactManager.updateProfile(socketClient, options);
    },

    // --- Presence / Typing ---

    /**
     * Sends typing/presence status to a chat (0x004a MSG_TYPING).
     */
    async sendPresence(
      chatId: string | number | bigint,
      action: PresenceAction = 'typing'
    ): Promise<void> {
      return presenceManager.sendPresence(socketClient, chatId, action);
    },

    /**
     * Simulates typing for delayMs, then resets status to pause.
     */
    async simulateTyping(
      chatId: string | number | bigint,
      delayMs = 2000,
      action: PresenceAction = 'typing'
    ): Promise<void> {
      return presenceManager.simulateTyping(socketClient, chatId, delayMs, action);
    },
  };

  return sock;
}
