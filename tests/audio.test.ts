import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { extractAudioMetadata, generateWaveform } from '../src/media/audio.js';

describe('Audio Metadata Extraction', () => {
  test('extracts metadata from valid WAV RIFF buffer', () => {
    // Construct minimal WAV RIFF header
    // RIFF (4) + chunkSize (4) + WAVE (4) + fmt (4) + subchunk1Size (4: 16) + audioFormat(2: 1)
    // + numChannels (2: 1) + sampleRate (4: 44100) + byteRate (4: 88200) + blockAlign(2: 2) + bitsPerSample(2: 16)
    // + data (4) + subchunk2Size (4: 176400) -> 176400 / 88200 = 2 seconds
    const buffer = Buffer.alloc(44 + 176400);
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + 176400, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16); // fmt chunk size
    buffer.writeUInt16LE(1, 20);  // PCM format
    buffer.writeUInt16LE(1, 22);  // mono
    buffer.writeUInt32LE(44100, 24); // sample rate
    buffer.writeUInt32LE(88200, 28); // byte rate
    buffer.writeUInt16LE(2, 32);  // block align
    buffer.writeUInt16LE(16, 34); // bits per sample
    buffer.write('data', 36);
    buffer.writeUInt32LE(176400, 40); // data size

    const meta = extractAudioMetadata(buffer);
    assert.equal(meta.mimeType, 'audio/wav');
    assert.equal(meta.duration, 2);
    assert.equal(meta.sampleRate, 44100);
    assert.equal(meta.channels, 1);
  });

  test('extracts metadata from OGG Opus buffer', () => {
    // Construct minimal OGG header with OpusHead
    const buffer = Buffer.alloc(100);
    buffer.write('OggS', 0);
    buffer.write('OpusHead', 28);

    const meta = extractAudioMetadata(buffer);
    assert.equal(meta.mimeType, 'audio/ogg; codecs=opus');
    assert.ok(typeof meta.duration === 'number');
    assert.ok(meta.duration! >= 1);
  });

  test('extracts metadata from MP3 ID3 buffer', () => {
    const buffer = Buffer.alloc(16000); // 16 KB ~ 2 seconds at 64 kbps
    buffer.write('ID3', 0);

    const meta = extractAudioMetadata(buffer);
    assert.equal(meta.mimeType, 'audio/mpeg');
    assert.equal(meta.duration, 2);
  });

  test('handles small / unknown buffer gracefully with fallback', () => {
    const emptyBuf = Buffer.alloc(0);
    const metaEmpty = extractAudioMetadata(emptyBuf);
    assert.equal(metaEmpty.duration, 1);
    assert.equal(metaEmpty.mimeType, 'audio/ogg');

    const unknownBuf = Buffer.from('hello world unknown audio');
    const metaUnknown = extractAudioMetadata(unknownBuf);
    assert.ok(metaUnknown.duration! >= 1);
    assert.equal(metaUnknown.mimeType, 'audio/ogg');
  });
});

describe('Audio Waveform Generation', () => {
  test('generates waveform array with default 64 bars', () => {
    // Create random or sine-like buffer
    const buf = Buffer.alloc(1024);
    for (let i = 0; i < buf.length; i++) {
      buf[i] = Math.round(128 + 100 * Math.sin(i / 10));
    }

    const waveform = generateWaveform(buf);
    assert.equal(waveform.length, 64);
    for (const val of waveform) {
      assert.ok(val >= 0 && val <= 255, `waveform value ${val} out of bounds [0, 255]`);
    }
  });

  test('handles empty buffer gracefully', () => {
    const empty = Buffer.alloc(0);
    const waveform = generateWaveform(empty, 64);
    assert.equal(waveform.length, 64);
    assert.ok(waveform.every(v => v === 0));
  });

  test('respects custom samplesCount', () => {
    const buf = Buffer.alloc(500, 100);
    const waveform = generateWaveform(buf, 32);
    assert.equal(waveform.length, 32);
  });
});
