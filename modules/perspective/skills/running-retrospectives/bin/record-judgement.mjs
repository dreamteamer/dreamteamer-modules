#!/usr/bin/env node
// record-judgement — the ONLY write path for JUDGED fields on a conversation. Whitelist, not
// blacklist: any key that is not judged rejects the whole payload with exit 2. Mechanical fields
// therefore cannot be corrupted by a model that misread the digest.
//   node record-judgement.mjs <summary-id> --json '{…}' [--body-file <md>] [--data-root <dir>]
import fs from 'node:fs';
import { DATA, WORKSPACE_ROOT } from '../lib/workspace.mjs';
import { recordPath, readRecord, writeRecord } from '../lib/records.mjs';
import { readDescriptor, enumValues } from '../lib/descriptors.mjs';

// THE NAME WHITELIST IS HALF A GUARD. Asking only "is this key judged?" lets a judging worker write a
// PROSE SENTENCE into `outcome`, a closed enum, and a gate that lets the bad write land and relies
// on a later pass to notice is not a gate. So values are validated against the descriptor too — the
// workspace's compiled one, else the one this module ships — which keeps the schema the single
// source of truth.
const FIELDS = readDescriptor(WORKSPACE_ROOT, 'perspective/conversations')?.fields ?? {};
/** The field types whose values are not strings. Every other one — text, a date, a link, a reference's id — is. */
const NUMERIC = new Set(['integer', 'number', 'boolean', 'object', 'map']);

/** Every way a judged value can be illegal, named precisely enough to fix without guessing. */
function valueProblems(payload) {
	const bad = [];
	for (const [key, value] of Object.entries(payload)) {
		const spec = FIELDS[key];
		if (!spec) continue;
		const clip = (v) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s.length > 70 ? s.slice(0, 70) + '…' : s; };
		if (spec.many) {
			if (!Array.isArray(value)) bad.push(`${key}: ${clip(value)} — must be an array`);
			continue;
		}
		const values = enumValues(spec.enum);
		if (values && !values.includes(value)) {
			bad.push(`${key}: ${clip(value)} — must be exactly one of [${values.join(', ')}]${typeof value === 'string' && value.length > 30 ? '. That looks like prose; prose belongs in `summary` or the body.' : ''}`);
			continue;
		}
		if (spec.type === 'integer' && !Number.isInteger(value)) bad.push(`${key}: ${clip(value)} — must be a whole number`);
		if (spec.type === 'number' && typeof value !== 'number') bad.push(`${key}: ${clip(value)} — must be a number`);
		if (typeof spec.type === 'string' && !NUMERIC.has(spec.type) && typeof value !== 'string') bad.push(`${key}: ${clip(value)} — must be a string`);
		if (typeof spec.minimum === 'number' && typeof value === 'number' && value < spec.minimum) bad.push(`${key}: ${value} — below the minimum ${spec.minimum}`);
		if (typeof spec.maximum === 'number' && typeof value === 'number' && value > spec.maximum) bad.push(`${key}: ${value} — above the maximum ${spec.maximum}`);
	}
	return bad;
}

// THIS SET AND THE DESCRIPTOR MUST AGREE. A field the descriptor calls JUDGED but this set omits
// is unwritable — it will simply stay empty forever while every instrument reports success.
// Two descriptor-judged fields are deliberately still absent, for the reason their own descriptions
// give: `oneshot_prompt_words` is a MEASUREMENT (someone actually reran the artifact in one shot),
// not something a reader of a digest may estimate; and `skill_tokens_active` has no honest source in
// a transcript. Adding either here would turn a stated gap into a fabricated number.
export const JUDGED = new Set([
	'subject_repos', 'divergences', 'plan_changes', 'summary', 'goals', 'key_topics', 'outcome',
	'knowledge_kinds', 'interest_score', 'interest_reason',
	'turns_added_information', 'turns_corrected', 'deliverable_kind', 'quality_score',
]);
const argv = process.argv.slice(2);
const opt = (n, d = '') => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const id = argv.find((a) => !a.startsWith('--') && a !== opt('json') && a !== opt('body-file') && a !== opt('data-root'));
if (!id || !opt('json')) { console.error('usage: record-judgement.mjs <summary-id> --json <object> [--body-file f] [--data-root d]'); process.exit(2); }
let payload;
try { payload = JSON.parse(opt('json')); } catch (e) { console.error(`--json is not valid JSON: ${e.message}`); process.exit(2); }
if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) { console.error('--json must be a JSON object of judged fields'); process.exit(2); }
const rejected = Object.keys(payload).filter((k) => !JUDGED.has(k));
if (rejected.length) { console.error(`rejected — not judged fields: ${rejected.join(', ')}. Judged fields are: ${[...JUDGED].join(', ')}`); process.exit(2); }
const badValues = valueProblems(payload);
if (badValues.length) { console.error(`rejected — ${badValues.length} illegal value(s), nothing written:\n  ${badValues.join('\n  ')}`); process.exit(2); }
const file = recordPath('conversations', id, 'conversation', opt('data-root', DATA));
if (!fs.existsSync(file)) { console.error(`no record at ${file}`); process.exit(2); }
const { fields, body } = readRecord(file);
const nextBody = opt('body-file') ? fs.readFileSync(opt('body-file'), 'utf8') : body;

// THIS WRITE FLIPS `depth` TO SUMMARIZED, and `check-records` requires a summarized conversation's
// body to open with `# <title>` and carry a `## recap (no PII)` section — the paragraph that may be
// shown outside the org. So a judgement landed with no --body-file, or with a body missing either
// heading, would leave a record that FAILS the workspace's own check the moment anyone runs it. So
// the body is checked here, before the write. A gate that lets the bad write land is not a gate.
const bodyProblems = [];
if (!/^\s*#\s+\S/.test(nextBody)) bodyProblems.push('the body must open with `# <title>` — the same string as the `title` field, so it stands alone when the frontmatter is stripped');
if (!/^##\s+recap \(no PII\)\s*$/m.test(nextBody)) bodyProblems.push('the body must carry a `## recap (no PII)` section — three to six sentences with no person, company, repo, path, URL, ticket or identifying figure. Anything identifying goes under a later `## detail`');
if (bodyProblems.length) {
	console.error(`rejected — the write-up is not exportable, nothing written:\n  ${bodyProblems.join('\n  ')}\n  (pass --body-file; depth flips to summarized and check-records fails a summarized record without both headings)`);
	process.exit(2);
}

const next = { ...fields, ...payload, depth: 'summarized' };
if (typeof next.interest_score === 'number') next.interest_score = Math.max(0, Math.min(100, Math.round(next.interest_score)));
writeRecord(file, next, nextBody);
process.stdout.write(`✔ ${id} · judged ${Object.keys(payload).length} fields · depth summarized\n`);
