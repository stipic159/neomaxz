import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { HttpClient } from '../src/media/http-client.js';
import { MediaManager } from '../src/media/media-manager.js';
import { makeMaxSocket } from '../src/client.js';
import { Command, OPCODES } from '../src/protocol/opcodes.js';
import type { ITransport } from '../src/socket/transport.js';
import type { InboundFrame, OutboundFrame } from '../src/protocol/frame.js';

describe('Media Pipeline & Attachment Tests', () => {
  let server: http.Server;
  let serverPort: number;
  let serverBaseUrl: string;

  before(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/upload-photo' && req.method === 'POST') {
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ token: 'photo_tok_xyz', id: 777 }));
        });
        return;
      }

      if (req.url === '/upload-file' && req.method === 'POST') {
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ fileId: 888, token: 'file_tok_abc' }));
        });
        return;
      }

      if (req.url === '/download/test.bin' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        res.end(Buffer.from('HELLO_MEDIA_CONTENT'));
        return;
      }

      if (req.url === '/download/huge.bin' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        res.end(Buffer.alloc(2000, 1));
        return;
      }

      if (req.url === '/error-500') {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
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

  describe('HttpClient unit tests', () => {
    test('uploads data and parses JSON response', async () => {
      const client = new HttpClient();
      const res = await client.upload(`${serverBaseUrl}/upload-photo`, Buffer.from('fake-image-bytes'), {
        headers: { 'Content-Type': 'image/jpeg' },
      });

      assert.deepStrictEqual(res, { token: 'photo_tok_xyz', id: 777 });
    });

    test('downloads data as Buffer', async () => {
      const client = new HttpClient();
      const buf = await client.download(`${serverBaseUrl}/download/test.bin`);
      assert.strictEqual(buf.toString('utf-8'), 'HELLO_MEDIA_CONTENT');
    });

    test('fails gracefully on HTTP 500 status', async () => {
      const client = new HttpClient();
      await assert.rejects(
        async () => {
          await client.upload(`${serverBaseUrl}/error-500`, Buffer.from('data'));
        },
        /HTTP upload failed with status 500/
      );
    });

    test('rejects download when size exceeds maxBytes limit', async () => {
      const client = new HttpClient();
      await assert.rejects(
        async () => {
          await client.download(`${serverBaseUrl}/download/huge.bin`, { maxBytes: 500 });
        },
        /Download exceeded maximum allowed size/
      );
    });

    test('resolves MediaSource from URL correctly', async () => {
      const client = new HttpClient();
      const resolved = await client.resolveMediaSource({ url: `${serverBaseUrl}/download/test.bin` });
      assert.strictEqual(resolved.buffer.toString('utf-8'), 'HELLO_MEDIA_CONTENT');
      assert.strictEqual(resolved.fileName, 'test.bin');
    });
  });

  describe('MediaManager and makeMaxSocket integration', () => {
    class MockTransport implements ITransport {
      public sentFrames: OutboundFrame[] = [];
      private listeners = {
        frame: new Set<(f: InboundFrame) => void>(),
        close: new Set<(e?: Error) => void>(),
        error: new Set<(e: Error) => void>(),
      };

      public on(event: any, listener: any): this {
        this.listeners[event as keyof typeof this.listeners].add(listener);
        return this;
      }
      public isOpen(): boolean {
        return true;
      }
      public async connect(): Promise<void> {}
      public close(): void {}

      public async send(frame: OutboundFrame): Promise<void> {
        this.sentFrames.push(frame);

        let payload: Record<string, any> = {};

        switch (frame.opcode) {
          case OPCODES.PHOTO_UPLOAD:
            payload = {
              url: `${serverBaseUrl}/upload-photo`,
              token: 'photo_tok_xyz',
            };
            break;

          case OPCODES.FILE_UPLOAD:
            payload = {
              url: `${serverBaseUrl}/upload-file`,
              fileId: 888n,
            };
            break;

          case OPCODES.FILE_DOWNLOAD:
            payload = {
              url: `${serverBaseUrl}/download/test.bin`,
            };
            break;

          case OPCODES.MSG_SEND:
            payload = {
              message: {
                id: 999999999123n,
                time: Date.now(),
                text: frame.payload?.message?.text,
                attaches: frame.payload?.message?.attaches,
              },
            };
            break;
        }

        setTimeout(() => {
          for (const l of this.listeners.frame) {
            l({
              ver: 10,
              cmd: Command.RESPONSE,
              seq: frame.seq,
              opcode: frame.opcode,
              flags: 0,
              length: 0,
              payload,
            });
          }
        }, 5);
      }
    }

    const mockAuth = {
      creds: {
        deviceId: 'dev_1',
        sessionToken: 'tok_1',
        userId: '1001',
      },
      keys: {},
    };

    test('sock.sendMessage uploads photo and sends message with PHOTO attachment and caption', async () => {
      const transport = new MockTransport();
      const sock = makeMaxSocket({ auth: mockAuth as any, transport });
      await sock.connect();

      const imageBuffer = Buffer.from('fake-photo-data');
      const msg = await sock.sendMessage('500', {
        image: imageBuffer,
        caption: 'Look at this *cat*!',
      });

      // Verify PHOTO_UPLOAD was called
      const photoUploadFrame = transport.sentFrames.find((f) => f.opcode === OPCODES.PHOTO_UPLOAD);
      assert.ok(photoUploadFrame);

      // Verify MSG_SEND was called with formatted caption and PHOTO attach
      const sendFrame = transport.sentFrames.find((f) => f.opcode === OPCODES.MSG_SEND);
      assert.ok(sendFrame);
      assert.strictEqual(sendFrame.payload?.message?.text, 'Look at this cat!');
      assert.strictEqual(sendFrame.payload?.message?.elements?.[0]?.type, 'BOLD');

      const photoAttach = sendFrame.payload?.message?.attaches?.[0];
      assert.ok(photoAttach);
      assert.strictEqual(photoAttach.type, 'PHOTO');
      assert.strictEqual(photoAttach.photoToken, 'photo_tok_xyz');

      assert.strictEqual(msg.text, 'Look at this cat!');
      assert.strictEqual(msg.attaches.length, 1);
    });

    test('sock.sendMessage uploads document and sets fileName and mime', async () => {
      const transport = new MockTransport();
      const sock = makeMaxSocket({ auth: mockAuth as any, transport });
      await sock.connect();

      const docBuffer = Buffer.from('sample-pdf-data');
      await sock.sendMessage('500', {
        document: docBuffer,
        fileName: 'report.pdf',
        mimetype: 'application/pdf',
      });

      const fileUploadFrame = transport.sentFrames.find((f) => f.opcode === OPCODES.FILE_UPLOAD);
      assert.ok(fileUploadFrame);
      assert.strictEqual(fileUploadFrame.payload?.name, 'report.pdf');

      const sendFrame = transport.sentFrames.find((f) => f.opcode === OPCODES.MSG_SEND);
      const fileAttach = sendFrame?.payload?.message?.attaches?.[0];
      assert.ok(fileAttach);
      assert.strictEqual(fileAttach.type, 'FILE');
      assert.strictEqual(fileAttach.fileId, 888n);
      assert.strictEqual(fileAttach.name, 'report.pdf');
    });

    test('sock.downloadMedia downloads content from message attachment via fileId', async () => {
      const transport = new MockTransport();
      const sock = makeMaxSocket({ auth: mockAuth as any, transport });
      await sock.connect();

      const buffer = await sock.downloadMedia({
        type: 'FILE',
        fileId: 888n,
      });

      assert.strictEqual(buffer.toString('utf-8'), 'HELLO_MEDIA_CONTENT');
    });
  });
});
