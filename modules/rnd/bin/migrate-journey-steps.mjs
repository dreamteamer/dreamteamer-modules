#!/usr/bin/env node
// migrate-journey-steps — move a journey's ORDER into `rnd/user-journeys.steps`, the one place rnd keeps it.
// Before rnd 0.5.0 a flow was spelled on its stories: `rnd/user-stories.journey` (the journey's key) plus
// `step` (the position). This script writes that order onto each journey as `steps` and clears the two
// legacy fields, so the order lives once.
//
//   node node_modules/@dreamteamer/rnd/bin/migrate-journey-steps.mjs --dry-run   # the plan, nothing written
//   node node_modules/@dreamteamer/rnd/bin/migrate-journey-steps.mjs --write     # apply it
//   … [--root <workspace>] [--json] [--screen-rules <field>]
//
// What changes:
//   a journey with no `steps`   gains `steps: [{ screen, story, persona }]`, one item per story whose `journey`
//                               is its key, ordered by `step` — `screen` as the story stores it
//                               (`rnd/screens/<id>`), `story` as `rnd/user-stories/<record id>`, `persona` the
//                               story's first `personas` value (omitted when it has none)
//   each of those stories       loses its top-level `journey:` and `step:` lines
//   --screen-rules <field>      a screen's `<field>` (a comma string or a list) joins its `scope_rows`, and the
//                               field is dropped — for a workspace that kept rule ids in a field of its own
// Only a story carrying `journey` is read. The whole write is refused (exit 1, nothing written) when such a
// story has no `screen` or no `step`, when two stories claim the same step of one journey, or when a story
// names a journey key no journey record has. A story whose journey already has `steps` is reported and left
// alone. Files are edited line by line, never re-serialised: every byte outside the moved keys — dates, folded
// scalars, comments, line endings — is kept. Every new text is computed before the first write, and journeys
// are written before any story is cleared. A second run is `journeys 0 · steps 0 · stories cleared 0 · screens 0`.
// Then: `dreamteamer relations rebuild rnd/user-journeys` and `dreamteamer check`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { findWorkspace } from '../lib/workspace-root.mjs';

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/;
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const rel = (root, p) => path.relative(root, p).split(path.sep).join('/');

function* walk(dir) {
	if (!isDir(dir)) return;
	for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
		if (e.name.startsWith('.')) continue;
		const p = path.join(dir, e.name);
		if (e.isDirectory()) yield* walk(p);
		else if (e.isFile() && e.name.endsWith('.md')) yield p;
	}
}

/** A record file under `dir`: its id (the path minus `.<suffix>.md`), its text and its front matter. */
function records(dir) {
	const out = [];
	for (const file of walk(dir)) {
		const text = fs.readFileSync(file, 'utf8');
		const m = FRONTMATTER.exec(text);
		let fm = {};
		try { fm = m ? (yaml.load(m[1]) ?? {}) : {}; } catch (e) { throw new Error(`${file}: front matter does not parse (${e.message})`); }
		const id = rel(dir, file).replace(/\.[^./]+\.md$/, '');
		out.push({ file, id, text, fm });
	}
	return out;
}

const eolOf = (text) => (text.includes('\r\n') ? '\r\n' : '\n');

/** Remove top-level `keys` (with their continuation lines) from a record's front matter; nothing else moves. */
export function dropKeys(text, keys) {
	const m = FRONTMATTER.exec(text);
	if (!m) return text;
	const eol = eolOf(text);
	const lines = m[1].split(/\r?\n/);
	const out = [];
	for (let i = 0; i < lines.length; i++) {
		const key = /^([A-Za-z0-9_-]+):/.exec(lines[i])?.[1];
		if (key && keys.includes(key)) {
			const emptyValue = /^[A-Za-z0-9_-]+:\s*$/.test(lines[i]);
			while (i + 1 < lines.length && (/^[ \t]/.test(lines[i + 1]) || (emptyValue && /^- /.test(lines[i + 1])) || lines[i + 1] === '')) {
				if (lines[i + 1] === '' && !(i + 2 < lines.length && /^[ \t]/.test(lines[i + 2]))) break;
				i++;
			}
			continue;
		}
		out.push(lines[i]);
	}
	const head = text.slice(0, text.indexOf(m[1]));
	return head + out.join(eol) + text.slice(text.indexOf(m[1]) + m[1].length);
}

/** Insert a top-level `key:` block (dumped as YAML) at the end of a record's front matter. */
export function addBlock(text, key, value) {
	const eol = eolOf(text);
	const block = `${key}:${eol}` + yaml.dump(value, { lineWidth: -1, noRefs: true }).trimEnd().split('\n').map((l) => `  ${l}`).join(eol);
	const m = FRONTMATTER.exec(text);
	if (!m) return `---${eol}${block}${eol}---${eol}${text}`;
	const at = text.indexOf(m[1]) + m[1].length;
	return text.slice(0, at) + (m[1].length ? eol : '') + block + text.slice(at);
}

const splitRules = (v) => (Array.isArray(v) ? v : String(v ?? '').split(',')).map((x) => String(x).trim()).filter(Boolean);

/** The plan for one workspace — pure, reads only. */
export function plan(root, { screenRules = null } = {}) {
	const data = path.join(root, 'data', 'rnd');
	const journeys = records(path.join(data, 'user-journeys'));
	const stories = records(path.join(data, 'user-stories')).filter((s) => s.fm.journey != null && s.fm.journey !== '');
	const byKey = new Map(journeys.map((j) => [String(j.fm.key ?? j.id), j]));
	const problems = [], skipped = [], writes = [];
	const groups = new Map();
	for (const s of stories) {
		const key = String(s.fm.journey);
		if (!byKey.has(key)) { problems.push(`${rel(root, s.file)}: journey "${key}" names no rnd/user-journeys record`); continue; }
		if (!groups.has(key)) groups.set(key, []);
		groups.get(key).push(s);
	}
	let stepCount = 0, cleared = 0, journeyCount = 0;
	const journeyWrites = [], storyWrites = [];
	for (const [key, list] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
		const j = byKey.get(key);
		if (Array.isArray(j.fm.steps) && j.fm.steps.length) { for (const s of list) skipped.push(`${rel(root, s.file)}: journey "${key}" already has steps — left unchanged`); continue; }
		const seen = new Map(); let bad = false;
		for (const s of list) {
			if (!s.fm.screen) { problems.push(`${rel(root, s.file)}: on journey "${key}" with no screen`); bad = true; }
			if (!Number.isInteger(s.fm.step)) { problems.push(`${rel(root, s.file)}: on journey "${key}" with no step`); bad = true; continue; }
			if (seen.has(s.fm.step)) { problems.push(`${rel(root, s.file)}: step ${s.fm.step} of journey "${key}" is also claimed by ${rel(root, seen.get(s.fm.step).file)}`); bad = true; }
			seen.set(s.fm.step, s);
		}
		if (bad) continue;
		const ordered = [...list].sort((a, b) => a.fm.step - b.fm.step);
		const steps = ordered.map((s) => {
			const persona = Array.isArray(s.fm.personas) ? s.fm.personas[0] : s.fm.personas;
			return { screen: s.fm.screen, story: `rnd/user-stories/${s.id}`, ...(persona ? { persona } : {}) };
		});
		journeyWrites.push({ file: j.file, text: addBlock(dropKeys(j.text, ['steps']), 'steps', steps), journey: key, steps: steps.length });
		for (const s of ordered) storyWrites.push({ file: s.file, text: dropKeys(s.text, ['journey', 'step']) });
		stepCount += steps.length; cleared += ordered.length; journeyCount++;
	}
	const screenWrites = [];
	if (screenRules) {
		for (const s of records(path.join(data, 'screens'))) {
			if (!(screenRules in s.fm)) continue;
			const rows = [...new Set([...splitRules(s.fm.scope_rows), ...splitRules(s.fm[screenRules])])];
			let text = dropKeys(s.text, [screenRules, 'scope_rows']);
			if (rows.length) text = addBlock(text, 'scope_rows', rows);
			screenWrites.push({ file: s.file, text, rows: rows.length });
		}
	}
	writes.push(...journeyWrites, ...storyWrites, ...screenWrites);
	return { root, journeys: journeyCount, steps: stepCount, stories: cleared, screens: screenWrites.length, problems, skipped, writes, journeyWrites, storyWrites, screenWrites };
}

/** Apply a plan: journeys first, then screens, then the stories are cleared. Refuses whole on any problem. */
export function apply(p) {
	if (p.problems.length) throw new Error(`refusing to write: ${p.problems.length} problem(s)`);
	for (const w of [...p.journeyWrites, ...p.screenWrites, ...p.storyWrites]) fs.writeFileSync(w.file, w.text);
}

export const planLine = (p) => `journeys ${p.journeys} · steps ${p.steps} · stories cleared ${p.stories} · screens ${p.screens}`;

export function render(p, { write }) {
	const lines = [`workspace ${p.root}`];
	for (const w of p.journeyWrites) lines.push(`${write ? '✔' : '·'} ${rel(p.root, w.file)}  steps ${w.steps}`);
	for (const w of p.screenWrites) lines.push(`${write ? '✔' : '·'} ${rel(p.root, w.file)}  scope_rows ${w.rows}`);
	if (p.storyWrites.length) lines.push(`${write ? '✔' : '·'} ${p.storyWrites.length} stor${p.storyWrites.length === 1 ? 'y' : 'ies'}  journey and step cleared`);
	for (const s of p.skipped) lines.push(`! ${s}`);
	for (const x of p.problems) lines.push(`✕ ${x}`);
	lines.push(planLine(p));
	lines.push(write ? 'written' : 'nothing written — pass --write to apply');
	if (write && p.journeys) lines.push('then: dreamteamer relations rebuild rnd/user-journeys · dreamteamer check');
	return lines.join('\n');
}

const USAGE = 'usage: migrate-journey-steps.mjs (--dry-run | --write) [--root <workspace>] [--json] [--screen-rules <field>]';

export function main(argv, { cwd = process.cwd(), log = console.log, error = console.error } = {}) {
	const args = [...argv];
	let write = false, dry = false, json = false, root = null, screenRules = null;
	while (args.length) {
		const a = args.shift();
		if (a === '--write') write = true;
		else if (a === '--dry-run') dry = true;
		else if (a === '--json') json = true;
		else if (a === '--root') root = args.shift() ?? null;
		else if (a === '--screen-rules') { screenRules = args.shift() ?? null; if (!screenRules) { error(`${USAGE}\n--screen-rules needs a field name`); return 2; } }
		else { error(`${USAGE}\nunknown argument: ${a}`); return 2; }
	}
	if (write && dry) { error(`${USAGE}\n--dry-run and --write exclude each other`); return 2; }
	root = root ? path.resolve(cwd, root) : (findWorkspace(cwd) ?? findWorkspace(path.dirname(fileURLToPath(import.meta.url))));
	if (!root) { error('no workspace here or above this script (no package.json beside a package-lock.json)'); return 1; }
	let p;
	try { p = plan(root, { screenRules }); } catch (e) { error(e.message); return 1; }
	if (write && p.problems.length) { error(render(p, { write: false })); error(`refusing to write: ${p.problems.length} problem(s)`); return 1; }
	if (write) apply(p);
	if (json) log(JSON.stringify({ written: write, root, journeys: p.journeys, steps: p.steps, stories: p.stories, screens: p.screens, problems: p.problems, skipped: p.skipped, files: p.writes.map((w) => rel(root, w.file)) }, null, 2));
	else log(render(p, { write }));
	return 0;
}

/** Run as a script, including through a symlink: both sides realpathed before they are compared. */
const isMain = () => {
	if (!process.argv[1]) return false;
	const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
	return real(process.argv[1]) === real(fileURLToPath(import.meta.url));
};

if (isMain()) process.exit(main(process.argv.slice(2)));
