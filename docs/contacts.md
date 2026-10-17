# 📇 Контакты и профили пользователей

> [🏠 neomaxz](../README.md) / [📚 Документация](README.md) / **Контакты и профили**

---

## Содержание
- [Обзор](#обзор)
- [Поиск пользователя по номеру телефона (`sock.getContactByPhone`)](#поиск-пользователя-по-номеру-телефона-sockgetcontactbyphone)
- [Получение публичного профиля (`sock.getUserProfile`)](#получение-публичного-профиля-sockgetuserprofile)
- [Поиск по личной адресной книге (`sock.searchContacts`)](#поиск-по-личной-адресной-книге-socksearchcontacts)
- [Глобальный публичный поиск (`sock.publicSearch`)](#глобальный-публичный-поиск-sockpublicsearch)
- [Добавление контакта (`sock.addContact`)](#добавление-контакта-sockaddcontact)
- [Обновление своего профиля (`sock.updateProfile`)](#обновление-своего-профиля-sockupdateprofile)
- [Типы данных и структуры](#типы-данных-и-структуры)
  - [`MaxContact`](#maxcontact)
  - [`UpdateProfileOptions`](#updateprofileoptions)

---

## Обзор

Модуль работы с контактами отвечает за адресную книгу, поиск аккаунтов и ботов в глобальном каталоге MAX, получение информации о пользователях и обновление данных текущего аккаунта. Все методы доступны как через фасад `sock`, так и через свойство `sock.contacts` (класс `ContactManager`).

---

## Поиск пользователя по номеру телефона (`sock.getContactByPhone`)

Проверяет регистрацию пользователя в MAX по его номеру телефона и возвращает его профиль (опкод `0x002e CONTACT_INFO_BY_PHONE`).

#### Сигнатура
```typescript
async getContactByPhone(phone: string): Promise<MaxContact | null>
```

#### Параметры
- `phone` *(строка)*: номер телефона (символ `+` в начале добавляется автоматически при отсутствии).

#### Возвращаемое значение
Возвращает объект [`MaxContact`](#maxcontact), либо `null`, если номер не зарегистрирован в мессенджере MAX.

#### Пример
```typescript
const contact = await sock.getContactByPhone('+79991234567');
if (contact) {
  console.log(`Найден пользователь: ${contact.name} (ID: ${contact.id})`);
} else {
  console.log('Пользователь не зарегистрирован в MAX');
}
```

---

## Получение публичного профиля (`sock.getUserProfile`)

Запрашивает публичные данные профиля по ID пользователя (опкод `0x0020 CONTACT_INFO`).

#### Сигнатура
```typescript
async getUserProfile(userId: string | number | bigint): Promise<MaxContact>
```

#### Пример
```typescript
const profile = await sock.getUserProfile('12345678');
console.log(`Имя: ${profile.name}`);
console.log(`Username: @${profile.username ?? 'нет'}`);
console.log(`О себе: ${profile.bio ?? 'нет'}`);
```

---

## Поиск по личной адресной книге (`sock.searchContacts`)

Выполняет поиск пользователей среди сохраненных контактов и недавних переписок (опкод `0x0025 CONTACT_SEARCH`).

#### Сигнатура
```typescript
async searchContacts(query: string): Promise<MaxContact[]>
```

#### Параметры
- `query` *(строка)*: поисковый запрос (имя, фамилия или номер телефона).

#### Пример
```typescript
const matches = await sock.searchContacts('Иван');
console.log(`Найдено в контактах: ${matches.length}`);
```

---

## Глобальный публичный поиск (`sock.publicSearch`)

Осуществляет глобальный поиск по всему каталогу мессенджера MAX среди публичных пользователей, каналов и ботов по никнейму или названию (опкод `0x002c PUBLIC_SEARCH`).

#### Сигнатура
```typescript
async publicSearch(query: string): Promise<MaxContact[]>
```

#### Параметры
- `query` *(строка)*: никнейм или ключевые слова (например, `'support_bot'`).

#### Пример
```typescript
const results = await sock.publicSearch('ai_assistant');
for (const user of results) {
  console.log(`@${user.username} — ${user.name} (Бот: ${user.isBot})`);
}
```

---

## Добавление контакта (`sock.addContact`)

Добавляет телефонный номер в личную адресную книгу MAX (опкод `0x0029 CONTACT_ADD`).

#### Сигнатура
```typescript
async addContact(
  phone: string,
  name: { firstName: string; lastName?: string }
): Promise<void>
```

#### Пример
```typescript
await sock.addContact('+79997654321', {
  firstName: 'Алексей',
  lastName: 'Техподдержка',
});
```

---

## Обновление своего профиля (`sock.updateProfile`)

Обновляет имя, фамилию, статус «О себе» (bio) или аватар авторизованного пользователя (опкод `0x0022 CONTACT_UPDATE`).

#### Сигнатура
```typescript
async updateProfile(options: UpdateProfileOptions): Promise<void>
```

#### Параметры
- `options.firstName` *(строка, опционально)*: новое имя.
- `options.lastName` *(строка, опционально)*: новая фамилия.
- `options.bio` *(строка, опционально)*: текстовое описание профиля.
- `options.avatarToken` *(строка, опционально)*: токен загруженного фото профиля (получается через `sock.media.uploadPhoto`).

#### Пример
```typescript
await sock.updateProfile({
  firstName: 'Бот-Помощник',
  bio: 'Автоматический сервис приема заявок 24/7',
});
```

---

## Типы данных и структуры

### `MaxContact`
```typescript
export interface MaxContact {
  id: string;              // Уникальный числовой ID строкой
  firstName: string;       // Имя
  lastName?: string;       // Фамилия
  name?: string;           // Полное имя (firstName + lastName)
  phone?: string;          // Номер телефона (если открыт)
  username?: string;       // Никнейм / публичный юзернейм
  bio?: string;            // Описание «О себе»
  avatarUrl?: string;      // URL аватара
  isBot?: boolean;         // Является ли ботом
  raw: Record<string, any>;// Исходные данные сервера
}
```

### `UpdateProfileOptions`
```typescript
export interface UpdateProfileOptions {
  firstName?: string;
  lastName?: string;
  bio?: string;
  avatarToken?: string;
}
```

---

[⬅️ Назад: Управление чатами](chats.md) | [Вперед: Presence и активность ➡️](presence.md)
