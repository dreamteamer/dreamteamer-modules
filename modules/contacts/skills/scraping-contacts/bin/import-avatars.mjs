#!/usr/bin/env node
// Import the photo URLs a browser session harvested → `assets/avatars/<id>` + `contacts.avatar`.
//
//   node import-avatars.mjs harvested.json [--dry]
//
// ⚠ CHECKS THE BYTES, NOT THE STATUS. Filling the 13 company logos taught this the hard way: two
// of seventeen fetches returned an HTML error page with HTTP 200, and one served a PNG named
// `.svg`. So the mime type is sniffed from the magic bytes and the extension comes from THAT,
// never from the URL.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The vault root, found by walking up to the folder carrying package-lock.json — never hard-coded.
// Scripts that hard-code a vault path break silently the day the vault moves. `package.json` alone is
// not enough: a module folder has one too — and a clone under `git_modules/` is never the vault either.
function vaultRoot(from = process.cwd()) {
	let dir = path.resolve(from);
	for (;;) {
		// a folder sitting directly inside `git_modules/` is a module clone, never the workspace, even when `npm install` left it a lockfile
		const inGitModules = path.basename(path.dirname(dir)) === 'git_modules';
		if (!inGitModules && fs.existsSync(path.join(dir, 'package-lock.json'))) return dir;
		const up = path.dirname(dir);
		if (up === dir) throw new Error('not inside a dreamteamer workspace (no package-lock.json above ' + from + ')');
		dir = up;
	}
}
const VAULT = vaultRoot(path.dirname(new URL(import.meta.url).pathname));
const MAX = 204800; // the assets collection's own max_bytes
const dry = process.argv.includes('--dry');
const file = process.argv[2];
if (!file) { console.error('usage: import-avatars.mjs <harvested.json> [--dry]'); process.exit(2); }

/** Magic-byte sniff → extension, or null when these bytes are not an image we accept. */
function extOf(buf) {
	if (buf.length < 12) return null;
	const hex = buf.subarray(0, 12).toString('hex');
	if (hex.startsWith('89504e47')) return 'png';
	if (hex.startsWith('ffd8ff')) return 'jpg';
	if (hex.startsWith('47494638')) return 'gif';
	if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
	const head = buf.subarray(0, 400).toString('utf8').trimStart().toLowerCase();
	if (head.startsWith('<svg') || head.startsWith('<?xml')) return 'svg';
	return null; // an HTML error page lands here, which is the whole point
}

const dt = (...args) => execFileSync('npm', ['run', '--silent', 'dt', '--', ...args], { cwd: VAULT, encoding: 'utf8' });

const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'avatars-'));
let ok = 0, skipped = 0, failed = 0;

for (const row of rows) {
	const { id, photo } = row ?? {};
	if (!id) { console.log(`✖ entry with no id: ${JSON.stringify(row)}`); failed++; continue; }
	if (!photo) { console.log(`· ${id}: no photo${row.note ? ` (${row.note})` : ''}`); skipped++; continue; }
	if (!/^https:\/\/media\.licdn\.com\//.test(photo)) {
		console.log(`✖ ${id}: not a media.licdn.com URL — a ghost avatar or the wrong link`); failed++; continue;
	}
	let buf;
	try {
		const res = await fetch(photo);
		if (!res.ok) { console.log(`✖ ${id}: HTTP ${res.status}`); failed++; continue; }
		buf = Buffer.from(await res.arrayBuffer());
	} catch (e) { console.log(`✖ ${id}: ${e.message}`); failed++; continue; }

	const ext = extOf(buf);
	if (!ext) { console.log(`✖ ${id}: ${buf.length} bytes that are not an image (an error page?)`); failed++; continue; }
	if (buf.length > MAX) { console.log(`✖ ${id}: ${buf.length} bytes, over max_bytes ${MAX}`); failed++; continue; }

	const out = path.join(tmp, `${id.replace(/\//g, '_')}.${ext}`);
	fs.writeFileSync(out, buf);
	if (dry) { console.log(`· ${id}: would import ${buf.length} bytes (.${ext})`); ok++; continue; }
	try {
		dt('add', 'assets', `avatars/${id}`, '--from', out, '--force');
		dt('set', `contacts/${id}`, `avatar=assets/avatars/${id}`);
		console.log(`✔ ${id}: ${buf.length} bytes (.${ext})`);
		ok++;
	} catch (e) { console.log(`✖ ${id}: ${String(e.stderr ?? e.message).trim().split('\n')[0]}`); failed++; }
}

console.log(`\n${ok} imported · ${skipped} had no photo · ${failed} failed`);
if (!dry && ok) console.log(`then: npm run check, and commit with\n  dt commit ${rows.filter((r) => r.photo).map((r) => `assets/avatars/${r.id} contacts/${r.id}`).slice(0, 3).join(' ')} …`);
