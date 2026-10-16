import https from 'node:https';
import http from 'node:http';
import { URL } from 'node:url';
import { promises as fs } from 'node:fs';
import { getTlsCaCertificates } from '../protocol/ca.js';
import type { MediaSource } from '../types/media.js';

export interface HttpClientOptions {
  ca?: string[];
  defaultTimeoutMs?: number;
}

export interface UploadOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  method?: 'POST' | 'PUT';
}

export interface DownloadOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
}

export class HttpClient {
  private ca: string[];
  private defaultTimeoutMs: number;

  constructor(options: HttpClientOptions = {}) {
    this.ca = options.ca ?? getTlsCaCertificates();
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 60000;
  }

  /**
   * Resolves various MediaSource inputs into a raw Buffer, guessing fileName or mimeType if possible.
   */
  public async resolveMediaSource(source: MediaSource): Promise<{
    buffer: Buffer;
    fileName?: string;
    mimeType?: string;
  }> {
    if (Buffer.isBuffer(source)) {
      return { buffer: source };
    }

    if (source instanceof Uint8Array) {
      return { buffer: Buffer.from(source.buffer, source.byteOffset, source.byteLength) };
    }

    if (typeof source === 'object' && 'url' in source && typeof source.url === 'string') {
      const buffer = await this.download(source.url);
      const urlPath = new URL(source.url).pathname;
      const fileName = urlPath.split('/').pop() || undefined;
      return { buffer, fileName };
    }

    if (typeof source === 'string') {
      // Local file path
      const buffer = await fs.readFile(source);
      const fileName = source.replace(/\\/g, '/').split('/').pop();
      return { buffer, fileName };
    }

    if (typeof source === 'object' && 'stream' in source && source.stream) {
      const chunks: Buffer[] = [];
      for await (const chunk of source.stream as any) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return { buffer: Buffer.concat(chunks) };
    }

    throw new TypeError(`Unsupported MediaSource type: ${typeof source}`);
  }

  /**
   * Performs an HTTP(S) upload (POST/PUT) with Russian CA chain verification.
   */
  public async upload(
    targetUrl: string,
    data: Buffer | Uint8Array,
    options: UploadOptions = {}
  ): Promise<any> {
    const parsedUrl = new URL(targetUrl);
    const isHttps = parsedUrl.protocol === 'https:';
    const client = isHttps ? https : http;
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;

    const buffer = Buffer.isBuffer(data)
      ? data
      : Buffer.from(data.buffer, data.byteOffset, data.byteLength);

    const headers: Record<string, string | number> = {
      'Content-Length': buffer.length,
      'Content-Type': options.headers?.['Content-Type'] ?? 'application/octet-stream',
      ...(options.headers ?? {}),
    };

    return new Promise<any>((resolve, reject) => {
      let settled = false;

      const req = client.request(
        targetUrl,
        {
          method: options.method ?? 'POST',
          headers,
          ca: isHttps ? this.ca : undefined,
          timeout: timeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];

          res.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
          });

          res.on('end', () => {
            if (settled) return;
            settled = true;

            const responseBuffer = Buffer.concat(chunks);
            const responseText = responseBuffer.toString('utf-8');

            const statusCode = res.statusCode ?? 0;
            if (statusCode < 200 || statusCode >= 300) {
              const err = new Error(`HTTP upload failed with status ${statusCode}: ${responseText.slice(0, 300)}`);
              (err as any).statusCode = statusCode;
              (err as any).body = responseText;
              return reject(err);
            }

            try {
              const json = JSON.parse(responseText);
              resolve(json);
            } catch {
              resolve(responseText);
            }
          });
        }
      );

      req.on('timeout', () => {
        if (settled) return;
        settled = true;
        req.destroy(new Error(`Upload to ${targetUrl} timed out after ${timeoutMs}ms`));
      });

      req.on('error', (err) => {
        if (settled) return;
        settled = true;
        reject(err);
      });

      req.end(buffer);
    });
  }

  /**
   * Downloads data from an HTTP(S) URL into a Buffer with Russian CA verification.
   */
  public async download(url: string, options: DownloadOptions = {}): Promise<Buffer> {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';
    const client = isHttps ? https : http;
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const maxBytes = options.maxBytes ?? 100 * 1024 * 1024; // 100MB default limit

    return new Promise<Buffer>((resolve, reject) => {
      let settled = false;
      let totalBytes = 0;

      const req = client.get(
        url,
        {
          headers: options.headers,
          ca: isHttps ? this.ca : undefined,
          timeout: timeoutMs,
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            // Handle redirect
            settled = true;
            return this.download(res.headers.location, options).then(resolve, reject);
          }

          if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
            settled = true;
            return reject(new Error(`HTTP download failed with status ${res.statusCode}`));
          }

          const chunks: Buffer[] = [];

          res.on('error', (err) => {
            if (settled) return;
            settled = true;
            reject(err);
          });

          res.on('data', (chunk: Buffer) => {
            totalBytes += chunk.length;
            if (totalBytes > maxBytes) {
              if (settled) return;
              settled = true;
              const err = new Error(`Download exceeded maximum allowed size of ${maxBytes} bytes`);
              res.destroy();
              req.destroy();
              reject(err);
              return;
            }
            chunks.push(chunk);
          });

          res.on('end', () => {
            if (settled) return;
            settled = true;
            resolve(Buffer.concat(chunks, totalBytes));
          });
        }
      );

      req.on('timeout', () => {
        if (settled) return;
        settled = true;
        req.destroy(new Error(`Download from ${url} timed out after ${timeoutMs}ms`));
      });

      req.on('error', (err) => {
        if (settled) return;
        settled = true;
        reject(err);
      });
    });
  }
}
