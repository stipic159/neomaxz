# 🚀 Быстрый старт

> [🏠 neomaxz](../README.md) / [📚 Документация](README.md) / **Быстрый старт**

---

## Содержание
- [Требования](#требования)
- [Установка](#установка)
- [Авторизация через консоль (CLI)](#авторизация-через-консоль-cli)
- [Минимальный бот (SQLite)](#минимальный-бот-sqlite)
- [Минимальный бот (Многофайловая сессия)](#минимальный-бот-многофайловая-сессия)
- [Эхо-ответ и цитирование](#эхо-ответ-и-цитирование)
- [Что дальше?](#что-дальше)

---

## Требования

- **Node.js**: версии 22.0.0 или новее (для нативной поддержки `node:sqlite` и встроенного тестового раннера).
- **Операционная система**: Windows, macOS, Linux (включая Alpine Docker).
- Встроенные сертификаты Минцифры РФ уже входят в бандл библиотеки — системные хранилища сертификатов настраивать не требуется.

---

## Установка

Установите пакет с помощью вашего пакетного менеджера:

```bash
# npm
npm install neomaxz

# pnpm
pnpm add neomaxz

# yarn
yarn add neomaxz
```

---

## Авторизация через консоль (CLI)

`neomaxz` включает встроенную утилиту для быстрого входа в аккаунт и генерации файла сессии без написания кода:

```bash
# Авторизация (по умолчанию создаст session.db в текущей папке)
npx neomaxz login

# Авторизация с сохранением в кастомный файл сессии
npx neomaxz login --session ./bot-session.db

# Проверка статуса авторизации и профиля
npx neomaxz whoami --session ./bot-session.db
```

В интерактивном меню CLI можно выбрать:
1. **QR-код**: в терминале отрендерится ASCII QR-код. Откройте мобильное приложение MAX ➔ Настройки ➔ Устройства ➔ Подключить устройство и отсканируйте код.
2. **Номер телефона**: введите номер в формате `+7...`, затем проверочный код из SMS и облачный 2FA-пароль (если включён).

---

## Минимальный бот (SQLite)

Рекомендуемый способ хранения — единый файл SQLite на базе встроенного модуля `node:sqlite`:

```typescript
import { makeMaxSocket, useSqliteAuthState } from 'neomaxz';

async function run() {
  // 1. Инициализируем хранилище сессии
  const { state, saveCreds } = await useSqliteAuthState('session.db');

  // 2. Создаем клиент
  const sock = makeMaxSocket({
    auth: state,
    autoReconnect: true,
  });

  // 3. Подписываемся на обновление токенов
  sock.ev.on('creds.update', saveCreds);

  // 4. Отслеживаем подключение
  sock.ev.on('connection.update', (update) => {
    if (update.connection === 'open') {
      console.log('✅ Соединение с MAX установлено!');
      console.log(`👤 Бот: ${sock.user?.name} (ID: ${sock.user?.id})`);
    } else if (update.connection === 'close') {
      console.log('❌ Соединение закрыто:', update.lastDisconnect?.error?.message);
    }
  });

  // 5. Обрабатываем входящие сообщения
  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      if (msg.fromMe) continue; // Пропускаем исходящие сообщения

      console.log(`📩 [${msg.chatId}] ${msg.senderName ?? msg.senderId}: ${msg.text}`);

      if (msg.text?.trim() === '/ping') {
        await sock.sendMessage(msg.chatId, {
          text: '🏓 pong!',
          replyToMessageId: msg.id,
        });
      }
    }
  });

  // 6. Подключаемся
  await sock.connect();
}

run().catch(console.error);
```

---

## Минимальный бот (Многофайловая сессия)

Если вам удобнее хранить учётные данные в виде JSON-файлов в папке (например, для отладки), используйте `useMultiFileAuthState`:

```typescript
import { makeMaxSocket, useMultiFileAuthState } from 'neomaxz';
import readline from 'node:readline/promises';

async function run() {
  const { state, saveCreds } = await useMultiFileAuthState('./session_data');

  const sock = makeMaxSocket({
    auth: state,
    autoReconnect: true,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection }) => {
    if (connection === 'open') {
      console.log('✅ Подключено к MAX');
    }
  });

  await sock.connect();

  // Если сессия новая и токен отсутствует — запрашиваем SMS-код
  if (!state.creds.sessionToken) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      const phone = await rl.question('Введите номер телефона (+7...): ');
      await sock.requestAuthCode(phone);

      const code = await rl.question('Введите код из SMS: ');
      const res = await sock.submitAuthCode(code);

      if (res.status === 'password_required') {
        const password = await rl.question(`Введите пароль 2FA (${res.hint ?? ''}): `);
        await sock.submitPassword(password);
      }

      console.log('🎉 Сессия успешно сохранена!');
    } finally {
      rl.close();
    }
  }
}

run().catch(console.error);
```

---

## Эхо-ответ и цитирование

Для ответа на сообщение укажите поле `replyToMessageId` в объекте контента:

```typescript
sock.ev.on('messages.upsert', async ({ messages }) => {
  for (const msg of messages) {
    if (msg.fromMe || !msg.text) continue;

    if (msg.text.startsWith('!echo ')) {
      const replyText = msg.text.slice(6);
      await sock.sendMessage(msg.chatId, {
        text: `Вы сказали: *${replyText}*`,
        replyToMessageId: msg.id,
      });
    }
  }
});
```

---

## Что дальше?

- Ознакомьтесь с подробным описанием способов авторизации и управления токенами: [🔐 Авторизация и сессии (authentication.md)](authentication.md).
- Изучите все варианты отправки сообщений, разметки Markdown, инлайн-кнопок и опросов: [💬 Сообщения и чаты (messages.md)](messages.md).
- Узнайте о возможностях отправки медиафайлов, голосовых с волнограммами и стриминга: [🎬 Медиа и стриминг (media.md)](media.md).

---

[⬅️ На главную (README.md)](README.md) | [Вперед к Авторизации (authentication.md) ➡️](authentication.md)
