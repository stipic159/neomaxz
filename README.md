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
- 🔄 **Хранение сессий как в Baileys**: Метод `useMultiFileAuthState(folder)` для сохранения учетных данных в `creds.json` с атомарной записью (защита от повреждения файлов).
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

## 🚀 Быстрый старт

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

> *Примечание: На данный момент библиотека поддерживает работу с текстовыми сообщениями, реакциями и историей чатов. Поддержка отправки и скачивания медиафайлов находится в разработке.*

### Работа с сообщениями

- **`sock.sendMessage(chatId, { text, replyToMessageId })`**: Отправка текста или ответа с цитированием.
- **`sock.editMessage(chatId, messageId, newText)`**: Редактирование текста сообщения.
- **`sock.deleteMessages(chatId, messageIds, forMe = false)`**: Удаление одного или нескольких сообщений.
- **`sock.addReaction(chatId, messageId, emoji)`**: Установка реакции (эмодзи) на сообщение.
- **`sock.removeReaction(chatId, messageId)`**: Снятие реакции.
- **`sock.getChatHistory(chatId, fromTimestamp?, limit = 50)`**: Получение истории переписки.

### Авторизация и сессия

- **`sock.requestAuthCode(phone)`**: Запрос SMS-кода для указанного номера телефона.
- **`sock.submitAuthCode(code)`**: Проверка кода из SMS. Возвращает `{ status: 'ok' }` или `{ status: 'password_required', hint }`.
- **`sock.submitPassword(password)`**: Отправка пароля двухфакторной аутентификации.
- **`sock.logout()`**: Завершение сессии на сервере MAX и очистка локального токена.
- **`sock.end()`**: Принудительное закрытие сокета.

### События (`sock.ev.on`)

- `'connection.update'`: Изменение состояния сокета (`connecting`, `open`, `close`).
- `'creds.update'`: Обновление токенов или информации об устройстве.
- `'messages.upsert'`: Новые входящие сообщения (`{ messages: MaxMessage[], type: 'notify' }`).
- `'presence.update'`: Изменение статуса активности пользователей (набор текста и онлайн).

---

## ⚖️ Лицензия

MIT License