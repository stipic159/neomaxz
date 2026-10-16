/**
 * MAX Protocol Opcodes and Commands
 * Protocol version: 10 (0x0a)
 */

export const PROTOCOL_VERSION = 10;

/** Frame command direction */
export const Command = {
  REQUEST: 0,
  RESPONSE: 1,
  EVENT: 2, // Server push
  ERROR: 3,
} as const;

export type Command = (typeof Command)[keyof typeof Command];

/**
 * Known opcodes for MAX messenger binary protocol
 */
export const OPCODES = {
  // --- System / Handshake ---
  PING: 0x0001,
  INIT: 0x0006,

  // --- Authentication ---
  START_AUTH: 0x0011,       // Request SMS code { phone }
  CHECK_CODE: 0x0012,       // Submit SMS code { code, trackId } -> returns loginToken OR passwordChallenge
  LOGIN: 0x0013,            // Login with session token { token }
  LOGOUT: 0x0014,           // Terminate session { pushToken }
  CHECK_PASSWORD: 0x0073,   // 2FA cloud password { trackId, password } -> returns loginToken
  QR_LOGIN_START: 0x0018,   // QR authentication request
  QR_LOGIN_CHECK: 0x0019,   // QR authentication status poll

  // --- Contacts & Profile ---
  CONTACT_INFO: 0x0020,
  CONTACT_UPDATE: 0x0022,
  CONTACT_SEARCH: 0x0025,
  CONTACT_ADD: 0x0029,
  PUBLIC_SEARCH: 0x002c,    // Global directory search
  CONTACT_INFO_BY_PHONE: 0x002e,

  // --- Chats & Dialogs ---
  CHAT_HISTORY: 0x0031,
  CHAT_INFO: 0x0033,
  CHAT_DELETE: 0x0034,
  CHATS_LIST: 0x0035,
  CHAT_SET_INFO: 0x0037,    // Update title/description
  CHAT_LEAVE: 0x003a,
  CHAT_MEMBERS: 0x003b,
  CHAT_CREATE: 0x003c,
  CHAT_INVITE_LINK: 0x003e,
  CHAT_JOIN_LINK: 0x003f,

  // --- Messages & Typing ---
  MSG_SEND: 0x0040,
  MSG_TYPING: 0x004a,       // Outgoing typing status
  MSG_DELETE: 0x0042,
  MSG_EDIT: 0x0043,
  MSG_REACTION: 0x0044,
  MSG_READ: 0x0045,
  MSG_CANCEL_REACTION: 0x0046,
  MSG_PIN: 0x0047,
  MSG_UNPIN: 0x0048,
  MSG_FORWARD: 0x0049,
  MSG_CALLBACK: 0x0076,     // Bot keyboard button callback { callbackId, chatId, payload }

  // --- Media & Files ---
  PHOTO_UPLOAD: 0x0050,
  VIDEO_UPLOAD: 0x0052,
  VIDEO_PLAY: 0x0053,
  FILE_UPLOAD: 0x0057,
  FILE_DOWNLOAD: 0x0058,

  // --- Server Pushes / Events ---
  PUSH_MESSAGE: 0x0080,     // Incoming message push
  PUSH_TYPING: 0x0081,      // Typing status push
  PUSH_CHAT_UPDATE: 0x0087, // Chat metadata update
  PUSH_READ: 0x0088,        // Message read receipt push
  NOTIF_ATTACH: 0x0088,     // Attachment processing notification
  PUSH_USER_STATUS: 0x008e, // Online/offline status push
} as const;

export type Opcode = (typeof OPCODES)[keyof typeof OPCODES];

/** Default network endpoints */
export const DEFAULT_WEBSOCKET_URL = "wss://api.oneme.ru/websocket";
export const DEFAULT_RAW_TCP_HOST = "api2.oneme.ru";
export const DEFAULT_RAW_TCP_PORT = 443;
export const DEFAULT_ORIGIN = "https://web.max.ru";
