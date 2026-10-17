// Protocol exports
export * from "./protocol/ca.js";
export * from "./protocol/opcodes.js";
export * from "./protocol/lz4.js";
export * from "./protocol/frame.js";

// Socket & Transport exports
export * from "./socket/request-broker.js";
export * from "./socket/request-queue.js";
export * from "./socket/circuit-breaker.js";
export * from "./socket/gap-recovery.js";
export * from "./socket/event-emitter.js";
export * from "./socket/transport.js";
export * from "./socket/socket-client.js";

// Session & Auth exports
export * from "./session/auth-state.js";
export * from "./session/tokens.js";
export * from "./session/file-auth.js";
export * from "./session/sqlite-auth.js";
export * from "./session/auth-manager.js";

// Media exports
export * from "./media/http-client.js";
export * from "./media/media-manager.js";
export * from "./media/audio.js";

// Messages & Domain exports
export * from "./messages/message-manager.js";
export * from "./messages/idempotency-ledger.js";
export * from "./messages/formatting.js";
export * from "./types/message.js";
export * from "./types/media.js";
export * from "./types/buttons.js";

// Chats & Groups exports
export * from "./chats/chat-manager.js";
export * from "./types/chat.js";

// Contacts & Profiles exports
export * from "./contacts/contact-manager.js";
export * from "./types/contact.js";

// Presence & Typing exports
export * from "./presence/presence-manager.js";
export * from "./types/presence.js";

// Client Facade
export * from "./client.js";

// Types
export * from "./types/connection.js";
export * from "./types/events.js";
