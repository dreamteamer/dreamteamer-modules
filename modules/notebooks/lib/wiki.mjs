// THE RULES A WIKI IS JUDGED BY — pure, so a fixture can pin every one of them without a network
// call, a login or a folder. `bin/wiki.mjs` does the disk; this file does the deciding.
//
// A wiki is a collection of markdown sources serialised as a FOLDER: `wiki.yaml`, then
// `sources/<nn>--<slug>.md`, nested into subfolders when the corpus has sections. Every source is a
// file — including one nothing has downloaded yet, which exists as a STUB carrying
// `completeness: pending` and no body.
//
// ⚠ THE STUB IS THE WHOLE POINT. A corpus that is half fetched and looks finished is the failure this
// design is against, and absence is the one state a reader cannot see. So the inventory is laid out
// complete-and-empty first and filled second, and the marker travels in the frontmatter of the file it
// judges — where copying the folder copies the truth, deleting the file deletes the claim, and
// `grep -l 'completeness: pending'` still works when every tool here is gone.
//
// Nothing in this file knows anything about any particular person, machine, corpus or account.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

// ─── the completeness marker ────────────────────────────────────────────────────────────────────────

/** The five states, worst first. Each is separated from its neighbour by an OBSERVATION, never by a
 *  shade of meaning — see `classify`, which is the only thing allowed to assign one. */
export const COMPLETENESS = ['pending', 'failed', 'empty', 'partial', 'complete'];

/** Under this many bytes of body, a fetch that exited 0 returned nothing worth keeping. A blocked
 *  page, a paywall and a Drive doc the login cannot read all come back as a short stub, and a real
 *  markdown source is kilobytes. Movable per run with `--min-bytes`; the judged byte count is kept on
 *  the file, so re-classifying never needs a re-download. */
export const MIN_BYTES = 256;

/** `notebooklm source fulltext` in TEXT mode truncates here (0.7.3, its own `--help` says so). A
 *  fetch that lands exactly on the cap is `partial`, not `complete` — this is the case the whole
 *  marker exists for, because it succeeds at exit 0 and looks like a finished source. */
export const TEXT_TRUNCATION = 2000;

/**
 * One fetch's OBSERVATIONS → one state, with the reason a later pass needs.
 *
 *   attempted      false means nothing has run yet — the stub
 *   status         the adapter's exit code
 *   bytes          the body actually written
 *   truncated      the adapter itself said it stopped early
 *   expectedBytes  a length known in advance, when the adapter reports one
 *   error          the adapter's stderr; only its first line is kept
 *
 * The order is load-bearing: a non-zero exit is `failed` even when it wrote nothing, because the
 * remedy is retry; a clean exit that wrote nothing is `empty`, because the remedy is a different
 * route entirely.
 */
export function classify({ attempted = false, status = 0, bytes = 0, truncated = false, expectedBytes = null, error = '', minBytes = MIN_BYTES } = {}) {
	if (!attempted) return { completeness: 'pending', reason: 'never fetched' };
	if (status !== 0) return { completeness: 'failed', reason: String(error || '').split('\n')[0].trim() || `the adapter exited ${status}` };
	if (bytes < minBytes) return { completeness: 'empty', reason: `${bytes} bytes, under the ${minBytes}-byte floor — the route works, the content is not there` };
	if (truncated) return { completeness: 'partial', reason: `truncated at ${bytes} bytes — refetch in a format that does not cap` };
	if (expectedBytes != null && bytes < expectedBytes) return { completeness: 'partial', reason: `${bytes} of ${expectedBytes} bytes — the fetch stopped early` };
	return { completeness: 'complete', reason: '' };
}

/** Counts by state, plus the two numbers a rollup carries. `sources` is anything with a
 *  `completeness`; an unknown or absent one counts as `pending` rather than being dropped. */
export function summarise(sources = []) {
	const by = Object.fromEntries(COMPLETENESS.map((s) => [s, 0]));
	for (const s of sources) {
		const state = COMPLETENESS.includes(s?.completeness) ? s.completeness : 'pending';
		by[state] += 1;
	}
	const total = sources.length;
	return { total, by, complete: by.complete, incomplete: total - by.complete };
}

// ─── which adapter answers for a record ─────────────────────────────────────────────────────────────

export const ADAPTERS = ['local', 'notebooklm'];

/**
 * The adapter a `notebooks` record is served by.
 *
 * ⚠ THERE IS NO DEFAULT ON THE FIELD, on purpose. Defaulting to `notebooklm` would contradict the
 * point of the local implementation — that a notebook needs no login — and defaulting to `local`
 * would silently relabel every record written before this release. So the field is optional and the
 * answer is DERIVED when it is absent: a record with a live uuid is served by NotebookLM, and one
 * without is a folder. The field exists only to override that, which is needed exactly once: when a
 * notebook that was restored upstream should stop being served from there.
 */
export function adapterOf(record = {}, override) {
	const pick = override ?? record.adapter;
	if (pick) {
		if (!ADAPTERS.includes(pick)) throw new Error(`unknown adapter "${pick}" — one of ${ADAPTERS.join(' · ')}`);
		return pick;
	}
	return record.notebook_id ? 'notebooklm' : 'local';
}

// ─── the folder ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Where a new wiki's `folder` field points: `wikis/<id>`, INSIDE the workspace and at its ROOT.
 *
 * ⚠ THIS MOVED IN 2026-09-11, and the move is the point of the collection. It used to be
 * `${env:FILES_FOLDER}/wikis/<id>` — outside the repo, on a synced drive — on the general rule that
 * bytes are not committed. That rule is about MEDIA: a recording, a scan, a screenshot, a PDF.
 * A wiki is none of those. It is markdown a coding agent GREPS and cites by `file:line`, and putting
 * it outside the clone cost exactly the thing the module was built for:
 *
 *   · a bare clone did not have the corpus, so "zero prerequisite" was false — the one claim the
 *     local adapter exists to make
 *   · a cloud session could not reach it at all (no Drive mount, by construction)
 *   · a citation could not be reviewed in a diff, or followed from a record, or pinned to a commit
 *
 * So the corpus is source, and it is versioned like source. The cost is real and is stated rather
 * than discovered: a corpus is megabytes of text and it lands in every clone forever. Keep scraped
 * PDFs and recordings where they were — under `${env:FILES_FOLDER}` — and keep here only what is
 * meant to be READ as text.
 *
 * ⚠ AND IT IS NOT UNDER `data/`, WHICH IS NOT A STYLE CHOICE. Every path under `data/` belongs to
 * some collection's storage, and `dreamteamer check` walks a collection's folder and WARNS on every
 * file in it that is not a record. Measured 2026-09-11: four corpora placed at `data/notebooks/<id>`
 * produced 42 warnings on every single check — one per source file plus one per manifest. The check
 * still passed, which is worse than failing: 42 permanent warnings is how people learn to skim
 * warnings, and that is how the next real one is missed. `wikis/` at the repo root is owned by no
 * collection, so a corpus is invisible to the record layer by construction rather than by exemption.
 *
 * ⚠ THE BETTER MODEL, NOT YET BUILT: make `wikis` a FOLDER-shaped collection (`shape: folder`,
 * `entry: wiki.md`). Check reads one level of a folder-shaped collection and looks only for the entry
 * file, so everything nested inside is invisible — the record and its corpus become ONE object, which
 * is what a wiki actually is. That is a record-model change with a migration behind it; this is the
 * correct cheap answer until it is made.
 *
 * ⚠ RELATIVE, not absolute, and not an `${env:…}` template. It resolves against the WORKSPACE ROOT
 * (see `resolveWiki`), so the same record works on every machine with no variable to set and nothing
 * to render — which is a stronger portability claim than the template it replaces, not a weaker one.
 * An existing record carrying the old template still renders and still works; nothing rewrites it.
 */
export const defaultFolder = (id) => `wikis/${id}`;

/** The folder every wiki sits under, relative to the workspace root. */
export const WIKI_ROOT = 'wikis';

/** Everything inside a wiki folder, once the template has been rendered. */
export function wikiPaths(root) {
	return {
		root,
		// ⚠ `index.md`, NOT `wiki.yaml`. A corpus is ONLY markdown: every file in it carries frontmatter
		// and reads in an editor, so a YAML manifest was the one file in the folder a reader could not
		// open the way they open everything else. The keys did not change — they moved into
		// frontmatter. `legacyManifest` is still read so a folder written before 2026-09-11 works
		// untouched; nothing rewrites one until the wiki is next written.
		index: path.join(root, 'index.md'),
		legacyManifest: path.join(root, 'wiki.yaml'),
		sources: path.join(root, 'sources'),
		notes: path.join(root, 'notes'),
	};
}

/** Lowercase kebab, capped — the slug half of a source filename and of a section folder. Returns ''
 *  when the title carries nothing latin-alphanumeric, which the caller reads as "use the number". */
export function slug(text, max = 48) {
	const s = String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
	if (s.length <= max) return s;
	const cut = s.slice(0, max);
	return cut.slice(0, cut.lastIndexOf('-') > 8 ? cut.lastIndexOf('-') : max).replace(/-+$/, '');
}

/**
 * `<nn>--<slug>.md`, or `<nn>.md` when the title slugs to nothing.
 *
 * ⚠ The number is the CORPUS ORDER and it is global, so `ls -R` is the order with no manifest lookup
 * and no second copy of the ordering to disagree with the first. A gap left by a delete is honest and
 * is never closed up: renumbering would move every file a link points at.
 */
export function sourceFileName(index, title) {
	const nn = String(index).padStart(3, '0');
	const s = slug(title);
	return s ? `${nn}--${s}.md` : `${nn}.md`;
}

/** The source's path INSIDE `sources/`, POSIX-spelled: a section becomes one subfolder. */
export function sourcePath(index, title, section) {
	const file = sourceFileName(index, title);
	const dir = slug(section);
	return dir ? `${dir}/${file}` : file;
}

// ─── the file format ────────────────────────────────────────────────────────────────────────────────

/** A source file → `{ fields, body, bodyLine }`. A file with no frontmatter is all body, which is how
 *  a hand-written markdown file dropped into `sources/` is still readable.
 *
 *  ⚠ `bodyLine` is the 1-based line of the FILE that `body` starts on, and it exists because leaving
 *  it out silently broke the one thing `wiki search` is for. Numbering a hit inside the body reports
 *  `<file>:<n>` where n is short by exactly the frontmatter's height — measured on a real corpus,
 *  reported line 44 against actual line 55, and 62 against 73. The number looks perfectly plausible,
 *  opens the wrong line, and nothing anywhere says so. A citation you cannot open is not a citation. */
export function parseSource(text) {
	const s = String(text ?? '');
	if (!s.startsWith('---\n')) return { fields: {}, body: s, bodyLine: 1 };
	const end = s.indexOf('\n---', 4);
	if (end < 0) return { fields: {}, body: s, bodyLine: 1 };
	const fields = yaml.load(s.slice(4, end)) ?? {};
	const consumed = s.slice(0, end + 4);
	let body = s.slice(end + 4);
	let bodyLine = consumed.split('\n').length;
	if (body.startsWith('\n')) { body = body.slice(1); bodyLine += 1; }
	return { fields, body, bodyLine };
}

/** `{ fields, body }` → a source file. The body is written verbatim — including a `---` line of its
 *  own, which `parseSource` reads back unharmed because only the FIRST closing marker is a boundary. */
export function renderSource(fields, body = '') {
	const fm = yaml.dump(fields, { lineWidth: -1, noRefs: true, quotingType: "'" });
	return `---\n${fm}---\n${body}`;
}

/** The frontmatter a source carries before anything has been fetched. */
export function stubFields({ kind, ref = '', title = '', upstream_id, adapter, section, source_file }) {
	return {
		kind,
		ref,
		title,
		// ⚠ WHERE THE ORIGINAL IS KEPT — and an original is kept only when there is a REASON, never by
		// default. A `${env:FILES_FOLDER}/…` TEMPLATE, never a machine path: the bytes stay out of the
		// repo, the corpus carries the text, and this field carries the pointer.
		//
		// Keep an original when ONE of these is true, and say which in the body:
		//   · RESTORING IT WOULD COST EFFORT — a paywalled or login-walled document, a one-off export,
		//     a URL that has already moved once, a file somebody sent that exists nowhere else.
		//   · IT HOLDS MORE THAN THE EXTRACTION DOES — figures, diagrams, a table the converter
		//     flattened, a signature page, pagination a citation depends on. Text extraction loses
		//     these silently, and the loss is invisible in the markdown that replaced them.
		//
		// Do NOT keep one for a document that can be re-fetched from a stable public URL: `ref` is
		// already that pointer, and a second copy is a thing to keep in sync for no gain. Absent is
		// the normal state and the honest one; a guessed path is a link that opens nothing.
		...(source_file ? { source_file } : {}),
		...(section ? { section } : {}),
		...(adapter ? { adapter } : {}),
		...(upstream_id ? { upstream_id } : {}),
		completeness: 'pending',
		bytes: 0,
	};
}

/**
 * `index.md` — the corpus's own page: identity, adapter, upstream and the counts AS OF the last sync
 * in frontmatter, then whatever a person wrote about what this corpus covers.
 *
 * ⚠ IT WAS `wiki.yaml` UNTIL 2026-09-11. The keys are identical; only the serialisation moved. The
 * reason is the rule the whole folder now obeys — a corpus is ONLY markdown, every file carrying
 * frontmatter — and a lone YAML file was the one thing in it that did not open the way everything
 * else does, in an editor, in a preview, in the same reader that renders the sources.
 *
 * ⚠ AND IT STILL LISTS NO SOURCES. That was true of the manifest and it is truer of a file called
 * `index`: a list of the sources is a SECOND index of a folder that already indexes itself by
 * filename, and the day the two disagree one of them is quietly wrong with nothing to say which.
 * `wiki status` renders the list from the folder, on demand, and cannot go stale.
 *
 * ⚠ THE BODY IS A PERSON'S, AND IT IS PRESERVED. Re-rendering an index keeps whatever prose is
 * already under the frontmatter — this file is where "what this corpus covers, and what it
 * deliberately does not" belongs, and a writer that overwrote it would make it worthless to write.
 */
export function renderIndex(m, body = '') {
	const fm = yaml.dump({
		id: m.id,
		title: m.title ?? m.id,
		adapter: m.adapter ?? 'local',
		...(m.upstream ? { upstream: m.upstream } : {}),
		...(m.persona ? { persona: m.persona } : {}),
		...(m.synced_at ? { synced_at: m.synced_at } : {}),
		...(m.counts ? { counts: m.counts } : {}),
	}, { lineWidth: -1, noRefs: true, quotingType: "'" });
	const prose = String(body ?? '').trim();
	return `---\n${fm}---\n${prose ? `\n${prose}\n` : '\n'}`;
}

/** The frontmatter of an `index.md`, or of a legacy bare-YAML `wiki.yaml` — both are accepted, and
 *  which one it is, is decided by whether the text opens a frontmatter fence. */
export function parseIndex(text) {
	const t = String(text ?? '');
	const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(t);
	if (!m) return { fields: yaml.load(t) ?? {}, body: '' };      // legacy wiki.yaml
	return { fields: yaml.load(m[1]) ?? {}, body: m[2] };
}

/** ⚠ KEPT AS ALIASES so nothing that imported the old names breaks mid-release. `renderManifest`
 *  now writes markdown, which is the point — a caller that wanted YAML is a caller that wanted the
 *  shape this release removed. */
export const renderManifest = (m) => renderIndex(m);
export const parseManifest = (text) => parseIndex(text).fields;

// ─── reading a corpus without a model ───────────────────────────────────────────────────────────────

/** A body's headings, in order — the mechanical stand-in for a summary the local adapter cannot
 *  generate. Fenced code is skipped, because a `# comment` in a shell block is not a heading. */
export function outline(body, maxLevel = 2) {
	const out = [];
	let fenced = false;
	for (const line of String(body ?? '').split('\n')) {
		if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
		if (fenced) continue;
		const m = /^(#{1,6})\s+(.*\S)\s*$/.exec(line);
		if (m && m[1].length <= maxLevel) out.push({ level: m[1].length, text: m[2] });
	}
	return out;
}

/** Every line of `body` matching `re`, as `{ line, text }` — numbered from `firstLine`, so a hit reads
 *  as a citation (`<file>:<line>`) rather than as an offset nobody can open.
 *
 *  ⚠ PASS THE SOURCE'S `bodyLine`. The default of 1 is correct only for a string that IS the whole
 *  file; for a parsed source the body starts below the frontmatter, and defaulting there is what
 *  produced line numbers that were plausible, wrong, and silent about it. */
export function searchBody(body, re, cap = 200, firstLine = 1) {
	const out = [];
	String(body ?? '').split('\n').forEach((text, i) => {
		if (out.length < cap && re.test(text)) out.push({ line: firstLine + i, text: text.trim() });
		re.lastIndex = 0;
	});
	return out;
}

// ─── templates and the environment ──────────────────────────────────────────────────────────────────

/** `${env:NAME}` → its value, or a refusal naming the variable. Records carry the template; only the
 *  machine that runs the verb may render it.
 *  ⚠ Deliberately a second copy of `bin/notebook.mjs`'s private renderer: `lib/` may not import from
 *  `bin/`, and eight duplicated lines beat a dependency edge in the wrong direction. */
export function renderTemplate(template, env = process.env) {
	let missing = null;
	const value = String(template ?? '').replace(/\$\{env:([A-Z0-9_]+)\}/g, (_, name) => {
		if (env[name] == null || env[name] === '') { missing = missing ?? name; return ''; }
		return env[name];
	});
	return missing
		? { refusal: `\${env:${missing}} is not set in this environment — export it, or add it to .env, and re-run` }
		: { value };
}

/** `.env` text → its key/value pairs. Names AND values, unlike the doctor's `envKeys`: the doctor's
 *  rule is that a value never reaches an OUTPUT, and it still holds — a `wiki` verb renders
 *  `FILES_FOLDER` into a folder it is about to write to, on the operator's own machine. */
export function parseEnv(text) {
	const out = {};
	for (const line of String(text ?? '').split('\n')) {
		const m = /^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
		if (!m) continue;
		let v = m[2].trim();
		if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
		if (v !== '') out[m[1]] = v;
	}
	return out;
}

/** The environment a verb renders templates against: the workspace's `.env`, overridden by anything
 *  actually exported. Without this, `${env:FILES_FOLDER}` renders only when the variable happens to be
 *  in the shell — which it almost never is under `npx`. */
export function envFrom(root, base = process.env) {
	let fromFile = {};
	try { fromFile = parseEnv(fs.readFileSync(path.join(root, '.env'), 'utf8')); } catch { /* no .env is a normal, working state */ }
	return { ...fromFile, ...Object.fromEntries(Object.entries(base).filter(([, v]) => v != null && v !== '')) };
}

// ─── reading the vendor's answer ────────────────────────────────────────────────────────────────────

/**
 * One `notebooklm` invocation's raw result → `{ json }` or `{ error }`.
 *
 * ⚠ THE VENDOR REPORTS FAILURE AS A JSON PAYLOAD ON STDOUT, AND SOMETIMES AT EXIT 0. Measured
 * 2026-09-11 on notebooklm-py 0.7.3: `source fulltext --format markdown` answers
 * `{"error": true, "code": "UNEXPECTED_ERROR", "message": "…requires the 'markdownify' package…"}`
 * — exit 2 with `-o`, exit 0 without it, stderr empty either way. Branching on the exit code alone
 * gave 129 sources whose recorded reason was the command line echoed back, which named nothing; the
 * payload names the fix in one sentence. So the PAYLOAD is read first, whatever the exit code says.
 */
export function vendorResult({ stdout = '', stderr = '', status = 0 } = {}) {
	const i = String(stdout).indexOf('{');
	let json = null;
	if (i >= 0) { try { json = JSON.parse(String(stdout).slice(i)); } catch { /* not JSON — the exit code decides */ } }
	if (json?.error) return { error: String(json.message ?? json.code ?? 'the call reported an error') };
	if (status !== 0) return { error: String(stderr).trim() || `notebooklm exited ${status}` };
	return { json: json ?? {} };
}

/** The ONE fetch failure a lossier format actually fixes: `--format markdown` needs the vendor's
 *  optional `markdownify` extra, which a plain install does not bring. Any other error is left alone —
 *  retrying a real failure in a lossier format is how a bad answer gets written down as a good one. */
export const MARKDOWN_EXTRA_MISSING = /markdownify/i;

// ─── the pull ───────────────────────────────────────────────────────────────────────────────────────

/** One upstream `source list` entry's type → the kind a local source file carries. */
export function kindFromUpstream(type) {
	const t = String(type ?? '').replace(/^SourceType\./, '').toLowerCase();
	if (t === 'web_page') return 'url';
	if (t.startsWith('youtube')) return 'youtube';
	if (t === 'pasted_text') return 'text';
	if (t.startsWith('google_')) return 'drive';
	return 'file';
}

/**
 * The ordered work a `wiki pull` becomes — pure, so a fixture pins it without a network call.
 *
 * `live`      the upstream `source list --json` payload (or its `sources` array)
 * `existing`  the source files already on disk, as `{ upstream_id, completeness, path }`
 * `opts`      `refresh` re-fetches what is already complete · `limit` caps the run · `section(live)`
 *             assigns a subfolder
 *
 * ⚠ EVERY live source produces a step, including the ones being skipped. The plan IS the inventory,
 * and a step dropped because it looked finished is a source that stops being counted.
 */
export function pullPlan(live, existing = [], opts = {}) {
	const rows = Array.isArray(live) ? live : (live?.sources ?? []);
	const by = new Map(existing.filter((e) => e?.upstream_id).map((e) => [e.upstream_id, e]));
	const section = opts.section ?? (() => '');
	const steps = [];
	const refusals = [];
	if (!rows.length) refusals.push('the upstream notebook reports no sources — nothing to pull');

	rows.forEach((row, i) => {
		const index = Number.isInteger(row.index) ? row.index : i + 1;
		const id = row.id;
		if (!id) { refusals.push(`sources[${i}]: the upstream list gave no id — it cannot be tracked or resumed`); return; }
		const kind = kindFromUpstream(row.type);
		const prior = by.get(id);
		const file = prior?.path ?? `sources/${sourcePath(index, row.title, section(row))}`;
		const done = prior?.completeness === 'complete';
		steps.push({
			action: done && !opts.refresh ? 'skip' : 'fetch',
			index, upstream_id: id, kind, file,
			title: row.title ?? '',
			ref: row.url ?? '',
			reason: done && !opts.refresh ? 'already complete — pass --refresh to fetch it again' : '',
		});
	});

	const limit = Number(opts.limit) || 0;
	if (limit > 0) {
		let budget = limit;
		for (const s of steps) {
			if (s.action !== 'fetch') continue;
			if (budget > 0) { budget -= 1; continue; }
			s.action = 'skip';
			s.reason = `over --limit ${limit}`;
		}
	}
	return { steps, refusals };
}
