# 🔌 Бинарный протокол, фреймы и сертификаты

> [🏠 neomaxz](../README.md) / [📚 Документация](README.md) / **Протокол и фреймы**

---

## Содержание
- [Обзор](#обзор)
- [Структура бинарного заголовка (10 байт)](#структура-бинарного-заголовка-10-байт)
- [Сериализация полезной нагрузки (MessagePack)](#сериализация-полезной-нагрузки-messagepack)
- [Сжатие данных (LZ4 и Zstandard)](#сжатие-данных-lz4-и-zstandard)
- [Кодек фреймов (`encodeFrame` и `decodeFrame`)](#кодек-фреймов-encodeframe-и-decodeframe)
- [Потоковый буфер фреймов (`StreamFrameBuffer`)](#потоковый-буфер-фреймов-streamframebuffer)
- [Сетевые транспорты (`ITransport`)](#сетевые-транспорты-itransport)
  - [`WebSocketTransport`](#websockettransport)
  - [`TlsSocketTransport`](#tlssockettransport)
- [Сертификаты Минцифры РФ](#сертификаты-минцифры-рф)
- [Справочник опкодов (OPCODES)](#справочник-опкодов-opcodes)

---

## Обзор

Мессенджер MAX взаимодействует с серверами по бинарному протоколу версии 10 (`0x0A`). Каждый сетевой пакет состоит из фиксированного 10-байтного заголовка и тела переменной длины, сериализованного в формат MessagePack.

---

## Структура бинарного заголовка (10 байт)

| Байт(ы) | Поле | Тип | Описание |
| :--- | :--- | :--- | :--- |
| `0` | `ver` | `uint8` | Версия протокола (всегда `10` / `0x0A`). |
| `1` | `cmd` | `uint8` | Направление команды: `0` = REQUEST, `1` = RESPONSE, `2` = EVENT (Server push), `3` = ERROR. |
| `2..3` | `seq` | `uint16_be` | Порядковый номер запроса (Sequence ID, 0..65535) для сопоставления ответа с запросом. |
| `4..5` | `opcode` | `uint16_be` | Код операции (см. [таблицу опкодов](#справочник-опкодов-opcodes)). |
| `6` | `flags` | `uint8` | Флаги сжатия: `0x00` = без сжатия, `0x01..0x7F` = фактор сжатия LZ4, `0xFF` = Zstandard (`zstd`). |
| `7..9` | `length` | `uint24_be` | Длина тела пакета в байтах (младшие 24 бита 32-битного упакованного поля). |

---

## Сериализация полезной нагрузки (MessagePack)

Тело запросов и ответов кодируется библиотекой `@msgpack/msgpack`. 

### Особенность 64-битных ID:
Сервер MAX передает 64-битные числовые идентификаторы (ID сообщений, пользователей и чатов) как запакованный Extension Type 1 (`WRAPPED_EXT_TYPE = 1`). Кодек `neomaxz` автоматически распаковывает такие структуры в нативный JavaScript `bigint` или `number` (если значение помещается в `Number.MAX_SAFE_INTEGER`).

Функции сериализации:
- `encodePayload(payload: Record<string, any>): Uint8Array`
- `decodePayloadBytes(bytes: Uint8Array): unknown`

---

## Сжатие данных (LZ4 и Zstandard)

Сервер MAX передает крупные ответы (историю сообщений, список чатов) в сжатом виде:
1. **LZ4**: флаг содержит коэффициент распаковки `factor = (decompressedSize / compressedSize)`. Распаковка выполняется нативным блочным декодером `decompressBlock` с динамическим расширением буфера при необходимости.
2. **Zstandard (`0xFF`)**: распаковывается через легковесную библиотеку `fzstd`.

```typescript
import { compressBlock, decompressBlock } from 'neomaxz';

// Сжатие
const { compressed, factor } = compressBlock(rawBytes);

// Распаковка
const decompressed = decompressBlock(compressed, factor);
```

---

## Кодек фреймов (`encodeFrame` и `decodeFrame`)

```typescript
import { encodeFrame, decodeFrame, type OutboundFrame, type InboundFrame } from 'neomaxz';

// Кодирование исходящего фрейма в бинарный Uint8Array
const bytes = encodeFrame({
  seq: 1,
  opcode: 0x0001, // PING
  cmd: 0,         // REQUEST
  payload: null,
});

// Декодирование входящего бинарного буфера
const frame: InboundFrame = decodeFrame(bytes);
console.log(`Получен ответ seq=${frame.seq}, opcode=${frame.opcode}`);
```

---

## Потоковый буфер фреймов (`StreamFrameBuffer`)

При работе через чистый TCP/TLS сокет входящие данные могут фрагментироваться на стыках TCP-пакетов. Класс `StreamFrameBuffer` накапливает сырые байты и извлекает строго законченные фреймы:

```typescript
import { StreamFrameBuffer } from 'neomaxz';

const streamBuffer = new StreamFrameBuffer();
socket.on('data', (chunk) => {
  streamBuffer.append(chunk);
  let frame;
  while ((frame = streamBuffer.nextFrame()) !== null) {
    // Обработка собранного фрейма
  }
});
```

---

## Сетевые транспорты (`ITransport`)

Библиотека поддерживает два варианта транспорта:

### `WebSocketTransport`
Стандартный транспорт web-клиента (`https://web.max.ru`).
- Адрес по умолчанию: `wss://api.oneme.ru/websocket`.
- Включает заголовок `Origin: https://web.max.ru`.
- Настраивает TCP Keep-Alive с интервалом `5000ms`.

### `TlsSocketTransport`
Низкоуровневый Raw TLS транспорт (стиль официальных десктопных и мобильных клиентов).
- Подключается напрямую к `api2.oneme.ru:443` без WebSocket-фрейминга.
- Передает чистый поток 10-байтных бинарных фреймов.

---

## Сертификаты Минцифры РФ

Для защиты от ошибок валидации SSL (`CERT_HAS_EXPIRED` / `UNABLE_TO_VERIFY_LEAF_SIGNATURE`) в бандл `neomaxz` вшиты актуальные корневой и промежуточный сертификаты:
- **Russian Trusted Root CA**
- **Russian Trusted Sub CA**

Функция `getTlsCaCertificates()` объединяет стандартные доверенные сертификаты Node.js (`tls.rootCertificates`) и сертификаты Минцифры, обеспечивая бесшовное подключение в любых окружениях (включая минималистичные контейнеры Alpine Docker).

```typescript
import { getTlsCaCertificates, createMaxHttpsAgent } from 'neomaxz';

const agent = createMaxHttpsAgent(); // HTTPS агент со встроенной цепочкой Минцифры
```

---

## Справочник опкодов (OPCODES)

Таблица констант `OPCODES` из протокола MAX:

| Опкод (hex) | Название | Назначение |
| :--- | :--- | :--- |
| `0x0001` | `PING` | Проверка связи / Heartbeat RTT |
| `0x0006` | `INIT` | Первичное рукопожатие и передача User-Agent |
| `0x0011` | `START_AUTH` | Запрос SMS-кода на номер телефона |
| `0x0012` | `CHECK_CODE` | Подтверждение проверочного SMS-кода |
| `0x0013` | `LOGIN` | Вход по сохраненному токену сессии |
| `0x0014` | `LOGOUT` | Завершение сессии на сервере |
| `0x0018` | `QR_LOGIN_START` | Запрос авторизации по QR-коду |
| `0x0019` | `QR_LOGIN_CHECK` | Опрос статуса подтверждения QR-кода |
| `0x0020` | `CONTACT_INFO` | Получение профиля пользователя по ID |
| `0x0022` | `CONTACT_UPDATE` | Обновление данных своего профиля |
| `0x0025` | `CONTACT_SEARCH` | Поиск по личной адресной книге |
| `0x0029` | `CONTACT_ADD` | Добавление контакта в телефонную книгу |
| `0x002c` | `PUBLIC_SEARCH` | Глобальный публичный поиск в каталоге MAX |
| `0x002e` | `CONTACT_INFO_BY_PHONE` | Поиск профиля по номеру телефона |
| `0x0031` | `CHAT_HISTORY` | Получение истории сообщений чата |
| `0x0033` | `CHAT_INFO` | Детальная информация о чате |
| `0x0034` | `CHAT_DELETE` | Удаление чата |
| `0x0035` | `CHATS_LIST` | Получение списка активных чатов |
| `0x0037` | `CHAT_SET_INFO` | Изменение названия, описания или аватара чата |
| `0x003a` | `CHAT_LEAVE` | Выход из группы или канала |
| `0x003b` | `CHAT_MEMBERS` | Получение, добавление и удаление участников |
| `0x003c` | `CHAT_CREATE` | Создание группы или канала |
| `0x003e` | `CHAT_INVITE_LINK` | Создание ссылки-приглашения в группу |
| `0x003f` | `CHAT_JOIN_LINK` | Вступление в группу по ссылке |
| `0x0040` | `MSG_SEND` | Отправка сообщения или пересылка |
| `0x0042` | `MSG_DELETE` | Удаление сообщений |
| `0x0043` | `MSG_EDIT` | Редактирование текста сообщения |
| `0x0044` | `MSG_REACTION` | Установка реакции (эмодзи) |
| `0x0045` | `MSG_READ` | Отметка сообщений прочитанными |
| `0x0046` | `MSG_CANCEL_REACTION`| Снятие реакции с сообщения |
| `0x0047` | `MSG_PIN` | Закрепление сообщения |
| `0x0048` | `MSG_UNPIN` | Открепление сообщения |
| `0x004a` | `MSG_TYPING` | Отправка статуса набора текста/записи аудио |
| `0x0050` | `PHOTO_UPLOAD` | Запрос URL для выгрузки фото |
| `0x0052` | `VIDEO_UPLOAD` | Запрос URL для выгрузки видеозаписи |
| `0x0057` | `FILE_UPLOAD` | Запрос URL для выгрузки файла или аудио |
| `0x0058` | `FILE_DOWNLOAD` | Запрос URL для скачивания файла |
| `0x0073` | `CHECK_PASSWORD` | Ввод пароля двухфакторной аутентификации 2FA |
| `0x0076` | `MSG_CALLBACK` | Ответ на нажатие инлайн-кнопки |
| `0x0080` | `PUSH_MESSAGE` | Серверный пуш входящего сообщения |
| `0x0081` | `PUSH_TYPING` | Серверный пуш изменения активности |
| `0x0088` | `PUSH_READ` | Серверный пуш о прочтении сообщений |

---

[⬅️ Назад: Инфраструктура и надежность](infrastructure.md) | [На главную страницу документации ➡️](README.md)
