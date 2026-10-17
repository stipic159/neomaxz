import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseCliArgs, printHelp, runCli, VERSION } from '../src/cli.js';

describe('CLI Arguments Parsing', () => {
  test('parses default options with no arguments', () => {
    const opts = parseCliArgs([]);
    assert.equal(opts.command, undefined);
    assert.equal(opts.sessionPath, 'session.db');
    assert.equal(opts.showHelp, false);
    assert.equal(opts.showVersion, false);
  });

  test('parses login command with custom session flag', () => {
    const opts = parseCliArgs(['login', '--session', 'my-bot.db']);
    assert.equal(opts.command, 'login');
    assert.equal(opts.sessionPath, 'my-bot.db');
  });

  test('parses short session flag -s before command', () => {
    const opts = parseCliArgs(['-s', 'auth.sqlite', 'whoami']);
    assert.equal(opts.command, 'whoami');
    assert.equal(opts.sessionPath, 'auth.sqlite');
  });

  test('detects help flags', () => {
    assert.equal(parseCliArgs(['--help']).showHelp, true);
    assert.equal(parseCliArgs(['-h']).showHelp, true);
    assert.equal(parseCliArgs(['help']).showHelp, true);
  });

  test('detects version flags', () => {
    assert.equal(parseCliArgs(['--version']).showVersion, true);
    assert.equal(parseCliArgs(['-v']).showVersion, true);
    assert.equal(parseCliArgs(['version']).showVersion, true);
  });
});

describe('CLI Execution', () => {
  test('prints version without throwing', async () => {
    let output = '';
    const originalLog = console.log;
    console.log = (msg: string) => { output += msg; };

    try {
      await runCli(['--version']);
      assert.ok(output.includes(`neomaxz v${VERSION}`));
    } finally {
      console.log = originalLog;
    }
  });

  test('prints help without throwing', async () => {
    let output = '';
    const originalLog = console.log;
    console.log = (msg: string) => { output += msg; };

    try {
      await runCli(['--help']);
      assert.ok(output.includes('neomaxz CLI'));
      assert.ok(output.includes('Commands:'));
    } finally {
      console.log = originalLog;
    }
  });

  test('handles unknown command by reporting error and showing help', async () => {
    let errorOutput = '';
    const originalError = console.error;
    const originalLog = console.log;
    console.error = (msg: string) => { errorOutput += msg; };
    console.log = () => {};

    try {
      const code = await runCli(['unknown_command']);
      assert.equal(code, 1);
      assert.ok(errorOutput.includes('Unknown command: "unknown_command"'));
    } finally {
      console.error = originalError;
      console.log = originalLog;
    }
  });
});
