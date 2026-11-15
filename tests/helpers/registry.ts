// A THROWAWAY NPM REGISTRY over packed tarballs — so a test can watch `npm install` decide a version
// floor with the semantics a workspace actually gets from `npm install @dreamteamer/<id>@^x`.
//
// ⚠ WHY NOT `file:` TARBALLS. Measured 2026-10-31 on npm 11.7.0: under a `file:` spec npm overrides an
// OPTIONAL peer with `npm warn ERESOLVE overriding peer dependency`, REMOVES the conflicting package
// from node_modules and exits 0 — while the same floor under a registry spec is refused, ERESOLVE,
// exit 1, nothing changed. Only a registry shows what a person installing from npm sees.
//
// Nothing here leaves the machine: the server binds 127.0.0.1 on a free port, every package npm asks
// for must be one of the tarballs (anything else is a 404), and each install gets its own cache.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';

/** Serve `tarballs` as a registry. Resolves to `{ url, close() }`. */
export async function serveRegistry(tarballs) {
	const files = new Map(); // tarball file name -> bytes
	const versions = new Map(); // package name -> { version -> manifest }
	for (const file of tarballs) {
		const manifest = JSON.parse(execFileSync('tar', ['-xOzf', file, 'package/package.json'], { encoding: 'utf8' }));
		const bytes = fs.readFileSync(file);
		const name = `${manifest.name.replace('/', '-').replace(/^@/, '')}-${manifest.version}.tgz`;
		files.set(name, bytes);
		if (!versions.has(manifest.name)) versions.set(manifest.name, {});
		versions.get(manifest.name)[manifest.version] = { manifest, name, bytes };
	}
	const server = http.createServer((req, res) => {
		const at = decodeURIComponent(req.url.split('?')[0]);
		if (at.startsWith('/-/')) {
			const bytes = files.get(at.slice(3));
			res.writeHead(bytes ? 200 : 404, { 'content-type': 'application/octet-stream' });
			return res.end(bytes ?? '');
		}
		const pkg = versions.get(at.slice(1));
		if (!pkg) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{"error":"not found"}'); }
		const base = `http://${req.headers.host}/-/`;
		const all = Object.keys(pkg).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
		const packument = {
			name: at.slice(1),
			'dist-tags': { latest: all.at(-1) },
			versions: Object.fromEntries(all.map((v) => {
				const { manifest, name, bytes } = pkg[v];
				const dist = { tarball: base + name, shasum: createHash('sha1').update(bytes).digest('hex'), integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` };
				return [v, { ...manifest, dist }];
			})),
		};
		res.writeHead(200, { 'content-type': 'application/json' });
		res.end(JSON.stringify(packument));
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	return { url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise((resolve) => server.close(resolve)) };
}

/** `npm install <args>` in `cwd` against `registry`, with a cache of its own. ASYNC on purpose: the
 *  registry is served from this process, and a synchronous spawn would block the loop that answers it.
 *  The parent's `npm_*` environment is dropped — under `npm test` it names THIS repo as the prefix,
 *  and an install that inherited it could write here instead of in `cwd`. */
export function npmInstall(cwd, args, registry) {
	const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'dtm-npm-cache-'));
	const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^npm_/i.test(k)));
	const argv = ['install', '--no-audit', '--no-fund', '--no-update-notifier', `--registry=${registry}`, `--@dreamteamer:registry=${registry}`, `--cache=${cache}`, ...args];
	return new Promise((resolve) => {
		execFile('npm', argv, { cwd, env, encoding: 'utf8', timeout: 120_000 }, (err, stdout, stderr) => {
			fs.rmSync(cache, { recursive: true, force: true });
			resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: `${stdout}\n${stderr}` });
		});
	});
}

/** The version npm left in `cwd`'s node_modules for a package, or null when it is not there. */
export const installedVersion = (cwd, name) => {
	try { return JSON.parse(fs.readFileSync(path.join(cwd, 'node_modules', name, 'package.json'), 'utf8')).version; } catch { return null; }
};
