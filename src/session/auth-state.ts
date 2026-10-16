import crypto from 'node:crypto';

export interface AuthenticationCreds {
  deviceId: string;
  phone?: string;
  sessionToken?: string;
  userId?: string;
  name?: string;
  registeredAt?: number;
}

export interface AuthenticationState {
  creds: AuthenticationCreds;
  keys?: Record<string, any>;
}

export interface RuntimeAuthContext {
  phone?: string;
  authToken?: string;         // Temporary token from START_AUTH
  trackId?: string;           // 2FA track ID if password challenge occurred
  passwordHint?: string;      // Password hint if provided
}

export function initAuthenticationCreds(): AuthenticationCreds {
  return {
    deviceId: crypto.randomUUID(),
  };
}
