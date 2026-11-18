// Tier 1 — theme colour ids render in a browser without changing VS Code (cr-modules-005, D15).
// A colour id (`charts.blue`) becomes `var(--vscode-charts-blue, var(--dt-color-charts-blue,
// var(--dt-unknown-color)))`: inside VS Code the first term resolves exactly as before, and
// `--dt-unknown-color` is defined ONLY by styles/browser.css (never loaded in VS Code), so an id VS Code
// does not define still renders as no colour there. ONE builder (`themeColor`) makes every such value: a
// template-built `var(--vscode-${…}` anywhere else in the webview fails the scan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { themeColor } from '../../src/lib/collection-display';
import { sourceColor } from '../../src/lib/sources';

const SRC = path.join(process.cwd(), 'src');
const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : /\.(ts|vue|css)$/.test(e.name) ? [path.join(dir, e.name)] : []));
const CHARTS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'foreground', 'lines'].map((c) => `charts.${c}`);
const ANSI = ['Black', 'Red', 'Green', 'Yellow', 'Blue', 'Magenta', 'Cyan', 'White'].flatMap((c) => [`terminal.ansi${c}`, `terminal.ansiBright${c}`]);

test('themeColor ends in a fallback only the browser stylesheet defines', () => {
	assert.equal(themeColor('charts.blue'), 'var(--vscode-charts-blue, var(--dt-color-charts-blue, var(--dt-unknown-color)))');
	assert.match(sourceColor('northwind-archive'), /^var\(--vscode-charts-[a-z]+, var\(--dt-color-charts-[a-z]+, var\(--dt-unknown-color\)\)\)$/);
});

test('no template-built --vscode- colour outside themeColor', () => {
	const offenders = files(SRC).flatMap((f) => fs.readFileSync(f, 'utf8').split('\n').map((l, i) => ({ f, i, l })))
		.filter(({ f, l }) => /var\(--vscode-\$\{/.test(l) && !f.endsWith(path.join('lib', 'collection-display.ts')))
		.map(({ f, i }) => `${path.relative(SRC, f)}:${i + 1}`);
	assert.deepEqual(offenders, []);
});

test('no literal --vscode- variable without a fallback outside vscode.css', () => {
	const offenders = files(SRC).filter((f) => !f.endsWith('vscode.css')).flatMap((f) => fs.readFileSync(f, 'utf8').split('\n').map((l, i) => ({ f, i, l })))
		.flatMap(({ f, i, l }) => [...l.matchAll(/var\((--vscode-[A-Za-z0-9-]+)\s*\)/g)].map((m) => `${path.relative(SRC, f)}:${i + 1} ${m[1]}`));
	assert.deepEqual(offenders, []);
});

test('browser.css defines every chart and ANSI colour, light and dark, and --dt-unknown-color; the dark token set is browser-only', () => {
	const css = fs.readFileSync(path.join(SRC, 'styles', 'browser.css'), 'utf8');
	const [light, dark] = css.split(/@media\s*\(prefers-color-scheme:\s*dark\)/);
	assert.ok(dark, 'browser.css has no dark block');
	for (const id of [...CHARTS, ...ANSI]) {
		const v = `--dt-color-${id.replace(/\./g, '-')}:`;
		assert.ok(light.includes(v), `light lacks ${v}`);
		assert.ok(dark.includes(v), `dark lacks ${v}`);
	}
	assert.ok(light.includes('--dt-unknown-color:'), 'no --dt-unknown-color');
	assert.match(css, /--dt-bg:\s*#/, 'browser.css carries no dark token set');
	assert.doesNotMatch(fs.readFileSync(path.join(SRC, 'styles', 'tokens.css'), 'utf8'), /prefers-color-scheme/, 'tokens.css (loaded in VS Code) changes with the OS scheme');
	for (const lib of ['index.ts', 'mount.ts']) assert.ok(!fs.readFileSync(path.join(SRC, lib), 'utf8').includes('browser.css'), `the library (${lib}), which a VS Code host bundles, loads browser.css`);
});
