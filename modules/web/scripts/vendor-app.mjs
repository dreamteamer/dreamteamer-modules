#!/usr/bin/env node
// Put the built app into dist/app/. Two ways, and neither writes the pin:
//   --from <dir>     a local build of the extension's webview (development only; never published)
//   --version <v>    the PUBLISHED extension package of that version from Open VSX, checked against the
//                    sha256 dist/app/SOURCE.json records (copied from the extension's own release, by hand)
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'app');
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
const from = arg('from');
const version = arg('version');
const keep = path.join(DIST, 'SOURCE.json');
const source = fs.existsSync(keep) ? fs.readFileSync(keep, 'utf8') : null;

function install(dir) {
	if (!fs.existsSync(path.join(dir, 'browser.html'))) throw new Error(`${dir} has no browser.html — not a webview build that carries the browser page`);
	fs.rmSync(DIST, { recursive: true, force: true });
	fs.cpSync(dir, DIST, { recursive: true });
	if (source) fs.writeFileSync(keep, source);
}

if (from) {
	install(path.resolve(from));
	console.log(`✔ dist/app from ${from} (development; not for publishing)`);
} else if (version) {
	const pin = JSON.parse(source ?? '{}');
	if (pin.version !== version || !/^[0-9a-f]{64}$/.test(pin.sha256 ?? '')) throw new Error(`dist/app/SOURCE.json pins no sha256 for ${version} — copy it from the extension's release first`);
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-web-vendor-'));
	const vsix = path.join(tmp, 'ext.vsix');
	const res = await fetch(pin.url, { signal: AbortSignal.timeout(120_000) });
	if (!res.ok) throw new Error(`${pin.url} answered ${res.status}`);
	fs.writeFileSync(vsix, Buffer.from(await res.arrayBuffer()));
	const got = crypto.createHash('sha256').update(fs.readFileSync(vsix)).digest('hex');
	if (got !== pin.sha256) throw new Error(`sha256 mismatch for ${version}: SOURCE.json ${pin.sha256}, downloaded ${got}`);
	execFileSync('unzip', ['-q', vsix, 'extension/dist/webview/*', '-d', tmp], { timeout: 120_000 });
	install(path.join(tmp, 'extension', 'dist', 'webview'));
	fs.rmSync(tmp, { recursive: true, force: true });
	console.log(`✔ dist/app from ${pin.url} (sha256 ${got.slice(0, 12)}…)`);
} else {
	console.error('usage: vendor-app.mjs --from <webview build dir> | --version <extension version>');
	process.exit(2);
}
