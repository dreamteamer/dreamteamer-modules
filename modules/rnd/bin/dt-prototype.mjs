#!/usr/bin/env node
// dt-prototype — the prototype harness's tools, run from the prototype's folder (the one holding
// harness.config.mjs). The browser half is vendored into the prototype; these run from the installed package.
//
//   npx dt-prototype init                         vendor the browser half and write a skeleton harness.config.mjs
//   npx dt-prototype vendor [--force]             copy the browser half into <public>/harness/, stamped
//   npx dt-prototype export [--check] [--strict]  rnd records → <data>/journeys.js and <data>/meta.js
//   npx dt-prototype check [--json] [--apply] [--strict]   the screen registry against rnd/screens; the stamps
//   npx dt-prototype play [--only k,k] [--jobs n] [--port n]   every journey in headless Chromium
//   npx dt-prototype shoot [--only k,k] [--portal p] [--out dir]   one screenshot per registered screen
//   npx dt-prototype walk [--only k,k]            every screen with the layer off, against the forbidden words
//   … [--dir <prototype folder>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const USAGE = 'usage: dt-prototype <init|vendor|export|check|play|shoot|walk> [flags] [--dir <prototype>]';
const VERBS = {
	init: ['vendor', (m, dir, f, io) => m.run(dir, { init: true, force: f.force, ...io })],
	vendor: ['vendor', (m, dir, f, io) => m.run(dir, { force: f.force, ...io })],
	export: ['export', (m, dir, f, io) => m.run(dir, { check: f.check, strict: f.strict, ...io })],
	check: ['check', (m, dir, f, io) => m.run(dir, { json: f.json, apply: f.apply, strict: f.strict, ...io })],
	play: ['play', (m, dir, f, io) => m.run(dir, { ...f, ...io })],
	shoot: ['shoot', (m, dir, f, io) => m.run(dir, { ...f, ...io })],
	walk: ['walk', (m, dir, f, io) => m.run(dir, { ...f, ...io })],
};

export function parse(argv) {
	const [verb, ...rest] = argv;
	const f = { dir: process.cwd() };
	while (rest.length) {
		const a = rest.shift();
		if (!a.startsWith('--')) return { error: `unexpected argument: ${a}` };
		const k = a.slice(2);
		if (['force', 'check', 'strict', 'json', 'apply'].includes(k)) f[k] = true;
		else if (['dir', 'only', 'jobs', 'port', 'portal', 'out'].includes(k)) { const v = rest.shift(); if (v == null) return { error: `--${k} needs a value` }; f[k] = v; }
		else return { error: `unknown flag: ${a}` };
	}
	if (f.only) f.only = f.only.split(',').map((s) => s.trim()).filter(Boolean);
	for (const k of ['jobs', 'port']) if (f[k] != null) f[k] = Number(f[k]);
	return { verb, flags: f };
}

export async function main(argv, { log = console.log, error = console.error } = {}) {
	const { verb, flags, error: bad } = parse(argv);
	if (bad || !VERBS[verb]) { error(`${USAGE}${bad ? `\n${bad}` : verb ? `\nunknown verb: ${verb}` : ''}`); return 2; }
	const [file, call] = VERBS[verb];
	const mod = await import(new URL(`../lib/prototype/node/${file}.mjs`, import.meta.url).href);
	try { return await call(mod, path.resolve(flags.dir), flags, { log, error }); } catch (e) { error(e.message); return 1; }
}

const isMain = () => {
	if (!process.argv[1]) return false;
	const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
	return real(process.argv[1]) === real(fileURLToPath(import.meta.url));
};
// exit explicitly: a static server or a browser a failed run left behind must not keep the process alive
if (isMain()) process.exit(await main(process.argv.slice(2)));
