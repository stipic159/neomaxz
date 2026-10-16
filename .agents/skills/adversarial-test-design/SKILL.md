---
name: adversarial-test-design
description: Guidelines for preventing mirror-mocking, catching swallowed asynchronous errors, and writing realistic, adversarial test suites.
---

# Adversarial Test Design

This skill provides testing standards to prevent AI self-deception ("mirror mocks") and ensure test suites expose real bugs instead of creating an illusion of correctness.

## Core Rules

### 1. Ban Mirror-Mocking (Self-Fulfilling Tests)
- **Definition**: A mirror-mock is a mock object written to match the specific quirks or buggy assumptions of the implementation rather than real protocol specifications.
- **Rule**:
  - Always test against contract violations: server delays, out-of-order frames, malformed payloads, abrupt network disconnects midway through a query.
  - Never assume the transport behaves synchronously or delivers responses in lock-step with requests.

### 2. Zero-Tolerance for Swallowed Test Assertions
- In asynchronous event-driven code, assertions executed inside event callbacks or background tasks run outside the main test Promise stack.
- **Rule**:
  - Never allow an event emitter or bus to swallow `AssertionError` (or any unhandled error) inside `catch` blocks without failing the test runner.
  - Test suites must register global error listeners (e.g. `client.ev.on('error', (err) => { throw err; })`) or propagate handler rejections.
  - In unit tests, verify exact invocation counts and assert that unwanted events (or duplicates) are NEVER emitted.

### 3. Mandatory Chaos & Edge-Case Test Scenarios
For every networking/socket module, include tests for:
1. **Concurrent duplicate opcodes**: Dispatching 5 concurrent requests with identical opcodes to verify no correlation cross-talk occurs.
2. **Abrupt disconnect while waiting**: Disconnecting the transport while 3 queries are pending; all 3 must cleanly reject with connection-lost errors.
3. **Reconnect state verification**: Simulating a network drop and verifying that `INIT` and `LOGIN` re-execute automatically before any user queries succeed.
4. **Duplicate message detection**: Verifying that a single incoming server push emits exactly one normalized domain event.
