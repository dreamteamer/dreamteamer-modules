#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { call, READ_TOOLS, listTools } from '../lib/access.mjs';
import { doctor } from '../lib/doctor.mjs';
import { authorize, storedAccounts } from '../lib/auth.mjs';

export async function main(argv = process.argv.slice(2)) {
  if (argv[0] === 'tools') {
    if (argv.length > 2 || (argv[1] && argv[1] !== '--allow-write')) throw new Error('Expected tools [--allow-write].');
    console.log(JSON.stringify(await listTools({ allowWrite: argv[1] === '--allow-write' }))); return 0;
  }
  if (argv[0] === 'whoami') {
    if (argv.length !== 1) throw new Error('Expected whoami with no arguments.');
    console.log(JSON.stringify({ accounts: storedAccounts() })); return 0;
  }
  if (argv[0] === 'auth') {
    if (argv.length < 2 || argv.length > 3 || (argv[2] && argv[2] !== '--allow-write')) throw new Error('Expected auth <account> [--allow-write].');
    const controller = new AbortController();
    const cancel = () => controller.abort();
    process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
    try {
      const result = await authorize({ account: argv[1], allowWrite: argv[2] === '--allow-write', signal: controller.signal, onConsentUrl: url => {
        console.error('Open this Google URL yourself, verify the selected account and requested scopes, and keep this process running:');
        console.error(url);
      } });
      console.log(JSON.stringify(result)); return 0;
    } finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
  }
  if (argv[0] === 'doctor') {
    if (argv.length > 2 || (argv[1] && argv[1] !== '--json')) throw new Error('Expected doctor [--json].');
    const report = doctor();
    console.log(argv[1] === '--json' ? JSON.stringify(report) : report.checks.map(c => `${c.state}: ${c.label}: ${c.detail}`).join('\n'));
    return report.checks.some(c => c.state === 'bad') ? 1 : 0;
  }
  if (argv.length === 0 || argv[0] === '--help') {
    console.log('dt-google call <account-email> <tool> [JSON object] [--allow-write]\nOther commands: tools [--allow-write] | whoami | auth <account> [--allow-write] | doctor [--json]\nRead-only tools: ' + [...READ_TOOLS].join(', '));
    return 0;
  }
  if (argv[0] !== 'call') throw new Error('Expected call. Use --help for usage.');
  const allowWrite = argv.at(-1) === '--allow-write';
  const positional = allowWrite ? argv.slice(0, -1) : argv;
  if (positional.length < 3 || positional.length > 4) throw new Error('Expected account, tool and optional JSON object.');
  let args; try { args = JSON.parse(positional[3] ?? '{}'); } catch { throw new Error('Arguments are not valid JSON.'); }
  const result = await call({ account: positional[1], tool: positional[2], args, allowWrite });
  console.log(JSON.stringify(result));
  return 0;
}
const real = p => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) {
  main().then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
