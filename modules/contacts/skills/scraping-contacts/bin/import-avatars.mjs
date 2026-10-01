#!/usr/bin/env node
// Import the photo URLs a browser session harvested → `assets/avatars/<id>` + `contacts.avatar`.
//
//   node import-avatars.mjs harvested.json [--dry]
//
//   harvested.json: [{ "id": "<contact id>", "photo": "https://media.licdn.com/…" | null, "note"?: "…" }]
//
// Checks the bytes, not the status: an error page can arrive as HTTP 200 and a URL can name the wrong
// type, so the image type is sniffed from the magic bytes and the extension comes from that.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The workspace root: the nearest folder carrying package-lock.json. `package.json` alone is not
// enough, because a module folder has one too.
function workspaceRoot(from = process.cwd()) {
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
const WORKSPACE = workspaceRoot(path.dirname(new URL(import.meta.url).pathname));
const MAX = 204800; // the assets collection's own max_bytes
const dry = process.argv.includes('--dry');
const file = process.argv[2];
if (!file) { console.error('usage: import-avatars.mjs <harvested.json> [--dry]\n  harvested.json: [{"id": "<contact id>", "photo": "https://media.licdn.com/…" | null, "note"?: "…"}]'); process.exit(2); }

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

// The workspace's own installed engine, run directly: a workspace need not define an npm `dt` script.
function engineBin(root) {
	const pkgPath = path.join(root, 'node_modules', 'dreamteamer', 'package.json');
	const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
	const bin = typeof pkg.bin === 'string' ? pkg.bin : (pkg.bin.dreamteamer ?? Object.values(pkg.bin)[0]);
	return path.join(path.dirname(pkgPath), bin);
}
const dt = (...args) => execFileSync(process.execPath, [engineBin(WORKSPACE), ...args], { cwd: WORKSPACE, encoding: 'utf8' });

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
if (!dry && ok) console.log(`then: npx dt check, and commit with\n  npx dt commit ${rows.filter((r) => r.photo).map((r) => `assets/avatars/${r.id} contacts/${r.id}`).slice(0, 3).join(' ')} …`);
