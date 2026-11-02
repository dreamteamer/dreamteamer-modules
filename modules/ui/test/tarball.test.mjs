// The package a host installs: built, packed, and carrying the three things a host reads — the library
// (`mount` and its stylesheet) the VS Code extension bundles, and the browser page dt web serves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const UI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the build, packed: dist/lib/index.js with its types and style.css, and dist/app/index.html with its assets', { timeout: 300_000 }, () => {
	const built = spawnSync(process.execPath, ['scripts/build.mjs'], { cwd: UI, encoding: 'utf8', timeout: 240_000 });
	assert.equal(built.status, 0, `the build failed:\n${built.stdout}\n${built.stderr}`);
	const packed = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: UI, encoding: 'utf8', timeout: 60_000 });
	assert.equal(packed.status, 0, packed.stderr);
	const files = JSON.parse(packed.stdout)[0].files.map((f) => f.path);
	for (const f of ['dist/lib/index.js', 'dist/lib/index.d.ts', 'dist/lib/style.css', 'dist/app/index.html', 'src/mount.ts', 'README.md']) assert.ok(files.includes(f), `${f} is not in the tarball`);
	assert.ok(!files.some((f) => f.startsWith('test/') || f.startsWith('scripts/')), 'tests and build scripts do not ship');
	const page = fs.readFileSync(path.join(UI, 'dist', 'app', 'index.html'), 'utf8');
	const script = /<script type="module"[^>]*src="\.\/assets\/([^"]+\.js)"/.exec(page)?.[1];
	assert.ok(script && files.includes(`dist/app/assets/${script}`), 'the page loads its entry from ./assets/, and the entry ships');
	const appCss = [...page.matchAll(/href="\.\/(assets\/[^"]+\.css)"/g)].map((m) => fs.readFileSync(path.join(UI, 'dist', 'app', m[1]), 'utf8')).join('\n');
	assert.match(appCss, /--dt-unknown-color\s*:/, 'the browser page does not carry browser.css');
	assert.match(appCss, /prefers-color-scheme:\s*dark/, 'the browser page has no dark set');
	const lib = fs.readFileSync(path.join(UI, 'dist', 'lib', 'index.js'), 'utf8');
	assert.match(lib, /export\s*\{[^}]*\bmount\b/, 'the library exports mount');
	assert.match(fs.readFileSync(path.join(UI, 'dist', 'lib', 'style.css'), 'utf8'), /--dt-/, 'the stylesheet carries the tokens');
	assert.doesNotMatch(fs.readFileSync(path.join(UI, 'dist', 'lib', 'style.css'), 'utf8'), /--dt-unknown-color\s*:/, 'the library stylesheet carries no browser-only fallback (VS Code loads it)');
});
