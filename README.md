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

## 🛠 Методы API (`sock`)

### Работа с сообщениями и медиа

- **`sock.sendMessage(chatId, content)`**: Отправка сообщений в стиле Baileys:
  - **Текст и Markdown**: `{ text: 'Привет, *мир*!' }` (автоматический парсинг Markdown: `*жирный*`, `_курсив_`, `~зачеркнутый~`, `||спойлер||`, ````код````, `[ссылка](url)`).
  - **Фото**: `{ image: Buffer | 'path/to/pic.jpg' | { url: '...' }, caption: 'Подпись' }`.
  - **Документы**: `{ document: Buffer, fileName: 'doc.pdf', mimetype: 'application/pdf' }`.
  - **Видео**: `{ video: Buffer, caption: 'Видео' }`.
  - **Голосовые заметки (PTT)**: `{ audio: Buffer, ptt: true }` (автоматическое извлечение длительности и расчёт волнограммы из 64 полос).
  - **Кружочки (VideoNote)**: `{ videoNote: Buffer }`.
  - **Инлайн-клавиатуры**: `{ text: 'Выбор:', buttons: [[{ type: 'CALLBACK', text: 'Клик', payload: 'btn_1' }, { type: 'URL', text: 'Сайт', url: 'https://...' }]] }`.
  - **Опросы**: `{ poll: { question: 'Вопрос?', options: ['Вариант 1', 'Вариант 2'] } }`.
  - **Отложенные**: `{ text: 'В будущее', sendAt: 1800000000000 }`.
  - **Ответ с цитированием**: `{ text: 'Ответ', replyToMessageId: '...' }`.
- **`sock.downloadMedia(message | attach)`**: Скачивание медиафайлов и документов из входящих сообщений в `Buffer` с валидацией цепочки Минцифры РФ.
- **`sock.markChatRead(chatId, messageIds?, fromTimestamp?)`**: Отметка сообщений в чате как прочитанные.
- **`sock.pinMessage(chatId, messageId, notify = false)`**: Закрепление сообщения в чате.
- **`sock.unpinMessage(chatId, messageId)`**: Открепление сообщения.
- **`sock.sendCallback(chatId, messageId, callbackId, payload?)`**: Отправка ответа на нажатие инлайн-кнопки.
- **`sock.forwardMessages(targetChatId, sourceChatId, messageIds)`**: Пересылка сообщений в другой чат.
- **`sock.editMessage(chatId, messageId, newText, options?)`**: Редактирование текста сообщения.
- **`sock.deleteMessages(chatId, messageIds, forMe = false)`**: Удаление одного или нескольких сообщений.
- **`sock.addReaction(chatId, messageId, emoji)`**: Установка реакции (эмодзи) на сообщение.
- **`sock.removeReaction(chatId, messageId)`**: Снятие реакции.
- **`sock.getChatHistory(chatId, fromTimestamp?, limit = 50)`**: Получение истории переписки.

### Авторизация и сессия

- **`sock.requestQrCode()`**: Запрос QR-кода для быстрой авторизации через мобильное приложение MAX.
- **`sock.pollQrStatus(trackId?, options?)`**: Ожидание сканирования QR-кода на мобильном устройстве и автоматический вход.
- **`sock.requestAuthCode(phone)`**: Запрос SMS-кода для указанного номера телефона.
- **`sock.submitAuthCode(code)`**: Проверка кода из SMS. Возвращает `{ status: 'ok' }` или `{ status: 'password_required', hint }`.
- **`sock.submitPassword(password)`**: Отправка пароля двухфакторной аутентификации.
- **`sock.logout()`**: Завершение сессии на сервере MAX и очистка локального токена.
- **`sock.end()`**: Принудительное закрытие сокета.

### Управление чатами и группами (`sock.chats`)

- **`sock.getChats(options?)`**: Получение списка активных диалогов и каналов пользователя.
- **`sock.getChat(chatId)`**: Получение детальной информации о чате/канале.
- **`sock.createChat({ title, userIds, description?, isChannel? })`**: Создание новой группы или канала.
- **`sock.setChatInfo(chatId, { title?, description?, avatarToken? })`**: Обновление названия, описания или аватара чата.
- **`sock.getChatMembers(chatId, options?)`**: Список участников группы с их ролями (`ADMIN`, `MEMBER`, `OWNER`).
- **`sock.addChatMembers(chatId, userIds)`**: Добавление пользователей в группу.
- **`sock.removeChatMember(chatId, userId)`**: Исключение (кик) пользователя из группы.
- **`sock.leaveChat(chatId)`**: Выход из чата или канала.
- **`sock.deleteChat(chatId)`**: Удаление чата.
- **`sock.createInviteLink(chatId)`**: Создание ссылки-приглашения в группу.
- **`sock.joinByLink(inviteLinkOrCode)`**: Вступление в группу по ссылке-приглашению.

### Пользователи, контакты и профили (`sock.contacts`)

- **`sock.getContactByPhone(phone)`**: Пробитие профиля пользователя MAX по номеру телефона.
- **`sock.getUserProfile(userId)`**: Получение публичного профиля пользователя по ID.
- **`sock.searchContacts(query)`**: Поиск пользователей в своей адресной книге.
- **`sock.publicSearch(query)`**: Глобальный поиск пользователей и ботов в каталоге MAX по никнейму.
- **`sock.addContact(phone, { firstName, lastName? })`**: Добавление номера в контакты.
- **`sock.updateProfile({ firstName?, lastName?, bio?, avatarToken? })`**: Обновление данных своего профиля.

### Индикаторы активности / Presence (`sock.presence`)

- **`sock.sendPresence(chatId, action)`**: Отправка статуса активности (`'typing'`, `'recording_audio'`, `'uploading_file'`, `'paused'`).
- **`sock.simulateTyping(chatId, delayMs?, action?)`**: Показ статуса активности в течение `delayMs` с автоматическим сбросом.

### События (`sock.ev.on`)

- `'connection.update'`: Изменение состояния сокета (`connecting`, `open`, `close`, `{ qr, trackId }`).
- `'creds.update'`: Обновление токенов или информации об устройстве.
- `'messages.upsert'`: Новые входящие сообщения (`{ messages: MaxMessage[], type: 'notify' }`).
- `'messages.read'`: Уведомление о прочтении сообщений (`{ chatId, userId, messageIds, markTime }`).
- `'presence.update'`: Изменение активности пользователя (`{ chatId, userId, action, isTyping }`).

### Утилиты для работы со звуком

- **`extractAudioMetadata(buffer)`**: Извлечение реальной длительности (duration в секундах) и mime-типа из заголовков WAV (RIFF), OGG (Opus) и MP3.
- **`generateWaveform(buffer, samplesCount = 64)`**: Расчёт массива амплитуд (0..255) для реалистичной визуальной дорожки голосовых сообщений.

---

## ⚖️ Лицензия

MIT License