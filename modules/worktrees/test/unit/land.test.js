// Tier 1 — `land`'s two pure decisions: which collection a conflicted path belongs to, and what the
// landing would do. No fs, no git, no subprocess: every input here is hand-built, which is the only
// way these can be asserted at all — the interesting states (a primary with pending store writes, a
// lock held by a live pid) are expensive and racy to manufacture on a disk and trivial to state as
// data.
//
// The refusal strings are contracts, not messages: `dt land` prints them verbatim and each one has
// to be enough to fix the state without reading the engine. They are asserted whole, one state at a
// time, so a reworded refusal shows up as a failing test rather than as a support question.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import '../helpers.mjs'; // binds the engine API `groupByCollection` reads storage through
import { LAND_LOCK, groupByCollection, planLand, mirrorModules } from '../../src/land.js';
import { mirrorLinkedDeps } from '../../src/worktrees.js';

/** A compiled v2 descriptor reduced to what grouping reads: the storage path compile resolved, and
 *  whether the collection is runtime build output. */
const compiled = (name, p, { runtime = false } = {}) => ({ name, compiled: { defaults: { storage: { path: p } }, runtime } });

const descriptors = new Map([
	['notes', compiled('notes', 'data/notes')],
	['hr/people', compiled('hr/people', 'data/hr/people')],
	// a compiled source: its records live in the gitignored runtime, and a conflict can never be one
	['collections', compiled('collections', 'collections', { runtime: true })],
]);

describe('groupByCollection — conflicted paths, named by the collection the operator knows', () => {
	test('three paths become two collections and the residue', () => {
		const g = groupByCollection(['data/notes/a.note.md', 'data/hr/people/b.person.md', 'README.md'], descriptors);
		assert.deepEqual([...g.keys()], ['notes', 'hr/people', 'other files'], 'insertion order follows the paths given');
		assert.deepEqual(g.get('notes'), ['data/notes/a.note.md']);
		assert.deepEqual(g.get('hr/people'), ['data/hr/people/b.person.md']);
		assert.deepEqual(g.get('other files'), ['README.md']);
	});

	test('the LONGEST storage path wins — a namespace parent must not swallow its child', () => {
		// The exact shape `storageOverlaps` exists to refuse at compile time; grouping a conflict is
		// the wrong place to discover it, so the resolution is longest-prefix regardless.
		const overlapping = new Map([
			['hr', compiled('hr', 'data/hr')],
			['hr/people', compiled('hr/people', 'data/hr/people')],
		]);
		const g = groupByCollection(['data/hr/people/b.person.md', 'data/hr/c.hr.md'], overlapping);
		assert.deepEqual(g.get('hr/people'), ['data/hr/people/b.person.md']);
		assert.deepEqual(g.get('hr'), ['data/hr/c.hr.md']);
	});

	test('a path under the data path that no collection claims is named as such, not filed under other files', () => {
		const g = groupByCollection(['data/orphans/x.md', 'README.md'], descriptors);
		assert.deepEqual([...g.keys()], ['data (no collection)', 'other files']);
		assert.deepEqual(g.get('data (no collection)'), ['data/orphans/x.md']);
	});

	test('a runtime collection never claims a path — .dreamteamer is build output, not a record', () => {
		const g = groupByCollection(['collections/notes.collection.yaml'], descriptors);
		assert.deepEqual([...g.keys()], ['other files']);
	});

	test('several paths in one collection stay in the order they were given', () => {
		const g = groupByCollection(['data/notes/b.note.md', 'data/notes/a.note.md'], descriptors);
		assert.deepEqual(g.get('notes'), ['data/notes/b.note.md', 'data/notes/a.note.md']);
	});

	test('an empty path list is an empty map, not a map of empty groups', () => {
		assert.equal(groupByCollection([], descriptors).size, 0);
	});

	test('the data path is a parameter — a descriptor outside it is not a collection here', () => {
		const g = groupByCollection(['data/notes/a.note.md'], descriptors, 'records');
		assert.deepEqual([...g.keys()], ['other files'], 'data/notes is outside the declared data path');
	});

	test('… and the unclaimed group follows the same parameter', () => {
		assert.deepEqual([...groupByCollection(['records/x/y.md'], descriptors, 'records').keys()], ['data (no collection)']);
	});
});

/** A worktree that can be landed: every refusal test below turns exactly one thing bad. */
const clean = () => ({
	name: 'w',
	worktree: { kind: 'linked', root: '/w/ws/.worktrees/w' },
	branch: 'worktree-w',
	primaryBranch: 'main',
	detached: false,
	upstream: null,
	dirtyRecords: 0,
	uncommitted: 0,
	pendingPrimary: 0,
	dirtyPrimaryTouched: [],
	range: { commits: 2, files: ['data/notes/a.note.md'] },
	lock: { held: false, pid: null, age_s: 0, path: `/w/ws/.git/${LAND_LOCK}` },
	keep: false,
});

const refusalsFor = (patch) => planLand({ ...clean(), ...patch }).refusals;

describe('planLand — the refusals, each for exactly its state', () => {
	test('a clean state refuses nothing', () => {
		assert.deepEqual(refusalsFor({}), []);
	});

	test('the primary checkout', () => {
		assert.deepEqual(refusalsFor({ worktree: { kind: 'primary', root: '/w/ws' } }), ['it is the primary checkout']);
	});

	test('a detached worktree — the refusal carries the two commands that fix it', () => {
		assert.deepEqual(refusalsFor({ detached: true, branch: null }),
			['it is DETACHED (no branch) — inside it: git switch -c worktree-w, or dt land w --branch w to do that first']);
	});

	test('dirty records in the worktree', () => {
		assert.deepEqual(refusalsFor({ dirtyRecords: 3 }), ['3 dirty record(s) — dt commit them first']);
	});

	test('uncommitted changes in the worktree', () => {
		assert.deepEqual(refusalsFor({ uncommitted: 1 }), ['1 uncommitted change(s) — commit or discard them first']);
	});

	test('a pushed branch is refused rather than rewritten', () => {
		assert.deepEqual(refusalsFor({ upstream: 'origin/worktree-w' }),
			['branch worktree-w has an upstream (origin/worktree-w) — a pushed branch is not rebased; land it by hand']);
	});

	test('the primary has pending store writes — the reason is in the text', () => {
		assert.deepEqual(refusalsFor({ pendingPrimary: 4 }),
			['the primary has 4 pending record write(s) — dt commit them first (a landing would sweep them into someone else\'s subject)']);
	});

	test('the primary has uncommitted changes to a file this branch touches', () => {
		assert.deepEqual(refusalsFor({ dirtyPrimaryTouched: ['data/notes/a.note.md', 'README.md'] }),
			['the primary has uncommitted changes to 2 file(s) this branch also touches: data/notes/a.note.md, README.md']);
	});

	test('… and only the first five paths are named', () => {
		const six = ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => `data/notes/${n}.note.md`);
		const [r] = refusalsFor({ dirtyPrimaryTouched: six });
		assert.match(r, /^the primary has uncommitted changes to 6 file\(s\) this branch also touches: /);
		assert.ok(r.endsWith('data/notes/a.note.md, data/notes/b.note.md, data/notes/c.note.md, data/notes/d.note.md, data/notes/e.note.md, …'),
			`the sixth path is elided, not printed: ${r}`);
	});

	test('another land holds the lock — the pid, the age and the path to remove', () => {
		assert.deepEqual(refusalsFor({ lock: { held: true, pid: 4242, age_s: 12, path: '/w/ws/.git/dreamteamer-land.lock' } }),
			['another land holds the lock (pid 4242, 12s) — wait, or remove /w/ws/.git/dreamteamer-land.lock if that process is gone']);
	});

	test('an old lock reads in minutes, not in four-digit seconds', () => {
		const [r] = refusalsFor({ lock: { held: true, pid: 7, age_s: 3600, path: '/w/ws/.git/dreamteamer-land.lock' } });
		assert.match(r, /\(pid 7, 60m\)/);
	});

	test('nothing to land', () => {
		assert.deepEqual(refusalsFor({ range: { commits: 0, files: [] } }),
			['nothing to land — worktree-w is already on main']);
	});

	test('… and a detached worktree with nothing to land says (detached), never "null"', () => {
		const r = refusalsFor({ detached: true, branch: null, range: { commits: 0, files: [] } });
		assert.equal(r.at(-1), 'nothing to land — (detached) is already on main');
	});

	test('several bad things are ALL reported, in the contract\'s order — one run, one fix list', () => {
		assert.deepEqual(refusalsFor({ dirtyRecords: 1, uncommitted: 2, pendingPrimary: 3 }), [
			'1 dirty record(s) — dt commit them first',
			'2 uncommitted change(s) — commit or discard them first',
			'the primary has 3 pending record write(s) — dt commit them first (a landing would sweep them into someone else\'s subject)',
		]);
	});

	test('a refused plan has no steps — nothing is offered that would not run', () => {
		assert.deepEqual(planLand({ ...clean(), uncommitted: 1 }).steps, []);
	});
});

const idsFor = (patch) => planLand({ ...clean(), ...patch }).steps.map((s) => s.id);

describe('planLand — the steps, in the order they run', () => {
	test('the ordinary landing: lock, a copy, the rebase, recompile the copy, check, ff, recompile the primary, retire', () => {
		assert.deepEqual(idsFor({}), ['lock', 'copy', 'rebase', 'recompile-copy', 'check', 'ff', 'recompile-primary', 'retire']);
	});

	test('every step says why — the plan is what --dry-run prints', () => {
		for (const s of planLand(clean()).steps) assert.ok(s.why && s.why.length > 0, `step ${s.id} has no why`);
	});

	// ⚠ THE PLAN IS THE RUN. `landWorktree` compiles the copy on EVERY landing — `.dreamteamer/` is
	// gitignored, so a fresh checkout has no runtime for `check` to read — so the plan lists the step
	// whatever the range holds, or a --dry-run prints a plan the real run does not follow.
	test('recompile-copy is in EVERY plan, whatever the range holds', () => {
		assert.deepEqual(idsFor({}),
			['lock', 'copy', 'rebase', 'recompile-copy', 'check', 'ff', 'recompile-primary', 'retire']);
		assert.deepEqual(idsFor({ range: { commits: 1, files: ['README.md', 'data/notes/a.note.md'] } }),
			['lock', 'copy', 'rebase', 'recompile-copy', 'check', 'ff', 'recompile-primary', 'retire']);
	});

	test('npm-ci appears iff package-lock.json is in the range, and after the fast-forward', () => {
		assert.ok(!idsFor({}).includes('npm-ci'));
		assert.deepEqual(idsFor({ range: { commits: 1, files: ['package-lock.json'] } }),
			['lock', 'copy', 'rebase', 'recompile-copy', 'check', 'ff', 'npm-ci', 'recompile-primary', 'retire']);
	});

	test('--keep drops retire and nothing else', () => {
		assert.deepEqual(idsFor({ keep: true }), ['lock', 'copy', 'rebase', 'recompile-copy', 'check', 'ff', 'recompile-primary']);
	});

	test('both extras together, still in the contract\'s order', () => {
		assert.deepEqual(idsFor({ keep: true, range: { commits: 3, files: ['README.md', 'package-lock.json'] } }),
			['lock', 'copy', 'rebase', 'recompile-copy', 'check', 'ff', 'npm-ci', 'recompile-primary']);
	});

	test('the lock step names the file land takes', () => {
		const [lock] = planLand(clean()).steps;
		assert.equal(lock.id, 'lock');
		assert.ok(lock.why.includes(LAND_LOCK), `the lock step names ${LAND_LOCK}: ${lock.why}`);
	});
});

// ⚠ THE SEAM BETWEEN TWO TASKS, and the one thing a per-task review could not see. `createWorktree`
// (checkout.js) learned to mirror a shadowing `git_modules/<name>` symlink into a new worktree;
// `land` makes a SECOND worktree — the throwaway the rebase runs in — and never got the same fix.
// `git_modules/` is gitignored, so the copy had none, and `land` runs only `compile` there, never
// `install`. The copy therefore compiled without a whole module and ran the `check` gate against
// fewer collections than the workspace has, silently.
describe('mirrorModules — the copy compiles with the SAME modules as the primary', () => {
	const mk = () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-mirror-'));
		fs.mkdirSync(path.join(root, 'primary', 'git_modules'), { recursive: true });
		fs.mkdirSync(path.join(root, 'primary', 'node_modules'), { recursive: true });
		fs.mkdirSync(path.join(root, 'temp'), { recursive: true });
		fs.mkdirSync(path.join(root, 'elsewhere', 'extra'), { recursive: true });
		return root;
	};

	test('a SYMLINKED git_modules entry is mirrored into the temp tree', () => {
		const root = mk();
		fs.symlinkSync(path.join(root, 'elsewhere', 'extra'), path.join(root, 'primary', 'git_modules', 'extra'), 'dir');
		mirrorModules(path.join(root, 'primary'), path.join(root, 'temp'));
		const at = path.join(root, 'temp', 'git_modules', 'extra');
		assert.ok(fs.existsSync(at), 'the shadowing module never reached the copy — check would run against fewer collections');
		assert.equal(fs.realpathSync(at), fs.realpathSync(path.join(root, 'elsewhere', 'extra')));
	});

	// LINKS ONLY, for the reason createWorktree gives: a real clone under git_modules/ is
	// per-checkout working state, and linking it would hand two checkouts one working tree.
	test('a REAL git_modules clone is left alone', () => {
		const root = mk();
		fs.mkdirSync(path.join(root, 'primary', 'git_modules', 'hr'), { recursive: true });
		mirrorModules(path.join(root, 'primary'), path.join(root, 'temp'));
		assert.equal(fs.existsSync(path.join(root, 'temp', 'git_modules', 'hr')), false);
	});

	test('node_modules is still mirrored, and no git_modules folder is invented when there is none', () => {
		const root = mk();
		fs.rmSync(path.join(root, 'primary', 'git_modules'), { recursive: true });
		mirrorModules(path.join(root, 'primary'), path.join(root, 'temp'));
		assert.ok(fs.existsSync(path.join(root, 'temp', 'node_modules')));
		assert.equal(fs.existsSync(path.join(root, 'temp', 'git_modules')), false);
	});
});

// A new worktree must load the SAME extensions as the tree it was cut from: every direct dependency
// that is a symlink here (a dev shadow, `npm link`, a test fixture) is mirrored — scoped ones too.
describe('mirrorLinkedDeps — a new tree gets the same linked engine and extensions', () => {
	const mk = () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-deps-'));
		for (const d of ['from/node_modules/@scope', 'to', 'pkgs/engine', 'pkgs/ext', 'from/node_modules/real-dep']) fs.mkdirSync(path.join(root, d), { recursive: true });
		fs.symlinkSync(path.join(root, 'pkgs/engine'), path.join(root, 'from/node_modules/dreamteamer'), 'dir');
		fs.symlinkSync(path.join(root, 'pkgs/ext'), path.join(root, 'from/node_modules/@scope/ext'), 'dir');
		return root;
	};

	test('the engine link and a SCOPED extension link are both mirrored', () => {
		const root = mk();
		mirrorLinkedDeps(path.join(root, 'from'), { devDependencies: { '@scope/ext': '*' } }, path.join(root, 'to'));
		assert.equal(fs.realpathSync(path.join(root, 'to/node_modules/dreamteamer')), fs.realpathSync(path.join(root, 'pkgs/engine')));
		assert.equal(fs.realpathSync(path.join(root, 'to/node_modules/@scope/ext')), fs.realpathSync(path.join(root, 'pkgs/ext')), 'the extension was not mirrored — the new tree would compile without it');
	});

	test('a REAL installed dependency is left to dt install, and an undeclared link is not copied', () => {
		const root = mk();
		mirrorLinkedDeps(path.join(root, 'from'), { dependencies: { 'real-dep': '*' } }, path.join(root, 'to'));
		assert.equal(fs.existsSync(path.join(root, 'to/node_modules/real-dep')), false);
		assert.equal(fs.existsSync(path.join(root, 'to/node_modules/@scope/ext')), false, 'a link nothing declares is not a dependency');
	});
});
