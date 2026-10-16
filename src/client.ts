import { SocketClient, type SocketClientOptions } from "./socket/socket-client.js";
import { AuthManager, DEFAULT_USER_AGENT, type SubmitCodeResult } from "./session/auth-manager.js";
import { MessageManager } from "./messages/message-manager.js";
import type { AuthenticationState } from "./session/auth-state.js";
import type { AnyMessageContent, MaxMessage, MessageElement } from "./types/message.js";
import type { MessageAttachment } from "./types/media.js";
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
  userAgent?: typeof DEFAULT_USER_AGENT;
}

export function makeMaxSocket(config: MaxSocketConfig) {
  const transport = config.transport ?? new WebSocketTransport(config.transportOptions);
  const authManager = new AuthManager(config.auth);
  const messageManager = new MessageManager();

  let lastLoginResult: { sessionToken?: string; profile?: any; chats?: any[] } | undefined;

  const socketClient = new SocketClient({
    transport,
    timeoutMs: config.timeoutMs,
    keepAliveIntervalMs: config.keepAliveIntervalMs,
    autoReconnect: config.autoReconnect,
    maxReconnectDelayMs: config.maxReconnectDelayMs,
    messageNormalizer: (payload) => normalizeMessage(payload, config.auth.creds.userId),
    onSessionHandshake: async (client) => {
      await authManager.initSession(client, config.userAgent);
      if (config.auth.creds.sessionToken) {
        lastLoginResult = await authManager.loginWithToken(client);
      }
    },
  });

  // Re-emit creds updates when tokens change
  socketClient.ev.on("creds.update", (creds) => {
    Object.assign(config.auth.creds, creds);
  });

  const sock = {
    /** Event bus: connection.update, messages.upsert, messages.read, presence.update, creds.update */
    ev: socketClient.ev,

    /** Current authentication state */
    authState: config.auth,

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

    /**
     * Connects to MAX, executes INIT handshake, and logs in if sessionToken exists.
     * Handshake automatically re-executes upon any reconnect!
     */
    async connect(): Promise<{ sessionToken?: string; profile?: any; chats?: any[] } | void> {
      await socketClient.connect();
      return lastLoginResult;
    },

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
  };

  return sock;
}
