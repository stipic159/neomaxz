import { OPCODES } from "../protocol/opcodes.js";
import type { SocketClient } from "../socket/socket-client.js";
import { toBigIntId } from "../types/message.js";
import {
  normalizeContact,
  type MaxContact,
  type UpdateProfileOptions,
} from "../types/contact.js";

export class ContactManager {
  /**
   * Looks up a user in MAX by their phone number (e.g. +79991234567).
   */
  public async getContactByPhone(
    client: SocketClient,
    phone: string
  ): Promise<MaxContact | null> {
    const normalizedPhone = phone.startsWith('+') ? phone : `+${phone}`;

    const res = await client.query({
      opcode: OPCODES.CONTACT_INFO_BY_PHONE,
      payload: {
        phone: normalizedPhone,
      },
    });

    if (!res.payload || (!res.payload.id && !res.payload.userId && !res.payload.contact)) {
      return null;
    }

    const raw = res.payload.contact ?? res.payload;
    return normalizeContact(raw);
  }

  /**
   * Retrieves profile details for a specific user ID.
   */
  public async getUserProfile(
    client: SocketClient,
    userId: string | number | bigint
  ): Promise<MaxContact> {
    const res = await client.query({
      opcode: OPCODES.CONTACT_INFO,
      payload: {
        userId: toBigIntId(userId),
      },
    });

    const raw = res.payload?.contact ?? res.payload?.profile ?? res.payload ?? {};
    return normalizeContact(raw);
  }

  /**
   * Searches contacts within the user's address book and dialogs.
   */
  public async searchContacts(
    client: SocketClient,
    query: string
  ): Promise<MaxContact[]> {
    const res = await client.query({
      opcode: OPCODES.CONTACT_SEARCH,
      payload: {
        query,
      },
    });

    const list: any[] = Array.isArray(res.payload?.contacts)
      ? res.payload.contacts
      : Array.isArray(res.payload)
      ? res.payload
      : [];

    return list.map(normalizeContact);
  }

  /**
   * Searches the global MAX directory by name or username/nickname.
   */
  public async publicSearch(
    client: SocketClient,
    query: string
  ): Promise<MaxContact[]> {
    const res = await client.query({
      opcode: OPCODES.PUBLIC_SEARCH,
      payload: {
        query,
      },
    });

    const list: any[] = Array.isArray(res.payload?.results)
      ? res.payload.results
      : Array.isArray(res.payload?.contacts)
      ? res.payload.contacts
      : Array.isArray(res.payload)
      ? res.payload
      : [];

    return list.map(normalizeContact);
  }

  /**
   * Adds a user to the address book.
   */
  public async addContact(
    client: SocketClient,
    phone: string,
    name: { firstName: string; lastName?: string }
  ): Promise<void> {
    const normalizedPhone = phone.startsWith('+') ? phone : `+${phone}`;

    await client.query({
      opcode: OPCODES.CONTACT_ADD,
      payload: {
        phone: normalizedPhone,
        firstName: name.firstName,
        lastName: name.lastName ?? '',
      },
    });
  }

  /**
   * Updates current user's profile info (name, bio, avatar).
   */
  public async updateProfile(
    client: SocketClient,
    options: UpdateProfileOptions
  ): Promise<void> {
    const payload: Record<string, any> = {};

    if (options.firstName !== undefined) payload.firstName = options.firstName;
    if (options.lastName !== undefined) payload.lastName = options.lastName;
    if (options.bio !== undefined) payload.description = options.bio;
    if (options.avatarToken !== undefined) payload.photoToken = options.avatarToken;

    await client.query({
      opcode: OPCODES.CONTACT_UPDATE,
      payload,
    });
  }
}
