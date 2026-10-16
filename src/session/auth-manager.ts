import { OPCODES } from "../protocol/opcodes.js";
import type { SocketClient } from "../socket/socket-client.js";
import type { AuthenticationState, RuntimeAuthContext } from "./auth-state.js";
import {
  findAuthToken,
  findLongToken,
  extractPasswordChallenge,
  describeAuthError,
} from "./tokens.js";

export const DEFAULT_USER_AGENT = {
  deviceType: "DESKTOP",
  appVersion: "26.35.1",
  buildNumber: 80662,
  osVersion: "Ubuntu 24.04.4 LTS",
  locale: "ru",
  screen: "2.0x",
  timezone: "Europe/Moscow",
};

export type SubmitCodeResult =
  | { status: "ok"; sessionToken: string }
  | { status: "password_required"; trackId: string; hint?: string };

export class AuthManager {
  private runtime: RuntimeAuthContext = {};

  constructor(private state: AuthenticationState) {}

  public getRuntimeContext(): Readonly<RuntimeAuthContext> {
    return this.runtime;
  }

  /**
   * Performs the initial handshake (0x0006 INIT).
   * MAX requires INIT before accepting LOGIN or other non-auth commands.
   */
  public async initSession(
    client: SocketClient,
    userAgent = DEFAULT_USER_AGENT
  ): Promise<Record<string, any>> {
    const res = await client.query({
      opcode: OPCODES.INIT,
      payload: {
        userAgent,
        deviceId: this.state.creds.deviceId,
      },
    });

    return res.payload ?? {};
  }

  /**
   * Step 1: Requests SMS authentication code for the phone number (0x0011 START_AUTH).
   */
  public async requestAuthCode(
    client: SocketClient,
    phone: string
  ): Promise<{ authToken: string }> {
    const normalizedPhone = phone.startsWith("+") ? phone : `+${phone}`;
    this.runtime.phone = normalizedPhone;
    this.state.creds.phone = normalizedPhone;

    const res = await client.query({
      opcode: OPCODES.START_AUTH,
      payload: {
        phone: normalizedPhone,
        type: "START_AUTH",
      },
    });

    const authToken = findAuthToken(res.payload);
    if (!authToken) {
      throw new Error(
        describeAuthError(res.payload, "START_AUTH did not return an auth token")
      );
    }

    this.runtime.authToken = authToken;
    return { authToken };
  }

  /**
   * Step 2: Submits SMS verification code (0x0012 CHECK_CODE).
   * Returns either { status: 'ok', sessionToken } or { status: 'password_required', trackId, hint }.
   */
  public async submitAuthCode(
    client: SocketClient,
    code: string,
    authToken?: string
  ): Promise<SubmitCodeResult> {
    const token = authToken ?? this.runtime.authToken;
    if (!token) {
      throw new Error("Cannot submit code: No active auth token. Call requestAuthCode first.");
    }

    const res = await client.query({
      opcode: OPCODES.CHECK_CODE,
      payload: {
        token,
        verifyCode: code.trim(),
      },
    });

    // Check if 2FA password is required
    const challenge = extractPasswordChallenge(res.payload);
    if (challenge) {
      this.runtime.trackId = challenge.trackId;
      this.runtime.passwordHint = challenge.hint;
      return {
        status: "password_required",
        trackId: challenge.trackId,
        hint: challenge.hint,
      };
    }

    // Otherwise check for login token
    const loginToken = findLongToken(res.payload);
    if (loginToken) {
      this.state.creds.sessionToken = loginToken;
      client.ev.emit("creds.update", this.state.creds);
      return {
        status: "ok",
        sessionToken: loginToken,
      };
    }

    throw new Error(
      describeAuthError(
        res.payload,
        "SMS verification code was rejected. Please verify the code and phone number."
      )
    );
  }

  /**
   * Step 2b (Optional): Submits 2FA cloud password if passwordChallenge was received (0x0073 CHECK_PASSWORD).
   */
  public async submitPassword(
    client: SocketClient,
    password: string,
    trackId?: string
  ): Promise<string> {
    const tid = trackId ?? this.runtime.trackId;
    if (!tid) {
      throw new Error("Cannot submit password: No trackId found. Complete submitAuthCode first.");
    }

    const res = await client.query({
      opcode: OPCODES.CHECK_PASSWORD,
      payload: {
        trackId: tid,
        password,
      },
    });

    const loginToken = findLongToken(res.payload);
    if (!loginToken) {
      throw new Error(
        describeAuthError(res.payload, "CHECK_PASSWORD did not return a valid login token")
      );
    }

    this.state.creds.sessionToken = loginToken;
    client.ev.emit("creds.update", this.state.creds);
    return loginToken;
  }

  /**
   * Requests a QR-code for web/desktop authorization (0x0018 QR_LOGIN_START).
   */
  public async requestQrCode(
    client: SocketClient
  ): Promise<{ qr: string; trackId: string }> {
    const res = await client.query({
      opcode: OPCODES.QR_LOGIN_START,
      payload: {
        deviceId: this.state.creds.deviceId,
      },
    });

    const qr = String(res.payload?.qr ?? res.payload?.qrCode ?? res.payload?.url ?? '');
    const trackId = String(res.payload?.trackId ?? res.payload?.id ?? '');

    if (!qr) {
      throw new Error(`QR_LOGIN_START did not return a valid QR code: ${JSON.stringify(res.payload)}`);
    }

    this.runtime.trackId = trackId;
    client.ev.emit('connection.update', { qr, trackId });

    return { qr, trackId };
  }

  /**
   * Polls the server until the user scans the QR-code on their mobile app (0x0019 QR_LOGIN_CHECK).
   */
  public async pollQrStatus(
    client: SocketClient,
    trackId?: string,
    options: { timeoutMs?: number; intervalMs?: number } = {}
  ): Promise<{ sessionToken: string }> {
    const tid = trackId ?? this.runtime.trackId;
    if (!tid) {
      throw new Error("Cannot poll QR status without a valid trackId");
    }

    const timeoutMs = options.timeoutMs ?? 60000;
    const intervalMs = options.intervalMs ?? 2000;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (!client.isOpen()) {
        throw new Error("Connection closed while polling QR status");
      }

      try {
        const res = await client.query({
          opcode: OPCODES.QR_LOGIN_CHECK,
          payload: {
            trackId: tid,
          },
        });

        const loginToken = findLongToken(res.payload);
        if (loginToken) {
          this.state.creds.sessionToken = loginToken;
          client.ev.emit("creds.update", this.state.creds);
          return { sessionToken: loginToken };
        }

        const status = String(res.payload?.status ?? '').toLowerCase();
        if (status === 'expired' || status === 'canceled' || status === 'rejected') {
          throw new Error(`QR code authorization ${status}`);
        }
      } catch (err: any) {
        if (err.message?.includes('expired') || err.message?.includes('rejected')) {
          throw err;
        }
        // otherwise wait and retry
      }

      await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error(`QR code authorization timed out after ${timeoutMs}ms`);
  }

  /**
   * Step 3: Logs in with session token (0x0013 LOGIN).
   * Restores session snapshot (profile, chats, contacts) and handles token rotation.
   */
  public async loginWithToken(
    client: SocketClient,
    token?: string,
    chatsCount = 50
  ): Promise<{ sessionToken: string; profile: any; chats: any[] }> {
    const sessionToken = token ?? this.state.creds.sessionToken;
    if (!sessionToken) {
      throw new Error("No session token available to login");
    }

    // chatsCount must be <= 50, otherwise MAX server returns internal error
    const count = Math.min(Math.max(1, chatsCount), 50);

    const res = await client.query({
      opcode: OPCODES.LOGIN,
      payload: {
        token: sessionToken,
        interactive: true,
        chatsCount: count,
      },
    });

    const payload = res.payload ?? {};

    // In case server rotates token, save the new one; otherwise retain existing
    const activeToken = findLongToken(payload) ?? sessionToken;
    this.state.creds.sessionToken = activeToken;

    // Extract profile info if returned
    if (payload.profile) {
      const contact = payload.profile.contact ?? payload.profile;
      this.state.creds.userId = String(contact.id ?? payload.profile.id ?? "");
      const nameObj = Array.isArray(contact.names) ? contact.names[0] : undefined;
      this.state.creds.name =
        nameObj?.name ??
        nameObj?.firstName ??
        contact.name ??
        contact.firstName ??
        "";
    }

    client.ev.emit("creds.update", this.state.creds);

    return {
      sessionToken: activeToken,
      profile: payload.profile ?? null,
      chats: Array.isArray(payload.chats) ? payload.chats : [],
    };
  }

  /**
   * Terminates active session on MAX server and clears credentials (0x0014 LOGOUT).
   */
  public async logout(client: SocketClient): Promise<void> {
    try {
      if (client.isOpen()) {
        await client.query({
          opcode: OPCODES.LOGOUT,
          payload: {},
        });
      }
    } finally {
      this.state.creds.sessionToken = undefined;
      client.ev.emit("creds.update", this.state.creds);
      client.disconnect();
    }
  }
}
