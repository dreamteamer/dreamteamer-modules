#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGoogleRequest } from '../lib/direct.mjs';
import { calendarReader } from '../lib/calendar.mjs';
export async function main(argv = process.argv.slice(2)) {
  const [command, account, ...args] = argv;
  if (!command || command === '--help') { console.log('dt-google-calendar calendars <account> | events <account> <calendar> <from> <to> [--show-deleted] [--time-zone <zone>] | event <account> <calendar> <event>'); return; }
  if (!['calendars', 'events', 'event'].includes(command)) throw new Error('Unknown calendar command.');
  let request;
  const reader = calendarReader(async (...params) => { request ??= await createGoogleRequest(account, 'calendar'); return request(...params); });
  let result;
  if (command === 'calendars') { if (args.length) throw new Error('Unexpected calendar-list arguments.'); result = await reader.calendars(); }
  else if (command === 'event') { if (args.length !== 2) throw new Error('Expected calendar and event identifiers.'); result = await reader.event(...args); }
  else {
    const options = {}; const rest = args.slice(3);
    while (rest.length) { const flag = rest.shift(); if (flag === '--show-deleted') options.showDeleted = true; else if (flag === '--time-zone' && rest.length) options.timeZone = rest.shift(); else throw new Error('Unknown or incomplete calendar option.'); }
    result = await reader.events(args[0], args[1], args[2], options);
  }
  // Let stdout drain naturally; do not truncate large event lists with process.exit().
  console.log(JSON.stringify(result));
}
const real = p => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) main().catch(error => { console.error(error.message); process.exitCode = 1; });
