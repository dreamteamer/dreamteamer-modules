import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { messageCoordinator } from '../src/message.mjs';

async function sender(t, body) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dt-relay-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const executable = path.join(dir, 'sender');
  await fs.writeFile(executable, `#!${process.execPath}\n${body}`, { mode: 0o700 });
  return { executable, workspace: dir, coordinator: 'test-editor', text: 'Show the board', timeout: 10000 };
}

test('relay keeps its inbox alive after delivery until the completion reply', async t => {
  const options = await sender(t, `
    process.stdin.once('data', () => {
      console.log(JSON.stringify({type:'result',result:'DELIVERY_PENDING'}));
      setTimeout(() => console.log(JSON.stringify({type:'result',result:'Board opened. REPLY_RECEIVED'})), 100);
    });
    process.stdin.on('end', () => process.exit(1));
  `);
  await messageCoordinator(options);
});

test('delivery without a completion reply is reported as a timeout', async t => {
  const options = await sender(t, `
    process.stdin.once('data', () => console.log(JSON.stringify({type:'result',result:'DELIVERY_PENDING'})));
    process.stdin.resume();
  `);
  await assert.rejects(messageCoordinator({ ...options, timeout: 5000 }), /no coordinator reply/);
});
