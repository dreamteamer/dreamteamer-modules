#!/usr/bin/env node
// The perspective module's own record guards — the rules the engine's schema cannot express,
// wired into `npm run check` so a finding can never outrun the evidence behind it.
//
//   1. findings  — the body ends with its count `(n sessions)`, every `evidence` ref resolves, and
//                  `standing` follows `evidence_count` unless an ANSWERED QUESTION is among the
//                  evidence (then the person has spoken, and only `confirmed` or `refuted` are legal).
//   2. proposals — every `justified_by` finding exists, and none of them is `refuted`.
//   3. paths     — `sources.location` and `conversations.transcript_path` are `${…}`
//                  templates, never a machine path: records travel between machines unresolved.
//   4. conversations — a SUMMARIZED conversation's body carries its title as `# …` and a
//                  `## recap (no PII)` section, so the write-up can be exported without a
//                  redaction pass. The heading is checked; the absence of PII is a judgement the
//                  judging pass owns and no regex can settle.
//
// The v2 perspective model adds five more (design doc 2026-09-08, §7):
//
//   5. insights  — at least TWO `findings`, each resolving. An insight on one finding IS that
//                  finding; the grain distinction is the reason the collection exists.
//   6. activities — `collaborative` agrees with `collaborators` in BOTH directions (it is a derived
//                  field, and a derived field that disagrees with its source is worse than none);
//                  every `commits` entry is a 7–40 hex SHA, because git is the store and these are
//                  the only pointers into it; `ended` is not before `started`.
//   7. decisions — `source_ref` is non-empty and SHAPED for its `source_kind`, AND the record it
//                  names exists — including a `meetings/<id>` one, resolved against the workspace's
//                  own meetings collection (0.4.0; before that the shape was checked and the
//                  existence never was, which is a claim wearing a provenance).
//   8. perspectives — one per retrospective, and the retrospective points BACK. Init writes the
//                  perspective before it sets the back-pointer, so a missing back-pointer is a `⚠`
//                  warning on stdout (a run in flight), while a back-pointer aimed elsewhere is a
//                  violation (two perspectives for one run).
//   9. workflows — `steps` non-empty (the steps ARE the workflow), at least one resolving activity
//                  as evidence, and the same `collaborative` agreement as an activity.
//  10. world/users — `handles` non-empty (it is the merge key), and no two observed people under one
//                  retrospective share a handle. The readers are supposed to upsert into the
//                  existing record, so a shared handle is an unmerged duplicate — and a wrong merge
//                  attributes one person's work to another, which a person must resolve by hand.
//  11. world/*   — `real` points at its OWN real collection (a violation when it does not: an
//                  observed project claiming to be a task is corrupt, not stale), and resolves to a
//                  record (a WARNING when it does not). The field is `x-reference-soft`, so the
//                  engine ignores both absences by design — this is what stops "soft" meaning
//                  "silent".
//
// `--data-root <dir>` points the whole check at a fixture tree; the default is `data/` under the
// workspace the CURRENT DIRECTORY sits in. ⚠ It REFUSES (exit 2) when there is no workspace there,
// rather than reporting a clean zero — see `workspaceRootFromCwd`, which exists because this guard
// once printed `0 checked, 0 violations` over a workspace holding 173 records.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { listRecords, readRecord } from '../skills/running-retrospectives/lib/records.mjs';
// ⚠ `lib/vault.mjs`'s DATA is deliberately NOT imported — see `workspaceRootFromCwd` below. It
// resolves from the SCRIPT, which is the wrong question the moment the module is linked for
// preview, and importing it here is how it got reached for by accident the first time.

/** Bare collection name → the storage suffix its files carry. Mirrors the descriptors one for one.
 *  ⚠ A COLLECTION MISSING HERE IS SILENTLY UNCHECKED, and one was: `projects` never appeared in this
 *  map, so from the v2 perspective model until 2026-09-08 every project record skipped this guard
 *  entirely while the comment above claimed seventeen entries over sixteen. Nothing failed — that is
 *  the whole problem with a hand-kept mirror, and `mirrors-every-descriptor` in the tests now walks
 *  the descriptor directory and fails when the two disagree. */
const SUFFIX = {
	'retrospective-sessions': 'retrospective-session',
	assumptions: 'assumption',
	gates: 'gate',
	sources: 'source',
	'conversations': 'conversation',
	'activity-weeks': 'activity-week',
	questions: 'question',
	threads: 'thread',
	findings: 'finding',
	proposals: 'proposal',
	// v2 — the perspective model.
	tickets: 'ticket',
	topics: 'topic',
	concepts: 'concept',
	terms: 'term',
	workflows: 'workflow',
	insights: 'insight',
	perspectives: 'perspective',
	// ⚠ THE OBSERVED WORLD — two-segment names, and that is why `collectionOf` below is a
	// longest-prefix match rather than `split('/')[0]`. The old one-segment reading returned `world`
	// for every one of these, so every guard below silently stopped firing on them.
	'world/users': 'user',
	'world/goals': 'goal',
	'world/projects': 'project',
	'world/activity-lanes': 'activity-lane',
	'world/activities': 'activity',
	'world/tasks': 'task',
	// ⚠ MOVED INTO THE NAMESPACE 2026-09-11 — `decisions` and `deliverables` were one-segment names
	// here until the world layer grew to cover the whole projects model. A stale one-segment entry
	// does not fail: `collectionOf` falls through to the first path segment, every record resolves to
	// `world`, and every rule below goes silently inert over them. That is the failure this map's own
	// comment above describes, and it is why the mirror test exists.
	'world/decisions': 'decision',
	'world/deliverables': 'deliverable',
	'world/phases': 'phase',
};
/** Each observed-world collection and the REAL collection its `real` field must point at. One-way,
 *  many-to-one: several contributors' observed copies of one thing point at the same real record,
 *  and no real record ever points back. */
const REAL_TARGET = {
	'world/users': 'users',
	'world/projects': 'projects',
	'world/activity-lanes': 'activity-lanes',
	'world/activities': 'activities',
	'world/tasks': 'tasks',
	'world/goals': 'goals',
	'world/decisions': 'decisions',
	'world/deliverables': 'deliverables',
	'world/phases': 'phases',
};
/** Collection names longest first, so `world/users` is tested before `world`. */
const COLLECTIONS_BY_LENGTH = Object.keys(SUFFIX).sort((a, b) => b.length - a.length);

/** Which collection a record file under `data/perspective/` belongs to — the longest declared name
 *  that prefixes its path at a segment boundary. */
function collectionOf(relPath) {
	for (const name of COLLECTIONS_BY_LENGTH) if (relPath === name || relPath.startsWith(name + '/')) return name;
	return relPath.split('/')[0];
}
/** A commit SHA as it may be cited: git's own abbreviation floor to a full hash. */
const SHA = /^[0-9a-f]{7,40}$/;
/** What a decision's `source_ref` must look like, per `source_kind`. A shape, not a lookup — the
 *  lookup happens too, but only for the refs that point inside this module's own data. */
const SOURCE_REF_SHAPE = {
	'git-commit': { test: (ref) => SHA.test(ref), want: 'a 7–40 hex commit SHA' },
	'agent-session': { test: (ref) => ref.startsWith('perspective/conversations/'), want: 'perspective/conversations/<id>' },
	'decision-log': {
		test: (ref) => ref.startsWith('agent-decision-log/') || /^DECISION-LOG\.md#\d+$/.test(ref),
		want: 'agent-decision-log/<id> or DECISION-LOG.md#<row>',
	},
	ticket: { test: (ref) => ref.startsWith('perspective/tickets/'), want: 'perspective/tickets/<id>' },
	meeting: { test: (ref) => ref.startsWith('meetings/'), want: 'meetings/<id>' },
	interview: { test: (ref) => ref.startsWith('perspective/questions/'), want: 'perspective/questions/<id>' },
	email: { test: (ref) => ref.startsWith('perspective/threads/'), want: 'perspective/threads/<id> — the thread record, never a mail URL' },
};
/** What a finding's polymorphic `evidence` may point at. */
// v2 (decision 314): activities, tickets and decisions are legal evidence too — a finding about a
// contributor with no transcripts on this machine rests on tickets and commits, not sessions.
// 2026-09-08: `answers` is gone — an answer is now a field on the question that asked it, so a
// finding confirmed by the person cites the QUESTION. The record it points at is the same fact; it
// just stopped needing a second id scheme and a join to be read.
// ⚠ `meetings` is the one legal evidence collection that is NOT this module's, and it is spelled
//   without the `perspective/` prefix because it belongs to a PEER module. A finding about how
//   somebody's week is spent rests on the calendar directly; copying a meeting into this module's
//   data to make the ref local would put a domain object here, which is the one thing the module
//   never holds. It resolves against the workspace's own meetings collection — see PEER below.
// ⚠ AND SWEPT AGAIN 2026-09-11, when `decisions` and `deliverables` moved into `perspective/world`.
//   A stale entry here is not a loud failure: the ref resolves, the collection is real, and the guard
//   simply refuses every finding that cites one — measured on the first consumer, 12 correct findings
//   failed in one run. The rule this keeps re-teaching is that a COLLECTION rename and a VOCABULARY
//   rename are the same change, and only a red run connects them.
const EVIDENCE_COLLECTIONS = ['conversations', 'activity-weeks', 'questions', 'world/activities', 'world/tasks', 'tickets', 'world/decisions', 'world/deliverables', 'threads', 'meetings'];
/** The count a finding's body must close with — sessions, weeks or answers, whichever it counted.
 *  ⚠ `weeks` was missing here for one run: the collection was renamed activity-windows →
 *  activity-weeks and this regex was not swept with it, so three correct findings ending `(22 weeks)`
 *  were failed by the guard. A rename that leaves a VOCABULARY behind is the kind the compiler
 *  cannot catch. `windows` stays accepted so records written before the rename still pass. */
// ⚠ SWEEP THIS WITH `EVIDENCE_COLLECTIONS`. `decisions` was added to that list and NOT to this one,
//   so three correct findings closing `(3 decisions)` were failed by the guard on 2026-09-08 — the
//   identical failure the paragraph above records, one collection later. The two lists are one
//   vocabulary and they drift apart silently, because nothing but a red run connects them.
// ⚠ A trailing full stop is allowed. `(4 activities).` is ordinary English and refusing it made the
//   guard a punctuation checker; the thing being enforced is that the COUNT IS THERE.
const COUNT_TAIL = /\(\s*\d+\s+(?:sessions?|weeks?|windows?|answers?|tickets?|activities|activity|commits?|decisions?|threads?|meetings?)\s*\)\s*\.?\s*$/;

/**
 * WHERE THE RECORDS ARE — and this function is a bug fix with a body count of one silent pass.
 *
 * ⚠ MEASURED IN A REAL CONSUMER, 2026-09-11. Run from the workspace root with the module linked for
 * preview, this guard printed `✔ perspective records: 0 checked, 0 violations` and EXITED 0 over a
 * workspace holding 173 of them. The cause: the default came from `lib/vault.mjs`'s `VAULT`, which
 * walks up from the SCRIPT — and under preview the module lives outside the workspace (a
 * `git_modules/` symlink into a clone elsewhere), so the walk found the PACKAGE's own root and
 * looked for records in a tree that has none by design.
 *
 * A guard that reports success while doing nothing is the worst failure this repo can ship: it is
 * byte-identical to a pass. It is also exactly what this module's own `gates` descriptor refuses —
 * "a verdict without a measurement is success being reported instead of a result being quoted".
 *
 * So: walk up from the CURRENT DIRECTORY, the way the engine resolves a workspace, and REFUSE when
 * no root is found rather than reporting a clean zero. There is deliberately NO script-relative
 * fallback — that fallback WAS the defect, and a fallback that can silently answer the wrong
 * question is worse than an error.
 *
 * ⚠ The `git_modules/` skip is the same rule `lib/vault.mjs` carries and for the same measured
 * reason: `npm install` inside a module clone leaves a lockfile there, so a walk that stops at the
 * first `package-lock.json` resolves the CLONE as the workspace.
 *
 * ⚠ ZERO RECORDS IS STILL LEGAL. A workspace that has the module installed and has never run a
 * retrospective has no `data/perspective` at all, and `0 checked` is the honest answer for it. The
 * refusal keys on "no workspace root", never on "no records".
 */
function workspaceRootFromCwd(start = process.cwd()) {
	for (let d = path.resolve(start); ; d = path.dirname(d)) {
		const inGitModules = path.basename(path.dirname(d)) === 'git_modules';
		if (!inGitModules && fs.existsSync(path.join(d, 'package-lock.json'))) return d;
		if (path.dirname(d) === d) return null;
	}
}

function dataRootFromArgv(argv) {
	const i = argv.indexOf('--data-root');
	if (i >= 0) {
		const value = argv[i + 1];
		if (!value) throw new Error('--data-root needs a directory');
		return path.resolve(value);
	}
	const ws = workspaceRootFromCwd();
	if (!ws) {
		console.error('✖ perspective guard: no workspace here.');
		console.error(`    Looked for package-lock.json in ${process.cwd()} and every directory above it.`);
		console.error('    Run this from inside the workspace whose records you want checked, or pass --data-root <dir>.');
		console.error('    ⚠ Refusing rather than reporting "0 checked, 0 violations" — a guard that says nothing');
		console.error('      while checking nothing is indistinguishable from a guard that passed.');
		process.exit(2);
	}
	return path.join(ws, 'data');
}

const dataRoot = dataRootFromArgv(process.argv.slice(2));
const root = path.join(dataRoot, 'perspective');
const rel = (file) => path.relative(path.dirname(dataRoot), file);

// ── the PEER collections a ref may legally point OUT of this module at ──────────────────────────
// ⚠ `meetings/<id>` was accepted UNRESOLVED until 0.4.0. `SOURCE_REF_SHAPE.meeting` has demanded the
// prefix since v2, and `refTarget` returned null for anything not under `perspective/`, so the shape
// was checked and the existence never was: a decision could cite a meeting that had been renamed,
// deleted or never existed and `check` said nothing. The shape guard alone is exactly the "provenance
// that cannot be followed back" this file's rule 7 exists to refuse.
//
// The workspace root is the parent of the data root — that is what a `data/…` storage path is
// relative to. The COMPILED descriptor is the authority on where the records are; the shipped
// default is the fallback for a fixture with no compiled runtime beside it. And when the collection
// is not installed AT ALL, a ref into it is a WARNING and never a violation: the meetings module is
// a peer, a workspace may legitimately not have it, and failing `check` over a record whose own
// fields are innocent would block that workspace for someone else's absence.
const workspaceRoot = path.dirname(dataRoot);
const PEER = (() => {
	const out = {};
	// ⚠ THE REAL WORLD. Every `perspective/world/*` collection carries `real`, a one-way SOFT
	// reference to the record it appears to be — `x-reference-soft`, so the engine's own `check`
	// ignores it whether the collection is absent or the record is. That is deliberate (a
	// correspondence is a judgement a run made on a date, and a deleted project must not turn a whole
	// workspace red), but "ignored" must not mean "unsaid": a `real` that points at nothing is
	// reported HERE, as a warning, which is what makes the softness honest rather than silent.
	for (const [collection, fallbackPath, fallbackSuffix] of [
		['meetings', 'data/meetings', 'meeting'],
		['users', 'data/users', 'user'],
		['projects', 'data/projects', 'project'],
		['activities', 'data/activities', 'activity'],
		['tasks', 'data/tasks', 'task'],
		['goals', 'data/goals', 'goal'],
	]) {
		const compiled = path.join(workspaceRoot, '.dreamteamer', 'collections', `${collection}.collection.yaml`);
		let storage;
		if (fs.existsSync(compiled)) {
			try { storage = (yaml.load(fs.readFileSync(compiled, 'utf8')) ?? {}).storage; } catch { /* unreadable → the fallback below */ }
		}
		const dir = path.join(workspaceRoot, String(storage?.path || fallbackPath));
		const suffix = String(storage?.suffix || fallbackSuffix);
		out[collection] = { dir, suffix, installed: Boolean(storage?.path) || fs.existsSync(dir) };
	}
	return out;
})();
const peerGaps = new Map();   // collection → how many refs could not be resolved because it is absent

/** A qualified ref → where its file would be. Null when the ref names no collection this can resolve. */
function refTarget(ref) {
	const parts = String(ref).split('/');
	if (parts.length < 2) return null;
	if (parts[0] !== 'perspective') {
		const peer = PEER[parts[0]];
		if (!peer || parts.length < 2) return null;
		const id = parts.slice(1).join('/');
		return { collection: parts[0], id, peer, file: path.join(peer.dir, `${id}.${peer.suffix}.md`) };
	}
	if (parts.length < 3) return null;
	// ⚠ LONGEST PREFIX, not `parts[1]`. `perspective/world/users/dana/sam` is the collection
	// `world/users` and the id `dana/sam`; splitting at the first segment made it the collection
	// `world`, which is in no SUFFIX map, so every ref into the observed world returned null and
	// every guard that resolves one silently stopped resolving.
	const rest = parts.slice(1).join('/');
	const collection = COLLECTIONS_BY_LENGTH.find((n) => rest.startsWith(n + '/'));
	if (!collection) return null;
	const id = rest.slice(collection.length + 1);
	if (!id) return null;
	return { collection, id, file: path.join(root, collection, `${id}.${SUFFIX[collection]}.md`) };
}

/** Does the record a ref names exist? `null` = unanswerable, because the peer collection is absent. */
function resolves(target) {
	if (target.peer && !target.peer.installed) {
		peerGaps.set(target.collection, (peerGaps.get(target.collection) ?? 0) + 1);
		return null;
	}
	return fs.existsSync(target.file);
}

const violations = [];
const fail = (file, rule) => violations.push(`${rel(file)}: ${rule}`);
/** Not a violation: a state a run in flight legitimately passes through. Printed, never exited on. */
const warnings = [];
const warn = (file, note) => warnings.push(`⚠ ${rel(file)}: ${note}`);
/** A field the schema types as an array, read defensively — a hand-edit may leave a bare string. */
const list = (value) => (Array.isArray(value) ? value : value === undefined || value === null || value === '' ? [] : [value]);

const files = listRecords(root);
const records = new Map();
for (const file of files) {
	try {
		records.set(file, readRecord(file));
	} catch (error) {
		fail(file, `unreadable frontmatter — ${error.message}`);
	}
}

/** A finding is confirmed or refuted only by the person, and the only place the person speaks in this
 *  module is the `answer` on a question they were asked. ⚠ Citing the QUESTION is not enough — an
 *  unanswered question is a question, and a finding may not be promoted to `confirmed` by the fact
 *  that somebody once thought of asking. The answer must actually be there. */
function citesAnsweredQuestion(evidence) {
	for (const ref of evidence) {
		const target = refTarget(ref);
		if (!target || target.collection !== 'questions') continue;
		const q = records.get(target.file);
		if (String(q?.fields?.answer ?? '').trim()) return true;
	}
	return false;
}

for (const [file, { fields, body }] of records) {
	const collection = collectionOf(path.relative(root, file));

	/* ⚠ A GOAL'S COUNT IS ITS REFS, and the descriptor says which: decisions, activities and
	 *  projects, once each. Measured 2026-09-08 on the first run that wrote goals: three of three
	 *  under-counted their own attachments by one or two, and on the next run seven of seven counted
	 *  a different subset (topics in, projects out). Nobody was lying — everyone was counting
	 *  something slightly different. So the count is DERIVED here and a mismatch is a violation, and
	 *  `corroborated` needs three, and `confirmed`/`refuted` need a person — a goal is never asked
	 *  directly, so the only route is a cited finding that an answered question already confirmed. */
	if (collection === 'world/goals') {
		const refs = new Set([...list(fields.decisions), ...list(fields.activities), ...list(fields.projects)]);
		const count = Number(fields.evidence_count ?? 0);
		if (count !== refs.size) {
			fail(file, `evidence_count ${count} but ${refs.size} distinct decisions+activities+projects are attached — the count is the refs`);
		}
		const standing = fields.standing;
		if (standing === 'corroborated' && refs.size < 3) {
			fail(file, `standing corroborated with ${refs.size} refs — under three it is inferred`);
		}
		if (standing === 'confirmed' || standing === 'refuted') {
			const viaFinding = list(fields.findings).some((ref) => {
				const t = refTarget(ref);
				const f = t && records.get(t.file);
				return f && (f.fields.standing === 'confirmed' || f.fields.standing === 'refuted');
			});
			if (!viaFinding) fail(file, `standing ${standing} — a goal is ${standing} only through a cited finding a person has confirmed or refuted`);
		}
	}

	/* ⚠ A SUGGESTION IS NOT AN ANSWER, and the two fields exist so nobody has to pretend otherwise.
	 *  Two ways the separation breaks, both refused: a suggestion with no `suggestion_evidence` is a
	 *  guess wearing a record, and an `answer` that is byte-for-byte the suggestion is the machine
	 *  quoting itself in the one field where only the person speaks. The interviewer who copies a
	 *  suggestion into `answer` because the person nodded has changed `answer_origin` to a lie. */
	if (collection === 'questions') {
		const suggested = String(fields.suggested_answer ?? '').trim();
		const answer = String(fields.answer ?? '').trim();
		if (suggested && !list(fields.suggestion_evidence).length) {
			fail(file, 'suggested_answer with no suggestion_evidence — a suggestion is read out of records, name them');
		}
		if (suggested && answer && suggested === answer) {
			fail(file, 'answer is identical to suggested_answer — the person did not say it, the run did; leave answer empty or record their actual words');
		}
		if (answer && !fields.answer_origin) {
			fail(file, 'answer without answer_origin — say whether it was spoken, typed or relayed');
		}
	}

	if (collection === 'findings') {
		if (!COUNT_TAIL.test(body ?? '')) {
			fail(file, 'finding body must end with its evidence count, e.g. `(3 sessions)`');
		}
		const evidence = Array.isArray(fields.evidence) ? fields.evidence : fields.evidence ? [fields.evidence] : [];
		for (const ref of evidence) {
			const target = refTarget(ref);
			if (!target) {
				fail(file, `evidence ${ref} is not perspective/<${EVIDENCE_COLLECTIONS.filter((c) => c !== 'meetings').join('|')}>/<id> or meetings/<id>`);
				continue;
			}
			if (!EVIDENCE_COLLECTIONS.includes(target.collection)) {
				fail(file, `evidence ${ref} points at ${target.collection}; evidence is ${EVIDENCE_COLLECTIONS.join(', ')}`);
				continue;
			}
			if (resolves(target) === false) fail(file, `evidence ${ref} does not resolve to a record`);
		}
		const count = Number(fields.evidence_count ?? 0);
		const standing = fields.standing;
		if (citesAnsweredQuestion(evidence)) {
			if (standing !== 'confirmed' && standing !== 'refuted') {
				fail(file, `standing ${standing} — an ANSWERED interview question is cited, so it is confirmed or refuted`);
			}
		} else {
			const expected = count >= 3 ? 'pattern' : 'anecdote';
			if (standing !== expected) {
				fail(file, `standing ${standing} with evidence_count ${count} — unconfirmed findings are ${expected}`);
			}
		}
	}

	if (collection === 'conversations' && fields.depth === 'summarized') {
		const text = body ?? '';
		if (!/^#\s+\S/m.test(text)) fail(file, 'summarized conversation body must open with `# <title>`');
		if (!/^##\s+recap\s*\(no PII\)\s*$/im.test(text)) fail(file, 'summarized conversation body must carry a `## recap (no PII)` section — the paragraph that is safe to export');
	}

	if (collection === 'proposals') {
		const justified = Array.isArray(fields.justified_by)
			? fields.justified_by
			: fields.justified_by
				? [fields.justified_by]
				: [];
		for (const ref of justified) {
			const target = refTarget(ref);
			if (!target || target.collection !== 'findings') {
				fail(file, `justified_by ${ref} is not perspective/findings/<id>`);
				continue;
			}
			const finding = records.get(target.file);
			if (!finding) {
				fail(file, `justified_by ${ref} does not resolve to a finding`);
				continue;
			}
			if (finding.fields?.standing === 'refuted') fail(file, `justified_by ${ref} is refuted — a proposal may not cite one`);
		}
	}

	if (collection === 'insights') {
		const findings = list(fields.findings);
		if (findings.length < 2) {
			fail(file, `findings has ${findings.length} ref(s) — an insight is drawn ACROSS at least two findings`);
		}
		for (const ref of findings) {
			const target = refTarget(ref);
			if (!target || target.collection !== 'findings') {
				fail(file, `findings ${ref} is not perspective/findings/<id>`);
				continue;
			}
			if (!records.has(target.file)) fail(file, `findings ${ref} does not resolve to a finding`);
		}
	}

	if (collection === 'world/activities' || collection === 'workflows') {
		const collaborators = list(fields.collaborators);
		const collaborative = fields.collaborative === true;
		if (collaborators.length && !collaborative) {
			fail(file, `collaborative is not true but ${collaborators.length} collaborator(s) are named — the derived field must agree`);
		}
		if (!collaborators.length && collaborative) {
			fail(file, 'collaborative is true but no collaborators are named — the derived field must agree');
		}
	}

	if (collection === 'world/activities') {
		for (const sha of list(fields.commits)) {
			if (!SHA.test(String(sha))) fail(file, `commits ${sha} is not a 7–40 hex commit SHA`);
		}
		if (fields.ended && fields.started && String(fields.ended) < String(fields.started)) {
			fail(file, `ended ${fields.ended} is before started ${fields.started}`);
		}
	}

	// 11. A `real` THAT POINTS AT NOTHING. The field is `x-reference-soft`, so the engine's own
	//     `check` ignores it whether the collection is absent or the record is — deliberately, because
	//     a correspondence is a judgement a run made on a date and a deleted project must not turn a
	//     whole workspace red. But soft must not mean silent: a wrong TARGET is a violation (an
	//     observed project claiming to be a task is a corrupt record, not a stale one), and a right
	//     target that resolves to nothing is a warning.
	if (REAL_TARGET[collection] && typeof fields.real === 'string' && fields.real.trim()) {
		const want = REAL_TARGET[collection];
		const target = refTarget(fields.real.trim());
		if (!target || target.collection !== want) {
			fail(file, `real ${fields.real} is not ${want}/<id> — an observed object joins to its OWN real collection, never to another`);
		} else if (resolves(target) === false) {
			warn(file, `real ${fields.real} resolves to no record — the correspondence is kept (it is what the run judged), but nothing is there now`);
		}
	}

	if (collection === 'decisions') {
		const ref = typeof fields.source_ref === 'string' ? fields.source_ref.trim() : '';
		const kind = fields.source_kind;
		if (!ref) {
			fail(file, 'source_ref is empty — a decision must name where it was extracted from');
		} else {
			const shape = SOURCE_REF_SHAPE[kind];
			if (!shape) {
				fail(file, `source_kind ${kind} is not one of ${Object.keys(SOURCE_REF_SHAPE).join(', ')}`);
			} else if (!shape.test(ref)) {
				fail(file, `source_ref ${ref} is not shaped for source_kind ${kind} — expected ${shape.want}`);
			}
			const target = refTarget(ref);
			if (target && resolves(target) === false) fail(file, `source_ref ${ref} does not resolve to a record`);
		}
	}

	if (collection === 'perspectives') {
		const self = `perspective/perspectives/${path.relative(path.join(root, 'perspectives'), file).replace(/\.perspective\.md$/, '')}`;
		const target = refTarget(fields.retrospective);
		if (!target || target.collection !== 'retrospective-sessions') {
			fail(file, `retrospective ${fields.retrospective} is not perspective/retrospective-sessions/<id>`);
		} else if (!records.has(target.file)) {
			fail(file, `retrospective ${fields.retrospective} does not resolve to a retrospective`);
		}
		// ⚠ THE BACK-POINTER CHECK IS GONE, and its absence is the point. It existed to catch
		// `retrospective-sessions.perspective` disagreeing with `perspectives.retrospective` — two
		// hand-maintained halves of one relation. Since 2026-09-09 the session's field is a GENERATED
		// mirror (`x-inverse: perspective`, `x-unique: true`), so the two cannot disagree: the engine
		// maintains it on every `dt` write and reports it stale after a raw one. A guard whose job the
		// schema can do is a guard that will one day disagree with the schema.
		void self;
	}

	// 10. A GATE'S VERDICT WITHOUT ITS MEASUREMENT is the pattern rule 7 exists to catch: success
	//     reported rather than a result quoted. And a waiver with no reason is an undocumented
	//     shortcut that reads, later, exactly like a pass.
	if (collection === 'gates') {
		if (fields.verdict && fields.verdict !== 'not-run' && !String(fields.measured ?? '').trim()) {
			fail(file, `verdict ${fields.verdict} with no \`measured\` — quote the count, the command's line, or the person's words`);
		}
		if (fields.verdict === 'waived' && !String(fields.waived_because ?? '').trim()) {
			fail(file, 'waived with no `waived_because` — a waiver without a reason is an undocumented shortcut');
		}
	}

	if (collection === 'workflows') {
		if (!list(fields.steps).length) fail(file, 'steps is empty — the ordered steps ARE the workflow');
		const activities = list(fields.activities);
		if (!activities.length) fail(file, 'activities is empty — a workflow is observed across activities, never asserted');
		for (const ref of activities) {
			const target = refTarget(ref);
			if (!target || target.collection !== 'world/activities') {
				fail(file, `activities ${ref} is not perspective/world/activities/<id>`);
				continue;
			}
			if (!records.has(target.file)) fail(file, `activities ${ref} does not resolve to an activity`);
		}
	}

	if (collection === 'world/users' && !list(fields.handles).length) {
		fail(file, 'handles is empty — it is the merge key, and an observed person without one can never be matched');
	}

	for (const field of ['location', 'transcript_path']) {
		const value = fields[field];
		if (typeof value !== 'string' || value === '') continue;
		// A `url:` location is machine-independent by nature — the Asana source carries one — so it is
		// as legal as a template. The rule exists to stop a resolved filesystem path travelling, nothing else.
		// ⚠ A BARE http(s) URL is machine-independent by the SAME argument, and the rule was narrower
		// than its own stated intent until 2026-09-08: read-drive writes a Drive web link, which is the
		// only sane `location` for an artefact that does not live in the vault, and all 53 of the first
		// contributor's deliverables were refused for it. A link is not a path.
		if (/^(url:|https?:\/\/)/.test(value)) continue;
		if (!value.startsWith('${') || value.startsWith('/')) {
			fail(file, `${field} must be a \${…} template or a url:, never a machine path`);
		}
	}
}

// Two collaborators under one retrospective sharing a handle is the unmerged duplicate: the readers
// upsert into the record whose `handles` already carry the identity, so a second record means one
// person's work is being split in two. BOTH files are named, because only a person can say which
// record survives — and this is a violation, not a warning, because the readers should never make one.
const handleOwners = new Map(); // `${retrospective}\0${handle}` → first file that claimed it
for (const [file, { fields }] of records) {
	if (collectionOf(path.relative(root, file)) !== 'world/users') continue;
	const run = fields.retrospective ?? '';
	for (const handle of list(fields.handles)) {
		const key = `${run}\0${String(handle).trim().toLowerCase()}`;
		const first = handleOwners.get(key);
		if (first === undefined) {
			handleOwners.set(key, file);
			continue;
		}
		fail(first, `handle ${handle} is also on ${rel(file)} — two collaborators for one person, merge them`);
		fail(file, `handle ${handle} is also on ${rel(first)} — two collaborators for one person, merge them`);
	}
}

// ── the module clone's own unpushed work ────────────────────────────────────────────────────────
// ⚠ AN EDIT MADE IN THE STUDIO, IN A CONSUMING WORKSPACE, LANDS HERE — inside `git_modules/<name>`,
// which is gitignored THERE and is a clone of the module repo. So the change is invisible to the
// module, invisible to every other workspace consuming it, and erased by the next pull. Worse, the
// clone diverges, so `git pull --ff-only` refuses outright and the module silently stops updating
// in that workspace until somebody looks.
//
// Twice in one day, both found by accident while carrying something else. A note in a file did not
// stop the second one, so this is the guard: `check` runs on every workspace, every time, and it is
// the only thing that reliably looks at this directory.
//
// A WARNING, not a violation: the work is not wrong, it is merely stranded, and refusing `check`
// would block a workspace over a state its own records are innocent of.
function strandedCloneWarning() {
	const here = fileURLToPath(new URL('..', import.meta.url));
	if (!here.includes(`${path.sep}git_modules${path.sep}`)) return null;   // running from the module repo itself
	const git = (args) => {
		try { return execFileSync('git', ['-C', here, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
		catch { return null; }
	};
	const ahead = git(['rev-list', '--count', 'origin/main..HEAD']);
	const dirty = git(['status', '--porcelain']);
	if (ahead === null) return null;                                        // no origin, or not a clone — not our business
	const commits = Number(ahead) || 0;
	const files = dirty ? dirty.split('\n').filter(Boolean).length : 0;
	if (!commits && !files) return null;
	const parts = [];
	if (commits) parts.push(`${commits} commit(s) not on origin`);
	if (files) parts.push(`${files} uncommitted file(s)`);
	return [
		`⚠ the consumed module clone has work that exists NOWHERE ELSE — ${parts.join(' and ')}.`,
		`    ${here}`,
		'    This directory is gitignored by THIS workspace and is a clone of the module repo, so an edit',
		'    made here (the studio commits ui-view saves into it) is invisible to the module, invisible to',
		'    every other workspace, and lost on the next pull — which will itself refuse, because the clone',
		'    has diverged.',
		'    Carry it to the module repo by hand, then `git -C <the clone> reset --hard origin/main`.',
	].join('\n');
}
const stranded = strandedCloneWarning();
if (stranded) warnings.push(stranded);

// A ref into a peer collection this workspace does not have is UNCHECKED, and saying so is the
// whole point: silence here would read exactly like a pass, which is what the `meetings` shape guard
// did for two releases while resolving nothing.
for (const [collection, n] of peerGaps) {
	warnings.push(
		`⚠ ${n} ref(s) point at \`${collection}/…\`, which this workspace does not have — they were NOT resolved.`
		+ `\n    Install the \`${collection}\` module (it is a declared peer) and re-run to have them checked.`,
	);
}

for (const warning of warnings) console.log(warning);

if (violations.length) {
	console.error(`\nperspective guard: ${violations.length} violation(s)`);
	for (const violation of violations) console.error(violation);
	process.exit(1);
}

console.log(`✔ perspective records: ${files.length} checked, 0 violations`);
