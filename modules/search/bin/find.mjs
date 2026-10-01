#!/usr/bin/env node
// `npx dt-find` — the effort ladder over a workspace's own records.
//
// ⚠ WHY THIS IS NOT `wiki ask`. `wiki ask` searches ONE corpus of prose a person assembled. `find`
// searches the WORKSPACE — every collection's records — which is a different thing in the one way
// that matters: records carry REFERENCES, and a question about records is often a question about the
// graph rather than about the prose. Rung 3 exists only here, because only here is there a graph.
//
// ⚠ IT PRINTS LOCATIONS AND NEVER AN ANSWER. Nothing here synthesises. The output is where to read,
// and the reading is the caller's job — a paraphrase is what makes an answer uncheckable, which is the
// failure the `file:line` citation was the fix for.
//
// ⚠ AND IT NEVER GUESSES PAST A REFUSAL. A rung that cannot run says so and names the rung below it;
// an expansion with no agreed reference expands nothing. The measured failure mode this guards is a
// confident set built on one coincidence, which looks exactly like an answer.
import __fs from 'node:fs';
import __path from 'node:path';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { buildQueryDocument, stripLineAnchor, agreedReference, collectionOfAgreeing, RUNGS, suggestEffort } from '../lib/find.mjs';

const USAGE = [
	'usage: npx dt-find <question> [--effort 0|1|2|3] [-c <collection>] [-n N]',
	'                              [--lex "…"] [--vec "…"] [--hyde "…"] [--ref-field <field>] [--json]',
	'',
	'  --effort 0  lexical    exact words. MRR 1.00 in 9ms WHEN YOU ALREADY KNOW THE PHRASE',
	'  --effort 1  vector     embeddings. best MRR and recall@1 of any single backend',
	'  --effort 2  structured lex+vec+hyde in ONE call — hedges a vocabulary gap against an abstraction gap',
	'  --effort 3  + graph    then close the set through the reference the hits agree on',
	'',
	'  ⚠ --lex/--vec/--hyde are where YOU supply the vocabulary the asker lacked. That is the whole',
	'    point of rung 2: the two questions no backend answers are rescued by OPPOSITE lanes, and',
	'    only a caller who knows the domain can write them.',
].join('\n');

const has = (a, f) => a.includes(`--${f}`);
const opt = (a, f) => { const i = a.indexOf(`--${f}`); return i >= 0 ? a[i + 1] : undefined; };

/** Is `qmd` on PATH? Its absence is a degraded mode, never an error — grep is the floor. */
const qmdPresent = () => spawnSync('qmd', ['--version'], { encoding: 'utf8' }).status === 0;

const QMD_MISSING = [
	'✖ `qmd` is not installed — it is the retrieval engine every rung above 0 needs.',
	'    npm install -g @tobilu/qmd',
	'  It is fully on-device: no account, no key, no network.',
	'  ⚠ Measured over 300 records: lexical recall 0.22 against vector\'s 0.80. Real gap — and still',
	'    optional, because grep answers every question asked in the corpus\'s own words.',
].join('\n');

/** Read one record's frontmatter field, without a YAML parser — one flat scalar, first match wins. */
export function frontmatterField(file, field) {
	let text;
	try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
	if (!text.startsWith('---')) return null;
	const end = text.indexOf('\n---', 3);
	const head = end === -1 ? text : text.slice(0, end);
	const m = new RegExp(`^${field}:\\s*(.+)$`, 'm').exec(head);
	return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : null;
}

export function main(argv, root) {
	const flagAt = argv.findIndex((a) => a.startsWith('--') || a === '-c' || a === '-n');
	const question = (flagAt === -1 ? argv : argv.slice(0, flagAt)).join(' ').trim();
	if (!question) { console.error(USAGE); return 2; }

	const effort = Number(opt(argv, 'effort') ?? suggestEffort(question));
	if (!RUNGS[effort]) { console.error(`✖ --effort must be 0, 1, 2 or 3 (got ${opt(argv, 'effort')})`); return 2; }
	const rung = RUNGS[effort];
	const n = opt(argv, 'n') ?? (argv.includes('-n') ? argv[argv.indexOf('-n') + 1] : '10');
	const collection = opt(argv, 'collection') ?? (argv.includes('-c') ? argv[argv.indexOf('-c') + 1] : undefined);

	if (!qmdPresent()) { console.error(QMD_MISSING); return 1; }

	// Rung 0 and 1 take the question as typed; 2 and 3 take the structured document.
	const query = effort >= 2
		? buildQueryDocument({ question, lex: opt(argv, 'lex'), vec: opt(argv, 'vec'), hyde: opt(argv, 'hyde') })
		: question;
	const args = [rung.verb, query, '-n', String(n)];
	if (collection) args.push('-c', collection);
	const r = spawnSync('qmd', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
	if (r.status !== 0) {
		console.error(`✖ qmd ${rung.verb} failed${r.stderr ? `: ${r.stderr.trim().split('\n')[0]}` : ''}`);
		console.error('  is this workspace indexed?  qmd init && qmd collection add data --name <name> && qmd embed');
		return 1;
	}
	const out = (r.stdout ?? '').trim();
	if (!out) {
		console.log('no passage matched.');
		console.log(`  ⚠ Retrieval is SENSITIVE TO WORDING. At effort ${effort} the lanes were what you supplied or`);
		console.log('    what could be derived from the question. Name the instrument, or pass --lex/--vec/--hyde.');
		return 0;
	}

	// ⚠ KEEP THE COLLECTION NAME WITH THE PATH. A qmd collection can be rooted ANYWHERE — in one real
	// workspace `gkrnd` is rooted at `data/rnd`, so a hit reads `issues/x.md` and resolving it against
	// `data/` finds nothing. The collection is the only thing that says where its files actually live,
	// and asking qmd is cheaper than guessing.
	const hits = [...out.matchAll(/qmd:\/\/([a-z0-9-]+)\/(\S+)/g)].map((m) => ({ collection: m[1], file: stripLineAnchor(m[2]) }));
	let expansion = null;
	if (effort >= 3) expansion = expand(hits, root, argv);

	if (has(argv, 'json')) {
		console.log(JSON.stringify({ question, effort, rung: rung.name, backend: `qmd ${rung.verb}`, query, hits, expansion, raw: out }, null, 2));
		return 0;
	}
	console.log(out);
	if (expansion) {
		console.log(`\n─── rung 3: ${expansion.field} = ${expansion.ref}  (${expansion.agreeing} of ${expansion.carrying} hits agree) ───`);
		for (const line of expansion.records) console.log(`    ${line}`);
		console.log(`\n  ⚠ This set is EXACT and the ranking above is not. Retrieval returned ${hits.length}; the graph returned ${expansion.records.length}.`);
	} else if (effort >= 3) {
		console.log('\n─── rung 3: no expansion — the hits agree on no reference, so nothing was closed. ───');
		console.log('    ⚠ That is a refusal, not an empty answer: expanding through a weak plurality would');
		console.log('      hand back a confident set built on one coincidence.');
	}
	console.log(`\n  ⚠ These are LOCATIONS, not an answer. Open each cited line before citing it — a rank is not a fact.`);
	return 0;
}

/** Where a qmd collection's files actually live on disk. Answered once per collection per run. */
function collectionRoot(name, cache) {
	if (cache.has(name)) return cache.get(name);
	const r = spawnSync('qmd', ['collection', 'show', name], { encoding: 'utf8' });
	const p = /^\s*Path:\s*(\S+)/m.exec(r.stdout ?? '')?.[1] ?? null;
	cache.set(name, p);
	return p;
}

/** Rung 3: the reference the hits agree on, then the engine's own filter. */
function expand(hits, root, argv) {
	const field = opt(argv, 'ref-field') ?? 'repo';
	const cache = new Map();
	// ⚠ COLLECT THE REFERENCE AND ITS COLLECTION TOGETHER. Taking the collection from the FIRST hit is
	// the bug this replaced, and it failed in the one way that is hardest to see: the first hit was a
	// draft-doc, which carries no `repo` field at all, so the expansion filtered the WRONG collection,
	// `dt list` exited non-zero, and the whole rung reported "the hits agree on no reference" — a
	// refusal that reads as principled and is actually a defect. The collection must come from the hits
	// that CARRY the agreed reference, because those are the records the set is made of.
	const carried = [];
	for (const hit of hits) {
		const base = collectionRoot(hit.collection, cache);
		if (!base) continue;
		const file = path.join(base, hit.file);
		if (!fs.existsSync(file)) continue;
		const ref = frontmatterField(file, field);
		// The dt collection is the record's own directory relative to `data/` — what `dt list` takes,
		// and NOT the qmd collection name: one qmd collection can span several dt ones.
		const rel = path.relative(path.join(root, 'data'), path.dirname(file));
		carried.push({ ref, collection: rel && !rel.startsWith('..') ? rel : hit.file.split('/')[0] });
	}
	const agreed = agreedReference(carried.map((c) => c.ref));
	if (!agreed) return null;
	const collection = collectionOfAgreeing(carried, agreed.ref);
	if (!collection) return null;
	const r = spawnSync('npx', ['dreamteamer', 'list', collection, '--filter', `${field}=${agreed.ref}`], { cwd: root, encoding: 'utf8' });
	if (r.status !== 0) return null;
	const records = (r.stdout ?? '').trim().split('\n').filter(Boolean).map((l) => l.split(/\s{2,}/)[0]);
	return { field, ref: agreed.ref, agreeing: agreed.agreeing, carrying: agreed.carrying, records };
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
