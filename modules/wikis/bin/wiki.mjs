#!/usr/bin/env node
// `dt-wiki` — the verbs over a wiki, a folder of markdown sources with no account, login or network.
// `USAGE` below lists every verb and flag.
//
// A wiki is a FOLDER: `index.md`, then `sources/<nn>--<slug>.md` nested into section subfolders.
// `lib/wiki.mjs` holds every rule; this file does the disk, the subprocesses and the printing.
//
// `pull` is the only verb that reaches the network: it mirrors a live NotebookLM notebook's sources
// into a folder, through the `notebooklm` CLI, and never installs anything or logs in.
//
// This package fetches no URL itself, and carries no HTML-to-markdown converter: the `notebooklm`
// adapter and an agent's own fetch tool already do that. `dt-wiki add … --kind url` writes a stub
// marked `pending` and says so.
import __fs from 'node:fs';
import __path from 'node:path';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import yaml from 'js-yaml';
import {
	COMPLETENESS, MIN_BYTES, classify, summarise, adapterOf, defaultFolder, wikiPaths,
	slug, sourcePath, parseSource, renderSource, stubFields, renderIndex, parseIndex,
	outline, searchBody, renderTemplate, envFrom, pullPlan, vendorResult, MARKDOWN_EXTRA_MISSING, WIKI_ROOT,
} from '../lib/wiki.mjs';

const USAGE = [
	'usage: npx dt-wiki init <id> [--title <t>] [--description <d>]',
	'       npx dt-wiki list [--json]',
	'       npx dt-wiki show <id> [--json]',
	'       npx dt-wiki add <id> <ref> [--kind url|file|text] [--title <t>] [--section <s>]',
	'       npx dt-wiki status [<id>] [--json]',
	'       npx dt-wiki incomplete [<id>] [--json]',
	'       npx dt-wiki verify [<id>] [--fix]',
	'       npx dt-wiki search <id> <pattern> [--json]           lexical — exact words only',
	'       npx dt-wiki ask <id> <question> [-n N] [--lexical] [--json]',
	'       npx dt-wiki index [<id>] [--embed] [--dry-run]',
	'       npx dt-wiki outline <id>',
	'       npx dt-wiki pull <record-id> [--notebook <uuid>] [--wiki <id>] [--refresh] [--limit N] [--dry-run]',
].join('\n');

const opt = (argv, name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const has = (argv, name) => argv.includes(`--${name}`);
const positional = (argv) => argv.filter((a, i) => !a.startsWith('-') && !(i > 0 && VALUE_FLAGS.has(argv[i - 1])));
const VALUE_FLAGS = new Set(['--title', '--description', '--kind', '--section', '--notebook', '--wiki', '--limit', '--min-bytes', '--max-age', '-n']);

// ─── records ────────────────────────────────────────────────────────────────────────────────────────

/** Where a consumer keeps a collection's records: the COMPILED descriptor's storage block, else the
 *  module default. Reading the compiled copy is what makes this work in a workspace that re-typed or
 *  re-homed the collection in an overlay. */
function recordPath(root, collection, id) {
	let dir = `data/${collection}`;
	let suffix = collection.replace(/s$/, '');
	let under = null;
	const descriptor = (name) => {
		try { return yaml.load(fs.readFileSync(path.join(root, '.dreamteamer', 'collections', `${name}.collection.yaml`), 'utf8')); } catch { return null; }
	};
	const d = descriptor(collection); // an uncompiled workspace still has the module default
	if (d?.storage?.path) dir = d.storage.path;
	if (d?.storage?.suffix) suffix = d.storage.suffix;
	if (d?.storage?.under?.collection) under = d.storage.under;
	const own = path.join(root, dir, `${id}.${suffix}.md`);
	// A collection stored UNDER another (`storage.under`, engine 0.32+) keeps a record with an owner
	// inside that owner's folder; the own root is where a record WITHOUT one lives, and where a new
	// one is written. An existing record is looked for there first, then in every parent's folder.
	if (!under || fs.existsSync(own)) return own;
	const parentDir = descriptor(under.collection)?.storage?.path;
	if (!parentDir || !fs.existsSync(path.join(root, parentDir))) return own;
	for (const e of fs.readdirSync(path.join(root, parentDir), { withFileTypes: true })) {
		if (!e.isDirectory() || e.name.startsWith('.')) continue;
		const f = path.join(root, parentDir, e.name, under.path, `${id}.${suffix}.md`);
		if (fs.existsSync(f)) return f;
	}
	return own;
}

function readRecord(file) {
	const text = fs.readFileSync(file, 'utf8');
	if (!text.startsWith('---\n')) return { fields: {}, body: text };
	const end = text.indexOf('\n---', 4);
	if (end < 0) return { fields: {}, body: text };
	let body = text.slice(end + 4);
	if (body.startsWith('\n')) body = body.slice(1);
	return { fields: yaml.load(text.slice(4, end)) ?? {}, body };
}

function writeRecord(file, { fields, body }) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, `---\n${yaml.dump(fields, { lineWidth: -1, noRefs: true, quotingType: "'" })}---\n${body ?? ''}`);
}

// ─── the folder ─────────────────────────────────────────────────────────────────────────────────────

/** A wiki id → its folder on this machine, plus its record if one exists. Returns `{ refusal }` when
 *  the record's `${env:…}` template cannot be rendered here, rather than guessing. */
function resolveWiki(root, id) {
	const file = recordPath(root, 'wikis', id);
	const rec = fs.existsSync(file) ? readRecord(file) : null;
	const template = rec?.fields?.folder ?? defaultFolder(id);
	const r = renderTemplate(template, envFrom(root));
	if (r.refusal) return { refusal: `wikis/${id}: ${r.refusal}` };
	// A relative folder resolves against the workspace root, never the current directory, so the verb
	// reads the same tree wherever it is run from. An absolute path is used as it is.
	let dir = path.isAbsolute(r.value) ? r.value : path.resolve(root, r.value);
	// A wiki with no record and no in-repo folder is looked for under `${env:FILES_FOLDER}/wikis/`,
	// where `allWikiIds` may have discovered it. A record always wins, and an in-repo corpus is never
	// shadowed by a copy elsewhere.
	if (!rec && !fs.existsSync(dir)) {
		const legacy = renderTemplate(`\${env:FILES_FOLDER}/wikis/${id}`, envFrom(root));
		if (!legacy.refusal && fs.existsSync(legacy.value)) dir = legacy.value;
	}
	return { id, dir, rec, file, paths: wikiPaths(dir) };
}

/** Every source file under `sources/`, in corpus order — frontmatter spread flat, body attached.
 *  Ordered by the filename number, not the directory walk, so a section subfolder's sources stay in
 *  place among the ones around them. */
function listSources(dir) {
	const base = wikiPaths(dir).sources;
	const out = [];
	const walk = (d, prefix) => {
		if (!fs.existsSync(d)) return;
		for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			const p = path.join(d, e.name);
			if (e.isDirectory()) walk(p, `${prefix}${e.name}/`);
			else if (e.name.endsWith('.md')) {
				const { fields, body, bodyLine } = parseSource(fs.readFileSync(p, 'utf8'));
				out.push({ ...fields, path: `sources/${prefix}${e.name}`, abs: p, body, bodyLine });
			}
		}
	};
	walk(base, '');
	const num = (s) => Number(/(\d+)/.exec(path.basename(s.path))?.[1] ?? 0);
	return out.sort((a, b) => num(a) - num(b));
}

const nextIndex = (sources) => sources.reduce((m, s) => Math.max(m, Number(/(\d+)/.exec(path.basename(s.path))?.[1] ?? 0)), 0) + 1;

function writeSource(dir, relPath, fields, body) {
	const abs = path.join(dir, relPath);
	fs.mkdirSync(path.dirname(abs), { recursive: true });
	fs.writeFileSync(abs, renderSource(fields, body));
	return abs;
}

/** Every wiki this workspace knows: a record under the collection, or a folder carrying a manifest. */
function allWikiIds(root) {
	const ids = new Set();
	const dir = path.dirname(recordPath(root, 'wikis', 'x'));
	if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) { const m = /^(.+)\.[a-z-]+\.md$/.exec(f); if (m) ids.add(m[1]); }
	// Both roots are scanned: `wikis/` in the repo, and `${env:FILES_FOLDER}/wikis` outside it. A folder
	// carrying an `index.md` is a wiki whether or not a record points at it; the folder is the authority.
	for (const base of [path.resolve(root, WIKI_ROOT), renderTemplate('${env:FILES_FOLDER}/wikis', envFrom(root)).value]) {
		if (!base || !fs.existsSync(base)) continue;
		for (const e of fs.readdirSync(base, { withFileTypes: true })) {
			if (!e.isDirectory()) continue;
			// Either entry marks a wiki: `index.md`, or an older bare-YAML `wiki.yaml`. A folder with
			// neither is not a corpus.
			if (['index.md', 'wiki.yaml'].some((f) => fs.existsSync(path.join(base, e.name, f)))) ids.add(e.name);
		}
	}
	return [...ids].sort();
}

/** The corpus's own frontmatter. `index.md` wins; a bare-YAML `wiki.yaml` is read when it is all the
 *  folder has, and is never rewritten. */
const indexOf = (w) => {
	for (const f of [w.paths.index, w.paths.legacyManifest]) {
		if (fs.existsSync(f)) return parseIndex(fs.readFileSync(f, 'utf8'));
	}
	return { fields: {}, body: '' };
};
const manifestOf = (w) => indexOf(w).fields;

/** The rollup written back onto the `wikis` record. It is a CACHE and the field descriptions say so;
 *  this is the only place it is produced, and `verify` is what re-derives it. */
function stampRollup(w, sources) {
	if (!w.rec) return null;
	const s = summarise(sources);
	w.rec.fields.sources_total = s.total;
	w.rec.fields.sources_complete = s.complete;
	w.rec.fields.sources_incomplete = s.incomplete;
	w.rec.fields.synced_at = new Date().toISOString();
	writeRecord(w.file, w.rec);
	return s;
}

// ─── the verbs ──────────────────────────────────────────────────────────────────────────────────────

export function main(argv, root) {
	const [sub, ...rest] = argv;
	const table = { init, list, show, add, status, incomplete, verify, search, ask, index, outline: outlineCmd, pull };
	const fn = Object.hasOwn(table, sub ?? '') ? table[sub] : null;
	if (!fn) { console.error(`unknown wiki command "${sub ?? ''}"\n${USAGE}`); return 2; }
	return fn(rest, root);
}

function init(argv, root) {
	const id = positional(argv)[0];
	if (!id) { console.error(USAGE.split('\n')[0]); return 2; }
	if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) { console.error(`✖ "${id}" is not a wiki id — lowercase letters, digits and dashes, starting with a letter or digit`); return 1; }
	const w = resolveWiki(root, id);
	if (w.refusal) { console.error(`✖ ${w.refusal}`); return 1; }
	const title = opt(argv, 'title') ?? id;

	fs.mkdirSync(w.paths.sources, { recursive: true });
	if (!fs.existsSync(w.paths.index) && !fs.existsSync(w.paths.legacyManifest)) {
		fs.writeFileSync(w.paths.index, renderIndex({ id, title, adapter: 'local' }));
	}
	console.log(`✔ ${w.dir}`);

	if (!w.rec) {
		writeRecord(w.file, {
			fields: {
				name: title,
				folder: defaultFolder(id),
				...(opt(argv, 'description') ? { description: opt(argv, 'description') } : {}),
				adapter: 'local',
				status: 'active',
				sources_total: 0, sources_complete: 0, sources_incomplete: 0,
				synced_at: new Date().toISOString(),
			},
			body: '',
		});
		console.log(`✔ wikis/${id} — run \`npx dreamteamer check\` and commit it`);
	}
	console.log(`  add a source:  npx dt-wiki add ${id} <ref> --kind text|file|url`);
	return 0;
}

// ─── asking a corpus, rather than grepping it ───────────────────────────────────────────────────────
//
// Two verbs, because they answer different questions:
//   · `search` is grep — exact words, instant, deterministic, nothing installed. The right tool when
//     you know the phrase, and the floor that keeps the module working with nothing installed.
//   · `ask` is retrieval — the passage that MEANS what you asked, through `qmd`: BM25, vector search
//     and an LLM re-rank, all on-device. A corpus often states a rule in words the asker does not use,
//     and grep cannot find those.
// They stay separate verbs so every hit says which kind of match it is.
//
// `qmd` is local: no account, no key, no network, so `ask` works offline.

/** Is `qmd` on PATH? Answered once per process — the absence is a fallback, not an error. */
function qmdPresent() {
	return spawnSync('qmd', ['--version'], { encoding: 'utf8' }).status === 0;
}

const QMD_MISSING = [
	'✖ `qmd` is not installed — it is the retrieval engine for `wiki ask`.',
	'    npm install -g @tobilu/qmd',
	'    npx dt-wiki index --embed',
	'  It is fully on-device: no account, no key, no network. ~2.1 GB of local models on first embed.',
	'  Meanwhile `wiki search <id> <pattern>` still works — it is exact-match only.',
].join('\n');

/**
 * `dt-wiki ask <id> <question>` — the passages that answer, each with its file and line.
 *
 * It prints locations, never an answer: the reading is the caller's job, so every claim drawn from the
 * corpus stays checkable at its `file:line`.
 */
function ask(argv, root) {
	const pos = positional(argv);
	const id = pos[0];
	const question = pos.slice(1).join(' ');
	if (!id || !question) { console.error(USAGE.split('\n').find((l) => l.includes('wiki ask'))); return 2; }
	const w = resolveWiki(root, id);
	if (w.refusal) { console.error(`✖ ${w.refusal}`); return 1; }

	if (!qmdPresent()) { console.error(QMD_MISSING); return 1; }
	// `--lexical` is BM25 only: no vector, no re-rank, no model load. Much faster, and the right choice
	// when the question already uses the corpus's own words.
	const verb = has(argv, 'lexical') ? 'search' : 'query';
	const n = opt(argv, 'n') ?? '10';
	const r = spawnSync('qmd', [verb, question, '-c', id, '-n', String(n)], { encoding: 'utf8' });
	if (r.status !== 0) {
		console.error(`✖ qmd ${verb} failed${r.stderr ? `: ${r.stderr.trim().split('\n')[0]}` : ''}`);
		console.error('  is this corpus indexed?  npx dt-wiki index ' + id + ' --embed');
		return 1;
	}
	const out = (r.stdout ?? '').trim();
    if (!out) {
		console.log(`no passage matched. The corpus is indexed but nothing in it is close to that question.`);
		console.log(`  ⚠ Retrieval is SENSITIVE TO WORDING — measured 4/4 hits with the instrument named in the`);
		console.log(`    question and 2/2 misses without it. Name the statute, standard or document and re-ask.`);
		return 0;
	}
	if (has(argv, 'json')) { console.log(JSON.stringify({ id, question, backend: `qmd ${verb}`, raw: out }, null, 2)); return 0; }
	console.log(out);
	console.log(`\n  ⚠ These are LOCATIONS, not an answer. Open each line before citing it — a rank is not a fact.`);
	return 0;
}

/**
 * `dt-wiki index [<id>] [--embed]` — register every corpus with `qmd`, and give each one its context.
 *
 * The context string goes to the re-ranker with every candidate and lets it tell a statute from a
 * commentary on it. It comes from the record's `description`, so that field shapes ranking once a
 * corpus is indexed.
 */
function index(argv, root) {
	if (!qmdPresent()) { console.error(QMD_MISSING); return 1; }
	const only = positional(argv)[0];
	const ids = only ? [only] : allWikiIds(root);
	const dry = has(argv, 'dry-run');
	let added = 0;
	for (const id of ids) {
		const w = resolveWiki(root, id);
		if (w.refusal) { console.error(`  ✖ ${w.refusal}`); continue; }
		if (!fs.existsSync(w.paths.sources)) { console.error(`  ✖ ${id}: no sources/ folder`); continue; }
		const description = w.rec?.fields?.description ?? indexOf(w).fields?.title ?? id;
		if (dry) { console.log(`  would index ${id} — ${w.paths.sources}`); added += 1; continue; }
		const a = spawnSync('qmd', ['collection', 'add', w.paths.sources, '--name', id], { encoding: 'utf8' });
		if (a.status !== 0) { console.error(`  ✖ ${id}: ${(a.stderr ?? '').trim().split('\n')[0]}`); continue; }
		spawnSync('qmd', ['context', 'add', `qmd://${id}`, String(description)], { encoding: 'utf8' });
		console.log(`  ✔ ${id}`);
		added += 1;
	}
	if (dry) { console.log(`(--dry-run: nothing written)`); return 0; }
	console.log(`${added} corpus(es) registered with qmd`);
	if (has(argv, 'embed')) {
		// Slow and one-off: minutes for a corpus of a few dozen documents, plus ~2.1 GB of models on the
		// first run. Without it `ask` answers lexically.
		console.log('embedding — first run downloads ~2.1 GB of local models, and this takes minutes');
		const e = spawnSync('qmd', ['embed'], { stdio: 'inherit' });
		if (e.status !== 0) { console.error('✖ qmd embed failed'); return 1; }
	} else if (added) {
		console.log('  now:  npx dt-wiki index --embed    (or: qmd embed)');
	}
	return 0;
}

function list(argv, root) {
	const rows = [];
	for (const id of allWikiIds(root)) {
		const w = resolveWiki(root, id);
		if (w.refusal) { rows.push({ id, error: w.refusal }); continue; }
		const m = manifestOf(w);
		const s = summarise(listSources(w.dir));
		rows.push({ id, title: m.title ?? w.rec?.fields?.name ?? id, adapter: m.adapter ?? w.rec?.fields?.adapter ?? 'local', ...s });
	}
	if (has(argv, 'json')) { console.log(JSON.stringify(rows, null, 2)); return 0; }
	if (!rows.length) { console.log('no wikis yet — `npx dt-wiki init <id>` makes one'); return 0; }
	for (const r of rows) {
		if (r.error) { console.log(`  ${r.id.padEnd(28)} ✖ ${r.error}`); continue; }
		console.log(`  ${r.id.padEnd(28)} ${String(r.adapter).padEnd(10)} ${String(r.total).padStart(4)} sources · ${r.incomplete} incomplete`);
	}
	return 0;
}

function show(argv, root) {
	const id = positional(argv)[0];
	if (!id) { console.error(USAGE.split('\n')[2]); return 2; }
	const w = resolveWiki(root, id);
	if (w.refusal) { console.error(`✖ ${w.refusal}`); return 1; }
	const m = manifestOf(w);
	const sources = listSources(w.dir);
	const s = summarise(sources);
	if (has(argv, 'json')) { console.log(JSON.stringify({ id, folder: w.dir, manifest: m, ...s, sources: sources.map(({ body, abs, ...f }) => f) }, null, 2)); return 0; }
	console.log(`${id} — ${m.title ?? id}`);
	console.log(`  folder    ${w.dir}`);
	console.log(`  adapter   ${m.adapter ?? 'local'}${m.upstream ? ` · upstream ${m.upstream}` : ''}`);
	console.log(`  sources   ${s.total} · ${COMPLETENESS.map((c) => `${c} ${s.by[c]}`).join(' · ')}`);
	for (const src of sources) console.log(`  ${String(src.completeness ?? 'pending').padEnd(9)} ${src.path}  ${src.title ?? ''}`);
	return 0;
}

function add(argv, root) {
	const [id, ...others] = positional(argv);
	const ref = others.join(' ');
	if (!id || !ref) { console.error(USAGE.split('\n')[3]); return 2; }
	const w = resolveWiki(root, id);
	if (w.refusal) { console.error(`✖ ${w.refusal}`); return 1; }
	if (!fs.existsSync(w.paths.sources)) { console.error(`✖ no wiki at ${w.dir} — \`npx dt-wiki init ${id}\` first`); return 1; }

	const kind = opt(argv, 'kind') ?? (/^https?:\/\//i.test(ref) ? 'url' : fs.existsSync(ref) ? 'file' : 'text');
	if (!['url', 'file', 'text'].includes(kind)) { console.error(`✖ --kind ${kind} — the local adapter takes url, file or text`); return 1; }
	const sources = listSources(w.dir);
	const index = nextIndex(sources);
	const section = opt(argv, 'section');
	let title = opt(argv, 'title') ?? '';
	let body = '';
	let observation = { attempted: false };

	if (kind === 'text') {
		body = ref === '-' ? fs.readFileSync(0, 'utf8') : ref;
		title = title || slug(body.split('\n').find((l) => l.trim()) ?? '').slice(0, 48) || `text-${index}`;
		observation = { attempted: true, status: 0, bytes: Buffer.byteLength(body) };
	} else if (kind === 'file') {
		if (!fs.existsSync(ref)) { console.error(`✖ ${ref} does not exist on this machine`); return 1; }
		const buf = fs.readFileSync(ref);
		if (buf.includes(0)) { console.error(`✖ ${ref} is not text — a wiki holds MARKDOWN. Keep the bytes under \${env:FILES_FOLDER} and add a \`url\` or \`text\` source pointing at them.`); return 1; }
		body = buf.toString('utf8');
		title = title || path.basename(ref, path.extname(ref));
		observation = { attempted: true, status: 0, bytes: buf.length };
	} else {
		// A URL lands as a stub. This package fetches nothing (see the header): the body is filled by
		// `dt-wiki pull` through the notebooklm adapter, or by an agent with a fetch tool writing the file.
		title = title || ref;
	}

	const { completeness, reason } = classify({ ...observation, minBytes: Number(opt(argv, 'min-bytes')) || MIN_BYTES });
	const rel = `sources/${sourcePath(index, title || `source-${index}`, section)}`;
	const fields = {
		...stubFields({ kind, ref: kind === 'text' ? '' : ref, title, section, adapter: 'local' }),
		...(observation.attempted ? { fetched_at: new Date().toISOString() } : {}),
		completeness,
		bytes: observation.bytes ?? 0,
		...(reason ? { reason } : {}),
	};
	writeSource(w.dir, rel, fields, body);
	console.log(`✔ ${rel}  ${completeness}${reason ? ` · ${reason}` : ''}`);
	if (completeness === 'pending') console.log(`  this package fetches no URL — fill the body, or run \`wiki pull\` against a notebook that holds it;\n  \`npx dt-wiki incomplete ${id}\` keeps naming it until something does`);
	stampRollup(w, listSources(w.dir));
	return 0;
}

/** Every source of every named wiki, flattened — the shared read behind status, incomplete and verify. */
function scan(argv, root) {
	const ids = positional(argv).length ? positional(argv) : allWikiIds(root);
	const rows = [];
	const errors = [];
	for (const id of ids) {
		const w = resolveWiki(root, id);
		if (w.refusal) { errors.push(w.refusal); continue; }
		for (const s of listSources(w.dir)) rows.push({ wiki: id, w, ...s });
	}
	return { ids, rows, errors };
}

function status(argv, root) {
	const { ids, rows, errors } = scan(argv, root);
	for (const e of errors) console.error(`✖ ${e}`);
	const s = summarise(rows);
	if (has(argv, 'json')) { console.log(JSON.stringify({ wikis: ids, ...s }, null, 2)); return errors.length ? 1 : 0; }
	console.log(`${ids.length} wiki(s) · ${s.total} source(s)`);
	for (const c of COMPLETENESS) console.log(`  ${c.padEnd(9)} ${String(s.by[c]).padStart(5)}`);
	if (s.incomplete) console.log(`\n${s.incomplete} still need scraping — \`npx dt-wiki incomplete\` names each one`);
	return errors.length ? 1 : 0;
}

/** THE QUERY THE WHOLE DESIGN EXISTS FOR. Exits 1 when anything is short, so it gates a pipeline. */
function incomplete(argv, root) {
	const { rows, errors } = scan(argv, root);
	for (const e of errors) console.error(`✖ ${e}`);
	const short = rows.filter((r) => r.completeness !== 'complete');
	if (has(argv, 'json')) {
		console.log(JSON.stringify(short.map((r) => ({ wiki: r.wiki, path: r.path, kind: r.kind, ref: r.ref, title: r.title, completeness: r.completeness ?? 'pending', reason: r.reason ?? '' })), null, 2));
		return short.length || errors.length ? 1 : 0;
	}
	if (!short.length && !errors.length) { console.log(`✔ every source in ${rows.length} is complete`); return 0; }
	for (const r of short) console.log(`  ${String(r.completeness ?? 'pending').padEnd(9)} ${r.wiki}/${r.path}${r.reason ? ` · ${r.reason}` : ''}${r.ref ? `\n            ${r.ref}` : ''}`);
	console.log(`\n${short.length} of ${rows.length} source(s) still need scraping`);
	return 1;
}

/** Re-derive every marker from the files and name the drift between them and the rollup. */
function verify(argv, root) {
	const { ids, rows, errors } = scan(argv, root);
	for (const e of errors) console.error(`✖ ${e}`);
	const minBytes = Number(opt(argv, 'min-bytes')) || MIN_BYTES;
	const drift = [];
	const seen = new Map();
	let untouched = 0;
	for (const r of rows) {
		seen.set(r.wiki, r.w);
		const stored = r.completeness ?? 'pending';
		// `failed` and `partial` cannot be re-derived from a file: the exit code and the truncation flag
		// are observations of the fetch, and neither is on disk afterwards. Re-deriving from bytes alone
		// would promote a truncated source to `complete` and demote a failed one to `empty`, losing its
		// reason. So verify leaves both alone and counts them; only a refetch (`dt-wiki pull --refresh`)
		// can observe them again.
		if (stored === 'failed' || stored === 'partial') { untouched += 1; continue; }
		const bytes = Buffer.byteLength(r.body ?? '');
		const fresh = classify({ attempted: Boolean(r.fetched_at) || bytes > 0, status: 0, bytes, minBytes });
		if (fresh.completeness !== stored || bytes !== (r.bytes ?? 0)) {
			drift.push({ ...r, was: stored, now: fresh.completeness, wasBytes: r.bytes ?? 0, bytes, reason: fresh.reason });
			if (has(argv, 'fix')) {
				const { fields, body } = parseSource(fs.readFileSync(r.abs, 'utf8'));
				fields.completeness = fresh.completeness;
				fields.bytes = bytes;
				if (fresh.reason) fields.reason = fresh.reason; else delete fields.reason;
				fs.writeFileSync(r.abs, renderSource(fields, body));
			}
		}
	}
	for (const w of seen.values()) stampRollup(w, listSources(w.dir));
	for (const id of ids) if (!seen.has(id)) { const w = resolveWiki(root, id); if (!w.refusal) stampRollup(w, []); }

	const left = untouched ? `; ${untouched} left alone (failed/partial — only a refetch can observe those)` : '';
	if (!drift.length) { console.log(`✔ ${rows.length} source(s) in ${ids.length} wiki(s) — every marker matches its file${left}; rollups restamped`); return errors.length ? 1 : 0; }
	console.log(`${drift.length} marker(s) disagree with the file${has(argv, 'fix') ? ' — rewritten' : ''}${left}:`);
	for (const d of drift) console.log(`  ${d.wiki}/${d.path}  ${d.was} → ${d.now}  (${d.wasBytes} → ${d.bytes} bytes)`);
	if (!has(argv, 'fix')) console.log('\npass --fix to write the re-derived markers back');
	return has(argv, 'fix') ? 0 : 1;
}

function search(argv, root) {
	const [id, ...pat] = positional(argv);
	const pattern = pat.join(' ');
	if (!id || !pattern) { console.error(USAGE.split('\n')[7]); return 2; }
	const w = resolveWiki(root, id);
	if (w.refusal) { console.error(`✖ ${w.refusal}`); return 1; }
	let re;
	try { re = new RegExp(pattern, 'i'); } catch (e) { console.error(`✖ ${pattern} is not a regular expression — ${e.message}`); return 1; }
	const out = [];
	for (const s of listSources(w.dir)) for (const hit of searchBody(s.body, re, 200, s.bodyLine)) out.push({ path: s.path, title: s.title ?? '', ...hit });
	if (has(argv, 'json')) { console.log(JSON.stringify(out, null, 2)); return out.length ? 0 : 1; }
	// `<file>:<line>`, so every hit opens at the line it names.
	for (const h of out) console.log(`  ${h.path}:${h.line}  ${h.text.slice(0, 140)}`);
	console.log(`\n${out.length} hit(s)`);
	return out.length ? 0 : 1;
}

/** A table of contents for a corpus — the mechanical stand-in for a summary, which nothing here
 *  generates. */
function outlineCmd(argv, root) {
	const id = positional(argv)[0];
	if (!id) { console.error(USAGE.split('\n')[8]); return 2; }
	const w = resolveWiki(root, id);
	if (w.refusal) { console.error(`✖ ${w.refusal}`); return 1; }
	const sources = listSources(w.dir);
	if (has(argv, 'json')) { console.log(JSON.stringify(sources.map((s) => ({ path: s.path, title: s.title ?? '', completeness: s.completeness ?? 'pending', headings: outline(s.body) })), null, 2)); return 0; }
	for (const s of sources) {
		console.log(`${s.path}  ${s.title ?? ''}${s.completeness === 'complete' ? '' : `  [${s.completeness ?? 'pending'}]`}`);
		for (const h of outline(s.body)) console.log(`${'  '.repeat(h.level)}${h.text}`);
	}
	console.log(`\n${sources.length} source(s). This is a table of contents, not a summary — the local adapter runs no model.`);
	return 0;
}

// ─── pull: the bridge to NotebookLM, and the only verb here that reaches the network ────────────────

/** One vendor call, or a throw carrying the vendor's own words. `vendorResult` in lib/wiki.mjs decides
 *  which, because the vendor's exit code alone does not say whether the call failed. */
function nlm(args) {
	let out = '';
	let stderr = '';
	let status = 0;
	try { out = execFileSync('notebooklm', ['--quiet', ...args], { encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'pipe'] }); }
	catch (e) {
		if (e.code === 'ENOENT') throw new Error('notebooklm is not on PATH (uv tool install notebooklm-py)');
		out = (e.stdout ?? '').toString();
		stderr = (e.stderr ?? '').toString();
		status = e.status ?? 1;
	}
	const r = vendorResult({ stdout: out, stderr, status });
	if (r.error) throw new Error(r.error);
	return r.json;
}

/** Markdown first, plain text as the fallback — and only for the one failure a lossier format fixes
 *  (`MARKDOWN_EXTRA_MISSING`). Falling back keeps the content (with `-o` the text path is not
 *  truncated) and loses headings, tables and links, a downgrade recorded on the file. */
function fetchFulltext(uuid, sourceId, tmp) {
	let lastError = '';
	for (const format of ['markdown', 'text']) {
		try {
			fs.rmSync(tmp, { force: true });
			nlm(['source', 'fulltext', '-n', uuid, sourceId, '--format', format, '-o', tmp, '--force', '--json']);
			const buf = fs.existsSync(tmp) ? fs.readFileSync(tmp) : Buffer.alloc(0);
			return { observation: { attempted: true, status: 0, bytes: buf.length, body: buf.toString('utf8') }, format };
		} catch (e) {
			lastError = e.message;
			if (format === 'markdown' && MARKDOWN_EXTRA_MISSING.test(lastError)) continue;
			break;
		}
	}
	return { observation: { attempted: true, status: 1, bytes: 0, body: '', error: lastError }, format: null };
}

function pull(argv, root) {
	const recordId = positional(argv)[0];
	let uuid = opt(argv, 'notebook');
	let nbFile = null;
	let nb = null;
	if (recordId) {
		nbFile = recordPath(root, 'notebooks', recordId);
		if (!fs.existsSync(nbFile)) { console.error(`✖ no such record — looked for ${path.relative(root, nbFile)}`); return 1; }
		nb = readRecord(nbFile);
		uuid = uuid ?? nb.fields.notebook_id;
		if (adapterOf(nb.fields) !== 'notebooklm' && !uuid) {
			console.error(`✖ notebooks/${recordId} is served locally and has no upstream to pull from — its wikis are already the corpus`);
			return 1;
		}
	}
	if (!uuid) { console.error(USAGE.split('\n')[9]); return 2; }

	const id = opt(argv, 'wiki') ?? recordId ?? slug(uuid);
	const w = resolveWiki(root, id);
	if (w.refusal) { console.error(`✖ ${w.refusal}`); return 1; }
	const dry = has(argv, 'dry-run');
	const minBytes = Number(opt(argv, 'min-bytes')) || MIN_BYTES;

	let live;
	try { live = nlm(['source', 'list', '-n', uuid, '--json']); } catch (e) { console.error(`✖ ${e.message}`); return 1; }
	const existing = fs.existsSync(w.paths.sources) ? listSources(w.dir) : [];
	const plan = pullPlan(live, existing, { refresh: has(argv, 'refresh'), limit: opt(argv, 'limit') });
	if (plan.refusals.length) { console.error(`✖ ${id} cannot be pulled:`); for (const r of plan.refusals) console.error(`  · ${r}`); return 1; }

	const fetching = plan.steps.filter((s) => s.action === 'fetch');
	console.log(`${dry ? 'plan' : 'pulling'} ${id} ← notebook ${uuid.slice(0, 8)}… · ${plan.steps.length} source(s), ${fetching.length} to fetch`);
	if (dry) { for (const s of plan.steps) console.log(`  ${s.action.padEnd(6)} ${s.file}${s.reason ? ` · ${s.reason}` : ''}`); return 0; }

	// Every source gets its file before any byte is fetched, so a run that dies halfway leaves a folder
	// that names what is missing rather than one that merely lacks it.
	fs.mkdirSync(w.paths.sources, { recursive: true });
	for (const s of plan.steps) {
		if (fs.existsSync(path.join(w.dir, s.file))) continue;
		writeSource(w.dir, s.file, stubFields({ kind: s.kind, ref: s.ref, title: s.title, upstream_id: s.upstream_id, adapter: 'notebooklm' }), '');
	}
	// The body of `index.md` is preserved: it is where a person writes what the corpus covers and what
	// it leaves out. Only the frontmatter is re-derived.
	fs.writeFileSync(w.paths.index, renderIndex(
		{ id, title: nb?.fields?.name ?? id, adapter: 'notebooklm', upstream: uuid, synced_at: new Date().toISOString() },
		indexOf(w).body,
	));

	const tmp = path.join(w.dir, '.fulltext.tmp');
	let n = 0;
	let degraded = 0;
	for (const s of fetching) {
		n += 1;
		const { observation, format } = fetchFulltext(uuid, s.upstream_id, tmp);
		if (format === 'text') degraded += 1;
		const { completeness, reason } = classify({ ...observation, minBytes });
		const fields = {
			...stubFields({ kind: s.kind, ref: s.ref, title: s.title, upstream_id: s.upstream_id, adapter: 'notebooklm' }),
			fetched_at: new Date().toISOString(),
			...(format ? { format } : {}),
			completeness,
			bytes: observation.bytes,
			...(reason ? { reason } : {}),
		};
		writeSource(w.dir, s.file, fields, observation.body);
		console.log(`  ${String(n).padStart(3)}/${fetching.length} ${completeness.padEnd(9)} ${s.file}${format === 'text' ? ' [text]' : ''}${reason ? ` · ${reason}` : ''}`);
	}
	fs.rmSync(tmp, { force: true });
	if (degraded) console.log(`⚠ ${degraded} source(s) came back as PLAIN TEXT, not markdown — headings, tables and links are lost.\n  fix: pip install 'notebooklm-py[markdown]' (or: uv tool install --with markdownify notebooklm-py), then \`wiki pull ${id} --refresh\``);

	const sources = listSources(w.dir);
	const s = summarise(sources);
	if (!w.rec) {
		writeRecord(w.file, {
			fields: {
				name: nb?.fields?.name ?? id, folder: defaultFolder(id), adapter: 'notebooklm', upstream: uuid,
				...(nb?.fields?.account ? { account: nb.fields.account } : {}),
				status: 'active',
				sources_total: s.total, sources_complete: s.complete, sources_incomplete: s.incomplete,
				synced_at: new Date().toISOString(),
			},
			body: '',
		});
		console.log(`✔ wikis/${id} written`);
	} else stampRollup(w, sources);

	if (nb && nbFile) {
		const linked = new Set(nb.fields.wikis ?? []);
		if (!linked.has(`wikis/${id}`)) {
			nb.fields.wikis = [...linked, `wikis/${id}`];
			writeRecord(nbFile, nb);
			console.log(`✔ notebooks/${recordId} now points at wikis/${id}`);
		}
	}

	console.log(`\n${s.total} source(s) · ${COMPLETENESS.map((c) => `${c} ${s.by[c]}`).join(' · ')}`);
	if (s.incomplete) console.log(`⚠ ${s.incomplete} still need scraping — \`npx dt-wiki incomplete ${id}\``);
	console.log(`run \`npx dreamteamer check\`, then commit the record ${path.relative(root, w.file)} and the corpus ${path.relative(root, w.dir)}/ together`);
	return 0;
}

// ── run as a script ──────────────────────────────────────────────────────────────────────────────
// Both sides realpath'd: reached through a symlink (`node_modules/.bin`, a `git_modules/` clone) the
// invoked path and the resolved one differ, and a guard that never fires reads as a clean run.
const __isMain = () => {
	if (!process.argv[1]) return false;
	const real = (p) => { try { return __fs.realpathSync(p); } catch { return __path.resolve(p); } };
	return real(process.argv[1]) === real(__fileURLToPath(import.meta.url));
};
if (__isMain()) {
	const { findWorkspace } = await import('../lib/workspace-root.mjs');
	const ws = findWorkspace();
	if (!ws) { console.error('Not inside a dreamteamer workspace — run this from the folder with package.json and package-lock.json.'); process.exit(1); }
	process.exit(await main(process.argv.slice(2), ws));
}
