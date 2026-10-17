# 📚 Документация neomaxz

> Полный справочник по архитектуре, модулям, методам API и протоколу библиотеки **neomaxz**.

[![GitHub](https://img.shields.io/badge/Вернуться_в_репозиторий-neomaxz-blue?logo=github)](../README.md)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../LICENSE)

---

## 🗺 Быстрая навигация по разделам

Для удобного чтения на GitHub документация разбита на тематические модули:

| Раздел | Описание | Ссылка |
| :--- | :--- | :--- |
| **🚀 Быстрый старт** | Установка, консольная утилита CLI, минимальный эхо-бот | [docs/quickstart.md](quickstart.md) |
| **🔐 Авторизация и сессии** | SQLite (`session.db`), MultiFile, вход по QR, SMS, 2FA пароль | [docs/authentication.md](authentication.md) |
| **💬 Сообщения и чаты** | Отправка сообщений, Markdown, кнопки, опросы, реакции, цитирование | [docs/messages.md](messages.md) |
| **👥 Управление чатами** | Создание групп/каналов, участники, аватары, ссылки-приглашения | [docs/chats.md](chats.md) |
| **📇 Контакты и профили** | Поиск пользователей, пробитие по номеру, обновление профиля | [docs/contacts.md](contacts.md) |
| **👀 Presence и активность** | Индикаторы набора текста, записи аудио, загрузки файлов | [docs/presence.md](presence.md) |
| **🎬 Медиа и стриминг** | Загрузка и скачивание фото/видео/аудио, волнограммы PTT, стримы | [docs/media.md](media.md) |
| **⚡ Шина событий (`ev`)** | Все события сокета (`messages.upsert`, `connection.update` и др.) | [docs/events.md](events.md) |
| **🛡 Инфраструктура** | Rate Limiter (Token Bucket), Circuit Breaker, Ledger, Gap Recovery | [docs/infrastructure.md](infrastructure.md) |
| **🔌 Протокол и фреймы** | 10-байтный бинарный заголовок, MessagePack, LZ4/Zstandard, CA | [docs/protocol.md](protocol.md) |

---

## 🏗 Архитектура клиента `makeMaxSocket`

Фасадный клиент создаётся функцией `makeMaxSocket(config)`:

```typescript
import { makeMaxSocket, useSqliteAuthState } from 'neomaxz';

const { state, saveCreds } = await useSqliteAuthState('session.db');

const sock = makeMaxSocket({
  auth: state,
  autoReconnect: true,
  maxGlobalPerSecond: 30,
  maxChatPerSecond: 5,
});
```

### Свойства объекта `sock`

Клиент `sock` объединяет высокоуровневые методы и открывает доступ к специализированным менеджерам и инфраструктурным компонентам:

| Свойство | Тип / Класс | Описание |
| :--- | :--- | :--- |
| `sock.ev` | [`MaxEventEmitter`](events.md) | Шина событий с гарантией FIFO-порядка доставки и неблокирующим исполнением асинхронных слушателей. |
| `sock.authState` | `AuthenticationState` | Текущее состояние авторизации (токены, `deviceId`, ключи). |
| `sock.user` | `{ id?: string; name?: string; phone?: string }` | Данные текущего авторизованного пользователя после логина. |
| `sock.queue` | [`RequestQueue`](infrastructure.md#requestqueue) | Очередь исходящих запросов с Token Bucket rate limiter и backpressure сокета. |
| `sock.circuitBreaker` | [`CircuitBreaker`](infrastructure.md#circuitbreaker) | L7 предохранитель с замером RTT (EWMA) и автоматическим размыкателем цепи. |
| `sock.ledger` | [`IdempotencyLedger`](infrastructure.md#idempotencyledger) | Реестр уникальных `cid` и статусов доставки сообщений. |
| `sock.gapRecovery` | [`GapRecoveryManager`](infrastructure.md#gaprecoverymanager) | Монотонный учёт времени сервера, дедупликация и синхронизация пропущенных сообщений. |
| `sock.messages` | [`MessageManager`](messages.md) | Экземпляр менеджера сообщений. |
| `sock.media` | [`MediaManager`](media.md) | Экземпляр менеджера загрузки и обработки вложений. |
| `sock.chats` | [`ChatManager`](chats.md) | Экземпляр менеджера чатов, каналов и участников. |
| `sock.contacts` | [`ContactManager`](contacts.md) | Экземпляр менеджера адресной книги и профилей. |
| `sock.presence` | [`PresenceManager`](presence.md) | Экземпляр менеджера индикации активности. |
| `sock.rawClient` | `SocketClient` | Низкоуровневый клиент взаимодействия с бинарным сокетом. |

---

## ⚡ Карта методов `sock`

Для быстрого перехода к сигнатурам и примерам используйте ссылки ниже:

### Подключение и авторизация ([Подробнее в authentication.md](authentication.md))
- [`sock.connect()`](authentication.md#sockconnect) — подключение к серверу MAX, рукопожатие `INIT` и автоматический `LOGIN`.
- [`sock.requestQrCode()`](authentication.md#sockrequestqrcode) — запрос данных QR-кода для мобильного приложения.
- [`sock.pollQrStatus(trackId?, options?)`](authentication.md#sockpollqrstatustrackid-options) — опрос статуса сканирования QR-кода.
- [`sock.requestAuthCode(phone)`](authentication.md#sockrequestauthcodephone) — запрос SMS-кода на номер телефона.
- [`sock.submitAuthCode(code)`](authentication.md#socksubmitauthcodecode) — подтверждение кода из SMS.
- [`sock.submitPassword(password)`](authentication.md#socksubmitpasswordpassword) — ввод облачного 2FA-пароля.
- [`sock.logout()`](authentication.md#socklogout) — завершение сессии на сервере и сброс токенов.
- [`sock.end()`](authentication.md#sockend) — закрытие сетевого соединения.

### Сообщения и медиа ([Подробнее в messages.md](messages.md))
- [`sock.sendMessage(chatId, content)`](messages.md#socksendmessagechatid-content) — отправка текста, Markdown, фото, документов, видео, аудио, кнопок и опросов.
- [`sock.editMessage(chatId, messageId, newText, options?)`](messages.md#sockeditmessagechatid-messageid-newtext-options) — редактирование текста ранее отправленного сообщения.
- [`sock.deleteMessages(chatId, messageIds, forMe?)`](messages.md#sockdeletemessageschatid-messageids-forme) — удаление одного или нескольких сообщений.
- [`sock.addReaction(chatId, messageId, emoji)`](messages.md#sockaddreactionchatid-messageid-emoji) — установка эмодзи-реакции на сообщение.
- [`sock.removeReaction(chatId, messageId)`](messages.md#sockremovereactionchatid-messageid) — удаление реакции.
- [`sock.markChatRead(chatId, messageIds?, fromTimestamp?)`](messages.md#sockmarkchatreadchatid-messageids-fromtimestamp) — отметка сообщений прочитанными.
- [`sock.pinMessage(chatId, messageId, notify?)`](messages.md#sockpinmessagechatid-messageid-notify) — закрепление сообщения в чате.
- [`sock.unpinMessage(chatId, messageId)`](messages.md#sockunpinmessagechatid-messageid) — открепление сообщения.
- [`sock.sendCallback(chatId, messageId, callbackId, payload?)`](messages.md#socksendcallbackchatid-messageid-callbackid-payload) — отправка ответа на клик по инлайн-кнопке.
- [`sock.forwardMessages(targetChatId, sourceChatId, messageIds)`](messages.md#sockforwardmessagestargetchatid-sourcechatid-messageids) — пересылка сообщений в другой чат.
- [`sock.downloadMedia(target)`](media.md#sockdownloadmediatarget) — скачивание медиафайла или документа в `Buffer`.
- [`sock.getChatHistory(chatId, fromTimestamp?, limit?)`](messages.md#sockgetchathistorychatid-fromtimestamp-limit) — получение истории сообщений.

### Чаты и группы ([Подробнее в chats.md](chats.md))
- [`sock.getChats(options?)`](chats.md#sockgetchatsoptions) — получение списка активных чатов пользователя.
- [`sock.getChat(chatId)`](chats.md#sockgetchatchatid) — получение подробной информации о чате.
- [`sock.createChat(options)`](chats.md#sockcreatechatoptions) — создание группового чата или канала.
- [`sock.setChatInfo(chatId, options)`](chats.md#socksetchathinfochatid-options) — изменение названия, описания или аватара чата.
- [`sock.getChatMembers(chatId, options?)`](chats.md#sockgetchatmemberschatid-options) — список участников группы и их роли.
- [`sock.addChatMembers(chatId, userIds)`](chats.md#sockaddchatmemberschatid-userids) — добавление пользователей в группу.
- [`sock.removeChatMember(chatId, userId)`](chats.md#sockremovechatmemberchatid-userid) — исключение участника из группы.
- [`sock.leaveChat(chatId)`](chats.md#sockleavechatchatid) — выход из чата или канала.
- [`sock.deleteChat(chatId)`](chats.md#sockdeletechatchatid) — безвозвратное удаление чата.
- [`sock.createInviteLink(chatId)`](chats.md#sockcreateinvitelinkchatid) — генерация ссылки-приглашения в группу.
- [`sock.joinByLink(inviteLinkOrCode)`](chats.md#sockjoinbylinkinvitelinkorcode) — вступление в группу по ссылке.

### Контакты и профили ([Подробнее в contacts.md](contacts.md))
- [`sock.getContactByPhone(phone)`](contacts.md#sockgetcontactbyphonephone) — поиск профиля пользователя по номеру телефона.
- [`sock.getUserProfile(userId)`](contacts.md#sockgetuserprofileuserid) — получение публичного профиля по ID.
- [`sock.searchContacts(query)`](contacts.md#socksearchcontactsquery) — поиск в личной адресной книге.
- [`sock.publicSearch(query)`](contacts.md#sockpublicsearchquery) — глобальный поиск пользователей и ботов в каталоге MAX.
- [`sock.addContact(phone, name)`](contacts.md#sockaddcontactphone-name) — добавление контакта в телефонную книгу.
- [`sock.updateProfile(options)`](contacts.md#sockupdateprofileoptions) — обновление своего имени, bio или аватара.

### Presence и индикаторы ([Подробнее в presence.md](presence.md))
- [`sock.sendPresence(chatId, action?)`](presence.md#socksendpresencechatid-action) — отправка статуса (`typing`, `recording_audio`, `uploading_file`, `paused`).
- [`sock.simulateTyping(chatId, delayMs?, action?)`](presence.md#socksimulatetypingchatid-delayms-action) — автоматическая имитация набора текста на заданное время.

---

[➡️ Перейти к Быстрому старту (quickstart.md)](quickstart.md)
