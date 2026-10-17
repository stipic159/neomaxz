import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Readable } from 'node:stream';
import { HttpClient } from '../src/media/http-client.js';

describe('HttpClient Streaming Upload and Download', () => {
  let server: http.Server;
  let serverPort: number;
  let serverBaseUrl: string;

  before(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/upload-stream' && req.method === 'POST') {
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ receivedBytes: body.length, status: 'ok' }));
        });
        return;
      }

      if (req.url === '/download-stream' && req.method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'text/plain',
          'Content-Length': '12',
        });
        res.end('HELLO_STREAM');
        return;
      }

      if (req.url === '/redirect-stream' && req.method === 'GET') {
        res.writeHead(302, { Location: '/download-stream' });
        res.end();
        return;
      }

      res.writeHead(404);
      res.end('Not Found');
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        serverPort = addr.port;
        serverBaseUrl = `http://127.0.0.1:${serverPort}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test('uploadStream pipes data directly and tracks onProgress', async () => {
    const client = new HttpClient();
    const dataString = 'Chunk1_Chunk2_Chunk3_Data';
    const stream = Readable.from([Buffer.from('Chunk1_'), Buffer.from('Chunk2_'), Buffer.from('Chunk3_Data')]);

    const progressReports: number[] = [];
    const result = await client.uploadStream(`${serverBaseUrl}/upload-stream`, stream, {
      knownLength: dataString.length,
      onProgress: (p) => {
        progressReports.push(p.bytesSent);
      },
    });

    assert.deepEqual(result, { receivedBytes: dataString.length, status: 'ok' });
    assert.ok(progressReports.length >= 1);
    assert.equal(progressReports[progressReports.length - 1], dataString.length);
    client.destroy();
  });

  test('downloadStream returns Readable stream and follows redirect', async () => {
    const client = new HttpClient();
    const progressList: number[] = [];

    const { stream, contentLength, mimeType } = await client.downloadStream(`${serverBaseUrl}/redirect-stream`, {
      onProgress: (p) => {
        progressList.push(p.bytesDownloaded);
      },
    });

    assert.equal(contentLength, 12);
    assert.equal(mimeType, 'text/plain');

    const chunks: Buffer[] = [];
    for await (const chunk of stream as any) {
      chunks.push(chunk);
    }

    const downloaded = Buffer.concat(chunks).toString('utf-8');
    assert.equal(downloaded, 'HELLO_STREAM');
    assert.ok(progressList.length >= 1);
    assert.equal(progressList[progressList.length - 1], 12);
    client.destroy();
  });

  test('uploadStream aborts cleanly with AbortSignal', async () => {
    const client = new HttpClient();
    const controller = new AbortController();

    // Stream that delays
    const stream = new Readable({
      read() {
        setTimeout(() => this.push(Buffer.from('slow-chunk')), 100);
      },
    });

    const promise = client.uploadStream(`${serverBaseUrl}/upload-stream`, stream, {
      signal: controller.signal,
    });

    setTimeout(() => controller.abort(), 20);

    await assert.rejects(promise, /aborted/);
    client.destroy();
  });
});
