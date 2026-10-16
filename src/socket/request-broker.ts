import { Command } from "../protocol/opcodes.js";
import { SEQ_MODULO, type InboundFrame } from "../protocol/frame.js";

export class ProtocolError extends Error {
  readonly opcode: number;
  readonly payload: Record<string, any> | null;
  readonly code?: string | number;

  constructor(message: string, opcode: number, payload: Record<string, any> | null) {
    super(message);
    this.name = "ProtocolError";
    this.opcode = opcode;
    this.payload = payload;
    this.code = payload?.error ?? payload?.code;
  }
}

interface PendingRequest {
  opcode: number;
  resolve: (frame: InboundFrame) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export class RequestBroker {
  private currentSeq = 0;
  private pending = new Map<number, PendingRequest>();

  /**
   * Generates the next sequential 16-bit sequence number (1..65535).
   */
  public nextSeq(): number {
    this.currentSeq = (this.currentSeq + 1) % SEQ_MODULO;
    if (this.currentSeq === 0) {
      this.currentSeq = 1;
    }
    return this.currentSeq;
  }

  /**
   * Registers a pending request and returns a Promise that resolves when the response arrives.
   */
  public register(seq: number, opcode: number, timeoutMs = 15000): Promise<InboundFrame> {
    return new Promise<InboundFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        reject(new Error(`Timeout waiting for response to opcode 0x${opcode.toString(16)} (seq=${seq}) after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(seq, { opcode, resolve, reject, timer });
    });
  }

  /**
   * Rejects an individual pending request by its seq.
   */
  public reject(seq: number, reason: Error): boolean {
    const entry = this.pending.get(seq);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.pending.delete(seq);
    entry.reject(reason);
    return true;
  }

  /**
   * Matches an incoming frame with a pending request.
   * Returns true if a pending request was found and resolved/rejected.
   */
  public handleResponse(frame: InboundFrame): boolean {
    let targetSeq: number | undefined;

    // 1. Exact seq match
    if (this.pending.has(frame.seq)) {
      targetSeq = frame.seq;
    } else {
      // 2. Safe fallback: ONLY if there is EXACTLY ONE pending request with this opcode
      // This strictly prevents cross-talk and data corruption when concurrent queries share an opcode
      const matches: number[] = [];
      for (const [seq, entry] of this.pending) {
        if (entry.opcode === frame.opcode) {
          matches.push(seq);
        }
      }
      if (matches.length === 1) {
        targetSeq = matches[0];
      }
    }

    if (targetSeq === undefined) return false;

    const entry = this.pending.get(targetSeq)!;
    clearTimeout(entry.timer);
    this.pending.delete(targetSeq);

    if (frame.cmd === Command.ERROR) {
      const errorMsg = frame.payload?.message ?? frame.payload?.error ?? `MAX protocol error on opcode 0x${frame.opcode.toString(16)}`;
      entry.reject(new ProtocolError(String(errorMsg), frame.opcode, frame.payload));
    } else {
      entry.resolve(frame);
    }

    return true;
  }

  /**
   * Rejects all currently pending requests (called when connection drops).
   */
  public rejectAll(reason: Error): void {
    for (const [seq, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(reason);
    }
    this.pending.clear();
  }

  public pendingCount(): number {
    return this.pending.size;
  }
}
