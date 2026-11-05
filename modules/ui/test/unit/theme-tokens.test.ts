/**
 * Tier 1 — A NEUTRAL TOKEN MAY NOT BE MAPPED TO AN ACCENT.
 *
 * `--dt-border-strong` was `var(--vscode-focusBorder)` from the VS Code theme bridge's first day.
 * The standalone fallback beside it is `#d3dae4`, a grey, so the source read as a border colour and
 * the running product painted a saturated brand blue — `#0078d4` in Dark Modern. Twenty-six call
 * sites consume it and every one wants a neutral: input borders, the scrollbar thumb, blockquote
 * rules, chip outlines, the table's header shadow.
 *
 * The visible cost was worst on the boolean switch, whose OFF track is this token and whose ON
 * track is `--dt-accent` — `button.background`, the same `#0078d4` in most themes. So the control
 * rendered the same colour in both states and could not be read at all. That reached a screenshot
 * ("UGLY MESS, horrible UX") before anyone traced it, because nothing here compares a token's NAME
 * against what it resolves to.
 *
 * This test is that comparison. It is deliberately about intent, not appearance: a token whose name
 * says border/bg/fg must not resolve through a VS Code variable whose name says focus or accent.
 * `--dt-focus-ring` is the one token allowed to, because that is what it is for.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const css = (f: string) => fs.readFileSync(path.join(process.cwd(), 'webview/src', f), 'utf8');

/** `--dt-x: <value>;` pairs from a token file, comments stripped. */
function declarations(text: string): Array<[string, string]> {
	const out: Array<[string, string]> = [];
	for (const m of text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--dt-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
		out.push([m[1]!, m[2]!.trim()]);
	}
	return out;
}

describe('the VS Code theme bridge', () => {
	const decls = declarations(css('vscode.css'));

	test('maps every token it declares (the fixture is real)', () => {
		assert.ok(decls.length >= 15, `expected the token bridge, saw ${decls.length} declarations`);
	});

	test('never resolves a NEUTRAL token through focusBorder — that is an accent, not a border', () => {
		// Names that promise a neutral. `--dt-focus-ring` is exempt by definition; `--dt-accent` is
		// an accent and may map to whatever the theme calls one.
		const neutral = /^--dt-(border|bg|fg)/;
		const offenders = decls
			.filter(([name]) => neutral.test(name))
			.filter(([, value]) => /focusBorder|button-background|--vscode-button/.test(value))
			.map(([name, value]) => `${name}: ${value}`);
		assert.deepEqual(offenders, [], 'a token named for a neutral must not resolve to the theme accent');
	});

	test('and a focus ring exists, so the accent has a token of its own to live in', () => {
		const names = decls.map(([n]) => n);
		assert.ok(names.includes('--dt-focus-ring'), 'declare --dt-focus-ring for the one thing focusBorder is for');
	});
});
