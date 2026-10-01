// ONE VOICE: what ships reads as a product a stranger installs, not as the notebook of the workspace
// it came from. Every file npm would put in a tarball is scanned — descriptors, skills, commands,
// views, bindings, READMEs, manifests, and the comments in shipped code. Tests and docs/ do not ship
// and are not scanned.
import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { moduleIds, pkgOf, MODULES } from './helpers/workspace.mjs';

const PROSE = /\.(md|ya?ml|json)$/;
const CODE = /\.(m?js|py|sh)$/;
const SKIP_DIRS = new Set(['node_modules', 'test', 'tests', 'docs', '__pycache__', '.venv']);

/** Every file the module's `files` list ships, plus package.json. */
function shipped(m) {
	const root = path.join(MODULES, m);
	const out = [path.join(root, 'package.json')];
	const walk = (p) => {
		if (!fs.existsSync(p)) return;
		if (fs.statSync(p).isFile()) { out.push(p); return; }
		for (const e of fs.readdirSync(p, { withFileTypes: true })) if (!SKIP_DIRS.has(e.name)) walk(path.join(p, e.name));
	};
	for (const f of pkgOf(m).files ?? []) walk(path.join(root, f));
	return out.filter((f) => PROSE.test(f) || CODE.test(f));
}

/** The lines a rule applies to: every line of prose, only the comment lines of code. */
function lines(file) {
	const all = fs.readFileSync(file, 'utf8').split('\n');
	if (PROSE.test(file)) return all.map((text, i) => ({ text, n: i + 1 }));
	return all.map((text, i) => ({ text, n: i + 1 })).filter(({ text }) => /^\s*(\/\/|\*|\/\*|#)/.test(text) || /\s\/\/\s/.test(text));
}

// Each rule names what it catches. A date is allowed only where it is DATA: an id (`2026-08-30--…`),
// a timestamp (`…T10:00`) or part of a path or example value.
const RULES = [
	['the workspace it came from', /\b(operator|vault|dogfood|the-workspace)\b/i],
	['a dated history note', /(?<![\w/'"`-])20\d\d-\d\d-\d\d(?![\w/.'"`-]|T\d)/],
	['a decision number', /\bdecisions? \d+\b/i],
	['a warning marker', /⚠/],
	['a history clause', /\bsince engine \d|\buntil 20\d\d\b|\b(?:was|were) (?:renamed|moved|deleted) on\b/i],
	['a command only one workspace has', /\bnpm run (?:--silent )?(?:dt|doctor)\b/],
	['a placeholder path', /<(?:extensions|rnd|your clone[^>]*)>/],
];

for (const m of moduleIds()) {
	describe(`module ${m} speaks in one voice`, () => {
		const files = shipped(m);
		for (const [name, re] of RULES) {
			test(`no ${name}`, () => {
				const hits = [];
				for (const f of files) for (const { text, n } of lines(f)) if (re.test(text)) hits.push(`${path.relative(MODULES, f)}:${n}  ${text.trim().slice(0, 100)}`);
				assert.deepEqual(hits, [], `${hits.length} line(s):\n  ${hits.slice(0, 25).join('\n  ')}`);
			});
		}
		test('dreamteamer.description is at most 400 characters — the orientation block renders it in every session', () => {
			const d = pkgOf(m).dreamteamer?.description ?? '';
			assert.ok(d.length <= 400, `${d.length} characters`);
		});
	});
}
