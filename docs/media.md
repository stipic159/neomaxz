# 🎬 Медиафайлы, аудио и стриминг

> [🏠 neomaxz](../README.md) / [📚 Документация](README.md) / **Медиа и стриминг**

---

## Содержание
- [Обзор](#обзор)
- [Отправка медиа через `sock.sendMessage`](#отправка-медиа-через-socksendmessage)
  - [Фотографии (`image`)](#фотографии-image)
  - [Документы и произвольные файлы (`document`)](#документы-и-произвольные-файлы-document)
  - [Видеозаписи (`video`)](#видеозаписи-video)
  - [Голосовые заметки (PTT) с волнограммой (`audio`)](#голосовые-заметки-ptt-с-волнограммой-audio)
  - [Кружочки (`videoNote`)](#кружочки-videonote)
- [Скачивание вложений (`sock.downloadMedia`)](#скачивание-вложений-sockdownloadmedia)
- [Утилиты для обработки звука](#утилиты-для-обработки-звука)
  - [`extractAudioMetadata(buffer)`](#extractaudiometadatabuffer)
  - [`generateWaveform(buffer, samplesCount?)`](#generatewaveformbuffer-samplescount)
- [Менеджер медиа (`sock.media`)](#менеджер-медиа-sockmedia)
- [Потоковый HTTP-клиент (`sock.media.httpClient`)](#потоковый-http-клиент-sockmediahttpclient)
  - [`uploadStream(targetUrl, stream, options)`](#uploadstreamtargeturl-stream-options)
  - [`downloadStream(url, options)`](#downloadstreamurl-options)
  - [`resolveMediaSource(source)`](#resolvemediasourcesource)
- [Типы данных и структуры](#типы-данных-и-структуры)

---

## Обзор

Работа с медиа в MAX состоит из двух этапов:
1. Запрос эндпоинта выгрузки через WebSocket/TLS (опкоды `0x0050 PHOTO_UPLOAD`, `0x0052 VIDEO_UPLOAD`, `0x0057 FILE_UPLOAD`).
2. Загрузка бинарных данных на полученный URL по протоколу HTTPS с обязательной валидацией вшитой цепочки сертификатов Минцифры РФ.

Клиент `neomaxz` полностью автоматизирует этот процесс в стиле Baileys: достаточно передать `Buffer`, путь к локальному файлу, URL или стрим `Readable`.

---

## Отправка медиа через `sock.sendMessage`

### Фотографии (`image`)

Поддерживает форматы JPEG, PNG, WebP:

```typescript
// 1. Из локального файла на диске:
await sock.sendMessage(chatId, {
  image: './assets/screenshot.png',
  caption: 'Скриншот экрана',
});

// 2. Из памяти (Buffer):
await sock.sendMessage(chatId, {
  image: imageBuffer,
  caption: 'Изображение из буфера',
});

// 3. По прямой ссылке (автоматически скачивается и загружается в MAX):
await sock.sendMessage(chatId, {
  image: { url: 'https://example.com/photo.jpg' },
  caption: 'Фото из интернета',
});
```

---

### Документы и произвольные файлы (`document`)

Передача документов любых типов (PDF, ZIP, DOCX, TXT и т.д.):

```typescript
await sock.sendMessage(chatId, {
  document: fs.readFileSync('./report.pdf'),
  fileName: 'Отчет_2026.pdf',
  mimetype: 'application/pdf',
});
```

---

### Видеозаписи (`video`)

Отправка видео файлов в формате MP4:

```typescript
await sock.sendMessage(chatId, {
  video: './videos/demo.mp4',
  caption: 'Демонстрация работы',
});
```

---

### Голосовые заметки (PTT) с волнограммой (`audio`)

При отправке с флагом `ptt: true` библиотека автоматически:
1. Анализирует бинарный заголовок аудио (WAV, OGG Opus или MP3).
2. Вычисляет реальную длительность (`duration` в секундах).
3. Генерирует волнограмму (массив из 64 полос амплитуд `0..255`) для визуализации звуковой дорожки в официальных клиентах MAX.

```typescript
const voiceBuffer = fs.readFileSync('./voice.ogg');

await sock.sendMessage(chatId, {
  audio: voiceBuffer,
  ptt: true, // Пометка как голосовая заметка
});
```

---

### Кружочки (`videoNote`)

Отправка круглых видеосообщений (Round Video Note):

```typescript
await sock.sendMessage(chatId, {
  videoNote: fs.readFileSync('./round_video.mp4'),
});
```

---

## Скачивание вложений (`sock.downloadMedia`)

Скачивает файл или медиавложение из входящего сообщения в `Buffer`.

#### Сигнатура
```typescript
async downloadMedia(
  target: MaxMessage | MessageAttachment | Record<string, any>
): Promise<Buffer>
```

#### Поведение
1. Если сообщение содержит прямой URL — скачивает файл через постоянный HTTPS Keep-Alive пул соединений.
2. Если URL в сообщении отсутствует, а есть `fileId` / `id` — запрашивает ссылку скачивания через опкод `0x0058 FILE_DOWNLOAD` и производит выгрузку байтов.

#### Пример
```typescript
sock.ev.on('messages.upsert', async ({ messages }) => {
  for (const msg of messages) {
    if (msg.fromMe) continue;

    // Проверяем наличие вложений
    if (msg.attaches.length > 0) {
      console.log(`Скачиваем вложение типа ${msg.attaches[0].type}...`);
      const fileBuffer = await sock.downloadMedia(msg);
      console.log(`Скачано: ${fileBuffer.length} байт`);

      // Сохраняем на диск
      fs.writeFileSync('./downloaded_file.bin', fileBuffer);
    }
  }
});
```

---

## Утилиты для обработки звука

Доступны напрямую через именованный импорт: `import { extractAudioMetadata, generateWaveform } from 'neomaxz';`.

### `extractAudioMetadata(buffer)`

Извлекает реальную длительность (`duration`), `mimeType`, `sampleRate` и `channels` без вызова внешних бинарников ffmpeg:
- **WAV**: парсинг чанков RIFF `fmt ` и `data`.
- **OGG Opus**: парсинг страниц `OggS`, заголовка `OpusHead` и гранулярных меток (48 кГц).
- **MP3**: парсинг ID3-тегов и фреймовых меток (`0xFFE0`).

```typescript
import { extractAudioMetadata } from 'neomaxz';

const meta = extractAudioMetadata(audioBuffer);
console.log(`Длительность: ${meta.duration} сек, Тип: ${meta.mimeType}`);
```

### `generateWaveform(buffer, samplesCount = 64)`

Формирует массив нормализованных амплитуд (значения от `0` до `255`) длиной `samplesCount` (по умолчанию 64):

```typescript
import { generateWaveform } from 'neomaxz';

const waveform = generateWaveform(audioBuffer, 64);
// waveform: [25, 48, 120, 210, 180, 95, 30, ...]
```

---

## Менеджер медиа (`sock.media`)

Экземпляр класса `MediaManager` содержит специализированные методы:
- `uploadPhoto(client, source)` ➔ `Promise<PhotoAttachment>`
- `uploadFile(client, source, options)` ➔ `Promise<FileAttachment>`
- `uploadVideo(client, source, options)` ➔ `Promise<VideoAttachment>`
- `uploadAudio(client, source, ptt?)` ➔ `Promise<AudioAttachment>`
- `uploadVideoNote(client, source)` ➔ `Promise<VideoNoteAttachment>`
- `downloadMedia(client, target)` ➔ `Promise<Buffer>`

---

## Потоковый HTTP-клиент (`sock.media.httpClient`)

Для передачи файлов большого размера без расхода оперативной памяти (Zero-RAM Spikes) библиотека предоставляет нативный потоковый клиент на базе `node:stream`:

### `uploadStream(targetUrl, stream, options)`

Потоковая передача `ReadableStream` прямо в сокет запроса:

```typescript
import fs from 'node:fs';

const fileStream = fs.createReadStream('./large_archive.zip');
const fileSize = fs.statSync('./large_archive.zip').size;

const result = await sock.media.httpClient.uploadStream(uploadUrl, fileStream, {
  knownLength: fileSize,
  onProgress: ({ bytesSent, totalBytes, percent }) => {
    console.log(`Выгружено: ${percent}% (${bytesSent}/${totalBytes})`);
  },
});
```

### `downloadStream(url, options)`

Потоковое чтение входящих данных:

```typescript
const { stream, contentLength } = await sock.media.httpClient.downloadStream(fileUrl, {
  onProgress: ({ bytesDownloaded, percent }) => {
    console.log(`Загрузка: ${percent}%`);
  },
});

const writeStream = fs.createWriteStream('./output.zip');
stream.pipe(writeStream);
```

### `resolveMediaSource(source)`

Разрешает любой тип `MediaSource` (`Buffer`, `Uint8Array`, путь к файлу, URL-объект, стрим) в байтовый буфер.

---

## Типы данных и структуры

```typescript
export type MediaSource =
  | Buffer
  | Uint8Array
  | string
  | { url: string }
  | { stream: NodeJS.ReadableStream; size?: number };

export interface PhotoAttachment {
  type: 'PHOTO';
  photoToken?: string;
  id?: string | bigint;
  url?: string;
  width?: number;
  height?: number;
}

export interface FileAttachment {
  type: 'FILE';
  fileId?: string | bigint;
  token?: string;
  name?: string;
  size?: number;
  url?: string;
  mime?: string;
}

export interface AudioAttachment {
  type: 'AUDIO';
  audioId?: string | bigint;
  token?: string;
  duration?: number;
  waveform?: number[];
  ptt?: boolean;
  url?: string;
}

export interface VideoAttachment {
  type: 'VIDEO';
  videoId?: string | bigint;
  token?: string;
  duration?: number;
  width?: number;
  height?: number;
  url?: string;
}

export interface VideoNoteAttachment {
  type: 'VIDEO_NOTE';
  videoNoteId?: string | bigint;
  token?: string;
  duration?: number;
  url?: string;
}
```

---

[⬅️ Назад: Presence и активность](presence.md) | [Вперед: Шина событий ➡️](events.md)
