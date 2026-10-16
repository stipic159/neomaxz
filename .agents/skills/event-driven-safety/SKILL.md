---
name: event-driven-safety
description: Architectural rules for asynchronous event emitters, decoupling execution pipelines, and preventing event bus deadlocks.
---

# Event-Driven Safety & Architecture

This skill provides patterns for building safe, non-blocking asynchronous event emitters in Node.js and TypeScript.

## Core Rules

### 1. No Serial Head-of-Line Blocking in General Event Busses
- **The Problem**: A single queue that awaits each async listener sequentially (`await listener()`) will freeze the entire application if any listener performs slow I/O, LLM inference, or awaits user input.
- **The Rule**:
  - Dispatch listeners independently (concurrently) per event.
  - Wrap listener execution with error boundaries (`Promise.resolve(listener(data)).catch(...)`) so one listener's crash or delay cannot block or crash other listeners or stall the frame ingestion pipeline.
  - If ordered processing is strictly required for a specific domain entity (e.g. strict message ordering per chat ID), use a keyed partition queue rather than a global blocking event bus.

### 2. Single Source of Truth for Domain Events
- Never emit the same domain event (e.g. `messages.upsert`) from multiple layers in the architecture.
- Low-level network/socket layers should only emit low-level transport events (`frame.inbound`, `frame.outbound`, `raw.close`).
- High-level client layers are exclusively responsible for transforming, normalizing, and emitting high-level domain events (`messages.upsert`, `presence.update`).

### 3. Queue Hygiene & Backpressure
- Provide explicit queue bounds or telemetry if events are buffered during paused states (e.g. during initial handshake).
- Dropped or accumulated events must be visible to observability tools to prevent silent memory bloat.
