#!/usr/bin/env node

import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import qrcode from 'qrcode-terminal';
import { useSqliteAuthState } from './session/sqlite-auth.js';
import { makeMaxSocket } from './client.js';

export const VERSION = '0.5.1';

export interface CliOptions {
  command?: string;
  sessionPath: string;
  showHelp: boolean;
  showVersion: boolean;
}

export function parseCliArgs(argv: string[]): CliOptions {
  let command: string | undefined;
  let sessionPath = 'session.db';
  let showHelp = false;
  let showVersion = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h' || arg === 'help') {
      showHelp = true;
    } else if (arg === '--version' || arg === '-v' || arg === 'version') {
      showVersion = true;
    } else if (arg === '--session' || arg === '-s') {
      if (i + 1 < argv.length) {
        sessionPath = argv[++i];
      }
    } else if (!arg.startsWith('-') && !command) {
      command = arg;
    }
  }

  return { command, sessionPath, showHelp, showVersion };
}

export function printHelp(): void {
  console.log(`
neomaxz CLI - MAX Messenger Headless Client v${VERSION}

Usage:
  neomaxz <command> [options]

Commands:
  login       Log in via QR code or SMS and store credentials
  whoami      Check current session and account details

Options:
  -s, --session <path>   Path to SQLite session database (default: session.db)
  -h, --help             Show help
  -v, --version          Show version
`);
}

export async function handleLogin(dbPath: string): Promise<void> {
  console.log(`\n[neomaxz] Using session database: ${dbPath}`);
  const { state, saveCreds, close } = await useSqliteAuthState(dbPath);

  const rl = readline.createInterface({ input, output });

  try {
    console.log('\nChoose login method:');
    console.log('  1) QR Code (Scan with MAX mobile app)');
    console.log('  2) Phone Number (SMS verification + 2FA)');

    const choice = (await rl.question('\nSelect [1/2] (default: 1): ')).trim();

    const sock = makeMaxSocket({ auth: state });
    sock.ev.on('creds.update', () => {
      saveCreds().catch(() => {});
    });

    console.log('\nConnecting to MAX servers...');
    await sock.connect();

    if (choice === '2') {
      const phone = (await rl.question('Enter phone number (e.g. +79991234567): ')).trim();
      if (!phone) {
        throw new Error('Phone number is required');
      }
      console.log(`Requesting SMS code for ${phone}...`);
      await sock.requestAuthCode(phone);

      const code = (await rl.question('Enter SMS verification code: ')).trim();
      const res = await sock.submitAuthCode(code);

      if (res.status === 'password_required') {
        const password = (await rl.question('Enter 2FA password: ')).trim();
        await sock.submitPassword(password);
      }
    } else {
      console.log('Requesting QR code...');
      const { qr, trackId } = await sock.requestQrCode();

      console.log('\nScan this QR code in MAX messenger on your phone:');
      console.log('(Settings -> Linked Devices / Web)\n');
      qrcode.generate(qr, { small: true });

      console.log('\nWaiting for confirmation in app...');
      await sock.pollQrStatus(trackId);
    }

    await saveCreds();
    const user = sock.user;
    console.log(`\nSuccessfully logged in!`);
    if (user.id) console.log(`  User ID: ${user.id}`);
    if (user.name) console.log(`  Name:    ${user.name}`);
    if (user.phone) console.log(`  Phone:   ${user.phone}`);
    console.log(`\nSession saved to "${dbPath}". You can now use this session in your bot!`);
    sock.end();
  } finally {
    rl.close();
    close();
  }
}

export async function handleWhoami(dbPath: string): Promise<void> {
  console.log(`\n[neomaxz] Checking session database: ${dbPath}`);
  const { state, close } = await useSqliteAuthState(dbPath);

  if (!state.creds.sessionToken) {
    close();
    console.error(`\nNo active session found in "${dbPath}".`);
    console.error(`Run "npx neomaxz login" to log in first.\n`);
    throw new Error('No active session');
  }

  try {
    const sock = makeMaxSocket({ auth: state });
    console.log('Connecting to MAX to verify session...');
    const loginRes = await sock.connect();

    const user = sock.user;
    console.log('\nSession is active:');
    console.log(`  User ID:  ${user.id ?? 'Unknown'}`);
    console.log(`  Name:     ${user.name ?? 'Unknown'}`);
    console.log(`  Phone:    ${user.phone ?? 'Unknown'}`);
    if (loginRes?.profile?.username) {
      console.log(`  Username: @${loginRes.profile.username}`);
    }
    console.log(`  Database: ${dbPath}\n`);
    sock.end();
  } finally {
    close();
  }
}


export async function runCli(argv = process.argv.slice(2)): Promise<number> {
  const options = parseCliArgs(argv);

  if (options.showVersion) {
    console.log(`neomaxz v${VERSION}`);
    return 0;
  }

  if (options.showHelp || !options.command) {
    printHelp();
    return 0;
  }

  switch (options.command) {
    case 'login':
      await handleLogin(options.sessionPath);
      return 0;
    case 'whoami':
      await handleWhoami(options.sessionPath);
      return 0;
    default:
      console.error(`Unknown command: "${options.command}".`);
      printHelp();
      return 1;
  }
}

// Auto-run if executed directly as script/binary
function isRunningDirectly(): boolean {
  if (!process.argv[1]) return false;
  const script = process.argv[1].replace(/\\/g, '/').toLowerCase();
  return (
    (script.endsWith('/cli.ts') || script.endsWith('/cli.js') || script.endsWith('/neomaxz')) &&
    !script.includes('.test.')
  );
}

if (isRunningDirectly()) {
  runCli().then((code) => {
    if (code !== 0) {
      process.exit(code);
    }
  }).catch((err) => {
    console.error('Error:', err?.message ?? err);
    process.exit(1);
  });
}
