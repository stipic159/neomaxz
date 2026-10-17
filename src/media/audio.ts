/**
 * Audio parsing and Waveform generation utilities for voice notes (PTT).
 */

export interface AudioMetadata {
  duration?: number; // duration in seconds
  mimeType?: string;
  sampleRate?: number;
  channels?: number;
}

/**
 * Extracts duration and mimeType from common audio formats (WAV, OGG Opus, MP3).
 */
export function extractAudioMetadata(buffer: Buffer): AudioMetadata {
  if (!buffer || buffer.length < 12) {
    return { duration: 1, mimeType: 'audio/ogg' };
  }

  // 1. WAV Format (RIFF .... WAVE)
  if (
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WAVE'
  ) {
    let offset = 12;
    let byteRate = 0;
    let dataSize = 0;
    let sampleRate = 44100;
    let channels = 1;

    while (offset + 8 <= buffer.length) {
      const chunkId = buffer.toString('ascii', offset, offset + 4);
      const chunkSize = buffer.readUInt32LE(offset + 4);

      if (chunkId === 'fmt ' && offset + 20 <= buffer.length) {
        channels = buffer.readUInt16LE(offset + 10);
        sampleRate = buffer.readUInt32LE(offset + 12);
        byteRate = buffer.readUInt32LE(offset + 16);
      } else if (chunkId === 'data') {
        dataSize = chunkSize;
        break;
      }
      offset += 8 + chunkSize;
    }

    const duration = byteRate > 0 && dataSize > 0 ? Math.round(dataSize / byteRate) : undefined;
    return {
      duration: duration && duration > 0 ? duration : 1,
      mimeType: 'audio/wav',
      sampleRate,
      channels,
    };
  }

  // 2. OGG Container (OggS)
  if (buffer.toString('ascii', 0, 4) === 'OggS') {
    let mimeType = 'audio/ogg';
    let duration: number | undefined;

    // Check if Opus
    if (buffer.includes(Buffer.from('OpusHead'))) {
      mimeType = 'audio/ogg; codecs=opus';
    }

    // Try finding last Ogg page granule position to calculate exact duration
    const lastOggPos = buffer.lastIndexOf(Buffer.from('OggS'));
    if (lastOggPos !== -1 && lastOggPos + 14 <= buffer.length) {
      // Granule position is an 8-byte integer at offset 6 in Ogg header
      const granulePos = Number(buffer.readBigInt64LE(lastOggPos + 6));
      if (granulePos > 0) {
        // Opus internal clock rate is 48000 Hz
        duration = Math.max(1, Math.round(granulePos / 48000));
      }
    }

    if (!duration) {
      // Heuristic fallback for OGG at ~32-64 kbps
      duration = Math.max(1, Math.round(buffer.length / 4000));
    }

    return { duration, mimeType };
  }

  // 3. MP3 Format (ID3 or MPEG frame sync 0xFF)
  if (
    buffer.toString('ascii', 0, 3) === 'ID3' ||
    (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)
  ) {
    // Standard voice MP3 estimation (~64 kbps)
    const duration = Math.max(1, Math.round(buffer.length / (64000 / 8)));
    return { duration, mimeType: 'audio/mpeg' };
  }

  // Fallback
  return {
    duration: Math.max(1, Math.round(buffer.length / 5000)),
    mimeType: 'audio/ogg',
  };
}

/**
 * Generates an array of visual amplitude levels (waveform) from 0 to 255.
 * Typically, 64 or 100 samples are expected by messaging apps like MAX and Telegram.
 */
export function generateWaveform(buffer: Buffer, samplesCount = 64): number[] {
  if (!buffer || buffer.length === 0) {
    return new Array(samplesCount).fill(0);
  }

  const result: number[] = new Array(samplesCount);
  const windowSize = Math.max(1, Math.floor(buffer.length / samplesCount));

  for (let i = 0; i < samplesCount; i++) {
    const start = i * windowSize;
    const end = Math.min(start + windowSize, buffer.length);

    let sum = 0;
    let count = 0;

    // Sample bytes in window (stride = 2 for efficiency)
    for (let pos = start; pos < end; pos += 2) {
      // Treat as signed or centered amplitude
      const val = Math.abs(buffer[pos] - 128);
      sum += val;
      count++;
    }

    const avg = count > 0 ? sum / count : 0;
    // Scale and clamp to [0, 255]
    result[i] = Math.min(255, Math.max(0, Math.round((avg / 128) * 255)));
  }

  // Ensure minimum visual variation so it never looks like a flat deadline
  const maxVal = Math.max(...result);
  if (maxVal > 0) {
    for (let i = 0; i < samplesCount; i++) {
      result[i] = Math.min(255, Math.round((result[i] / maxVal) * 200 + 15));
    }
  } else {
    for (let i = 0; i < samplesCount; i++) {
      result[i] = 20;
    }
  }

  return result;
}
