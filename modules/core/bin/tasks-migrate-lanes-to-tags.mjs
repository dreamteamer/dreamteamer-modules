#!/usr/bin/env node
// migrate-lanes-to-tags — bring a workspace's tasks to the shape of tasks 0.3.0, which has no `lane`:
// each task's lane value becomes one of its `tags`, and the `lane` key is removed.
//
//   npx dt-migrate-lanes-to-tags                 # the plan (--dry-run is the default), nothing written
//   npx dt-migrate-lanes-to-tags --write         # apply it
//   … [--root <workspace>] [--json]
//
// What changes, record by record:
//   `lane: R&D` + `tags: [client:northwind]`  →  `tags: [client:northwind, r-d]`, no `lane`
//   the value is kebab-cased (lowercase, every run of other characters one hyphen) and added only when
//   the task does not already carry that tag; an empty lane (`lane:`, `lane: ''`) is simply removed
//   a value that kebab-cases to nothing (a lane written in a non-latin script) is reported with its file
//   and its task left exactly as it was — that value is yours to tag by hand
// Ids never change, so no reference anywhere is rewritten (`refs 0`). A workspace already in shape is a
// no-op (`records 0 · refs 0`), so a second run changes nothing.
//
// The script edits record FILES, never the engine's store: by the time it runs, the compiled schema may
// already have lost the field it reads. And it edits records ONLY. A workspace overlay of `tasks` that
// declared the field (often with an enum), or a view of its own that filters, groups or lists by it, is
// listed with its file and line so the workspace removes it; then `dt compile` and `dt check`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findWorkspace } from '../lib/workspace-root.mjs';

export const FIELD = 'lane';
const DEFAULT_DIR = 'data/tasks';
const TAG = /^[a-z0-9]+(-[a-z0-9]+)*(:[a-z0-9]+(-[a-z0-9]+)*)?$/;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/;
const KEY = /^([A-Za-z_][\w-]*)\s*:(.*)$/;
const MENTION = /\blane\b/;

/** A lane value as a tag: accents dropped, lowercase, every run of other characters one hyphen. */
export function kebab(value) {
	return String(value ?? '')
		.normalize('NFKD').replace(/[̀-ͯ]/g, '')
		.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** One YAML scalar as written inline — plain, 'single' or "double" quoted — or null for an empty one. */
export function scalar(raw) {
	const s = raw.trim();
	if (s.startsWith("'")) {
		let out = '';
		for (let i = 1; i < s.length; i++) {
			if (s[i] !== "'") out += s[i];
			else if (s[i + 1] === "'") { out += "'"; i++; }
			else break;
		}
		return out;
	}
	if (s.startsWith('"')) {
		const m = /^"((?:[^"\\]|\\.)*)"/.exec(s);
		return m ? JSON.parse(`"${m[1]}"`) : s.slice(1);
	}
	const plain = s.replace(/\s+#.*$/, '').trim();
	return plain === '' || plain === '~' || plain === 'null' ? null : plain;
}

/** The top-level keys of a frontmatter, each with the line range it spans: `{ key, start, end }`,
 *  `end` exclusive. A key runs until the next line at column 0 that is not a sequence item; blank lines
 *  and comments at its tail are left to whatever follows. */
export function keysOf(lines) {
	const keys = [];
	for (let i = 0; i < lines.length; i++) {
		const m = KEY.exec(lines[i]);
		if (!m) continue;
		let end = i + 1;
		while (end < lines.length && (lines[end] === '' || /^[\s-]/.test(lines[end]))) end++;
		while (end > i + 1 && lines[end - 1].trim() === '') end--;
		keys.push({ key: m[1], start: i, end });
		i = end - 1;
	}
	return keys;
}

/** The value of a lane key block: an inline scalar, or a folded/literal block joined into one line. */
function laneValue(block) {
	const inline = KEY.exec(block[0])[2].trim();
	if (/^[>|][+-]?\d*\s*(#.*)?$/.test(inline)) return block.slice(1).map((l) => l.trim()).filter(Boolean).join(' ') || null;
	if (block.length > 1) return [inline, ...block.slice(1).map((l) => l.trim())].filter(Boolean).join(' ') || null;
	return scalar(inline);
}

/** The tags of a tags key block — a block sequence, a flow sequence or one scalar — or an error. */
function tagsValue(block) {
	const inline = KEY.exec(block[0])[2].trim().replace(/\s+#.*$/, '');
	if (inline.startsWith('[')) {
		if (!inline.endsWith(']') || block.length > 1) return { error: 'a flow sequence over several lines' };
		const inner = inline.slice(1, -1).trim();
		return { tags: inner ? inner.split(',').map(scalar).filter((t) => t != null) : [] };
	}
	if (inline) return block.length > 1 ? { error: 'a multi-line scalar' } : { tags: [scalar(inline)].filter((t) => t != null) };
	const tags = [];
	for (const l of block.slice(1)) {
		if (l.trim() === '' || l.trim().startsWith('#')) continue;
		const m = /^\s*-\s+(.*)$/.exec(l) ?? /^\s*-()$/.exec(l);
		if (!m) return { error: `a line that is not a sequence item: ${l.trim()}` };
		const t = scalar(m[1]);
		if (t != null) tags.push(t);
	}
	return { tags };
}

/**
 * One record's text → `{ text, lane, tag, added }` when it carries a lane, `{ skip }` when it carries one
 * this script will not convert, or null when it has none. Pure: the input is never written.
 */
export function migrateText(text) {
	const fm = FRONTMATTER.exec(text);
	if (!fm) return null;
	const eol = fm[0].includes('\r\n') ? '\r\n' : '\n';
	const lines = fm[1].split(/\r?\n/);
	const keys = keysOf(lines);
	const lane = keys.find((k) => k.key === FIELD);
	if (!lane) return null;
	const value = laneValue(lines.slice(lane.start, lane.end));
	const tag = value == null ? null : kebab(value);
	if (value != null && !TAG.test(tag ?? '')) return { lane: value, skip: `kebab-cases to ${tag ? `"${tag}", not a valid tag` : 'nothing'}` };
	const tagsKey = keys.find((k) => k.key === 'tags');
	let current = [];
	if (tagsKey) {
		const parsed = tagsValue(lines.slice(tagsKey.start, tagsKey.end));
		if (parsed.error) return { lane: value, skip: `its tags are ${parsed.error}` };
		current = parsed.tags;
	}
	const added = tag != null && !current.includes(tag);
	const out = [...lines];
	// edit from the bottom up, so the range still to be edited keeps its line numbers
	const edits = [{ start: lane.start, end: lane.end, with: [] }];
	if (added) {
		if (!tagsKey) edits[0].with = ['tags:', `  - ${tag}`];
		else {
			const items = lines.slice(tagsKey.start + 1, tagsKey.end).filter((l) => /^\s*-/.test(l));
			const indent = items.length ? /^(\s*)-/.exec(items[0])[1] : '  ';
			const block = items.length
				? [...lines.slice(tagsKey.start, tagsKey.end), `${indent}- ${tag}`]
				: ['tags:', ...[...current, tag].map((t) => `${indent}- ${t}`)];
			edits.push({ start: tagsKey.start, end: tagsKey.end, with: block });
		}
	}
	for (const e of edits.sort((a, b) => b.start - a.start)) out.splice(e.start, e.end - e.start, ...e.with);
	const head = `---${eol}${out.join(eol)}${eol}---${fm[2]}`;
	return { text: head + text.slice(fm[0].length), lane: value, tag, added };
}

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const rel = (root, p) => path.relative(root, p).split(path.sep).join('/');

function* walk(dir, test) {
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		if (e.name.startsWith('.') || e.name === 'node_modules') continue;
		const p = path.join(dir, e.name);
		if (e.isDirectory()) yield* walk(p, test);
		else if (e.isFile() && test(e.name)) yield p;
	}
}

/** Where the workspace keeps its tasks: the compiled descriptor's `storage.path`, else the default. */
export function tasksDir(root) {
	const compiled = path.join(root, '.dreamteamer', 'collections', 'tasks.collection.yaml');
	const at = fs.existsSync(compiled) ? /^storage:\s*\r?\n(?:[ \t]+.*\r?\n)*?[ \t]+path:\s*['"]?([^'"\s]+)/m.exec(fs.readFileSync(compiled, 'utf8'))?.[1] : null;
	return path.join(root, at ?? DEFAULT_DIR);
}

/** The workspace's own sources that still name the field: an overlay of `tasks`, or a view of it. */
export function leftovers(root) {
	const dir = path.join(root, 'modules');
	if (!isDir(dir)) return [];
	const out = [];
	for (const file of walk(dir, (n) => /\.(collection|ui-view)\.ya?ml$/.test(n))) {
		const text = fs.readFileSync(file, 'utf8');
		const ofTasks = file.endsWith('.collection.yaml') || file.endsWith('.collection.yml')
			? /^name:\s*['"]?tasks['"]?\s*$/m.test(text)
			: /^collection:\s*['"]?(collections\/)?tasks['"]?\s*$/m.test(text);
		if (!ofTasks) continue;
		text.split(/\r?\n/).forEach((line, i) => { if (MENTION.test(line)) out.push({ file: rel(root, file), line: i + 1, text: line.trim() }); });
	}
	return out;
}

/** The plan for one workspace — pure, reads only. */
export function plan(root) {
	const dir = tasksDir(root);
	const records = [];
	const skipped = [];
	if (isDir(dir)) {
		for (const file of [...walk(dir, (n) => n.endsWith('.md'))].sort()) {
			const r = migrateText(fs.readFileSync(file, 'utf8'));
			if (!r) continue;
			if (r.skip) skipped.push({ file, lane: r.lane, why: r.skip });
			else records.push({ file, lane: r.lane, tag: r.tag, added: r.added, text: r.text });
		}
	}
	return { root, dir, records, skipped, refs: 0, leftovers: leftovers(root) };
}

/** Apply a plan: each changed record rewritten in place. */
export function apply(p) {
	for (const r of p.records) fs.writeFileSync(r.file, r.text);
}

export function render(p, { write }) {
	// the workspace first, always: the resolver falls back to the script's own tree when there is no
	// lockfile above the current folder, and a plan for the wrong workspace must be visible as one
	const lines = [`workspace ${p.root}`];
	for (const r of p.records) {
		const what = r.lane == null ? 'empty lane removed' : `lane ${r.lane} → tag ${r.tag}${r.added ? '' : ' (already tagged)'}`;
		lines.push(`${write ? '✔' : '·'} ${rel(p.root, r.file)}  ${what}`);
	}
	for (const s of p.skipped) lines.push(`! ${rel(p.root, s.file)}  lane ${JSON.stringify(s.lane)} ${s.why} — left as it is; tag it by hand`);
	for (const l of p.leftovers) lines.push(`! ${l.file}:${l.line}  still names lane — remove it from the workspace's source: ${l.text}`);
	lines.push(`records ${p.records.length} · refs ${p.refs}`);
	lines.push(write ? 'written' : 'nothing written — pass --write to apply');
	if (write && (p.records.length || p.leftovers.length)) lines.push(`then: ${p.leftovers.length ? 'remove the lines above · ' : ''}dreamteamer compile · dreamteamer check`);
	return lines.join('\n');
}

const USAGE = 'usage: migrate-lanes-to-tags.mjs [--dry-run | --write] [--root <workspace>] [--json]';

export function main(argv, { cwd = process.cwd(), log = console.log, error = console.error } = {}) {
	const args = [...argv];
	let write = false, dry = false, json = false, root = null;
	while (args.length) {
		const a = args.shift();
		if (a === '--write') write = true;
		else if (a === '--dry-run') dry = true;
		else if (a === '--json') json = true;
		else if (a === '--root') root = args.shift() ?? null;
		else if (a === '--help' || a === '-h') { log(USAGE); return 0; }
		else { error(`${USAGE}\nunknown argument: ${a}`); return 2; }
	}
	if (write && dry) { error(`${USAGE}\n--dry-run and --write exclude each other`); return 2; }
	root = root ? path.resolve(cwd, root) : (findWorkspace(cwd) ?? findWorkspace(path.dirname(fileURLToPath(import.meta.url))));
	if (!root) { error('no workspace here or above this script (no package.json beside a package-lock.json)'); return 1; }
	const p = plan(root);
	if (write) apply(p);
	if (json) {
		log(JSON.stringify({
			written: write, root, records: p.records.length, refs: p.refs,
			changes: p.records.map((r) => ({ file: rel(root, r.file), lane: r.lane, tag: r.tag, added: r.added })),
			skipped: p.skipped.map((s) => ({ file: rel(root, s.file), lane: s.lane, why: s.why })),
			leftovers: p.leftovers,
		}, null, 2));
	} else log(render(p, { write }));
	return 0;
}

/** Run as a script, including through a symlink: `process.argv[1]` is the path as invoked and
 *  `import.meta.url` the path resolved, so both are realpathed before they are compared. */
const isMain = () => {
	if (!process.argv[1]) return false;
	const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
	return real(process.argv[1]) === real(fileURLToPath(import.meta.url));
};

if (isMain()) process.exit(main(process.argv.slice(2)));
