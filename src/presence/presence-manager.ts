import { OPCODES } from "../protocol/opcodes.js";
import type { SocketClient } from "../socket/socket-client.js";
import { toBigIntId } from "../types/message.js";
import type { PresenceAction } from "../types/presence.js";

export class PresenceManager {
  /**
   * Sends user typing/presence action to a chat.
   * Actions: 'typing' | 'recording_audio' | 'uploading_file' | 'paused'
   */
  public async sendPresence(
    client: SocketClient,
    chatId: string | number | bigint,
    action: PresenceAction = 'typing'
  ): Promise<void> {
    const isTyping = action !== 'paused';
    const serverAction = action === 'paused' ? 'PAUSED' : action.toUpperCase();

    await client.query({
      opcode: OPCODES.MSG_TYPING,
      payload: {
        chatId: toBigIntId(chatId),
        action: serverAction,
        typing: isTyping,
      },
    });
  }

  /**
   * Helper for bots: sends typing action, waits delayMs, then sends 'paused'.
   */
  public async simulateTyping(
    client: SocketClient,
    chatId: string | number | bigint,
    delayMs = 2000,
    action: PresenceAction = 'typing'
  ): Promise<void> {
    await this.sendPresence(client, chatId, action);
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    await this.sendPresence(client, chatId, 'paused');
  }
}
