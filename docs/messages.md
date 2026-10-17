# 💬 Сообщения и работа с чатом

> [🏠 neomaxz](../README.md) / [📚 Документация](README.md) / **Сообщения и чаты**

---

## Содержание
- [Обзор](#обзор)
- [Отправка сообщений (`sock.sendMessage`)](#отправка-сообщений-socksendmessage)
  - [Параметры и сигнатура](#параметры-и-сигнатура)
  - [Форматирование текста и Markdown](#форматирование-текста-и-markdown)
  - [Ответ и цитирование (`replyToMessageId`)](#ответ-и-цитирование-replytomessageid)
  - [Инлайн-кнопки и клавиатуры (`buttons`)](#инлайн-кнопки-и-клавиатуры-buttons)
  - [Создание опросов (`poll`)](#создание-опросов-poll)
  - [Отложенная отправка (`sendAt`)](#отложенная-отправка-sendat)
- [Редактирование сообщений (`sock.editMessage`)](#редактирование-сообщений-sockeditmessage)
- [Удаление сообщений (`sock.deleteMessages`)](#удаление-сообщений-sockdeletemessages)
- [Реакции (эмодзи)](#реакции-эмодзи)
  - [`sock.addReaction(chatId, messageId, emoji)`](#sockaddreactionchatid-messageid-emoji)
  - [`sock.removeReaction(chatId, messageId)`](#sockremovereactionchatid-messageid)
- [Прочтение сообщений (`sock.markChatRead`)](#прочтение-сообщений-sockmarkchatread)
- [Закрепление сообщений](#закрепление-сообщений)
  - [`sock.pinMessage(chatId, messageId, notify?)`](#sockpinmessagechatid-messageid-notify)
  - [`sock.unpinMessage(chatId, messageId)`](#sockunpinmessagechatid-messageid)
- [Обработка инлайн-кнопок (`sock.sendCallback`)](#обработка-инлайн-кнопок-socksendcallback)
- [Пересылка сообщений (`sock.forwardMessages`)](#пересылка-сообщений-sockforwardmessages)
- [История переписки (`sock.getChatHistory`)](#история-переписки-sockgetchathistory)
- [Типы данных и структуры](#типы-данных-и-структуры)
  - [`MaxMessage`](#maxmessage)
  - [`AnyMessageContent`](#anymessagecontent)
  - [`MessageElement`](#messageelement)
  - [`InlineButton`](#inlinebutton)
- [Вспомогательные утилиты](#вспомогательные-утилиты)
  - [`parseMarkdown(input)`](#parsemarkdowninput)
  - [`toBigIntId(value)`](#tobigintidvalue)
  - [`normalizeMessage(raw, currentUserId?)`](#normalizemessageraw-currentuserid)

---

## Обзор

Модуль работы с сообщениями реализует отправку данных по протоколу MAX (опкод `0x0040 MSG_SEND`), автоматическую генерацию уникального монотонного `cid` для каждого сообщения, регистрацию в [`IdempotencyLedger`](infrastructure.md#idempotencyledger), парсинг Markdown, а также загрузку медиавложений в стиле библиотеки Baileys.

---

## Отправка сообщений (`sock.sendMessage`)

Основной метод отправки сообщений, медиафайлов, кнопок и интерактивных компонентов.

### Параметры и сигнатура

```typescript
async sendMessage(
  chatId: string | number | bigint,
  content: AnyMessageContent
): Promise<MaxMessage>
```

| Параметр | Тип | Описание |
| :--- | :--- | :--- |
| `chatId` | `string \| number \| bigint` | Числовой ID чата или канала (автоматически конвертируется в 64-битный ID). |
| `content` | `AnyMessageContent` | Объект с содержимым сообщения (текст, медиа, кнопки, опрос и т.д.). |

#### Возвращаемое значение
Возвращает промис с нормализованным объектом отправленного сообщения типа [`MaxMessage`](#maxmessage) с проставленными `id`, `fromMe: true` и серверным таймстемпом.

---

### Форматирование текста и Markdown

По умолчанию (`parseMode: 'markdown'`) текст автоматически парсится встроенным движком `parseMarkdown` и преобразуется в массив структур `MessageElement` протокола MAX:

| Форматирование | Синтаксис | Тип элемента (`type`) | Пример |
| :--- | :--- | :--- | :--- |
| **Жирный** | `*текст*` | `BOLD` | `*Важное сообщение*` |
| *Курсив* | `_текст_` | `ITALIC` | `_Примечание автора_` |
| ~Зачеркнутый~ | `~текст~` | `STRIKETHROUGH` | `~Старая цена~` |
| \|\|Спойлер\|\| | `\|\|текст\|\|` | `SPOILER` | `\|\|Секретный код\|\|` |
| `Инлайн-код` | `` `код` `` | `CODE` | `` `const x = 42;` `` |
| Кодовый блок | ```` ```код``` ```` | `PRE` | ```` ```ts\nconsole.log(1);\n``` ```` |
| Ссылка | `[текст](https://...)` | `LINK` | `[Документация](https://github.com)` |
| Упоминание | `@username` или `@12345` | `MENTION` | `@durov` |

#### Пример
```typescript
await sock.sendMessage(chatId, {
  text: 'Привет, *мир*! Ознакомьтесь с [нашим сайтом](https://example.com) и ||спойлером||.',
});
```

Если вы хотите отключить автопарсинг и передать текст «как есть», либо передать собственные сущности:
```typescript
await sock.sendMessage(chatId, {
  text: '*Это не будет жирным*',
  parseMode: 'none',
});
```

---

### Ответ и цитирование (`replyToMessageId`)

Для ответа на конкретное сообщение укажите его идентификатор в поле `replyToMessageId`:

```typescript
await sock.sendMessage(chatId, {
  text: 'Это ответ на ваше сообщение',
  replyToMessageId: targetMsg.id,
});
```

---

### Инлайн-кнопки и клавиатуры (`buttons`)

MAX поддерживает инлайн-кнопки под сообщением. Кнопки передаются в виде двумерного массива (массив строк кнопок):

```typescript
await sock.sendMessage(chatId, {
  text: 'Выберите действие:',
  buttons: [
    [
      { type: 'CALLBACK', text: '👍 Нравится', payload: 'like_clicked' },
      { type: 'CALLBACK', text: '👎 Дизлайк', payload: 'dislike_clicked' },
    ],
    [
      { type: 'URL', text: '🌐 Перейти на сайт', url: 'https://example.com' },
    ],
  ],
});
```

Типы кнопок:
- `CALLBACK`: отправляет `callbackId` боту при нажатии. Обрабатывается в `sock.sendCallback`.
- `URL`: внешняя ссылка, открывающая браузер.
- `QUICK_REPLY`: быстрая отправка текста от имени пользователя.

---

### Создание опросов (`poll`)

```typescript
await sock.sendMessage(chatId, {
  poll: {
    question: 'Какой фреймворк вы предпочитаете?',
    options: ['Node.js', 'Bun', 'Deno'],
    multipleAnswers: false, // Разрешен ли выбор нескольких вариантов
    anonymous: true,        // Анонимное голосование
  },
});
```

---

### Отложенная отправка (`sendAt`)

Сервер MAX позволяет запланировать отправку сообщения в будущее, указав таймстемп в миллисекундах или объект `Date`:

```typescript
const inOneHour = Date.now() + 60 * 60 * 1000;

await sock.sendMessage(chatId, {
  text: 'Это сообщение отправлено из прошлого!',
  sendAt: inOneHour,
});
```

---

## Редактирование сообщений (`sock.editMessage`)

Изменяет текст ранее отправленного сообщения (опкод `0x0043 MSG_EDIT`).

#### Сигнатура
```typescript
async editMessage(
  chatId: string | number | bigint,
  messageId: string | number | bigint,
  newText: string,
  options?: { parseMode?: 'markdown' | 'none'; elements?: MessageElement[] }
): Promise<void>
```

#### Пример
```typescript
await sock.editMessage(chatId, msg.id, 'Обновленный текст сообщения с *жирным шрифтом*.');
```

---

## Удаление сообщений (`sock.deleteMessages`)

Удаляет одно или несколько сообщений из чата (опкод `0x0042 MSG_DELETE`).

#### Сигнатура
```typescript
async deleteMessages(
  chatId: string | number | bigint,
  messageIds: Array<string | number | bigint>,
  forMe = false
): Promise<void>
```

#### Параметры
- `chatId`: идентификатор чата.
- `messageIds`: массив ID удаляемых сообщений.
- `forMe` *(boolean, по умолчанию `false`)*: если `true`, сообщение удаляется только для текущего пользователя; если `false` — для всех участников беседы.

#### Пример
```typescript
await sock.deleteMessages(chatId, [msg1.id, msg2.id]);
```

---

## Реакции (эмодзи)

### `sock.addReaction(chatId, messageId, emoji)`
Устанавливает реакцию-эмодзи на сообщение (опкод `0x0044 MSG_REACTION`).

```typescript
await sock.addReaction(chatId, msg.id, '🔥');
```

### `sock.removeReaction(chatId, messageId)`
Снимает ранее установленную реакцию (опкод `0x0046 MSG_CANCEL_REACTION`).

```typescript
await sock.removeReaction(chatId, msg.id);
```

---

## Прочтение сообщений (`sock.markChatRead`)

Отправляет на сервер подтверждение прочтения сообщений в чате (опкод `0x0045 MSG_READ`).

#### Сигнатура
```typescript
async markChatRead(
  chatId: string | number | bigint,
  messageIds: Array<string | number | bigint> = [],
  fromTimestamp: number = Date.now()
): Promise<void>
```

#### Пример
```typescript
// Отметить конкретные сообщения прочитанными
await sock.markChatRead(chatId, [msg.id]);

// Отметить весь чат прочитанным по текущее время
await sock.markChatRead(chatId);
```

---

## Закрепление сообщений

### `sock.pinMessage(chatId, messageId, notify?)`
Закрепляет сообщение вверху чата (опкод `0x0047 MSG_PIN`).

```typescript
// notify = true отправит системное уведомление всем участникам
await sock.pinMessage(chatId, msg.id, true);
```

### `sock.unpinMessage(chatId, messageId)`
Открепляет сообщение из шапки чата (опкод `0x0048 MSG_UNPIN`).

```typescript
await sock.unpinMessage(chatId, msg.id);
```

---

## Обработка инлайн-кнопок (`sock.sendCallback`)

Отправляет серверу подтверждение клика по инлайн-кнопке бота (опкод `0x0076 MSG_CALLBACK`).

#### Сигнатура
```typescript
async sendCallback(
  chatId: string | number | bigint,
  messageId: string | number | bigint,
  callbackId: string,
  payload?: string
): Promise<void>
```

#### Пример
```typescript
await sock.sendCallback(chatId, messageId, 'cb_12345', 'btn_accepted');
```

---

## Пересылка сообщений (`sock.forwardMessages`)

Пересылает одно или несколько сообщений из одного чата в другой с сохранением авторства (опкод `0x0040 MSG_SEND` с `link: { type: 'FORWARD' }`).

#### Сигнатура
```typescript
async forwardMessages(
  targetChatId: string | number | bigint,
  sourceChatId: string | number | bigint,
  messageIds: Array<string | number | bigint>
): Promise<MaxMessage[]>
```

#### Пример
```typescript
const forwarded = await sock.forwardMessages(
  '123456789', // Куда
  '987654321', // Откуда
  [msg.id]     // Какие сообщения
);
```

---

## История переписки (`sock.getChatHistory`)

Запрашивает список сообщений чата в обратном хронологическом порядке (опкод `0x0031 CHAT_HISTORY`).

#### Сигнатура
```typescript
async getChatHistory(
  chatId: string | number | bigint,
  fromTimestamp: number = Date.now(),
  limit = 50
): Promise<MaxMessage[]>
```

#### Параметры
- `chatId`: идентификатор чата.
- `fromTimestamp` *(число, по умолчанию `Date.now()`)*: точка отсчёта по времени назад.
- `limit` *(число, по умолчанию `50`)*: количество запрашиваемых сообщений (рекомендуется не более 50-100 за один запрос).

#### Возвращаемое значение
Массив объектов [`MaxMessage`](#maxmessage), нормализованных в единый формат.

---

## Типы данных и структуры

### `MaxMessage`
```typescript
export interface MaxMessage {
  key: MessageKey;              // Составной ключ { chatId, id, fromMe }
  chatId: string;               // ID чата
  id: string;                   // Уникальный ID сообщения
  fromMe: boolean;              // true, если сообщение отправлено текущим аккаунтом
  senderId?: string;            // ID отправителя
  senderName?: string;          // Имя отправителя
  text: string;                 // Чистый текст без Markdown-символов
  elements?: MessageElement[];  // Распарсенные сущности разметки (жирный, ссылки и т.д.)
  timestamp: number;            // Время отправки в миллисекундах
  replyToMessageId?: string;    // ID цитируемого сообщения
  attaches: MessageAttachment[];// Вложения (фото, файлы, опросы, кнопки)
  raw: Record<string, any>;     // Исходный сырой объект протокола MAX
}

export interface MessageKey {
  chatId: string;
  id: string;
  fromMe: boolean;
}
```

### `AnyMessageContent`
```typescript
export interface AnyMessageContent {
  text?: string;
  caption?: string;
  replyToMessageId?: string | number | bigint;
  elements?: MessageElement[];
  parseMode?: 'markdown' | 'none';
  attaches?: MessageAttachment[];

  // Медиавложения (Buffer, путь к файлу, URL или стрим):
  image?: MediaSource;
  document?: MediaSource;
  fileName?: string;
  mimetype?: string;
  video?: MediaSource;
  audio?: MediaSource;
  ptt?: boolean;              // Голосовая заметка с волнограммой
  videoNote?: MediaSource;    // Кружочек (round video)

  // Интерактив:
  buttons?: InlineButton[][];
  poll?: PollInput;

  // Таймер:
  sendAt?: number | Date;
}
```

### `MessageElement`
```typescript
export type MessageElementType =
  | 'BOLD'
  | 'ITALIC'
  | 'STRIKETHROUGH'
  | 'UNDERLINE'
  | 'CODE'
  | 'PRE'
  | 'SPOILER'
  | 'LINK'
  | 'MENTION';

export interface MessageElement {
  type: MessageElementType;
  offset: number;             // Смещение в символах от начала текста
  length: number;             // Длина выделенного фрагмента
  url?: string;               // URL для типа LINK
  userId?: string | bigint;   // ID пользователя для типа MENTION
}
```

### `InlineButton`
```typescript
export type InlineButton = CallbackButton | UrlButton | QuickReplyButton;

export interface CallbackButton {
  type: 'CALLBACK';
  text: string;
  payload: string;
}

export interface UrlButton {
  type: 'URL';
  text: string;
  url: string;
}

export interface QuickReplyButton {
  type: 'QUICK_REPLY';
  text: string;
  payload?: string;
}
```

---

## Вспомогательные утилиты

### `parseMarkdown(input)`
Разбирает строку Markdown и возвращает чистый текст и массив `elements`:
```typescript
import { parseMarkdown } from 'neomaxz';

const { text, elements } = parseMarkdown('Привет, *мир*!');
// text: "Привет, мир!"
// elements: [{ type: 'BOLD', offset: 8, length: 3 }]
```

### `toBigIntId(value)`
Безопасно конвертирует строку, число или BigInt в `bigint` для протокола MAX:
```typescript
import { toBigIntId } from 'neomaxz';

const id = toBigIntId('123456789012345678'); // 123456789012345678n
```

### `normalizeMessage(raw, currentUserId?)`
Преобразует произвольный сырой объект сообщения протокола MAX в типизированный `MaxMessage`.

---

[⬅️ Назад: Авторизация и сессии](authentication.md) | [Вперед: Управление чатами ➡️](chats.md)
