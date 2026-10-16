/**
 * Minimal Echo Bot example using neomaxz (Baileys style)
 * Run: npx tsx examples/echo-bot.ts
 */
import readline from 'node:readline/promises';
import { makeMaxSocket, useMultiFileAuthState } from '../src/index.js';

async function start() {
  // 1. Session persistence in local folder
  const { state, saveCreds } = await useMultiFileAuthState('./session_data');

  // 2. Initialize socket client
  const sock = makeMaxSocket({
    auth: state,
    autoReconnect: true,
  });

  // 3. Save rotated tokens and updated credentials automatically
  sock.ev.on('creds.update', saveCreds);

  // 4. Connection state updates
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'open') {
      console.log('✅ Connected to MAX messenger successfully!');
      console.log(`👤 User: ${sock.user.name ?? 'Unknown'} (ID: ${sock.user.id})`);
    } else if (connection === 'close') {
      console.log('❌ Connection closed:', lastDisconnect?.error?.message ?? 'Normal disconnect');
    }
  });

  // 5. Incoming message handler (Echo logic)
  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      // In normal chats, ignore our own messages. In "Saved Messages" (chat 0), allow self-testing!
      if (msg.fromMe && msg.chatId !== '0') continue;

      console.log(`📩 [${msg.chatId}] ${msg.senderName ?? msg.senderId ?? 'User'}: ${msg.text}`);

      try {
        if (msg.text.trim() === '!ping') {
          console.log(`Replying 🏓 pong! to [${msg.chatId}]...`);
          await sock.sendMessage(msg.chatId, {
            text: '🏓 pong!',
            replyToMessageId: msg.id, // Native reply quoting
          });
          console.log(`✅ Sent 🏓 pong! to [${msg.chatId}]`);
        } else if (msg.text.startsWith('!echo ')) {
          const replyText = msg.text.slice(6);
          console.log(`Replying "${replyText}" to [${msg.chatId}]...`);
          await sock.sendMessage(msg.chatId, {
            text: replyText,
          });
          console.log(`✅ Echoed to [${msg.chatId}]`);
        }
      } catch (err: any) {
        console.error(`❌ Failed to send message to [${msg.chatId}]:`, err.message);
      }
    }
  });

  // Debug: trace frame opcodes
  sock.rawClient.ev.on('frame.outbound', (frame) => {
    console.log(`➡️ OUT opcode: 0x${frame.opcode.toString(16)} (seq=${frame.seq})`);
  });
  sock.rawClient.ev.on('frame.inbound', (frame) => {
    console.log(`⬅️ IN opcode: 0x${frame.opcode.toString(16)} (cmd=${frame.cmd}, seq=${frame.seq})`);
  });

  // 6. Connect to MAX
  console.log('Connecting to MAX...');
  await sock.connect();

  // 7. If not logged in yet, prompt for phone and SMS code
  if (!state.creds.sessionToken) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      const phone = await rl.question('Enter phone number (+7...): ');
      console.log('Requesting SMS code...');
      await sock.requestAuthCode(phone);

      const code = await rl.question('Enter SMS verification code: ');
      try {
        const res = await sock.submitAuthCode(code);

        if (res.status === 'password_required') {
          console.log(`2FA Password required${res.hint ? ` (Hint: ${res.hint})` : ''}`);
          const password = await rl.question('Enter 2FA password: ');
          await sock.submitPassword(password);
        }

        console.log('🎉 Successfully logged in! Credentials saved.');
        console.log(`👤 Logged in as: ${sock.user.name || 'User'} (ID: ${sock.user.id})`);
        console.log('🤖 Echo bot is listening for incoming messages (!ping, !echo <text>)...');
      } catch (err: any) {
        console.error('❌ Failed to verify code:', err.message, err.payload ?? '');
      }
    } finally {
      rl.close();
    }
  } else {
    console.log(`👤 Logged in as: ${sock.user.name || 'User'} (ID: ${sock.user.id})`);
    console.log('🤖 Echo bot is listening for incoming messages (!ping, !echo <text>)...');
  }
}

start().catch(console.error);
