---
name: resilient-socket-protocol
description: Rules and patterns for designing resilient duplex network protocols, WebSockets, and stateful client connections with multi-stage authentication.
---

# Resilient Socket Protocol Design

This skill provides guidelines and strict architectural rules for building stateful, bidirectional, packet-oriented network clients (WebSocket, TLS, TCP) with complex authentication lifecycles.

## Core Principles

### 1. Two-Tier Reconnection Lifecycle (L4/L5 Transport vs L7 Session)
- **Transport Connection != Session State**: Re-establishing a TCP or WebSocket socket (`readyState === OPEN`) does NOT mean the client is ready to accept commands or pushes.
- **Mandatory Lifecycle Handshake**:
  When a transport re-connects after a drop:
  1. Transition client status to `connecting` or `authenticating`.
  2. Send low-level protocol initialization (`INIT`, handshake, protocol version verification).
  3. Re-authenticate session using existing credentials (`LOGIN` / `RESUME` token) or initiate session recovery.
  4. Only after the L7 server acknowledges the session, transition status to `open` and resume queued outgoing queries and keep-alives.
- **No Zombie Sockets**: Never emit `connection: 'open'` before L7 authentication completes upon reconnect.

### 2. Request/Response Correlation & Concurrency
- **Strict Sequence Matching**:
  - Outgoing requests must have unique sequence numbers (`seq`) or correlation IDs.
  - **NEVER** use heuristic fallback (e.g. matching only by `opcode`) if multiple requests are in flight. If the server does not return `seq` on certain transports, serialize requests into a strict FIFO queue or require explicit correlation.
  - Concurrent requests with identical opcodes (e.g., sending two messages simultaneously) must never cross-talk or resolve each other's promises.

### 3. Fault Isolation (No "Nuclear" `rejectAll`)
- A send error on an individual frame (e.g. serialization error, buffer backpressure, validation) must ONLY reject that specific request's Promise.
- `rejectAll()` must strictly be reserved for true connection teardowns (socket close, unrecoverable network failure).
- Pending requests must clean up their own timeout timers upon resolution or rejection.

### 4. Heartbeats and Stale Socket Detection
- Heartbeat pings must have independent, aggressive timeouts shorter than the heartbeat interval.
- If a heartbeat query times out, explicitly destroy/terminate the underlying transport to trigger the reconnect state machine rather than leaving a hanging half-open connection.
