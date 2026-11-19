// THE LITERAL SCAN — "A static scan over modules/ui-legacy/src fails on any literal font-size or border-radius or hex colour
// outside the token files." Sizes, radii and colours come from tokens (styles/tokens.css, and the browser host's values
// in styles/browser.css); a literal anywhere else is a value the next fix has to hunt for, and one the VS Code host's
// theme mapping (vscode.css maps `--dt-*` tokens) cannot reach.
//
// Scanned: every `.css` file, every `.vue` file's <style> blocks and template, and the string literals of every `.ts`
// file and `.vue` script (a CodeMirror theme object, a Leaflet marker colour, a palette array are style strings too).
//
//   font-size        allowed: `inherit`, `initial`, `unset`, `0`, `var(--…)` (no literal fallback), and `calc(…)` whose
//                    operands are vars and unitless numbers
//   border-radius    the same, plus `50%` (a circle); every corner longhand too (`border-top-left-radius`, …)
//   a hex colour     never (`#abc`, `#aabbcc`, `#aabbccdd`; an HTML entity like `&#9679;` is not one)
//
// The escape hatch is a comment on the same line: `/* literal-ok: <reason> */` (or `// literal-ok: <reason>` in
// script). Keep it rare — each one is a value no token could carry, and the reason says why.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)).replace(`${path.sep}.test-build${path.sep}unit`, `${path.sep}test${path.sep}unit`), '..', '..');
const SRC = path.join(ROOT, 'src');

/** The files that DEFINE tokens and nothing else — the only places a literal size, radius or colour may be written. */
export const TOKEN_FILES = ['styles/tokens.css', 'styles/browser.css'];

export interface Finding { file: string; line: number; what: string; text: string }

const ALLOW = /literal-ok:\s*\S/;
const HEX = /(?<![&\w.#-])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})\b/gi;
const LENGTH = /(?<![\w-])\d*\.?\d+(px|rem|em|pt|pc|ch|ex|vh|vw|vmin|vmax|cm|mm|in|q|%)(?![\w-])/gi;
const SIZE_KEYWORD = /^(xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|smaller|larger)$/i;

/** Blank out comments (keeping every newline, so offsets still map to lines). `css`: only block comments. */
function blankComments(text: string, css: boolean): string {
	const re = css ? /\/\*[\s\S]*?\*\//g : /\/\*[\s\S]*?\*\/|(?<![:'"`\\])\/\/[^\n]*/g;
	return text.replace(re, (m) => m.replace(/[^\n]/g, ' '));
}

const lineAt = (text: string, offset: number) => text.slice(0, offset).split('\n').length;

/** Why a size or radius value is a literal, or null when it is token-built. */
export function literalIn(prop: 'font-size' | 'border-radius', raw: string): string | null {
	const value = raw.replace(/!important/i, '').trim();
	if (!value || /^(inherit|initial|unset|revert|0)$/i.test(value)) return null;
	if (prop === 'font-size' && SIZE_KEYWORD.test(value)) return value;
	// a var's NAME may hold digits (`--dt-space-1`); its fallback may not hold a literal
	const withoutNames = value.replace(/var\(\s*--[\w-]+/g, 'var(');
	for (const m of withoutNames.matchAll(LENGTH)) {
		const lit = m[0];
		if (/^0+(\.0+)?[a-z%]*$/i.test(lit)) continue; // zero in any unit is zero
		if (prop === 'border-radius' && lit === '50%') continue;
		return lit;
	}
	// what is left must be vars, calc, numbers and operators — a word like `small` inside is a literal too
	const words = withoutNames.replace(/var\(|calc\(|min\(|max\(|clamp\(/g, '').match(/[a-z][a-z-]*/gi) ?? [];
	const bad = words.find((w) => SIZE_KEYWORD.test(w));
	return bad ?? null;
}

/** The declarations of a CSS text: property, value and the value's offset. */
function declarations(css: string): Array<{ prop: string; value: string; at: number }> {
	const out: Array<{ prop: string; value: string; at: number }> = [];
	for (const m of css.matchAll(/[{;]\s*(-{0,2}[a-z][\w-]*)\s*:\s*([^;{}]*)/gi)) {
		const value = m[2]!;
		out.push({ prop: m[1]!.toLowerCase(), value, at: m.index! + m[0].length - value.length });
	}
	return out;
}

function scanCss(file: string, original: string, css: string, offset: number, out: Finding[]): void {
	const lines = original.split('\n');
	const push = (at: number, what: string) => {
		const line = lineAt(original, offset + at);
		if (!ALLOW.test(lines[line - 1] ?? '')) out.push({ file, line, what, text: (lines[line - 1] ?? '').trim() });
	};
	for (const d of declarations(css)) {
		const prop = d.prop === 'font-size' ? 'font-size' : /^border(-[a-z]+)*-radius$/.test(d.prop) ? 'border-radius' : null;
		const lit = prop ? literalIn(prop, d.value) : null;
		if (prop && lit) push(d.at, `${prop}: ${lit}`);
		for (const h of d.value.matchAll(HEX)) push(d.at + h.index!, `hex ${h[0]}`);
	}
}

/** Script text: hex colours in it, and a camel-case or CSS-text font size / radius with a literal value. */
function scanScript(file: string, original: string, script: string, offset: number, out: Finding[]): void {
	const lines = original.split('\n');
	const push = (at: number, what: string) => {
		const line = lineAt(original, offset + at);
		if (!ALLOW.test(lines[line - 1] ?? '')) out.push({ file, line, what, text: (lines[line - 1] ?? '').trim() });
	};
	for (const h of script.matchAll(HEX)) push(h.index!, `hex ${h[0]}`);
	for (const m of script.matchAll(/(fontSize|font-size|borderRadius|border(?:-[a-z]+)*-radius|border(?:[A-Z][a-z]+)*Radius)['"]?\s*:\s*(['"`]?)([^'"`;,}\n]+)\2/g)) {
		const prop = /font/i.test(m[1]!) ? 'font-size' : 'border-radius';
		const raw = m[3]!.trim();
		// a bare number in a style object is pixels
		const lit = /^\d*\.?\d+$/.test(raw) && Number(raw) !== 0 ? `${raw} (px)` : literalIn(prop, raw);
		if (lit) push(m.index!, `${prop}: ${lit}`);
	}
}

export function scanFile(rel: string, text: string): Finding[] {
	const out: Finding[] = [];
	if (rel.endsWith('.css')) {
		scanCss(rel, text, blankComments(text, true), 0, out);
	} else if (rel.endsWith('.vue')) {
		for (const m of text.matchAll(/(<style[^>]*>)([\s\S]*?)<\/style>/g)) scanCss(rel, text, blankComments(m[2]!, true), m.index! + m[1]!.length, out);
		for (const m of text.matchAll(/(<script[^>]*>)([\s\S]*?)<\/script>/g)) scanScript(rel, text, blankComments(m[2]!, false), m.index! + m[1]!.length, out);
		const t = /<template>([\s\S]*)<\/template>/.exec(text);
		if (t) scanScript(rel, text, t[1]!.replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ' ')), t.index! + '<template>'.length, out);
	} else if (rel.endsWith('.ts')) {
		scanScript(rel, text, blankComments(text, false), 0, out);
	}
	return out.sort((a, b) => a.line - b.line);
}

function walk(dir: string): string[] {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
}

test('the scanner flags each kind of literal and lets tokens, zero, inherit, 50% and the allow-comment through', () => {
	const css = [
		'.a { font-size: 12px; }',
		'.b { font-size: var(--dt-text); border-radius: var(--dt-radius); }',
		'.c { border-radius: 50%; font-size: inherit; border-top-left-radius: 0; }',
		'.d { border-bottom-right-radius: 10px; }',
		'.e { color: var(--x, #fff); }',
		'.f { font-size: calc(var(--dt-text) + 2px); }',
		'.g { font-size: calc(var(--dt-text) * 1.5); }',
		'.h { font-size: 0.9em; /* literal-ok: relative to the heading it sits in */ }',
		'.i { font-size: smaller; }',
		'.j { font-size: var(--vscode-font-size, 13px); }',
		'/* .k { color: #000; } a comment is not a value */',
		'.l { mask-image: linear-gradient(#000, transparent); }',
	].join('\n');
	assert.deepEqual(scanFile('x.css', css).map((f) => `${f.line} ${f.what}`), [
		'1 font-size: 12px',
		'4 border-radius: 10px',
		'5 hex #fff',
		'6 font-size: 2px',
		'9 font-size: smaller',
		'10 font-size: 13px',
		'12 hex #000',
	]);
	const vue = [
		'<template>',
		'\t<span :style="{ color: \'#888\' }">&#9679;</span>',
		'</template>',
		'<script setup lang="ts">',
		"const theme = { '.h1': { fontSize: '1.5em' }, '.code': { borderRadius: 'var(--dt-radius-xs)' } };",
		"const swatch = '#cccccc'; // literal-ok: a colour input takes only #rrggbb",
		'// a comment naming #123456 is not a value',
		'</script>',
		'<style scoped>',
		'.x { border-radius: 2px; }',
		'</style>',
	].join('\n');
	assert.deepEqual(scanFile('x.vue', vue).map((f) => `${f.line} ${f.what}`), ['2 hex #888', '5 font-size: 1.5em', '10 border-radius: 2px']);
});

test('no literal font-size, border-radius or hex colour in modules/ui-legacy/src outside the token files', () => {
	const findings: Finding[] = [];
	for (const abs of walk(SRC)) {
		const rel = path.relative(SRC, abs).split(path.sep).join('/');
		if (TOKEN_FILES.includes(rel) || !/\.(css|vue|ts)$/.test(rel)) continue;
		findings.push(...scanFile(rel, fs.readFileSync(abs, 'utf8')));
	}
	assert.deepEqual(findings.map((f) => `${f.file}:${f.line}  ${f.what}  —  ${f.text}`), [], 'a literal outside the token files: put it on a token (or, where no token can carry it, say why with /* literal-ok: <reason> */)');
});

test('the token files exist and define tokens only — every declaration in them is a custom property', () => {
	for (const rel of TOKEN_FILES) {
		const css = blankComments(fs.readFileSync(path.join(SRC, rel), 'utf8'), true);
		const props = declarations(css).map((d) => d.prop);
		assert.ok(props.length > 0, `${rel} defines nothing`);
		const other = props.filter((p) => !p.startsWith('--'));
		// browser.css also carries the reduced-motion stop for every transition (a rule about time, not a value)
		const allowed = rel === 'styles/browser.css' ? ['animation-duration', 'animation-iteration-count', 'transition-duration'] : [];
		assert.deepEqual(other.filter((p) => !allowed.includes(p)), [], `${rel} declares something other than a token`);
	}
});
