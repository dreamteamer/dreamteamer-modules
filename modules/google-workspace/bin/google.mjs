#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { call, READ_TOOLS } from '../lib/access.mjs';
import { doctor } from '../lib/doctor.mjs';

export async function main(argv = process.argv.slice(2)) {
  if (argv[0] === 'doctor') {
    if (argv.length > 2 || (argv[1] && argv[1] !== '--json')) throw new Error('Expected doctor [--json].');
    const report = doctor();
    console.log(argv[1] === '--json' ? JSON.stringify(report) : report.checks.map(c => `${c.state}: ${c.label}: ${c.detail}`).join('\n'));
    return report.checks.some(c => c.state === 'bad') ? 1 : 0;
  }
  if (argv.length === 0 || argv[0] === '--help') {
    console.log('dt-google call <account-email> <tool> [JSON object] [--allow-write]\nRead-only tools: ' + [...READ_TOOLS].join(', '));
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
