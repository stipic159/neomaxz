import { OPCODES } from "../protocol/opcodes.js";
import type { SocketClient } from "../socket/socket-client.js";
import { HttpClient } from "./http-client.js";
import type {
  MediaSource,
  PhotoAttachment,
  FileAttachment,
  VideoAttachment,
  AudioAttachment,
  VideoNoteAttachment,
  MessageAttachment,
} from "../types/media.js";
import { toBigIntId, type MaxMessage } from "../types/message.js";
import { extractAudioMetadata, generateWaveform } from "./audio.js";

export class MediaManager {
  private httpClient: HttpClient;

  constructor(httpClient?: HttpClient) {
    this.httpClient = httpClient ?? new HttpClient();
  }

  public getHttpClient(): HttpClient {
    return this.httpClient;
  }

  /**
   * Uploads an image and returns a PhotoAttachment.
   */
  public async uploadPhoto(
    client: SocketClient,
    source: MediaSource
  ): Promise<PhotoAttachment> {
    const { buffer } = await this.httpClient.resolveMediaSource(source);

    // 1. Request upload URL from MAX server
    const res = await client.query({
      opcode: OPCODES.PHOTO_UPLOAD,
      payload: {
        count: 1,
      },
    });

    const uploadUrl = res.payload?.url ?? res.payload?.uploadUrl;
    if (!uploadUrl) {
      throw new Error(`Failed to obtain photo upload URL: ${JSON.stringify(res.payload)}`);
    }

    const token = res.payload?.token ?? res.payload?.photoToken;

    // 2. Upload file bytes to HTTP uploadUrl
    const uploadRes = await this.httpClient.upload(uploadUrl, buffer, {
      headers: { 'Content-Type': 'image/jpeg' },
    });

    const photoToken = uploadRes?.token ?? uploadRes?.photoToken ?? token;
    const photoId = uploadRes?.id ?? res.payload?.id;

    return {
      type: 'PHOTO',
      photoToken: photoToken ? String(photoToken) : undefined,
      id: photoId ? toBigIntId(photoId) : undefined,
      url: uploadRes?.url ?? uploadUrl,
    };
  }

  /**
   * Uploads an arbitrary file or document and returns a FileAttachment.
   */
  public async uploadFile(
    client: SocketClient,
    source: MediaSource,
    options: { fileName?: string; mimeType?: string } = {}
  ): Promise<FileAttachment> {
    const resolved = await this.httpClient.resolveMediaSource(source);
    const fileName = options.fileName ?? resolved.fileName ?? 'file.bin';
    const mimeType = options.mimeType ?? resolved.mimeType ?? 'application/octet-stream';

    // 1. Request file upload endpoint
    const res = await client.query({
      opcode: OPCODES.FILE_UPLOAD,
      payload: {
        name: fileName,
        size: resolved.buffer.length,
        type: 'FILE',
      },
    });

    const uploadUrl = res.payload?.url ?? res.payload?.uploadUrl;
    if (!uploadUrl) {
      throw new Error(`Failed to obtain file upload URL: ${JSON.stringify(res.payload)}`);
    }

    const fileId = res.payload?.fileId ?? res.payload?.id;

    // 2. Upload bytes
    const uploadRes = await this.httpClient.upload(uploadUrl, resolved.buffer, {
      headers: { 'Content-Type': mimeType },
    });

    return {
      type: 'FILE',
      fileId: fileId ? toBigIntId(fileId) : (uploadRes?.fileId ? toBigIntId(uploadRes.fileId) : undefined),
      token: uploadRes?.token ? String(uploadRes.token) : undefined,
      name: fileName,
      size: resolved.buffer.length,
      mime: mimeType,
      url: uploadRes?.url ?? uploadUrl,
    };
  }

  /**
   * Uploads a video and returns a VideoAttachment.
   */
  public async uploadVideo(
    client: SocketClient,
    source: MediaSource,
    options: { fileName?: string } = {}
  ): Promise<VideoAttachment> {
    const resolved = await this.httpClient.resolveMediaSource(source);
    const fileName = options.fileName ?? resolved.fileName ?? 'video.mp4';

    const res = await client.query({
      opcode: OPCODES.VIDEO_UPLOAD,
      payload: {
        name: fileName,
        size: resolved.buffer.length,
      },
    });

    const uploadUrl = res.payload?.url ?? res.payload?.uploadUrl;
    if (!uploadUrl) {
      throw new Error(`Failed to obtain video upload URL: ${JSON.stringify(res.payload)}`);
    }

    const videoId = res.payload?.videoId ?? res.payload?.id;

    const uploadRes = await this.httpClient.upload(uploadUrl, resolved.buffer, {
      headers: { 'Content-Type': 'video/mp4' },
      timeoutMs: 900000, // 15 mins for video upload
    });

    return {
      type: 'VIDEO',
      videoId: videoId ? toBigIntId(videoId) : (uploadRes?.videoId ? toBigIntId(uploadRes.videoId) : undefined),
      token: uploadRes?.token ? String(uploadRes.token) : undefined,
      url: uploadRes?.url ?? uploadUrl,
    };
  }

  /**
   * Uploads an audio or voice recording (PTT).
   */
  public async uploadAudio(
    client: SocketClient,
    source: MediaSource,
    ptt = false
  ): Promise<AudioAttachment> {
    const resolved = await this.httpClient.resolveMediaSource(source);
    const audioMeta = extractAudioMetadata(resolved.buffer);
    const waveform = ptt ? generateWaveform(resolved.buffer, 64) : undefined;

    const res = await client.query({
      opcode: OPCODES.FILE_UPLOAD,
      payload: {
        name: ptt ? 'voice.ogg' : 'audio.mp3',
        size: resolved.buffer.length,
        type: 'AUDIO',
      },
    });

    const uploadUrl = res.payload?.url ?? res.payload?.uploadUrl;
    if (!uploadUrl) {
      throw new Error(`Failed to obtain audio upload URL: ${JSON.stringify(res.payload)}`);
    }

    const audioId = res.payload?.fileId ?? res.payload?.id;

    const uploadRes = await this.httpClient.upload(uploadUrl, resolved.buffer, {
      headers: { 'Content-Type': ptt ? (audioMeta.mimeType ?? 'audio/ogg') : 'audio/mpeg' },
    });

    return {
      type: 'AUDIO',
      audioId: audioId ? toBigIntId(audioId) : (uploadRes?.audioId ? toBigIntId(uploadRes.audioId) : undefined),
      token: uploadRes?.token ? String(uploadRes.token) : undefined,
      duration: audioMeta.duration,
      waveform,
      ptt,
      url: uploadRes?.url ?? uploadUrl,
    };
  }

  /**
   * Uploads a round video note (VideoNote).
   */
  public async uploadVideoNote(
    client: SocketClient,
    source: MediaSource
  ): Promise<VideoNoteAttachment> {
    const resolved = await this.httpClient.resolveMediaSource(source);

    const res = await client.query({
      opcode: OPCODES.VIDEO_UPLOAD,
      payload: {
        name: 'videonote.mp4',
        size: resolved.buffer.length,
        videoType: 'ROUND',
      },
    });

    const uploadUrl = res.payload?.url ?? res.payload?.uploadUrl;
    if (!uploadUrl) {
      throw new Error(`Failed to obtain video note upload URL: ${JSON.stringify(res.payload)}`);
    }

    const videoNoteId = res.payload?.videoId ?? res.payload?.id;

    const uploadRes = await this.httpClient.upload(uploadUrl, resolved.buffer, {
      headers: { 'Content-Type': 'video/mp4' },
    });

    return {
      type: 'VIDEO_NOTE',
      videoNoteId: videoNoteId ? toBigIntId(videoNoteId) : (uploadRes?.videoId ? toBigIntId(uploadRes.videoId) : undefined),
      token: uploadRes?.token ? String(uploadRes.token) : undefined,
      url: uploadRes?.url ?? uploadUrl,
    };
  }

  /**
   * Downloads media attachment or message attachment content as a Buffer.
   */
  public async downloadMedia(
    client: SocketClient,
    target: MaxMessage | MessageAttachment | Record<string, any>
  ): Promise<Buffer> {
    let attach: Record<string, any>;

    if ('attaches' in target && Array.isArray((target as MaxMessage).attaches)) {
      if ((target as MaxMessage).attaches.length === 0) {
        throw new Error('Message does not contain any attachments to download');
      }
      attach = (target as MaxMessage).attaches[0];
    } else {
      attach = target;
    }

    // 1. Direct URL
    if (typeof attach.url === 'string' && attach.url.startsWith('http')) {
      return this.httpClient.download(attach.url);
    }

    // 2. Query download URL via opcode 0x0058 (FILE_DOWNLOAD)
    const fileId = attach.fileId ?? attach.id ?? attach.videoId ?? attach.audioId;
    if (fileId) {
      const res = await client.query({
        opcode: OPCODES.FILE_DOWNLOAD,
        payload: {
          fileId: toBigIntId(fileId),
        },
      });

      const downloadUrl = res.payload?.url ?? res.payload?.downloadUrl;
      if (!downloadUrl) {
        throw new Error(`Server did not return download URL for fileId ${fileId}`);
      }

      return this.httpClient.download(downloadUrl);
    }

    throw new Error(`Cannot download attachment: no URL or valid fileId found in ${JSON.stringify(attach)}`);
  }
}
