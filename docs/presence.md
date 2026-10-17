# 👀 Presence и активность в чате

> [🏠 neomaxz](../README.md) / [📚 Документация](README.md) / **Presence и активность**

---

## Содержание
- [Обзор](#обзор)
- [Отправка статуса активности (`sock.sendPresence`)](#отправка-статуса-активности-socksendpresence)
- [Имитация активности с автосбросом (`sock.simulateTyping`)](#имитация-активности-с-автосбросом-socksimulatetyping)
- [Отслеживание активности других пользователей](#отслеживание-активности-других-пользователей)
- [Типы данных и структуры](#типы-данных-и-структуры)

---

## Обзор

Индикаторы активности (Presence) отображают статус собеседника в верхней панели чата («печатает...», «записывает голосовое сообщение...», «отправляет файл...»). Методы присутствуют на фасаде `sock` и через свойство `sock.presence` (класс `PresenceManager`).

---

## Отправка статуса активности (`sock.sendPresence`)

Отправляет серверу текущее действие пользователя в чате (опкод `0x004a MSG_TYPING`).

#### Сигнатура
```typescript
async sendPresence(
  chatId: string | number | bigint,
  action: PresenceAction = 'typing'
): Promise<void>
```

#### Доступные действия (`action`):
- `'typing'`: пользователь набирает текстовое сообщение.
- `'recording_audio'`: пользователь записывает голосовое сообщение (PTT).
- `'uploading_file'`: пользователь выгружает документ или медиафайл.
- `'paused'`: сброс статуса активности (пользователь прекратил действие).

#### Пример
```typescript
// Показываем статус записи аудио перед отправкой PTT
await sock.sendPresence(chatId, 'recording_audio');
```

---

## Имитация активности с автосбросом (`sock.simulateTyping`)

Удобный хелпер для ботов: отправляет указанное действие, ждет заданное количество миллисекунд и автоматически отправляет `'paused'`.

#### Сигнатура
```typescript
async simulateTyping(
  chatId: string | number | bigint,
  delayMs = 2000,
  action: PresenceAction = 'typing'
): Promise<void>
```

#### Параметры
- `chatId`: идентификатор чата.
- `delayMs` *(число, опционально, по умолчанию `2000`)*: длительность показа индикатора в миллисекундах.
- `action` *(PresenceAction, опционально, по умолчанию `'typing'`)*: тип активности.

#### Пример
```typescript
sock.ev.on('messages.upsert', async ({ messages }) => {
  for (const msg of messages) {
    if (msg.fromMe || !msg.text) continue;

    // Имитируем набор текста 1.5 секунды перед ответом
    await sock.simulateTyping(msg.chatId, 1500, 'typing');

    await sock.sendMessage(msg.chatId, {
      text: 'Готово!',
      replyToMessageId: msg.id,
    });
  }
});
```

---

## Отслеживание активности других пользователей

Когда другой участник чата начинает или прекращает активность, сервер MAX отправляет пуш-событие `0x0081 PUSH_TYPING`, которое преобразуется в событие `'presence.update'` в `sock.ev`:

```typescript
sock.ev.on('presence.update', ({ chatId, userId, action, isTyping }) => {
  if (isTyping) {
    console.log(`Пользователь ${userId} в чате ${chatId} совершает действие: ${action}`);
  } else {
    console.log(`Пользователь ${userId} в чате ${chatId} остановился`);
  }
});
```

---

## Типы данных и структуры

```typescript
export type PresenceAction =
  | 'typing'           // Набор текста
  | 'recording_audio'  // Запись аудио
  | 'uploading_file'   // Загрузка файла
  | 'paused';          // Пауза / завершение

export type PresenceStatus = PresenceAction | 'online' | 'offline';

export interface PresenceUpdate {
  chatId: string;
  userId: string;
  action: PresenceAction;
  isTyping: boolean;
}
```

---

[⬅️ Назад: Контакты и профили](contacts.md) | [Вперед: Медиа и стриминг ➡️](media.md)
