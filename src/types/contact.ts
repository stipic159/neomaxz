export interface MaxContact {
  id: string;
  firstName: string;
  lastName?: string;
  name?: string;
  phone?: string;
  username?: string;
  bio?: string;
  avatarUrl?: string;
  isBot?: boolean;
  raw: Record<string, any>;
}

export interface UpdateProfileOptions {
  firstName?: string;
  lastName?: string;
  bio?: string;
  avatarToken?: string;
}

export function normalizeContact(raw: Record<string, any>): MaxContact {
  const id = String(raw.id ?? raw.userId ?? raw.contactId ?? '');
  const firstName = String(raw.firstName ?? raw.name ?? 'User');
  const lastName = raw.lastName ? String(raw.lastName) : undefined;
  const fullName = lastName ? `${firstName} ${lastName}` : firstName;

  return {
    id,
    firstName,
    lastName,
    name: fullName,
    phone: raw.phone ? String(raw.phone) : undefined,
    username: raw.username ?? raw.nick ?? raw.alias ?? undefined,
    bio: raw.bio ?? raw.description ?? raw.about ?? undefined,
    avatarUrl: raw.avatarUrl ?? raw.photoUrl ?? raw.icon ?? undefined,
    isBot: Boolean(raw.isBot ?? raw.bot ?? false),
    raw,
  };
}
