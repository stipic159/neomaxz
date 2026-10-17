import https from 'node:https';
import http from 'node:http';
import { URL } from 'node:url';
import { promises as fs } from 'node:fs';
import { PassThrough } from 'node:stream';
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
  maxRedirects?: number;
}

export interface StreamUploadOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  method?: 'POST' | 'PUT';
  knownLength?: number;
  signal?: AbortSignal;
  onProgress?: (progress: { bytesSent: number; totalBytes?: number; percent?: number }) => void;
}

export interface StreamDownloadOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  signal?: AbortSignal;
  onProgress?: (progress: { bytesDownloaded: number; totalBytes?: number; percent?: number }) => void;
}

export class HttpClient {
  private ca: string[];
  private defaultTimeoutMs: number;
  private httpsAgent: https.Agent;
  private httpAgent: http.Agent;

  constructor(options: HttpClientOptions = {}) {
    this.ca = options.ca ?? getTlsCaCertificates();
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 60000;
    this.httpsAgent = new https.Agent({ ca: this.ca, keepAlive: true });
    this.httpAgent = new http.Agent({ keepAlive: true });
  }

  /**
   * Cleans up internal HTTP/HTTPS agent sockets.
   */
  public destroy(): void {
    this.httpsAgent.destroy();
    this.httpAgent.destroy();
  }

  /**
   * Resolves various MediaSource inputs into a raw Buffer, guessing fileName or mimeType if possible.
   */
  public async resolveMediaSource(source: MediaSource): Promise<{
    buffer: Buffer;
    fileName?: string;
    mimeType?: string;
  }> {
    if (!source) {
      throw new TypeError(`Invalid MediaSource: value is null or undefined`);
    }

    if (Buffer.isBuffer(source)) {
      return { buffer: source };
    }

    if (source instanceof Uint8Array) {
      return { buffer: Buffer.from(source.buffer, source.byteOffset, source.byteLength) };
    }

    // Direct URL string: 'https://...' or 'http://...'
    if (typeof source === 'string' && (source.startsWith('http://') || source.startsWith('https://'))) {
      const buffer = await this.download(source);
      const urlPath = new URL(source).pathname;
      const fileName = decodeURIComponent(urlPath.split('/').pop() || '') || undefined;
      return { buffer, fileName };
    }

    // Object with url: { url: string }
    if (typeof source === 'object' && 'url' in source && typeof source.url === 'string') {
      const buffer = await this.download(source.url);
      const urlPath = new URL(source.url).pathname;
      const fileName = decodeURIComponent(urlPath.split('/').pop() || '') || undefined;
      return { buffer, fileName };
    }

    // Local file path
    if (typeof source === 'string') {
      const buffer = await fs.readFile(source);
      const fileName = source.replace(/\\/g, '/').split('/').pop();
      return { buffer, fileName };
    }

    // Readable Stream
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
    const agent = isHttps ? this.httpsAgent : this.httpAgent;
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

      const cleanup = () => {
        settled = true;
      };

      const req = client.request(
        targetUrl,
        {
          method: options.method ?? 'POST',
          headers,
          agent,
          timeout: timeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];

          res.on('error', (err) => {
            if (settled) return;
            cleanup();
            reject(err);
          });

          res.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
          });

          res.on('end', () => {
            if (settled) return;
            cleanup();

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
        cleanup();
        const err = new Error(`Upload to ${targetUrl} timed out after ${timeoutMs}ms`);
        req.destroy(err);
        reject(err);
      });

      req.on('error', (err) => {
        if (settled) return;
        cleanup();
        reject(err);
      });

      req.end(buffer);
    });
  }

  /**
   * Downloads data from an HTTP(S) URL into a Buffer with Russian CA verification.
   */
  public async download(
    url: string,
    options: DownloadOptions = {},
    redirectCount = 0
  ): Promise<Buffer> {
    const maxRedirects = options.maxRedirects ?? 5;
    if (redirectCount > maxRedirects) {
      throw new Error(`Download failed: exceeded maximum redirect depth of ${maxRedirects}`);
    }

    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';
    const client = isHttps ? https : http;
    const agent = isHttps ? this.httpsAgent : this.httpAgent;
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const maxBytes = options.maxBytes ?? 100 * 1024 * 1024; // 100MB default limit

    return new Promise<Buffer>((resolve, reject) => {
      let settled = false;
      let totalBytes = 0;

      const cleanup = () => {
        settled = true;
      };

      const req = client.get(
        url,
        {
          headers: options.headers,
          agent,
          timeout: timeoutMs,
        },
        (res) => {
          // Handle redirects (3xx)
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            cleanup();
            res.resume(); // Drain and release socket back to agent pool
            const resolvedRedirectUrl = new URL(res.headers.location, url).toString();
            return this.download(resolvedRedirectUrl, options, redirectCount + 1).then(resolve, reject);
          }

          if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
            cleanup();
            res.resume();
            return reject(new Error(`HTTP download failed with status ${res.statusCode}`));
          }

          // Fast upfront Content-Length check
          const contentLength = Number(res.headers['content-length']);
          if (!isNaN(contentLength) && contentLength > maxBytes) {
            cleanup();
            res.resume();
            req.destroy();
            return reject(
              new Error(`Download exceeded maximum allowed size of ${maxBytes} bytes (Content-Length: ${contentLength})`)
            );
          }

          const chunks: Buffer[] = [];

          res.on('error', (err) => {
            if (settled) return;
            cleanup();
            reject(err);
          });

          res.on('data', (chunk: Buffer) => {
            totalBytes += chunk.length;
            if (totalBytes > maxBytes) {
              if (settled) return;
              cleanup();
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
            cleanup();
            resolve(Buffer.concat(chunks, totalBytes));
          });
        }
      );

      req.on('timeout', () => {
        if (settled) return;
        cleanup();
        const err = new Error(`Download from ${url} timed out after ${timeoutMs}ms`);
        req.destroy(err);
        reject(err);
      });

      req.on('error', (err) => {
        if (settled) return;
        cleanup();
        reject(err);
      });
    });
  }

  /**
   * Performs a streaming HTTP(S) upload without buffering the entire body into RAM.
   */
  public async uploadStream(
    targetUrl: string,
    stream: NodeJS.ReadableStream,
    options: StreamUploadOptions = {}
  ): Promise<any> {
    const parsedUrl = new URL(targetUrl);
    const isHttps = parsedUrl.protocol === 'https:';
    const client = isHttps ? https : http;
    const agent = isHttps ? this.httpsAgent : this.httpAgent;
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;

    const headers: Record<string, string | number> = {
      'Content-Type': options.headers?.['Content-Type'] ?? 'application/octet-stream',
      ...(options.headers ?? {}),
    };

    if (options.knownLength !== undefined && options.knownLength >= 0) {
      headers['Content-Length'] = options.knownLength;
    }

    if (options.signal?.aborted) {
      throw new Error('Upload aborted before start');
    }

    return new Promise<any>((resolve, reject) => {
      let settled = false;
      let bytesSent = 0;

      const cleanup = () => {
        settled = true;
      };

      const req = client.request(
        targetUrl,
        {
          method: options.method ?? 'POST',
          headers,
          agent,
          timeout: timeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];

          res.on('error', (err) => {
            if (settled) return;
            cleanup();
            reject(err);
          });

          res.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
          });

          res.on('end', () => {
            if (settled) return;
            cleanup();

            const responseBuffer = Buffer.concat(chunks);
            const responseText = responseBuffer.toString('utf-8');

            const statusCode = res.statusCode ?? 0;
            if (statusCode < 200 || statusCode >= 300) {
              const err = new Error(
                `HTTP streaming upload failed with status ${statusCode}: ${responseText.slice(0, 300)}`
              );
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

      if (options.signal) {
        const onAbort = () => {
          if (settled) return;
          cleanup();
          const err = new Error('Upload aborted');
          req.destroy(err);
          (stream as any).destroy?.(err);
          reject(err);
        };
        options.signal.addEventListener('abort', onAbort, { once: true });
      }

      req.on('timeout', () => {
        if (settled) return;
        cleanup();
        const err = new Error(`Streaming upload to ${targetUrl} timed out after ${timeoutMs}ms`);
        req.destroy(err);
        (stream as any).destroy?.(err);
        reject(err);
      });

      req.on('error', (err) => {
        if (settled) return;
        cleanup();
        (stream as any).destroy?.(err);
        reject(err);
      });

      stream.on('data', (chunk: Buffer) => {
        bytesSent += chunk.length;
        if (options.onProgress) {
          const totalBytes = options.knownLength;
          const percent = totalBytes ? Math.min(100, Math.round((bytesSent / totalBytes) * 100)) : undefined;
          options.onProgress({ bytesSent, totalBytes, percent });
        }
      });

      stream.on('error', (err) => {
        if (settled) return;
        cleanup();
        req.destroy(err);
        reject(err);
      });

      stream.pipe(req);
    });
  }

  /**
   * Performs a streaming HTTP(S) download returning a ReadableStream.
   */
  public async downloadStream(
    url: string,
    options: StreamDownloadOptions = {},
    redirectCount = 0
  ): Promise<{
    stream: NodeJS.ReadableStream;
    contentLength?: number;
    mimeType?: string;
  }> {
    const maxRedirects = options.maxRedirects ?? 5;
    if (redirectCount > maxRedirects) {
      throw new Error(`Download failed: exceeded maximum redirect depth of ${maxRedirects}`);
    }

    if (options.signal?.aborted) {
      throw new Error('Download aborted before start');
    }

    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';
    const client = isHttps ? https : http;
    const agent = isHttps ? this.httpsAgent : this.httpAgent;
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const maxBytes = options.maxBytes ?? 500 * 1024 * 1024; // 500MB default limit

    return new Promise((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        settled = true;
      };

      const req = client.get(
        url,
        {
          headers: options.headers,
          agent,
          timeout: timeoutMs,
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            cleanup();
            res.resume();
            const resolvedRedirectUrl = new URL(res.headers.location, url).toString();
            return this.downloadStream(resolvedRedirectUrl, options, redirectCount + 1).then(resolve, reject);
          }

          if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
            cleanup();
            res.resume();
            return reject(new Error(`HTTP streaming download failed with status ${res.statusCode}`));
          }

          const contentLength = Number(res.headers['content-length']);
          if (!isNaN(contentLength) && contentLength > maxBytes) {
            cleanup();
            res.resume();
            req.destroy();
            return reject(
              new Error(`Download exceeded maximum allowed size of ${maxBytes} bytes (Content-Length: ${contentLength})`)
            );
          }

          const outputPassThrough = new PassThrough();
          let bytesDownloaded = 0;

          if (options.signal) {
            const onAbort = () => {
              const err = new Error('Download aborted');
              res.destroy(err);
              req.destroy(err);
              outputPassThrough.destroy(err);
            };
            options.signal.addEventListener('abort', onAbort, { once: true });
          }

          res.on('data', (chunk: Buffer) => {
            bytesDownloaded += chunk.length;
            if (bytesDownloaded > maxBytes) {
              const err = new Error(`Download exceeded maximum allowed size of ${maxBytes} bytes`);
              res.destroy(err);
              req.destroy(err);
              outputPassThrough.destroy(err);
              return;
            }
            if (options.onProgress) {
              const total = !isNaN(contentLength) ? contentLength : undefined;
              const percent = total ? Math.min(100, Math.round((bytesDownloaded / total) * 100)) : undefined;
              options.onProgress({ bytesDownloaded, totalBytes: total, percent });
            }
          });

          res.on('error', (err) => {
            outputPassThrough.destroy(err);
          });

          res.pipe(outputPassThrough);

          cleanup();
          resolve({
            stream: outputPassThrough,
            contentLength: !isNaN(contentLength) ? contentLength : undefined,
            mimeType: res.headers['content-type'],
          });
        }
      );

      req.on('timeout', () => {
        if (settled) return;
        cleanup();
        const err = new Error(`Streaming download from ${url} timed out after ${timeoutMs}ms`);
        req.destroy(err);
        reject(err);
      });

      req.on('error', (err) => {
        if (settled) return;
        cleanup();
        reject(err);
      });
    });
  }
}
