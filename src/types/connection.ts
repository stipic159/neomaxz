/**
 * Connection states and disconnect reasons inspired by Baileys
 */

export type ConnectionStatus = 'connecting' | 'open' | 'close';

export enum DisconnectReason {
  connectionClosed = 428,
  connectionLost = 408,
  connectionReplaced = 440,
  timedOut = 408,
  loggedOut = 401,
  badSession = 500,
  restartRequired = 515,
}

export interface DisconnectInfo {
  error?: Error;
  reason?: DisconnectReason | number;
  date: Date;
}

export interface ConnectionState {
  connection: ConnectionStatus;
  lastDisconnect?: DisconnectInfo;
}
