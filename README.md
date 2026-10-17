# neomaxz (MAX Baileys)

> **Автономная, легковесная TypeScript-библиотека для мессенджера MAX в стиле [Baileys](https://github.com/WhiskeySockets/Baileys).**
> Прямое подключение по WebSocket / TLS без браузера, Puppeteer и внешних сервисов.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> ⚠️ **Дисклеймер:** Проект экспериментальный (Alpha). Код написан при активном участии нейросетей и пока проходил только базовое ревью —  чисто взглядом. Используйте на свой страх и риск — в продакшене могут всплывать неожиданные баги.

---

## 🌟 Ключевые возможности

- 🚀 **Zero-Chromium / Zero-Puppeteer**: Работает напрямую с бинарным WebSocket-протоколом (`wss://api.oneme.ru/websocket`) и Raw TLS (`api2.oneme.ru:443`). Потребляет менее 30 МБ оперативной памяти.
- 🔐 **Встроенная цепочка сертификатов Минцифры РФ**: Сертификаты Russian Trusted Root CA и Sub CA вшиты прямо в бандл. Библиотека подключается на любой системе (Windows, macOS, Linux, Alpine Docker) из коробки без правок системного truststore.
- 📦 **Поддержка MessagePack и сжатия**:
  - 10-байтный бинарный заголовок (`ver`, `cmd`, `seq`, `opcode`, `flags`, `len`).
  - Обработка 64-битных ID (MessagePack Extension Type 1).
  - Нативное сжатие LZ4 и Zstandard (`fzstd`).
- 🔄 **Хранение сессий как в Baileys**:
  - `useMultiFileAuthState(folder)` — сохранение учетных данных в папку с JSON-файлами и атомарной записью.
  - `useSqliteAuthState('session.db')` — ультра-быстрое хранилище в едином файле SQLite на базе нативного движка Node.js `node:sqlite` (без node-gyp и внешних зависимостей).
- 💻 **Консольная утилита CLI (`npx neomaxz`)**: Авторизация через QR-код прямо в терминале или по SMS в одну команду, а также проверка текущей сессии (`whoami`).
- 🎙️ **Нативная волна звука (Waveform) и длительность**: Автоматический расчёт длительности и генерация амплитудной визуализации (волнограммы из 64 полос) для голосовых сообщений (PTT), как в официальных клиентах MAX и Telegram.
- ⚡ **Строгая упорядоченность событий**: Внутренняя FIFO-очередь в `sock.ev` предотвращает состояние гонки (race conditions) при асинхронных обработчиках сообщений.
- 🔁 **Автоматический Heartbeat & Reconnect**: Отправка фоновых PING каждые 25 секунд и экспоненциальный backoff при потере соединения.
- 🚦 **Очередь запросов и Rate Limiter (Token Bucket)**: Контроль исходящих запросов с приоритетами (`HIGH`, `NORMAL`, `LOW`), изоляцией спама по чатам (`maxChatPerSecond`), лимитом параллелизма (`maxConcurrent`) и защитой от переполнения сокета (Backpressure drain).
- 🛡️ **Гарантия идемпотентности (Idempotency Ledger)**: Генерация уникальных монотонных `cid`, трекинг статуса в полете и предотвращение дублей сообщений при сбоях сети.
- 🔄 **Движок восстановления пробелов (Gap Recovery)**: Монотонный учет server timestamp/sequence, фильтрация дубликатов входящих событий и синхронизация пропущенных сообщений при реконнекте.
- ⚡ **Circuit Breaker и L4/L7 Heartbeat**: Мгновенное обнаружение полуоткрытых сокетов через TCP Keep-Alive (`5s`), скользящий замер RTT (EWMA) и предохранитель от каскадных сбоев.
- 🌊 **Потоковый пайплайн медиа (Zero-RAM Spikes)**: Методы `uploadStream` и `downloadStream` на базе нативных стримов `node:stream` с прогресс-колбэками, `AbortSignal` и постоянными TLS-агентами (Keep-Alive).

---

## 📥 Установка

```bash
npm install neomaxz
# или
pnpm add neomaxz
```

---

## 💻 Консольная утилита (CLI)

`neomaxz` поставляется с удобным CLI для быстрой авторизации и проверки аккаунтов прямо в терминале:

```bash
# Авторизация по QR-коду (ASCII QR прямо в терминале) или по SMS:
npx neomaxz login

# Использование кастомного пути к файлу сессии SQLite:
npx neomaxz login --session ./bot-session.db

# Проверка статуса авторизации и данных аккаунта:
npx neomaxz whoami
```

---

## 🚀 Быстрый старт

### Вариант 1: SQLite сессия в одном файле (Рекомендуется)

```typescript
import { makeMaxSocket, useSqliteAuthState } from 'neomaxz';

async function main() {
  // 1. Инициализация сессии в едином SQLite файле session.db (на базе node:sqlite)
  const { state, saveCreds } = await useSqliteAuthState('session.db');

  // 2. Создание клиента
  const sock = makeMaxSocket({
    auth: state,
    autoReconnect: true,
  });

  // 3. Автосохранение обновленных токенов
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    if (update.connection === 'open') {
      console.log('✅ Подключено к MAX!');
      console.log(`👤 Пользователь: ${sock.user?.name} (ID: ${sock.user?.id})`);
    }
  });

  await sock.connect();
}

main().catch(console.error);
```

### Вариант 2: Многофайловое хранилище (JSON-папка)

```typescript
import { makeMaxSocket, useMultiFileAuthState } from 'neomaxz';
import readline from 'node:readline/promises';

async function main() {
  // 1. Инициализация постоянного хранилища сессии
  const { state, saveCreds } = await useMultiFileAuthState('./session_data');

  // 2. Создание клиента
  const sock = makeMaxSocket({
    auth: state,
    autoReconnect: true,
  });

  // 3. Автосохранение обновленных токенов
  sock.ev.on('creds.update', saveCreds);

  // 4. Отслеживание статуса соединения
  sock.ev.on('connection.update', (update) => {
    if (update.connection === 'open') {
      console.log('✅ Подключено к MAX!');
      console.log(`👤 Пользователь: ${sock.user?.name} (ID: ${sock.user?.id})`);
    } else if (update.connection === 'close') {
      console.log('❌ Соединение закрыто:', update.lastDisconnect?.error?.message);
    }
  });

  // 5. Обработка входящих сообщений
  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      if (msg.fromMe) continue; // Игнорировать свои сообщения

      console.log(`📩 [${msg.chatId}] ${msg.senderName ?? msg.senderId}: ${msg.text ?? '<медиа/вложение>'}`);

      // Эхо-ответ на команду !ping
      if (msg.text?.trim() === '!ping') {
        await sock.sendMessage(msg.chatId, {
          text: '🏓 pong!',
          replyToMessageId: msg.id, // Цитирование сообщения
        });
      }
    }
  });

  // 6. Подключение
  await sock.connect();

  // 7. Если сессия новая — запрашиваем номер и код из SMS
  if (!state.creds.sessionToken) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      const phone = await rl.question('Введите номер телефона (+7...): ');
      await sock.requestAuthCode(phone);

      const code = await rl.question('Введите код из SMS: ');
      const res = await sock.submitAuthCode(code);

      // Если на аккаунте включен 2FA (облачный пароль)
      if (res.status === 'password_required') {
        console.log(`Требуется 2FA пароль${res.hint ? ` (Подсказка: ${res.hint})` : ''}`);
        const password = await rl.question('Введите пароль: ');
        await sock.submitPassword(password);
      }

      console.log('🎉 Авторизация завершена! Сессия сохранена.');
    } finally {
      rl.close();
    }
  }
}

main().catch(console.error);
```

---

## 📖 Документация (API Reference)

Полная документация по всем методам, опкодам, типам данных и примерам использования вынесена в директорию [`docs/`](docs/README.md):

| Раздел документации | Содержание | Ссылка |
| :--- | :--- | :--- |
| **🚀 Быстрый старт** | Установка, консольная утилита CLI, минимальный эхо-бот | [docs/quickstart.md](docs/quickstart.md) |
| **🔐 Авторизация и сессии** | `useSqliteAuthState`, `useMultiFileAuthState`, вход по QR-коду, SMS, 2FA пароль | [docs/authentication.md](docs/authentication.md) |
| **💬 Сообщения и чаты** | Отправка сообщений, Markdown-разметка, инлайн-кнопки, опросы, реакции, цитирование | [docs/messages.md](docs/messages.md) |
| **👥 Управление чатами** | Создание групп/каналов, список участников, аватары, ссылки-приглашения | [docs/chats.md](docs/chats.md) |
| **📇 Контакты и профили** | Поиск пользователей, пробитие профиля по номеру, глобальный поиск, редактирование профиля | [docs/contacts.md](docs/contacts.md) |
| **👀 Presence и активность** | Индикаторы набора текста, записи аудио, загрузки файлов | [docs/presence.md](docs/presence.md) |
| **🎬 Медиа и стриминг** | Загрузка и скачивание фото/видео/аудио, волнограммы PTT (64 полосы), потоковый пайплайн | [docs/media.md](docs/media.md) |
| **⚡ Шина событий (`ev`)** | Каталог всех событий сокета (`messages.upsert`, `connection.update`, FIFO-очередь) | [docs/events.md](docs/events.md) |
| **🛡 Инфраструктура** | Token Bucket rate limiter, Circuit Breaker, Idempotency Ledger, Gap Recovery | [docs/infrastructure.md](docs/infrastructure.md) |
| **🔌 Протокол и фреймы** | 10-байтный бинарный заголовок, MessagePack, сжатие LZ4/Zstandard, сертификаты Минцифры | [docs/protocol.md](docs/protocol.md) |

### Структура объекта `sock`

```typescript
const sock = makeMaxSocket({ auth: state });

// Основные фасадные методы:
await sock.sendMessage(chatId, { text: 'Привет!' });
await sock.editMessage(chatId, msgId, 'Новый текст');
await sock.deleteMessages(chatId, [msgId]);
await sock.addReaction(chatId, msgId, '👍');
await sock.markChatRead(chatId);
const mediaBuffer = await sock.downloadMedia(msg);

// Подмодули и менеджеры:
sock.chats       // ChatManager: getChats, createChat, getChatMembers, inviteLinks
sock.contacts    // ContactManager: getContactByPhone, getUserProfile, searchContacts
sock.presence    // PresenceManager: sendPresence, simulateTyping
sock.media       // MediaManager: uploadPhoto, uploadFile, uploadVideo, uploadAudio
sock.ev          // MaxEventEmitter: messages.upsert, connection.update, creds.update
sock.queue       // RequestQueue: Token Bucket rate limiter и socket backpressure
sock.circuitBreaker // CircuitBreaker: L7 EWMA RTT замер и автоматический предохранитель
sock.ledger      // IdempotencyLedger: монотонные cid и дедупликация исходящих
sock.gapRecovery // GapRecoveryManager: синхронизация пропущенных сообщений при реконнекте
```

---

## ⚖️ Лицензия

MIT License