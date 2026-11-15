#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGoogleRequest } from '../lib/direct.mjs';
import { createDrive } from '../lib/drive.mjs';

export async function main(argv = process.argv.slice(2), { requestFactory = createGoogleRequest, output = value => console.log(value) } = {}) {
  if (!argv.length || argv[0] === '--help') {
    console.log('dt-google-drive <ls|exists|read|write|trash|rm|mv|rename|cp|check-mount|tier> <ref-or-local> [target] --as <account> [--apply] [--permanent] [--delete-local] [--layout flat|year-month]\nMutations default to dry-run. read requires an explicit absolute destination. Flags do not replace user approval.');
    return 0;
  }
  const positional = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--') && Object.hasOwn(flags, a)) throw new Error('Repeated flag.');
    if (['--as', '--layout'].includes(a)) { if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('Flag requires a value.'); flags[a] = argv[++i]; }
    else if (['--apply', '--permanent', '--delete-local', '--dry-run'].includes(a)) flags[a] = true;
    else if (a.startsWith('--')) throw new Error('Unknown flag.');
    else positional.push(a);
  }
  if (flags['--apply'] && flags['--dry-run']) throw new Error('Choose apply or dry-run, not both.');
  if (!flags['--as']) throw new Error('An explicit --as account is required.');
  const [verb, ref, target] = positional;
  if (!['ls', 'exists', 'read', 'write', 'trash', 'rm', 'mv', 'rename', 'cp', 'check-mount', 'tier'].includes(verb)) throw new Error('Unknown Drive command.');
  const requiresTarget = ['read', 'write', 'mv', 'rename', 'cp', 'check-mount', 'tier'].includes(verb);
  if (!ref || positional.length !== (requiresTarget ? 3 : 2)) throw new Error('Unexpected positional arguments.');
  if (flags['--permanent'] && verb !== 'rm') throw new Error('--permanent is only valid for rm.');
  if ((flags['--delete-local'] || flags['--layout']) && verb !== 'tier') throw new Error('Tier flags are only valid for tier.');
  if (verb === 'rm' && !flags['--permanent']) throw new Error('Permanent removal requires --permanent; prefer trash.');
  if (['read', 'write', 'mv', 'rename', 'cp', 'check-mount', 'tier'].includes(verb) && !target) throw new Error('This command requires a target.');
  let request;
  const drive = createDrive(async (...args) => {
    request ??= Promise.resolve(requestFactory(flags['--as'], 'drive'));
    return (await request)(...args);
  });
  const opts = { apply: !!flags['--apply'], permanent: !!flags['--permanent'], deleteLocal: !!flags['--delete-local'], layout: flags['--layout'] ?? 'year-month' };
  let result;
  if (verb === 'ls') result = await drive.list(ref);
  else if (verb === 'exists') result = await drive.exists(ref);
  else if (verb === 'read') result = await drive.read(ref, target);
  else if (verb === 'write') result = await drive.write(ref, target, opts);
  else if (verb === 'cp') result = await drive.copy(ref, target, opts);
  else if (verb === 'check-mount') result = await drive.checkMount(ref, target);
  else if (verb === 'tier') result = await drive.tier(ref, target, opts);
  else result = await drive.mutate(verb, ref, target, opts);
  output(JSON.stringify(result));
  return (verb === 'check-mount' && !result.matches) || (verb === 'tier' && result.failed > 0) || (verb === 'write' && opts.apply && result.content_verified !== true) ? 1 : 0;
}
const real = p => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) {
  main().then(code => { process.exitCode = code; }).catch(error => { if (error.partialResults) console.log(JSON.stringify({ incomplete: true, results: error.partialResults })); console.error(error.message); process.exitCode = 1; });
}
