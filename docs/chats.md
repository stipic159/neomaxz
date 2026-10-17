# 👥 Управление чатами и группами

> [🏠 neomaxz](../README.md) / [📚 Документация](README.md) / **Управление чатами**

---

## Содержание
- [Обзор](#обзор)
- [Получение списка чатов (`sock.getChats`)](#получение-списка-чатов-sockgetchats)
- [Информация о чате (`sock.getChat`)](#информация-о-чате-sockgetchat)
- [Создание группы или канала (`sock.createChat`)](#создание-группы-или-канала-sockcreatechat)
- [Изменение параметров чата (`sock.setChatInfo`)](#изменение-параметров-чата-socksetchatinfo)
- [Управление участниками](#управление-участниками)
  - [Список участников (`sock.getChatMembers`)](#список-участников-sockgetchatmembers)
  - [Добавление участников (`sock.addChatMembers`)](#добавление-участников-sockaddchatmembers)
  - [Исключение участника (`sock.removeChatMember`)](#исключение-участника-sockremovechatmember)
- [Ссылки-приглашения](#ссылки-приглашения)
  - [Создание ссылки (`sock.createInviteLink`)](#создание-ссылки-sockcreateinvitelink)
  - [Вступление по ссылке (`sock.joinByLink`)](#вступление-по-ссылке-sockjoinbylink)
- [Выход и удаление](#выход-и-удаление)
  - [Выход из чата (`sock.leaveChat`)](#выход-из-чата-sockleavechat)
  - [Удаление чата (`sock.deleteChat`)](#удаление-чата-sockdeletechat)
- [Типы данных и структуры](#типы-данных-и-структуры)
  - [`MaxChat`](#maxchat)
  - [`ChatMember`](#chatmember)
  - [`CreateChatOptions`](#createchatoptions)
  - [`SetChatInfoOptions`](#setchathinfooptions)

---

## Обзор

Модуль управления чатами позволяет работать с личными диалогами (`DIALOG`), групповыми чатами (`GROUP`) и каналами (`CHANNEL`). Все методы доступны как напрямую из объекта `sock`, так и через свойство `sock.chats` (класс `ChatManager`).

---

## Получение списка чатов (`sock.getChats`)

Запрашивает список активных диалогов и каналов пользователя (опкод `0x0035 CHATS_LIST`).

#### Сигнатура
```typescript
async getChats(
  options?: { fromTimestamp?: number; count?: number }
): Promise<MaxChat[]>
```

#### Параметры
- `options.fromTimestamp` *(число, опционально)*: серверное время, от которого запрашивать чаты назад.
- `options.count` *(число, опционально, по умолчанию `50`)*: максимальное количество возвращаемых чатов.

#### Возвращаемое значение
Массив нормализованных объектов [`MaxChat`](#maxchat).

#### Пример
```typescript
const chats = await sock.getChats({ count: 20 });
for (const chat of chats) {
  console.log(`[${chat.type}] ${chat.title} (ID: ${chat.id}, Непрочитано: ${chat.unreadCount})`);
}
```

---

## Информация о чате (`sock.getChat`)

Запрашивает детальную информацию о конкретном чате по его ID (опкод `0x0033 CHAT_INFO`).

#### Сигнатура
```typescript
async getChat(chatId: string | number | bigint): Promise<MaxChat>
```

#### Пример
```typescript
const chat = await sock.getChat('123456789');
console.log(`Название: ${chat.title}`);
console.log(`Описание: ${chat.description ?? 'нет'}`);
console.log(`Участников: ${chat.membersCount ?? 0}`);
```

---

## Создание группы или канала (`sock.createChat`)

Создает новую группу или публичный/приватный канал (опкод `0x003c CHAT_CREATE`).

#### Сигнатура
```typescript
async createChat(options: CreateChatOptions): Promise<MaxChat>
```

#### Параметры
- `options.title` *(строка, обязательно)*: название группы или канала.
- `options.userIds` *(массив `string | number | bigint`, опционально)*: начальный список ID пользователей для добавления.
- `options.description` *(строка, опционально)*: описание чата.
- `options.isChannel` *(boolean, опционально, по умолчанию `false`)*: если `true`, создается канал, иначе групповой чат.

#### Возвращаемое значение
Созданный объект [`MaxChat`](#maxchat) с назначенным сервером `id`.

#### Пример
```typescript
// Создание группы
const group = await sock.createChat({
  title: 'Рабочая группа проекта',
  description: 'Координация задач',
  userIds: ['10001', '10002'],
});
console.log(`Группа создана с ID: ${group.id}`);

// Создание канала
const channel = await sock.createChat({
  title: 'Новости компании',
  isChannel: true,
});
console.log(`Канал создан с ID: ${channel.id}`);
```

---

## Изменение параметров чата (`sock.setChatInfo`)

Обновляет заголовок, описание или аватар чата (опкод `0x0037 CHAT_SET_INFO`).

#### Сигнатура
```typescript
async setChatInfo(
  chatId: string | number | bigint,
  options: SetChatInfoOptions
): Promise<void>
```

#### Параметры
- `options.title` *(строка, опционально)*: новое название.
- `options.description` *(строка, опционально)*: новое описание.
- `options.avatarToken` *(строка, опционально)*: токен загруженного фото (получается через `sock.media.uploadPhoto`).

#### Пример
```typescript
await sock.setChatInfo('123456789', {
  title: 'Новое название группы',
  description: 'Обновленное описание правил',
});
```

---

## Управление участниками

### Список участников (`sock.getChatMembers`)
Запрашивает список участников чата с их ролями (опкод `0x003b CHAT_MEMBERS`).

```typescript
async getChatMembers(
  chatId: string | number | bigint,
  options?: { count?: number; offset?: number }
): Promise<ChatMember[]>
```

```typescript
const members = await sock.getChatMembers('123456789', { count: 50 });
for (const m of members) {
  console.log(`Пользователь ${m.name ?? m.userId} — Роль: ${m.role}`);
}
```

### Добавление участников (`sock.addChatMembers`)
Добавляет одного или нескольких пользователей в групповой чат (опкод `0x003b CHAT_MEMBERS`, действие `ADD`).

```typescript
async addChatMembers(
  chatId: string | number | bigint,
  userIds: Array<string | number | bigint>
): Promise<void>
```

```typescript
await sock.addChatMembers('123456789', ['10003', '10004']);
```

### Исключение участника (`sock.removeChatMember`)
Удаляет (кикает) участника из группового чата (опкод `0x003b CHAT_MEMBERS`, действие `REMOVE`).

```typescript
async removeChatMember(
  chatId: string | number | bigint,
  userId: string | number | bigint
): Promise<void>
```

```typescript
await sock.removeChatMember('123456789', '10003');
```

---

## Ссылки-приглашения

### Создание ссылки (`sock.createInviteLink`)
Генерирует постоянную ссылку-приглашение в группу (опкод `0x003e CHAT_INVITE_LINK`).

```typescript
async createInviteLink(chatId: string | number | bigint): Promise<string>
```

```typescript
const inviteLink = await sock.createInviteLink('123456789');
console.log(`Ссылка для вступления: ${inviteLink}`);
```

### Вступление по ссылке (`sock.joinByLink`)
Вступает в группу по ссылке-приглашению или коду приглашения (опкод `0x003f CHAT_JOIN_LINK`).

```typescript
async joinByLink(inviteLinkOrCode: string): Promise<MaxChat>
```

```typescript
const chat = await sock.joinByLink('https://max.ru/join/abc123xyz');
console.log(`Успешно вступили в: ${chat.title}`);
```

---

## Выход и удаление

### Выход из чата (`sock.leaveChat`)
Покидает групповой чат или канал (опкод `0x003a CHAT_LEAVE`).

```typescript
async leaveChat(chatId: string | number | bigint): Promise<void>
```

```typescript
await sock.leaveChat('123456789');
```

### Удаление чата (`sock.deleteChat`)
Безвозвратно удаляет диалог или группу (опкод `0x0034 CHAT_DELETE`). Доступно владельцу чата.

```typescript
async deleteChat(chatId: string | number | bigint): Promise<void>
```

```typescript
await sock.deleteChat('123456789');
```

---

## Типы данных и структуры

### `MaxChat`
```typescript
export type ChatType = 'DIALOG' | 'GROUP' | 'CHANNEL';

export interface ChatPermissions {
  canSend?: boolean;
  canPin?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  canInvite?: boolean;
  isAdmin?: boolean;
}

export interface MaxChat {
  id: string;                      // Числовой ID чата строкой
  title: string;                   // Название
  type: ChatType;                  // DIALOG, GROUP или CHANNEL
  avatarUrl?: string;              // URL аватара
  description?: string;            // Описание
  unreadCount: number;             // Количество непрочитанных сообщений
  lastMessage?: MaxMessage;        // Последнее сообщение в чате
  membersCount?: number;           // Количество участников
  ownerId?: string;                // ID владельца
  isArchived?: boolean;            // В архиве ли чат
  permissions?: ChatPermissions;   // Права текущего пользователя в чате
  raw: Record<string, any>;        // Исходные данные с сервера
}
```

### `ChatMember`
```typescript
export type ChatMemberRole = 'ADMIN' | 'MEMBER' | 'OWNER';

export interface ChatMember {
  userId: string;
  role: ChatMemberRole;
  name?: string;
  avatarUrl?: string;
  joinedAt?: number;
  canPin?: boolean;
  canDelete?: boolean;
}
```

### `CreateChatOptions`
```typescript
export interface CreateChatOptions {
  title: string;
  userIds?: Array<string | number | bigint>;
  description?: string;
  isChannel?: boolean;
}
```

### `SetChatInfoOptions`
```typescript
export interface SetChatInfoOptions {
  title?: string;
  description?: string;
  avatarToken?: string;
}
```

---

[⬅️ Назад: Сообщения и чаты](messages.md) | [Вперед: Контакты и профили ➡️](contacts.md)
