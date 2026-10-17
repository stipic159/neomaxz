# ⚡ Шина событий (`sock.ev`)

> [🏠 neomaxz](../README.md) / [📚 Документация](README.md) / **Шина событий**

---

## Содержание
- [Обзор](#обзор)
- [Методы `MaxEventEmitter`](#методы-maxeventemitter)
  - [`sock.ev.on(event, listener)`](#sockevonevent-listener)
  - [`sock.ev.once(event, listener)`](#sockevonceevent-listener)
  - [`sock.ev.off(event, listener)`](#sockevoffevent-listener)
  - [`sock.ev.removeAllListeners(event?)`](#sockevremovealllistenersevent)
  - [`sock.ev.pause()` и `sock.ev.resume()`](#sockevpause-и-sockevresume)
- [Каталог событий](#каталог-событий)
  - [`connection.update`](#connectionupdate)
  - [`creds.update`](#credsupdate)
  - [`messages.upsert`](#messagesupsert)
  - [`messages.read`](#messagesread)
  - [`presence.update`](#presenceupdate)
  - [`attachment.ready`](#attachmentready)
  - [`sync.start` и `sync.complete`](#syncstart-и-synccomplete)
  - [`frame.inbound` и `frame.outbound`](#frameinbound-и-frameoutbound)
  - [`error`](#error)
- [Типы данных и структуры](#типы-данных-и-структуры)

---

## Обзор

События мессенджера обрабатываются через встроенную шину `sock.ev` (экземпляр класса `MaxEventEmitter`). 

### Ключевые архитектурные свойства:
1. **Строгая упорядоченность (FIFO)**: события доставляются слушателям строго в том порядке, в котором поступили от сервера.
2. **Отсутствие Head-of-Line блокировок**: медленный асинхронный обработчик одного события (например, `messages.upsert`) не замораживает немедленную диспетчеризацию последующих системных событий (таких как `connection.update`).
3. **Безопасная обработка ошибок**: исключения, возникшие внутри слушателей, не приводят к аварийному падению Node.js процесса — они направляются в событие `'error'` (или логируются в `console.error`), в то время как проверочные `AssertionError` в тестах гарантированно всплывают наружу.

---

## Методы `MaxEventEmitter`

### `sock.ev.on(event, listener)`
Регистрирует постоянный обработчик события.

```typescript
sock.ev.on('messages.upsert', async ({ messages }) => {
  // обработка сообщений
});
```

### `sock.ev.once(event, listener)`
Регистрирует одноразовый обработчик события, который автоматически удаляется после первого вызова.

```typescript
sock.ev.once('connection.update', (update) => {
  if (update.connection === 'open') {
    console.log('Первое успешное подключение!');
  }
});
```

### `sock.ev.off(event, listener)`
Удаляет ранее зарегистрированный слушатель.

```typescript
sock.ev.off('messages.upsert', myHandler);
```

### `sock.ev.removeAllListeners(event?)`
Удаляет все слушатели указанного события (или вообще все слушатели, если аргумент опущен).

### `sock.ev.pause()` и `sock.ev.resume()`
Приостанавливает/возобновляет доставку событий. В режиме паузы входящие события накапливаются во внутренней очереди.

---

## Каталог событий

### `connection.update`
Срабатывает при любом изменении состояния сокета, обрыве соединения или получении данных QR-кода.

#### Полезная нагрузка
```typescript
{
  connection?: 'connecting' | 'open' | 'close';
  lastDisconnect?: {
    error?: Error;
    reason?: DisconnectReason;
    date: Date;
  };
  qr?: string;
  trackId?: string;
}
```

#### Пример
```typescript
import { DisconnectReason } from 'neomaxz';

sock.ev.on('connection.update', (update) => {
  const { connection, lastDisconnect, qr } = update;

  if (qr) {
    console.log('Получен QR-код для авторизации');
  }

  if (connection === 'open') {
    console.log('✅ Соединение открыто!');
  } else if (connection === 'close') {
    const reason = lastDisconnect?.reason;
    if (reason === DisconnectReason.loggedOut) {
      console.log('❌ Сессия была завершена на сервере. Требуется повторный вход.');
    } else {
      console.log('⚠️ Разрыв соединения, автореконнект:', lastDisconnect?.error?.message);
    }
  }
});
```

---

### `creds.update`
Срабатывает при обновлении токена авторизации (`sessionToken`), смене `userId`, имени или устройства. Слушатель этого события сохраняет данные в постоянное хранилище.

```typescript
sock.ev.on('creds.update', (creds) => {
  // saveCreds автоматически подписан при инициализации:
  // sock.ev.on('creds.update', saveCreds);
});
```

---

### `messages.upsert`
Срабатывает при поступлении новых входящих или исходящих сообщений.

#### Полезная нагрузка
```typescript
{
  messages: MaxMessage[];
  type: 'notify' | 'append';
}
```

#### Пример
```typescript
sock.ev.on('messages.upsert', async ({ messages, type }) => {
  for (const msg of messages) {
    if (msg.fromMe) continue; // Игнорируем собственные отправки

    console.log(`[Чат ${msg.chatId}] ${msg.senderName ?? msg.senderId}: ${msg.text}`);
  }
});
```

---

### `messages.read`
Срабатывает, когда собеседник или другой клиент аккаунта прочитал сообщения.

#### Полезная нагрузка
```typescript
export interface ReadReceipt {
  chatId: string;
  userId: string;
  messageIds?: string[];
  markTime: number;
}
```

#### Пример
```typescript
sock.ev.on('messages.read', ({ chatId, userId, markTime }) => {
  console.log(`Сообщения в чате ${chatId} прочитаны пользователем ${userId} в ${new Date(markTime)}`);
});
```

---

### `presence.update`
Срабатывает при изменении активности пользователя в диалоге или группе.

#### Полезная нагрузка
```typescript
export interface PresenceUpdate {
  chatId: string;
  userId: string;
  action: 'typing' | 'recording_audio' | 'uploading_file' | 'paused';
  isTyping: boolean;
}
```

---

### `attachment.ready`
Срабатывает, когда сервер MAX завершил внутреннюю обработку выгруженного медиафайла или видеозаписи и сгенерировал постоянный `fileId` / URL.

#### Полезная нагрузка
```typescript
export interface AttachmentReadyEvent {
  chatId?: string;
  fileId?: string;
  photoToken?: string;
  videoId?: string;
  url?: string;
  raw: any;
}
```

---

### `sync.start` и `sync.complete`
Срабатывают в процессе восстановления пропущенных сообщений ([Gap Recovery](infrastructure.md#gaprecoverymanager)) после временного разрыва сети.

```typescript
sock.ev.on('sync.start', ({ fromTimestamp }) => {
  console.log(`Начало синхронизации истории с ${new Date(fromTimestamp)}...`);
});

sock.ev.on('sync.complete', ({ syncedAt, count }) => {
  console.log(`Синхронизация завершена. Восстановлено сообщений: ${count ?? 0}`);
});
```

---

### `frame.inbound` и `frame.outbound`
Низкоуровневые события для отладки протокола: эмитируются при получении или отправке любого бинарного фрейма.

```typescript
sock.ev.on('frame.inbound', (frame) => {
  // frame: { ver, cmd, seq, opcode, flags, length, payload }
});
```

---

### `error`
Эмитируется при возникновении внутренних ошибок транспорта или неперехваченных ошибок в обработчиках.

```typescript
sock.ev.on('error', (err) => {
  console.error('Ошибка в сокете:', err);
});
```

---

## Типы данных и структуры

```typescript
export interface MaxEvents {
  'connection.update': Partial<ConnectionState> & { qr?: string; trackId?: string };
  'creds.update': Record<string, any>;
  'frame.inbound': InboundFrame;
  'frame.outbound': OutboundFrame;
  'presence.update': PresenceUpdate;
  'messages.upsert': { messages: MaxMessage[]; type: 'notify' | 'append' };
  'messages.update': any[];
  'messages.read': ReadReceipt;
  'attachment.ready': AttachmentReadyEvent;
  'sync.start': { fromTimestamp: number };
  'sync.complete': { syncedAt: number; count?: number };
  'error': Error;
}

export type EventKey = keyof MaxEvents;
export type EventListener<K extends EventKey> = (data: MaxEvents[K]) => void | Promise<void>;
```

---

[⬅️ Назад: Медиа и стриминг](media.md) | [Вперед: Инфраструктура и надежность ➡️](infrastructure.md)
