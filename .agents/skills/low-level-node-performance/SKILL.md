---
name: low-level-node-performance
description: Performance and reliability guardrails for low-level Node.js development, Buffer allocation, binary stream decoding, and Windows filesystem safety.
---

# Low-Level Node.js Performance and Safety Guardrails

This skill details essential engineering practices when working with binary data, codecs, and cross-platform filesystem operations.

## Core Rules

### 1. Zero-Allocation / Dynamic Buffer Management
- **Anti-Pattern**: Allocating large static buffers (e.g. `Buffer.alloc(8 * 1024 * 1024)`) on every inbound frame or packet. This triggers GC thrashing, high latency, and eventual OOM under heavy load.
- **Rule**:
  - Size output buffers based on decompression headers or packet metadata whenever possible.
  - For variable/unknown decompression output, start with reasonable initial sizes (e.g. 64KB or $N \times \text{inputSize}$) or use chunked stream decoders.
  - Reuse shared buffer pools for high-frequency operations.

### 2. Cross-Platform Safe Atomic File Writes
- **Anti-Pattern**: Writing to a hardcoded `.tmp` filename (e.g. `.creds.json.tmp`) and calling `fs.rename`.
- **The Windows Hazard**:
  - Concurrent writes to the exact same temporary file path will fail with `EBUSY` or `EPERM`.
  - On Windows, `fs.rename` is not reliably atomic if the target file is locked or open in another process/handle.
- **Rule**:
  - Use unique temporary filenames containing random UUIDs or thread/process IDs: `${filePath}.${randomUUID()}.tmp`.
  - Serialize writes through a mutex, promise queue, or lock file so rapid credential updates (`saveCreds()`) do not race.
  - Clean up orphaned `.tmp` files on failure.

### 3. Protocol Schema over Rigid Magic Constants
- **Anti-Pattern**: Hardcoding expected string lengths from sample dumps (e.g. `SESSION_TOKEN_LENGTH = 663`).
- **Rule**:
  - Extract credentials and tokens using schema property paths or structural validation rather than rigid character counts.
  - Allow variable-length tokens with sensible bounds (e.g., minimum length check, valid token character alphabet).
