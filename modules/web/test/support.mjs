// A contract fixture workspace (synthetic Northwind), a minimal app dir standing in for the built webview,
// and a request helper with a hard timeout. Every server a test starts is closed in after().
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { ENGINE_DIR } from '../../../tests/helpers/fixture.mjs';

const MODULES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { makeFixture } = await import(pathToFileURL(path.join(MODULES, 'protocol', 'lib', 'contract', 'fixture.js')).href);

export function fixture() {
	const f = makeFixture({ engineDir: ENGINE_DIR });
	// a declared variable with a folder, for the files origin
	const media = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-web-media-'));
	fs.writeFileSync(path.join(media, 'board.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
	fs.writeFileSync(path.join(media, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
	fs.writeFileSync(path.join(f.root, 'outside.txt'), 'not served');
	const pkgFile = path.join(f.root, 'package.json');
	const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
	pkg.dreamteamer.vars = [...(pkg.dreamteamer.vars ?? []), 'DT_WEB_TEST_MEDIA'];
	fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, '\t') + '\n');
	fs.writeFileSync(path.join(f.root, '.env'), `DT_WEB_TEST_MEDIA=${media}\n`);
	fs.writeFileSync(path.join(f.root, 'report.html'), '<!doctype html><p>Northwind report</p><script>alert(1)</script>');
	const app = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-web-app-'));
	fs.mkdirSync(path.join(app, 'assets'));
	fs.writeFileSync(path.join(app, 'browser.html'), '<!doctype html><html><head><title>dreamteamer</title><script type="module" src="./assets/app.js"></script></head><body><div id="app"></div></body></html>');
	fs.writeFileSync(path.join(app, 'assets', 'app.js'), 'export {};\n');
	return { ...f, media, app, cleanupAll: () => { f.cleanup(); fs.rmSync(media, { recursive: true, force: true }); fs.rmSync(app, { recursive: true, force: true }); } };
}

/** One request; `headers` override; the body parsed when it is JSON. Node's fetch sends no Origin and no
 *  Sec-Fetch-* headers unless given — a script, not a browser. */
export async function call(url, { method = 'GET', headers = {}, body, redirect = 'manual' } = {}) {
	const res = await fetch(url, { method, headers, body, redirect, signal: AbortSignal.timeout(20_000) });
	const text = await res.text();
	let json = null;
	try { json = JSON.parse(text); } catch { /* not JSON */ }
	return { status: res.status, headers: res.headers, text, json };
}

/** A raw request whose Host header is ours to set (fetch will not let a caller choose it). */
export function rawGet(url, headers) {
	return new Promise((resolve, reject) => {
		const u = new URL(url);
		const req = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: 'GET', headers, timeout: 20_000 }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
		req.on('error', reject);
		req.on('timeout', () => req.destroy(new Error('timeout')));
		req.end();
	});
}
