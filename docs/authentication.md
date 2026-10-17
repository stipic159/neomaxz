# 🔐 Авторизация и управление сессиями

> [🏠 neomaxz](../README.md) / [📚 Документация](README.md) / **Авторизация и сессии**

---

## Содержание
- [Обзор механизма сессий](#обзор-механизма-сессий)
- [Хранилища сессий](#хранилища-сессий)
  - [`useSqliteAuthState(dbPath?)`](#usesqliteauthstatedbpath)
  - [`useMultiFileAuthState(folder)`](#usemultifileauthstatefolder)
  - [Интерфейсы данных сессии](#интерфейсы-данных-сессии)
- [Методы клиента (`sock`)](#методы-клиента-sock)
  - [`sock.connect()`](#sockconnect)
  - [`sock.requestQrCode()`](#sockrequestqrcode)
  - [`sock.pollQrStatus(trackId?, options?)`](#sockpollqrstatustrackid-options)
  - [`sock.requestAuthCode(phone)`](#sockrequestauthcodephone)
  - [`sock.submitAuthCode(code)`](#socksubmitauthcodecode)
  - [`sock.submitPassword(password)`](#socksubmitpasswordpassword)
  - [`sock.logout()`](#socklogout)
  - [`sock.end()`](#sockend)
- [Низкоуровневый `AuthManager`](#низкоуровневый-authmanager)
  - [`authManager.initSession(client, userAgent?)`](#authmanagerinitsessionclient-useragent)
  - [`authManager.loginWithToken(client, token?, chatsCount?)`](#authmanagerloginwithtokenclient-token-chatscount)
  - [`DEFAULT_USER_AGENT`](#default_user_agent)
- [Сценарии авторизации](#сценарии-авторизации)
  - [Сценарий 1: Авторизация по QR-коду](#сценарий-1-авторизация-по-qr-коду)
  - [Сценарий 2: Авторизация по SMS и 2FA](#сценарий-2-авторизация-по-sms-и-2fa)

---

## Обзор механизма сессий

Протокол MAX требует строгого соблюдения последовательности при входе:
1. **Рукопожатие `INIT` (`0x0006`)**: передача параметров клиентского окружения (`userAgent`, `deviceId`). Без выполнения `INIT` сервер отклоняет любые другие команды.
2. **Вход по сохранённому токену `LOGIN` (`0x0013`)**: если сессия уже содержит `sessionToken`, клиент передает его серверу и получает снапшот профиля и список чатов. В библиотеке `neomaxz` этот шаг автоматизирован — вызов `sock.connect()` сам выполняет `INIT` и `LOGIN`.
3. **Авторизация нового аккаунта**:
   - **QR-код**: запрос QR (`0x0018 QR_LOGIN_START`) ➔ опрос статуса подтверждения (`0x0019 QR_LOGIN_CHECK`) ➔ получение `sessionToken` ➔ `LOGIN`.
   - **Номер телефона**: запрос SMS (`0x0011 START_AUTH`) ➔ отправка кода (`0x0012 CHECK_CODE`) ➔ ввод 2FA (`0x0073 CHECK_PASSWORD`, если требуется) ➔ `LOGIN`.

---

## Хранилища сессий

Библиотека предоставляет два драйвера постоянного хранения учетных данных:

### `useSqliteAuthState(dbPath?)`

Рекомендуемый движок. Хранит учетные данные в едином компактном `.db` файле при помощи встроенного нативного модуля Node.js `node:sqlite`. Не требует сборки компилятором C++ (`node-gyp`) и не создает мусорных файлов на диске.

#### Сигнатура
```typescript
function useSqliteAuthState(dbPath?: string): Promise<SqliteAuthStateResult>;

interface SqliteAuthStateResult {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
  close: () => void;
}
```

#### Параметры
- `dbPath` *(строка, опционально, по умолчанию `'session.db'`)*: путь к файлу базы данных SQLite. Если папки в пути не существуют, они создаются автоматически.

#### Возвращаемое значение
- `state`: текущее состояние сессии (`AuthenticationState`), передаваемое в `makeMaxSocket({ auth: state })`.
- `saveCreds`: асинхронная функция атомарного сохранения изменений в БД через транзакцию (`BEGIN TRANSACTION ... COMMIT`).
- `close`: метод закрытия соединения с базой данных SQLite.

#### Пример
```typescript
import { makeMaxSocket, useSqliteAuthState } from 'neomaxz';

const { state, saveCreds, close } = await useSqliteAuthState('./sessions/bot.db');
const sock = makeMaxSocket({ auth: state });

sock.ev.on('creds.update', saveCreds);

process.on('SIGINT', () => {
  close();
  process.exit(0);
});
```

---

### `useMultiFileAuthState(folder)`

Классический Baileys-стиль хранения: сохраняет сессию в указанную папку в виде двух JSON-файлов: `creds.json` (основные токены и реквизиты) и `keys.json` (криптографические ключи).

#### Сигнатура
```typescript
function useMultiFileAuthState(folder: string): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}>;
```

#### Параметры
- `folder` *(строка, обязательно)*: путь к директории хранения файлов сессии.

#### Особенности реализации
- Запись производится атомарно через запись во временный файл (`${targetFile}.${uuid}.tmp`) с последующим переименованием (`fs.rename`), что гарантирует защиту от повреждения данных при внезапном сбое питания или падении процесса.
- Внутренняя очередь `writeQueue` обеспечивает строго последовательную запись на диск, предотвращая ошибки блокировки файлов (`EBUSY` / `EPERM`) в Windows.

#### Пример
```typescript
import { makeMaxSocket, useMultiFileAuthState } from 'neomaxz';

const { state, saveCreds } = await useMultiFileAuthState('./session_data');
const sock = makeMaxSocket({ auth: state });
sock.ev.on('creds.update', saveCreds);
```

---

### Интерфейсы данных сессии

```typescript
export interface AuthenticationCreds {
  deviceId: string;          // Уникальный UUID устройства (генерируется автоматически)
  phone?: string;            // Номер телефона аккаунта (+7...)
  sessionToken?: string;     // Постоянный токен авторизованной сессии
  userId?: string;           // Числовой ID текущего пользователя
  name?: string;             // Имя пользователя
  registeredAt?: number;     // Таймстемп регистрации
}

export interface AuthenticationState {
  creds: AuthenticationCreds;
  keys?: Record<string, any>;
}

export interface RuntimeAuthContext {
  phone?: string;
  authToken?: string;        // Промежуточный токен между START_AUTH и CHECK_CODE
  trackId?: string;          // Идентификатор сессии 2FA или QR-кода
  passwordHint?: string;     // Подсказка к паролю 2FA
}
```

---

## Методы клиента (`sock`)

### `sock.connect()`

Инициирует сетевое подключение через сокет, автоматически выполняет handshake `INIT` и производит вход `LOGIN`, если в учетных данных уже сохранен `sessionToken`.

#### Сигнатура
```typescript
async connect(): Promise<{ sessionToken?: string; profile?: any; chats?: any[] } | void>
```

#### Возвращаемое значение
- Возвращает объект с результатами логина (`sessionToken`, `profile`, `chats`) либо `void`, если сессия новая и токена пока нет.
- При автоматическом переподключении сокета процедура `INIT` + `LOGIN` выполняется повторно до перехода сокета в статус `'open'`.

---

### `sock.requestQrCode()`

Запрашивает у сервера данные для авторизации по QR-коду (опкод `0x0018 QR_LOGIN_START`).

#### Сигнатура
```typescript
async requestQrCode(): Promise<{ qr: string; trackId: string }>
```

#### Возвращаемое значение
- `qr` *(строка)*: строка контента QR-кода (URL или бинарный токен для сканирования приложением).
- `trackId` *(строка)*: идентификатор операции проверки статуса.

#### Побочные эффекты
- Эмитит событие `connection.update` со свойствами `{ qr, trackId }`.

---

### `sock.pollQrStatus(trackId?, options?)`

Запускает периодический опрос сервера (опкод `0x0019 QR_LOGIN_CHECK`) до тех пор, пока пользователь не отсканирует QR-код в мобильном приложении MAX.

#### Сигнатура
```typescript
async pollQrStatus(
  trackId?: string,
  options?: { timeoutMs?: number; intervalMs?: number }
): Promise<{ sessionToken: string }>
```

#### Параметры
- `trackId` *(строка, опционально)*: идентификатор из `requestQrCode`. Если опущен, используется сохранённый в памяти контекст.
- `options.timeoutMs` *(число, опционально, по умолчанию `60000`)*: максимальное время ожидания сканирования (в мс).
- `options.intervalMs` *(число, опционально, по умолчанию `2000`)*: интервал между запросами статуса (в мс).

#### Возвращаемое значение
- `{ sessionToken: string }`: итоговый токен сессии. Метод сразу сохраняет токен в `authState` и автоматически выполняет `sock.connect() / loginWithToken`.

#### Исключения
- Бросает `Error('QR code authorization expired')` при истечении срока действия кода.
- Бросает `Error('QR code authorization timed out')` по истечении `timeoutMs`.

---

### `sock.requestAuthCode(phone)`

Запрашивает одноразовый код подтверждения по SMS (опкод `0x0011 START_AUTH`).

#### Сигнатура
```typescript
async requestAuthCode(phone: string): Promise<{ authToken: string }>
```

#### Параметры
- `phone` *(строка)*: номер телефона в международном формате (например, `'+79991234567'`).

#### Возвращаемое значение
- `{ authToken: string }`: временный авторизационный токен для последующей отправки в `submitAuthCode`.

---

### `sock.submitAuthCode(code)`

Отправляет полученный из SMS проверочный код (опкод `0x0012 CHECK_CODE`).

#### Сигнатура
```typescript
async submitAuthCode(code: string): Promise<SubmitCodeResult>

type SubmitCodeResult =
  | { status: 'ok'; sessionToken: string }
  | { status: 'password_required'; trackId: string; hint?: string };
```

#### Параметры
- `code` *(строка)*: цифровой проверочный код из SMS.

#### Возвращаемое значение
- `{ status: 'ok', sessionToken }`: если 2FA выключена, авторизация завершена, токен сохранен и выполнен логин.
- `{ status: 'password_required', trackId, hint }`: если на аккаунте включен облачный 2FA-пароль. Следующим шагом необходимо вызвать `sock.submitPassword(password)`.

---

### `sock.submitPassword(password)`

Передает облачный пароль двухфакторной аутентификации (опкод `0x0073 CHECK_PASSWORD`).

#### Сигнатура
```typescript
async submitPassword(password: string): Promise<string>
```

#### Параметры
- `password` *(строка)*: пароль от аккаунта MAX.

#### Возвращаемое значение
- `string`: постоянный `sessionToken`. Метод сохраняет токен и завершает вход в аккаунт.

---

### `sock.logout()`

Завершает сессию на сервере MAX (опкод `0x0014 LOGOUT`), очищает локальный `sessionToken`, оповещает подписчиков событием `creds.update` и разрывает сетевой сокет.

#### Сигнатура
```typescript
async logout(): Promise<void>
```

---

### `sock.end()`

Немедленно закрывает сокет без отзыва токена сессии на сервере. При следующем запуске сессия будет действительна.

#### Сигнатура
```typescript
end(): void
```

---

## Низкоуровневый `AuthManager`

Класс `AuthManager` инкапсулирует логику отправки низкоуровневых фреймов аутентификации. Доступен внутри `sock` или как отдельный модуль `import { AuthManager } from 'neomaxz'`.

### `authManager.initSession(client, userAgent?)`
Отправляет фрейм `INIT` (`0x0006`) с информацией об устройстве и UUID.

### `authManager.loginWithToken(client, token?, chatsCount?)`
Отправляет фрейм `LOGIN` (`0x0013`). Параметр `chatsCount` автоматически ограничивается значением `50` (требование сервера MAX). Извлекает профиль и список диалогов.

### `DEFAULT_USER_AGENT`
Параметры окружения по умолчанию:
```typescript
export const DEFAULT_USER_AGENT = {
  deviceType: "DESKTOP",
  appVersion: "26.35.1",
  buildNumber: 80662,
  osVersion: "Ubuntu 24.04.4 LTS",
  locale: "ru",
  screen: "2.0x",
  timezone: "Europe/Moscow",
};
```

---

## Сценарии авторизации

### Сценарий 1: Авторизация по QR-коду

```typescript
import { makeMaxSocket, useSqliteAuthState } from 'neomaxz';
import qrcode from 'qrcode-terminal';

async function authWithQr() {
  const { state, saveCreds } = await useSqliteAuthState('session.db');
  const sock = makeMaxSocket({ auth: state });
  sock.ev.on('creds.update', saveCreds);

  await sock.connect();

  if (!state.creds.sessionToken) {
    console.log('Запрос QR-кода...');
    const { qr } = await sock.requestQrCode();

    // Отрисовка QR-кода прямо в терминале
    qrcode.generate(qr, { small: true });
    console.log('Отсканируйте QR в приложении MAX: Настройки -> Устройства');

    await sock.pollQrStatus();
    console.log(`✅ Авторизован как: ${sock.user?.name} (ID: ${sock.user?.id})`);
  }
}
```

### Сценарий 2: Авторизация по SMS и 2FA

```typescript
import { makeMaxSocket, useSqliteAuthState } from 'neomaxz';
import readline from 'node:readline/promises';

async function authWithPhone() {
  const { state, saveCreds } = await useSqliteAuthState('session.db');
  const sock = makeMaxSocket({ auth: state });
  sock.ev.on('creds.update', saveCreds);

  await sock.connect();

  if (!state.creds.sessionToken) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      const phone = await rl.question('Номер телефона (+7...): ');
      await sock.requestAuthCode(phone);

      const code = await rl.question('Код из SMS: ');
      const res = await sock.submitAuthCode(code);

      if (res.status === 'password_required') {
        const pass = await rl.question(`Пароль 2FA${res.hint ? ` (${res.hint})` : ''}: `);
        await sock.submitPassword(pass);
      }

      console.log('✅ Вход успешно выполнен!');
    } finally {
      rl.close();
    }
  }
}
```

---

[⬅️ Назад: Быстрый старт](quickstart.md) | [Вперед: Сообщения и чаты ➡️](messages.md)
