#!/usr/bin/env node
// The `notebook` verbs — the three things this CLI does to a NotebookLM notebook:
//
//   npx dt-extensions notebook persona <notebook-id> [--print]     apply NOTEBOOKLM.md's persona, ONE call
//   npx dt-extensions notebook restore <record-id> [--account <label>] [--title <t>] [--replace] [--dry-run]
//                                                                    rebuild the notebook a record describes
//   npx dt-extensions notebook capture <record-id> [--dry-run]     fill the record's sources from the live list
//
// A `notebooks` record is the SPEC a notebook can be rebuilt from on any Google account: its ordered
// `sources` and the one `configure` call its `chat` block becomes. `restore` plays that spec against a
// fresh notebook and writes the new uuid, account and source ids back onto the record; `capture` is the
// mirror, for a notebook that existed before its record did. Both print their plan with `--dry-run`
// and touch no network until then.
//
// ⚠ THESE ARE THE CLI'S ONLY VERBS THAT WRITE OVER THE NETWORK. `doctor` is read-only by construction
// and `setup` edits only the workspace; this verb writes ONE setting to ONE notebook the operator
// named on the command line. It still never installs anything and never logs in — an expired
// session is `notebooklm login`, which opens a browser, and that is a person's to run.
//
// ⚠ `notebooklm configure` IS DESTRUCTIVE BY DEFAULT: it replaces the whole configuration with
// whatever the call passes. `configure --response-length longer` alone wiped a 3,039-character
// persona to zero, and a bare `configure` — the obvious way to READ the current settings — cleared
// `response_length` as well. Measured 2026-09-08, twice, the second time while checking the first.
// So there is no read-only inspection: every call sends the FULL configuration, which is why the
// persona has to live in a file under git (NOTEBOOKLM.md, written by compile when the workspace
// declares the `notebooklm` harness) rather than only in the notebook.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import yaml from 'js-yaml';

export const PERSONA_MAX = 10000;

/** The text between a `## <heading>` and whichever comes first: the next `## `, EITHER managed-block
 *  marker, or the end of the file.
 *
 *  ⚠ Both markers, not just `end`. The hand-written additions sit ABOVE the block, so a capture that
 *  stopped only at `## ` ran straight through `<!-- dreamteamer:begin -->` and swallowed the block's
 *  own preamble into the persona — 1,000 characters of "NotebookLM reads no context file", applied to
 *  a notebook as instructions. It was visible only by printing the tail. */
export function section(md, heading) {
	const esc = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const re = new RegExp(`^## ${esc}\\s*$([\\s\\S]*?)(?=^## |<!-- dreamteamer:(?:begin|end)|$(?![\\s\\S]))`, 'm');
	return (re.exec(md)?.[1] ?? '').trim();
}

/** The first `## custom instructions — … additions` heading, whatever the possessive: "this
 *  workspace's", "this team's", "this vault's". The generated block owns the bare heading; anything
 *  hand-written hangs off a dash. */
function additionsHeading(md) {
	return /^## (custom instructions — .*additions)\s*$/m.exec(md)?.[1] ?? null;
}

/** The applied persona: the GENERATED custom instructions first, the workspace's hand-written
 *  additions after. The generated half cannot go stale; the hand-written half knows things a
 *  descriptor cannot. `⚠` lines and the old script pointer are prose about the section, not persona. */
export function personaFrom(md) {
	const generated = section(md, 'custom instructions');
	if (!generated) throw new Error('NOTEBOOKLM.md has no "## custom instructions" section — has `npx dreamteamer compile` run with the notebooklm harness declared?');
	const heading = additionsHeading(md);
	const additions = heading
		? section(md, heading).split('\n').filter((l) => !l.startsWith('⚠') && !/apply-notebook-persona/.test(l)).join('\n').trim()
		: '';
	return additions ? `${generated}\n\n${additions}` : generated;
}

const USAGE = [
	'usage: dt-extensions notebook persona <notebook-id> [--print]',
	'       dt-extensions notebook restore <record-id> [--account <label>] [--title <title>] [--replace] [--dry-run]',
	'       dt-extensions notebook capture <record-id> [--dry-run]',
].join('\n');

/** Returns the exit code. `argv` is everything after the `notebook` verb. */
export function main(argv, root) {
	const [sub, ...rest] = argv;
	if (sub === 'restore') return restoreMain(rest, root);
	if (sub === 'capture') return captureMain(rest, root);
	if (sub !== 'persona') { console.error(`unknown notebook command "${sub ?? ''}"\n${USAGE}`); return 2; }
	const print = rest.includes('--print');
	const id = rest.find((a) => !a.startsWith('-'));

	const file = path.join(root, 'NOTEBOOKLM.md');
	if (!fs.existsSync(file)) {
		console.error(`✖ no NOTEBOOKLM.md in ${root}\n  it is written by compile when the workspace declares the harness:\n  add "notebooklm" to dreamteamer.harnesses in package.json, then npx dreamteamer compile`);
		return 1;
	}
	let persona;
	try { persona = personaFrom(fs.readFileSync(file, 'utf8')); }
	catch (e) { console.error(`✖ ${e.message}`); return 1; }
	if (persona.length > PERSONA_MAX) {
		console.error(`✖ persona is ${persona.length} characters and NotebookLM takes at most ${PERSONA_MAX} — trim the additions in NOTEBOOKLM.md`);
		return 1;
	}
	if (print) { console.log(persona); return 0; }
	if (!id) { console.error(USAGE.split('\n')[0]); return 2; }

	// ⚠ ONE call, carrying EVERY setting — see the note at the top of this file.
	// ⚠ NO `--mode`. It is mutually exclusive with `--persona` and the CLI does not say so: passing
	// both returns `{mode: "default", configured: true}` at exit 0 and SILENTLY DISCARDS the persona
	// and the response length. Measured 2026-09-08 — it reported a 0-character persona three times
	// while the identical string sent without `--mode` landed in full.
	let res;
	try {
		res = execFileSync('notebooklm', ['--quiet', 'configure', '-n', id, '--persona', persona, '--response-length', 'longer', '--json'], { encoding: 'utf8', maxBuffer: 1 << 24 });
	} catch (e) {
		console.error(`✖ notebooklm configure failed — ${e.code === 'ENOENT' ? 'notebooklm is not on PATH (uv tool install notebooklm-py)' : (e.stderr || e.message).toString().trim()}`);
		return 1;
	}
	const out = JSON.parse(res.slice(res.indexOf('{')));
	const got = String(out.persona ?? '').length;
	console.log(`✔ notebook ${id}`);
	console.log(`  persona ${got}/${PERSONA_MAX} chars · response length ${out.response_length} · configured ${out.configured}`);
	if (got !== persona.length) {
		console.error(`✖ the notebook came back with ${got} characters, not ${persona.length} — the write did not land`);
		return 1;
	}
	return 0;
}

// ─── the record as a spec ───────────────────────────────────────────────────────────────────────────

export const SOURCE_KINDS = ['url', 'youtube', 'file', 'text', 'drive', 'export'];
const RESPONSE_LENGTHS = ['default', 'longer', 'shorter'];
const MODES = ['default', 'learning-guide', 'concise', 'detailed'];
/** Placeholders a plan carries until the live call answers with the real id. */
export const NOTEBOOK = '<NOTEBOOK>';
export const SOURCE = '<SOURCE>';

/** `${env:NAME}` → the value from `env`, or a refusal naming the var. A record never carries a
 *  machine path (module rule 9); the plan renders the template where it runs. */
function renderEnv(template, env, where) {
	let missing = null;
	const out = String(template).replace(/\$\{env:([A-Z0-9_]+)\}/g, (_, name) => {
		if (env[name] == null || env[name] === '') { missing = missing ?? name; return ''; }
		return env[name];
	});
	return missing ? { refusal: `${where}: \${env:${missing}} is not set in this environment — export it (or add it to .env) and re-run` } : { value: out };
}

/** The persona a record's `chat` resolves to: inline `persona` wins; else `persona_file`, which is
 *  NOTEBOOKLM.md cut the way the persona verb cuts it, or any other file taken whole. */
function resolvePersona(chat, root, exists, read) {
	if (chat.persona) return { value: String(chat.persona) };
	if (!chat.persona_file) return { value: '' };
	const file = path.isAbsolute(chat.persona_file) ? chat.persona_file : path.join(root, chat.persona_file);
	if (!exists(file)) return { refusal: `chat.persona_file: ${chat.persona_file} does not exist under ${root}` };
	const md = read(file);
	if (path.basename(file) === 'NOTEBOOKLM.md') {
		try { return { value: personaFrom(md) }; } catch (e) { return { refusal: `chat.persona_file: ${e.message}` }; }
	}
	return { value: md.trim() };
}

/**
 * The ordered CLI calls a record becomes — pure, so a fixture can pin it. Every `argv` is what
 * `notebooklm` receives (the `export` step is `dt notebooklm` instead); `NOTEBOOK` and `SOURCE`
 * stand in for ids the live run learns as it goes.
 *
 * `opts`: `title` overrides the notebook title · `env` (default process.env) renders `${env:…}` ·
 * `root` locates `persona_file` · `exists`/`read` are injectable for tests.
 */
export function restorePlan(record, opts = {}) {
	const env = opts.env ?? process.env;
	const exists = opts.exists ?? fs.existsSync;
	const read = opts.read ?? ((f) => fs.readFileSync(f, 'utf8'));
	const root = opts.root ?? process.cwd();
	const steps = [];
	const refusals = [];
	const title = opts.title ?? record.name;
	if (!title) refusals.push('the record has no `name` and no --title was given');
	steps.push({ purpose: 'create', argv: ['create', String(title), '--json'] });

	(record.sources ?? []).forEach((src, i) => {
		const at = `sources[${i}]`;
		const kind = src.kind;
		if (!SOURCE_KINDS.includes(kind)) { refusals.push(`${at}: unknown kind "${kind}" — one of ${SOURCE_KINDS.join(' · ')}`); return; }
		const titled = src.title ? ['--title', String(src.title)] : [];
		if (kind === 'url' || kind === 'youtube') {
			if (!src.ref) { refusals.push(`${at}: a ${kind} source needs its URL in \`ref\``); return; }
			steps.push({ purpose: 'add', at: i, argv: ['source', 'add', '-n', NOTEBOOK, String(src.ref), '--type', kind, '--json'] });
		} else if (kind === 'text') {
			if (!src.text) { refusals.push(`${at}: a text source needs its content in \`text\` — the list cannot recover it, so it lives on the record`); return; }
			steps.push({ purpose: 'add', at: i, argv: ['source', 'add', '-n', NOTEBOOK, String(src.text), '--type', 'text', ...titled, '--json'] });
		} else if (kind === 'file') {
			if (!src.ref) { refusals.push(`${at}: a file source needs its path in \`ref\`, as \`\${env:FILES_FOLDER}/…\``); return; }
			const r = renderEnv(src.ref, env, at);
			if (r.refusal) { refusals.push(r.refusal); return; }
			if (!exists(r.value)) { refusals.push(`${at}: ${r.value} does not exist on this machine`); return; }
			steps.push({ purpose: 'add', at: i, argv: ['source', 'add', '-n', NOTEBOOK, r.value, '--type', 'file', ...titled, '--json'] });
		} else if (kind === 'drive') {
			if (!src.ref) { refusals.push(`${at}: a drive source needs the document id in \`ref\``); return; }
			steps.push({ purpose: 'add', at: i, argv: ['source', 'add-drive', '-n', NOTEBOOK, String(src.ref), ...(src.mime ? ['--mime-type', String(src.mime)] : []), '--json'] });
		} else if (kind === 'export') {
			// `dt notebooklm` (the @dreamteamer/notebooklm extension, installed in the workspace), pointed at
			// the new notebook. It adds, waits for and titles its own sources, so no wait or rename follows.
			const extra = String(src.ref ?? '').trim().split(/\s+/).filter(Boolean);
			steps.push({ purpose: 'export', at: i, argv: ['npx', 'dreamteamer', 'notebooklm', '--notebook', NOTEBOOK, ...extra] });
			return;
		}
		steps.push({ purpose: 'wait', at: i, argv: ['source', 'wait', '-n', NOTEBOOK, SOURCE, '--json'] });
		// ⚠ `--title` is kept on text and file uploads only, and even there the vendor keeps the file
		// NAME on most uploads (0.7.3, measured) — so every titled source is renamed by id afterwards.
		if (src.title) steps.push({ purpose: 'rename', at: i, argv: ['source', 'rename', '-n', NOTEBOOK, SOURCE, String(src.title), '--json'] });
	});

	const chat = record.chat ?? {};
	const rl = chat.response_length ?? 'default';
	if (!RESPONSE_LENGTHS.includes(rl)) refusals.push(`chat.response_length: "${rl}" is not one of ${RESPONSE_LENGTHS.join(' · ')}`);
	if (chat.mode && !MODES.includes(chat.mode)) refusals.push(`chat.mode: "${chat.mode}" is not one of ${MODES.join(' · ')}`);
	const persona = resolvePersona(chat, root, exists, read);
	if (persona.refusal) refusals.push(persona.refusal);
	const text = persona.value ?? '';
	// ⚠ `--mode` and `--persona` are mutually exclusive and the CLI does not say so: sent together, the
	// persona and the response length are DISCARDED at exit 0 (measured 2026-09-08). Refuse, never guess.
	if (text && chat.mode) refusals.push('chat: `mode` and `persona` cannot both be set — NotebookLM keeps one and silently drops the other; a persona IS the custom mode');
	if (text.length > PERSONA_MAX) refusals.push(`chat.persona is ${text.length} characters and NotebookLM takes at most ${PERSONA_MAX}`);
	if (text || chat.mode || rl !== 'default') {
		// ONE call carrying EVERY setting — `configure` replaces the whole configuration each time.
		const setting = text ? ['--persona', text] : chat.mode ? ['--mode', chat.mode] : [];
		steps.push({ purpose: 'configure', argv: ['configure', '-n', NOTEBOOK, ...setting, '--response-length', rl, '--json'], personaLength: text.length });
	}
	return { steps, refusals, title: String(title) };
}

/** One live `source list` entry → a record source, plus what the list could NOT recover. */
export function sourceFromLive(live) {
	const type = String(live.type ?? '').replace(/^SourceType\./, '').toLowerCase();
	const base = { kind: 'file', ref: '', title: live.title ?? '', source_id: live.id };
	if (type === 'web_page') return { source: { ...base, kind: 'url', ref: live.url ?? '' }, needs: live.url ? null : 'ref: the page URL' };
	if (type.startsWith('youtube')) return { source: { ...base, kind: 'youtube', ref: live.url ?? '' }, needs: live.url ? null : 'ref: the video URL' };
	if (type === 'pasted_text') return { source: { ...base, kind: 'text', text: '' }, needs: 'text: the pasted content — `notebooklm source fulltext` can recover it' };
	if (type.startsWith('google_')) {
		const mime = type === 'google_docs' ? 'google-doc' : type === 'google_slides' ? 'google-slides' : type === 'google_spreadsheet' ? 'google-sheets' : undefined;
		return { source: { ...base, kind: 'drive', ...(mime ? { mime } : {}) }, needs: 'ref: the Drive document id' };
	}
	// A PDF the web UI fetched from a URL keeps that URL as its TITLE (measured 2026-09-10 across nine
	// live notebooks: 21 of them). The URL is the restore key — add it as a url and let it title itself.
	if (/^https?:\/\/\S+$/i.test(String(live.title ?? ''))) return { source: { ...base, kind: 'url', ref: String(live.title), title: '' }, needs: null };
	// `dt · <collection>` is what `dt notebooklm` titles its sources — one record
	// entry of kind `export` restores the whole run; per-file refs would be the wrong shape.
	if (/^dt · /.test(String(live.title ?? ''))) return { source: base, needs: 'nothing per file — this is a `dt notebooklm` source; replace the run with ONE `kind: export` entry' };
	const known = ['pdf', 'markdown', 'docx', 'csv', 'epub', 'image', 'media'].includes(type);
	return { source: base, needs: `ref: the file as \${env:FILES_FOLDER}/… (live type ${type || 'unknown'}${known ? '' : ' — not a type this verb knows'})` };
}

/** The whole list → the record's `sources`, keeping ref/text/mime from an existing entry with the
 *  same live id, and naming every source the list could not make restorable. */
export function captureSources(listJson, existing = []) {
	const byId = new Map((existing ?? []).filter((s) => s.source_id).map((s) => [s.source_id, s]));
	const sources = [];
	const unresolved = [];
	for (const live of listJson.sources ?? []) {
		const { source, needs } = sourceFromLive(live);
		const prior = byId.get(live.id);
		const merged = prior ? { ...source, ref: prior.ref || source.ref, ...(prior.text ? { text: prior.text } : {}), ...(prior.mime ? { mime: prior.mime } : {}) } : source;
		const filled = merged.kind === 'text' ? Boolean(merged.text) : Boolean(merged.ref);
		if (needs && !filled) unresolved.push({ title: merged.title, kind: merged.kind, source_id: live.id, needs });
		sources.push(merged);
	}
	return { sources, unresolved };
}

// ─── the record file ────────────────────────────────────────────────────────────────────────────────

/** Read a `<id>.notebook.md` — frontmatter as an object, body verbatim. */
export function readRecord(file) {
	const text = fs.readFileSync(file, 'utf8');
	if (!text.startsWith('---\n')) return { fields: {}, body: text };
	const end = text.indexOf('\n---', 4);
	if (end < 0) return { fields: {}, body: text };
	const fields = yaml.load(text.slice(4, end)) ?? {};
	let body = text.slice(end + 4);
	if (body.startsWith('\n')) body = body.slice(1);
	return { fields, body };
}

/** Write frontmatter back; the body is untouched. */
export function writeRecord(file, { fields, body }) {
	const fm = yaml.dump(fields, { lineWidth: -1, noRefs: true, quotingType: "'" });
	fs.writeFileSync(file, `---\n${fm}---\n${body}`);
}

/** Where a consumer keeps its notebooks records: the compiled descriptor's storage path, else the
 *  module default. */
function recordFile(root, id) {
	let dir = 'data/notebooks';
	try {
		const d = yaml.load(fs.readFileSync(path.join(root, '.dreamteamer', 'collections', 'notebooks.collection.yaml'), 'utf8'));
		if (d?.storage?.path) dir = d.storage.path;
	} catch {}
	return path.join(root, dir, `${id}.notebook.md`);
}

function flag(argv, name) { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; }
const quote = (a) => (/[\s"]/.test(a) ? JSON.stringify(a.length > 60 ? a.slice(0, 57) + '…' : a) : a);
const show = (argv) => argv.map(quote).join(' ');

/** Run one notebooklm call, returning its parsed JSON. Throws with the CLI's own stderr. */
function nlm(argv) {
	let out;
	try { out = execFileSync('notebooklm', ['--quiet', ...argv], { encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'pipe'] }); }
	catch (e) { throw new Error(e.code === 'ENOENT' ? 'notebooklm is not on PATH (uv tool install notebooklm-py)' : (e.stderr || e.message).toString().trim()); }
	const i = out.indexOf('{');
	return i >= 0 ? JSON.parse(out.slice(i)) : {};
}

function restoreMain(rest, root) {
	const id = rest.find((a) => !a.startsWith('-'));
	if (!id) { console.error(USAGE.split('\n')[1]); return 2; }
	const file = recordFile(root, id);
	if (!fs.existsSync(file)) { console.error(`✖ no such record — looked for ${path.relative(root, file)}`); return 1; }
	const rec = readRecord(file);
	const account = flag(rest, '--account');
	const dry = rest.includes('--dry-run');
	if (rec.fields.notebook_id && !account && !rest.includes('--replace')) {
		console.error(`✖ ${id} is already live as notebook ${rec.fields.notebook_id} (account ${rec.fields.account ?? '?'})\n  pass --account <label> to restore a copy on another login, or --replace to re-create it on the same one; the previous uuid stays in git history`);
		return 1;
	}
	const plan = restorePlan(rec.fields, { title: flag(rest, '--title'), root });
	if (plan.refusals.length) {
		console.error(`✖ ${id} cannot be restored as written:`);
		for (const r of plan.refusals) console.error(`  · ${r}`);
		return 1;
	}
	console.log(`${dry ? 'plan' : 'restoring'} ${id} → ${plan.steps.length} call(s)${account ? ` on ${account}` : ''}`);
	for (const s of plan.steps) console.log(`  ${s.purpose.padEnd(9)} ${s.purpose === 'export' ? show(s.argv) : 'notebooklm ' + show(s.argv)}`);
	if (dry) return 0;

	const ids = new Map(); // source index → live id
	let notebookId;
	const fill = (argv, at) => argv.map((a) => (a === NOTEBOOK ? notebookId : a === SOURCE ? ids.get(at) : a));
	try {
		for (const s of plan.steps) {
			if (s.purpose === 'create') { notebookId = nlm(fill(s.argv)).notebook?.id; if (!notebookId) throw new Error('create returned no notebook id'); console.log(`  ✔ created ${notebookId}`); continue; }
			if (s.purpose === 'export') { execFileSync(s.argv[0], fill(s.argv).slice(1), { stdio: 'inherit', cwd: root }); continue; }
			if (s.purpose === 'add') { const sid = nlm(fill(s.argv)).source?.id; if (!sid) throw new Error(`source add for sources[${s.at}] returned no id`); ids.set(s.at, sid); console.log(`  ✔ sources[${s.at}] → ${sid}`); continue; }
			if (s.purpose === 'wait') { try { nlm(fill(s.argv, s.at)); } catch (e) { console.error(`  ⚠ sources[${s.at}] did not become ready: ${e.message}`); } continue; }
			if (s.purpose === 'rename') { nlm(fill(s.argv, s.at)); continue; }
			if (s.purpose === 'configure') {
				const out = nlm(fill(s.argv));
				const got = String(out.persona ?? '').length;
				if (got !== s.personaLength) throw new Error(`configure came back with a ${got}-character persona, not ${s.personaLength} — the write did not land`);
				console.log(`  ✔ configured · persona ${got}/${PERSONA_MAX} · response length ${out.response_length}`);
			}
		}
	} catch (e) {
		console.error(`✖ ${e.message}`);
		if (notebookId) console.error(`  the partial notebook is ${notebookId} — \`notebooklm delete -n ${notebookId} -y\` to discard it; the record was NOT changed`);
		return 1;
	}
	rec.fields.notebook_id = notebookId;
	if (account) rec.fields.account = account;
	rec.fields.sources = (rec.fields.sources ?? []).map((src, i) => (ids.has(i) ? { ...src, source_id: ids.get(i) } : src));
	writeRecord(file, rec);
	console.log(`✔ ${id} → notebook ${notebookId}${account ? ` on ${account}` : ''}; record updated — run \`npx dreamteamer check\` and commit notebooks/${id}`);
	return 0;
}

function captureMain(rest, root) {
	const id = rest.find((a) => !a.startsWith('-'));
	if (!id) { console.error(USAGE.split('\n')[2]); return 2; }
	const file = recordFile(root, id);
	if (!fs.existsSync(file)) { console.error(`✖ no such record — looked for ${path.relative(root, file)}`); return 1; }
	const rec = readRecord(file);
	if (!rec.fields.notebook_id) { console.error(`✖ ${id} has no notebook_id — nothing live to read; \`notebook restore\` is the verb for a record that is only a spec`); return 1; }
	let list;
	try { list = nlm(['source', 'list', '-n', rec.fields.notebook_id, '--json']); } catch (e) { console.error(`✖ ${e.message}`); return 1; }
	const { sources, unresolved } = captureSources(list, rec.fields.sources);
	console.log(`${id}: ${sources.length} live source(s)`);
	for (const s of sources) console.log(`  ${s.kind.padEnd(7)} ${s.title || s.ref}${s.ref ? ` · ${s.ref}` : ''}`);
	if (unresolved.length) {
		console.log(`⚠ ${unresolved.length} cannot be restored from the list alone — fill these on the record:`);
		for (const u of unresolved) console.log(`  · "${u.title}" (${u.kind}, ${u.source_id}) needs ${u.needs}`);
	}
	if (rest.includes('--dry-run')) return 0;
	rec.fields.sources = sources;
	writeRecord(file, rec);
	console.log(`✔ sources written — run \`npx dreamteamer check\` and commit notebooks/${id}`);
	return 0;
}
