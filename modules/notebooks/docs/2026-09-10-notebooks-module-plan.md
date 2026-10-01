# notebooks module — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `modules/notebooks` in `@dreamteamer/extensions` — a `notebooks` collection, the `using-notebooklm` skill, a `notebook persona` verb in `npx dt-extensions`, and a `notebooks` doctor capability — per `docs/2026-09-10-notebooks-module-design.md`.

**Architecture:** A seventh self-contained module folder (descriptor + module-scoped provenance template + one default view + one skill), discovered by the existing bundle machinery. The CLI gains a `notebook` verb dispatched to a new `bin/notebook.mjs` whose pure functions are unit-tested and whose one network call is smoked by hand. `lib/capabilities.mjs` gains a module-gated capability; `setup` gains two in-workspace edits.

**Tech Stack:** Node ≥ 20 ESM, `node --test` via `scripts/test.mjs`, js-yaml (dev), the pinned engine 0.24.0 as the compile gate, `notebooklm-py` 0.7.3 as the vendor CLI.

## Global Constraints

- **No personal data, anywhere** — synthetic cast only (Dana Oren · Northwind · Harbor Mutual · `*.example`); `tests/leak-gate.test.mjs` enforces the travelling half.
- Module `engine` range: `>=0.23.0`. Package bundle floor stays `0.24.0`.
- `peerDependencies: ["companies"]` — collection names, as `perspective` spells them.
- Every `templates:` ref stays inside the module (`collection-templates/notebooks-provenance`).
- The doctor spends **no network request**; `notebook persona` is the CLI's only network-writing verb and never installs or logs in.
- `notebooklm configure` is called **once**, with `--persona` and `--response-length longer`, **never `--mode`**.
- Persona cap: **10,000** characters.
- Commit by explicit path only; never `git add -A`. CHANGELOG entry **0.3.0**; the version bump and tag are NOT in this plan.
- `npm test` quoted by EXIT CODE (baseline before this plan: 578 tests, 575 pass, 3 skipped, exit 0).

---

### Task 1: the module folder — descriptor, template, view, manifest

**Files:**
- Create: `modules/notebooks/package.json`
- Create: `modules/notebooks/collection-templates/notebooks-provenance.collection-template.yaml`
- Create: `modules/notebooks/collections/notebooks.collection.yaml`
- Create: `modules/notebooks/ui-views/content-notebooks.ui-view.yaml`
- Test: the existing gates `tests/modules-structure.test.mjs`, `tests/compiles-alone.test.mjs`, `tests/view-columns.test.mjs`, `tests/leak-gate.test.mjs`

**Interfaces:**
- Produces: a module named `notebooks` that `installedModules()` finds under `node_modules/@dreamteamer/extensions/modules/notebooks` (Task 3 depends on the name).

- [ ] **Step 1: Run the structure gate to see it enumerate six modules (the baseline)**

Run: `node scripts/test.mjs --only=modules-structure 2>&1 | grep -E '^# (tests|pass|fail)'`
Expected: `# fail 0`.

- [ ] **Step 2: Write the manifest**

`modules/notebooks/package.json`:
```json
{
	"name": "notebooks",
	"private": true,
	"version": "0.1.0",
	"dreamteamer": {
		"title": "Notebooks",
		"description": "One NotebookLM notebook per `notebooks` record — its uuid, which Google login opens it, and what corpus it holds — so the id every `notebooklm -n <id>` call is addressed to lives somewhere greppable rather than only in scrollback. `using-notebooklm` carries this workspace's rules over the vendor CLI: the destructive `configure`, the empty answer at exit 0, the download folder. Rendering the workspace INTO a notebook is the engine's `dt export notebooklm`; applying `NOTEBOOKLM.md`'s persona in one safe call is `npx dt-extensions notebook persona <id>`. Peers `companies`, so a client corpus can say whose it is.",
		"engine": ">=0.23.0",
		"peerDependencies": [
			"companies"
		]
	}
}
```

- [ ] **Step 3: Write the provenance template**

`modules/notebooks/collection-templates/notebooks-provenance.collection-template.yaml`:
```yaml
# notebooks-provenance: the four fields every `notebooks` record carries, so any record can say who
# made it, from what, and how much to trust it.
#
# ⚠ NAMED `notebooks-provenance`, not `provenance`, ON PURPOSE. Compile treats a collection-template
# id as an IDENTITY entity: two modules shipping `collection-templates/provenance` is a hard name
# collision, not a merge. A module that wants a shared field set owns it under a module-scoped id, or
# it can only ever be installed beside whichever module ships the unscoped one. That is the trap the
# 2026-07-25 extraction fell into, and the reason every module in this package carries its own copy
# of this ~20-line quad. Duplication you can cherry-pick beats a dependency you must import.
#
# NOT for system records (collections, commands, skills, agents, ui-views) — they comply with a
# standardized schema, and their provenance is the module that shipped them.
name: notebooks-provenance
description: author / creation_context / source / confidence — the traceability quad on every `notebooks` record
template:
  schema:
    type: object
    properties:
      # free-text, not x-reference: the target is polymorphic (users | agents) and x-reference
      # cannot express that — so `check` cannot catch a typo'd `agents/dreamtemer`. Accepted.
      author:
        type: string
        description: >-
          Which AGENT made this record — `agents/dreamteamer (claude-opus-5)`. Leave it ABSENT when the
          operator wrote it themselves: there is no `users` collection to point at since engine 0.8.0, and
          absent is the honest encoding of the default rather than a constant repeated on every record.
      creation_context:
        type: string
        description: How and why this record came to be, in one line — and the reason whenever confidence is low.
      source:
        type: string
        description: 'Where the INFORMATION came from, prefixed so it stays machine-readable: <collection>/<id> · file:<path> · url:<…> · notebooklm:<notebook-id> · migration:<id>.'
      confidence:
        type: string
        enum: [low, normal, high]
        default: normal
        description: How much to trust this record. When low, the reason goes in creation_context — there is no separate note field.
```

- [ ] **Step 4: Write the descriptor**

`modules/notebooks/collections/notebooks.collection.yaml`:
```yaml
name: notebooks
templates: [collection-templates/notebooks-provenance]
id:
  generate: '{{ name | slug }}'
  # an entity, not a dated document — no date prefix, and the slug of the NotebookLM
  # title is what a person types when looking for it
  pattern: ^[a-z0-9][a-z0-9-]*$
schema:
  type: object
  required:
    - name
    - notebook_id
  properties:
    name:
      type: string
      description: The notebook's title as NotebookLM shows it — the record's id is its slug.
    notebook_id:
      type: string
      description: The NotebookLM notebook uuid — what every `notebooklm -n <id>` call is addressed to, and the whole reason this record exists.
    description:
      type: string
      description: One line on what the notebook is for, for a list view.
    company:
      type: string
      x-reference: companies
      description: The account this notebook is about, when it is a client corpus rather than a general one — `companies/harbor-mutual`.
    status:
      type: string
      enum:
        - active
        - archived
        - throwaway
      default: active
      description: "`throwaway` is a real state and earns its place: a smoke test and a spike notebook both live here, and neither should be read as a corpus anyone maintains."
    tags:
      type: array
      items:
        type: string
      description: "Free-form grouping — subject, engagement, or the flow that built it. Colon convention, no space: `purpose:topical-authority`."
    # A STRING, not a reference. The fact it holds — a notebook is invisible from the wrong Google
    # login, and nothing can derive which one — is not derivable and not guessable, so it has to be
    # written down; but this package ships no accounts collection to point at. A workspace that has
    # one re-types this field in an overlay.
    account:
      type: string
      description: Which Google login opens it — an address or a label, `dana.o@northwind.example`. Not derivable and not guessable; there are usually several, and a notebook is invisible from the wrong one.
    notes:
      type: string
      format: markdown
      description: What is in it, what it is for, and what has been asked of it. ⚠ NOT a source list or a count — both go stale and are one `notebooklm source list -n <id>` away.
      x-body: true
storage:
  path: data/notebooks
  codec: md
  shape: file
  suffix: notebook
description: One NotebookLM notebook — its id, whose Google login opens it, and what corpus it holds. The record exists so the uuid every API call is addressed to lives somewhere greppable.
use_when: a notebook is created, or you need to reach one — every notebooklm call takes -n <id>, and `notebooklm list | grep` is a network call that breaks on duplicate titles, so find the id here first. Write the record the moment the notebook exists, not later — including one made by `dt export notebooklm --create`, which writes no record. The corpus PLAN and what it argues is a document record elsewhere; this is the handle
icon: book
list_fields:
  - name
  - account
  - status
  - tags
```

- [ ] **Step 5: Write the default view**

`modules/notebooks/ui-views/content-notebooks.ui-view.yaml`:
```yaml
# the notebooks list — the default a bare /content/notebooks renders. No nav entry: the collection
# row IS the view, and there is nothing to arrange differently yet.
path: /content/notebooks
target: list
collection: collections/notebooks
layout: table
# ⚠ every column below is a declared field or the engine's generated one; a column the schema LACKS is
# dropped silently and tests/view-columns.test.mjs is what catches it.
options:
  columns:
    - name
    - account
    - status
    - tags
    - last-modified
  sort: '-last-modified'
default: true
```

- [ ] **Step 6: Run the four gates**

Run: `node scripts/test.mjs --only=modules-structure && node scripts/test.mjs --only=view-columns && node scripts/test.mjs --only=leak-gate && node scripts/test.mjs --only=compiles-alone; echo EXIT $?`
Expected: each `# fail 0`; the compiles-alone run lists `notebooks (+ nothing)`; final `EXIT 0`.

- [ ] **Step 7: Commit**

```bash
git add modules/notebooks/package.json modules/notebooks/collection-templates/notebooks-provenance.collection-template.yaml modules/notebooks/collections/notebooks.collection.yaml modules/notebooks/ui-views/content-notebooks.ui-view.yaml
git commit -m "notebooks: the seventh module — a NotebookLM notebook as a record, with its own provenance quad and a default view"
```

---

### Task 2: `bin/notebook.mjs` — the persona verb, TDD

**Files:**
- Create: `bin/notebook.mjs`
- Modify: `bin/extensions.mjs` (header comment lines 1–12; the dispatch block after `migrate`; the unknown-verb message)
- Test: `tests/notebook-persona.test.mjs`

**Interfaces:**
- Produces: `section(md: string, heading: string): string`, `personaFrom(md: string): string`, `PERSONA_MAX = 10000`, `main(argv: string[], root: string): number` (exit code). Invoked as `npx dt-extensions notebook persona <id> [--print]`.
- Consumes: `findWorkspace` from `lib/capabilities.mjs` (already exists).

- [ ] **Step 1: Write the failing tests**

`tests/notebook-persona.test.mjs`:
```js
// THE PERSONA VERB — the one thing in this CLI that writes over the network, pinned where a fixture
// can pin it: how the persona is cut out of NOTEBOOKLM.md, when the verb refuses, and what --print
// emits. The live `configure` call is smoked by hand against a throwaway notebook and quoted.
import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { section, personaFrom, PERSONA_MAX } from '../bin/notebook.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CLI = path.join(ROOT, 'bin', 'extensions.mjs');
const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

/** A NOTEBOOKLM.md the way compile writes it: hand-written additions ABOVE the managed block, the
 *  generated custom instructions and limits inside it. */
const FIXTURE = `# NOTEBOOKLM.md

Prose about the file. Never part of the persona.

## custom instructions — this workspace's additions

⚠ Hand-written, and part of the applied persona. This line is a warning and is filtered.
\`bin/apply-notebook-persona.mjs\` is the old pointer and is filtered.
- Dates are ISO. Amounts are in the currency the row names.
- Answer in the language the question was asked in.

<!-- dreamteamer:begin (generated — do not edit inside this block) -->
NOTEBOOKLM — preamble that must NOT be captured.

## settings

| setting | value |
|---|---|

## custom instructions

You are the reference desk for this workspace. Answer only from the sources.

## limits

| plan | sources |
<!-- dreamteamer:end -->
`;

/** A consumer folder the CLI accepts as a workspace, with or without a NOTEBOOKLM.md. */
function consumer(md) {
	const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-nb-')); made.push(ws);
	fs.writeFileSync(path.join(ws, 'package.json'), JSON.stringify({ name: 'consumer', private: true, dreamteamer: {} }));
	fs.writeFileSync(path.join(ws, 'package-lock.json'), '{}');
	if (md !== undefined) fs.writeFileSync(path.join(ws, 'NOTEBOOKLM.md'), md);
	return ws;
}
const cli = (ws, ...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: ws, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });

describe('section', () => {
	test('stops at the next ## heading', () => {
		assert.equal(section(FIXTURE, 'custom instructions'), 'You are the reference desk for this workspace. Answer only from the sources.');
	});
	test('stops at the managed-block BEGIN marker, so the additions never swallow the block preamble', () => {
		const s = section(FIXTURE, 'custom instructions — this workspace\'s additions');
		assert.ok(s.includes('Dates are ISO'));
		assert.ok(!s.includes('dreamteamer:begin'), s);
		assert.ok(!s.includes('preamble that must NOT'), s);
	});
	test('an absent heading is the empty string', () => {
		assert.equal(section(FIXTURE, 'no such heading'), '');
	});
});

describe('personaFrom', () => {
	test('generated first, additions after, warnings and the old pointer dropped', () => {
		const p = personaFrom(FIXTURE);
		assert.ok(p.startsWith('You are the reference desk'), p);
		assert.ok(p.indexOf('Dates are ISO') > p.indexOf('reference desk'));
		assert.ok(!p.includes('⚠'), p);
		assert.ok(!p.includes('apply-notebook-persona'), p);
	});
	test('any "## custom instructions — … additions" heading counts, whatever the possessive', () => {
		const md = FIXTURE.replace("this workspace's additions", "this team's additions");
		assert.ok(personaFrom(md).includes('Dates are ISO'));
	});
	test('a file with no generated section throws, naming compile', () => {
		assert.throws(() => personaFrom('# NOTEBOOKLM.md\n\nnothing generated here\n'), /compile/);
	});
});

describe('npx dt-extensions notebook persona', () => {
	test('--print emits exactly the persona and exits 0, touching no network', () => {
		const r = cli(consumer(FIXTURE), 'notebook', 'persona', '--print');
		assert.equal(r.status, 0, r.stderr);
		assert.equal(r.stdout.trimEnd(), personaFrom(FIXTURE));
	});
	test('refuses when NOTEBOOKLM.md is absent, naming the harness to declare', () => {
		const r = cli(consumer(undefined), 'notebook', 'persona', '--print');
		assert.equal(r.status, 1);
		assert.match(r.stderr, /dreamteamer\.harnesses/);
		assert.match(r.stderr, /notebooklm/);
	});
	test('refuses a persona over the cap, naming the count', () => {
		const big = FIXTURE.replace('Answer only from the sources.', 'x'.repeat(PERSONA_MAX + 1));
		const r = cli(consumer(big), 'notebook', 'persona', '--print');
		assert.equal(r.status, 1);
		assert.match(r.stderr, new RegExp(String(PERSONA_MAX)));
	});
	test('without --print and without an id it prints usage and exits 2', () => {
		const r = cli(consumer(FIXTURE), 'notebook', 'persona');
		assert.equal(r.status, 2);
		assert.match(r.stderr, /usage/i);
	});
	test('an unknown sub-verb exits 2', () => {
		const r = cli(consumer(FIXTURE), 'notebook', 'bogus');
		assert.equal(r.status, 2);
	});
	test('the CLI\'s unknown-verb message names the notebook verb', () => {
		const r = cli(consumer(FIXTURE), 'bogus');
		assert.equal(r.status, 2);
		assert.match(r.stderr, /notebook/);
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/test.mjs --only=notebook-persona 2>&1 | tail -8`
Expected: the import of `../bin/notebook.mjs` fails (`ERR_MODULE_NOT_FOUND`) — `# fail` non-zero or the file errors out.

- [ ] **Step 3: Write `bin/notebook.mjs`**

```js
#!/usr/bin/env node
// `npx dt-extensions notebook persona <notebook-id> [--print]` — apply NOTEBOOKLM.md's persona to
// one notebook, in ONE call.
//
// ⚠ THIS IS THE CLI'S ONE VERB THAT WRITES OVER THE NETWORK. `doctor` is read-only by construction
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

export const PERSONA_MAX = 10000;

/** The text between a `## <heading>` and whichever comes first: the next `## `, or EITHER managed-block
 *  marker.
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

const USAGE = 'usage: dt-extensions notebook persona <notebook-id> [--print]';

/** Returns the exit code. `argv` is everything after the `notebook` verb. */
export function main(argv, root) {
	const [sub, ...rest] = argv;
	if (sub !== 'persona') { console.error(`unknown notebook command "${sub ?? ''}" — ${USAGE}`); return 2; }
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
	if (!id) { console.error(USAGE); return 2; }

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
```

- [ ] **Step 4: Wire the verb into `bin/extensions.mjs`**

Replace the header comment (lines 1–12) with:
```js
#!/usr/bin/env node
// The package's own CLI, run from inside the workspace that installed it:
//
//   npx dt-extensions setup                       wire this workspace up, then show the board
//   npx dt-extensions doctor                      show the board and change nothing
//   npx dt-extensions migrate                     move a workspace whose records predate 0.2.0 onto perspective
//   npx dt-extensions notebook persona <id>       apply NOTEBOOKLM.md's persona to one notebook, in one call
//
// `doctor` is read-only by construction: it spends no network request, touches no file, and exits 0
// unless you pass --strict. `setup` does only the in-workspace edits listed under "what setup will
// do" and prints everything else as a fix for a person to run. ⚠ `notebook persona` is the ONE verb
// that writes over the network — one setting, to one notebook the operator named — and it still
// never installs anything and never logs in (bin/notebook.mjs says why it exists).
//
// Nothing here knows a thing about any particular person, machine or account.
```

After the `migrate` block, before `if (verb !== 'setup')`, add:
```js
if (verb === 'notebook') {
	const { main } = await import('./notebook.mjs');
	process.exit(main(args.filter((a) => a !== 'notebook'), root));
}
```

Change the unknown-verb line to:
```js
	console.error(`unknown command "${verb}" — expected setup, doctor, migrate or notebook`);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node scripts/test.mjs --only=notebook-persona 2>&1 | grep -E '^# (tests|pass|fail)'`
Expected: `# tests 12`, `# fail 0`.

- [ ] **Step 6: Run the resolver gate (the new file imports `findWorkspace`, it does not walk itself)**

Run: `node scripts/test.mjs --only=resolvers 2>&1 | grep -E '^# (pass|fail)'`
Expected: `# fail 0`.

- [ ] **Step 7: Commit**

```bash
git add bin/notebook.mjs bin/extensions.mjs tests/notebook-persona.test.mjs
git commit -m "dt-extensions notebook persona: NOTEBOOKLM.md's persona onto one notebook in one call — the CLI's only network write, and it says so"
```

---

### Task 3: the `notebooks` capability — doctor and setup

**Files:**
- Modify: `lib/capabilities.mjs` (`OURS`; a new capability block after `perspective`; two helpers)
- Modify: `bin/extensions.mjs` (the "what setup will do" list; two new setup steps before the recompile)
- Test: `tests/capabilities.test.mjs` (extend the `consumer()` fixture with `harnesses` and `gitignore`; new cases)

**Interfaces:**
- Consumes: module name `notebooks` (Task 1).
- Produces: `NOTEBOOKLM_FLOOR = '0.7.3'`, a capability named `notebooks` with checks labelled `notebooklm` · `version` · `signed in` · `vendor skill` · `harness declared` · `.cache/ ignored`.

- [ ] **Step 1: Write the failing tests**

In `tests/capabilities.test.mjs`, change the fixture signature and body:
```js
function consumer({ engineVersion = '0.24.0', deps = true, vars = [], disable = [], env = '', harnesses, gitignore } = {}) {
```
and, after the `package.json` write inside it, replace the `dreamteamer:` object with
```js
		dreamteamer: { 'workspace-module': 'default', vars, disable, ...(harnesses ? { harnesses } : {}) },
```
and after the lockfile write add:
```js
	if (gitignore !== undefined) fs.writeFileSync(path.join(ws, '.gitignore'), gitignore);
```

Then append a new describe block at the end of the file:
```js
describe('the notebooks capability', () => {
	test('OURS lists seven modules, notebooks among them, and the fixture consumer finds it', () => {
		assert.equal(OURS.length, 7);
		assert.ok(OURS.includes('notebooks'));
		assert.equal(installedModules(consumer()).get('notebooks')?.channel, 'node_modules');
	});
	test('an undeclared notebooklm harness is bad and the fix names dreamteamer.harnesses', () => {
		const c = check(capabilities(consumer()), 'notebooks', 'harness declared');
		assert.equal(c?.state, 'bad');
		assert.match(c.fix, /dreamteamer\.harnesses/);
	});
	test('a declared notebooklm harness is ok', () => {
		assert.equal(check(capabilities(consumer({ harnesses: ['claude-code', 'notebooklm'] })), 'notebooks', 'harness declared')?.state, 'ok');
	});
	test('.cache/ missing from .gitignore is a warn; present is ok', () => {
		assert.equal(check(capabilities(consumer({ gitignore: 'node_modules/\n' })), 'notebooks', '.cache/ ignored')?.state, 'warn');
		assert.equal(check(capabilities(consumer({ gitignore: 'node_modules/\n.cache/\n' })), 'notebooks', '.cache/ ignored')?.state, 'ok');
	});
	test('the module switched off shows no notebooks capability', () => {
		assert.equal(cap(capabilities(consumer({ disable: ['notebooks'] })), 'notebooks'), undefined);
	});
	test('setup --yes declares the harness WITHOUT dropping the engine default, and appends .cache/', () => {
		const ws = consumer({ gitignore: 'node_modules/\n' });
		const r = spawnSync(process.execPath, [CLI, 'setup', '--yes'], { cwd: ws, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
		assert.equal(r.status, 0, r.stderr + r.stdout);
		const pkg = JSON.parse(fs.readFileSync(path.join(ws, 'package.json'), 'utf8'));
		assert.deepEqual(pkg.dreamteamer.harnesses, ['claude-code', 'notebooklm']);
		assert.match(fs.readFileSync(path.join(ws, '.gitignore'), 'utf8'), /^\.cache\/$/m);
	});
	test('setup --yes appends to an explicit harness list rather than replacing it', () => {
		const ws = consumer({ harnesses: ['codex'] });
		spawnSync(process.execPath, [CLI, 'setup', '--yes'], { cwd: ws, encoding: 'utf8' });
		assert.deepEqual(JSON.parse(fs.readFileSync(path.join(ws, 'package.json'), 'utf8')).dreamteamer.harnesses, ['codex', 'notebooklm']);
	});
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node scripts/test.mjs --only=capabilities 2>&1 | grep -E '^# (tests|pass|fail)'`
Expected: `# fail 7` (OURS is six; no capability named `notebooks`).

- [ ] **Step 3: Implement in `lib/capabilities.mjs`**

Change `OURS`:
```js
export const OURS = ['assets', 'contacts', 'tasks', 'meetings', 'recordings', 'perspective', 'notebooks'];
```

Add after `readJson`:
```js
/** Run a local command and return its stdout, or '' when it is missing or fails. Memoised per
 *  process: the doctor is drawn twice by `setup` and many times by the tests, and each vendor call
 *  is a Python interpreter start. */
const shMemo = new Map();
export function sh(cmd, args) {
	const key = `${cmd} ${args.join(' ')}`;
	if (!shMemo.has(key)) {
		try { shMemo.set(key, execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })); }
		catch { shMemo.set(key, ''); }
	}
	return shMemo.get(key);
}

/** Does `.gitignore` carry `pattern` as a line of its own (trailing slash optional)? */
export function gitignores(root, pattern) {
	try {
		const want = pattern.replace(/\/$/, '');
		return fs.readFileSync(path.join(root, '.gitignore'), 'utf8').split('\n').some((l) => l.trim().replace(/\/$/, '') === want);
	} catch { return false; }
}

/** The vendor CLI release the using-notebooklm skill was measured on. Older ones lack `skill status`
 *  and keep auth at a path the skill no longer names. */
export const NOTEBOOKLM_FLOOR = '0.7.3';
```

Add the capability block after the `perspective` block and before `return out;`:
```js
	// ── notebooks ────────────────────────────────────────────────────────────────────────────
	// Every check here is LOCAL. `notebooklm auth check` without --test inspects the cookie file only
	// (its own --help says so); `skill status` and `--version` read disk. Timed at ~0.15 s each.
	if (has('notebooks')) {
		const c = cap('notebooks', 'a NotebookLM notebook as a record, and the persona verb. Optional: the records work with none of this.');
		const nb = bin('notebooklm');
		if (!nb) c.bad('notebooklm', 'uv tool install notebooklm-py · or: pip install "notebooklm-py[browser]"; then notebooklm skill install', 'the vendor CLI every notebook call goes through');
		else {
			c.ok('notebooklm', nb);
			const v = /version (\d+\.\d+\.\d+)/.exec(sh('notebooklm', ['--version']))?.[1];
			if (!v || cmp(v, NOTEBOOKLM_FLOOR) < 0) c.warn('version', 'uv tool upgrade notebooklm-py · or: pip install -U notebooklm-py; then notebooklm skill install', `${v ?? 'unknown'} installed — the skill was measured on ${NOTEBOOKLM_FLOOR}`);
			else c.ok('version', v);
			const auth = readJsonText(sh('notebooklm', ['auth', 'check', '--json']));
			auth?.status === 'ok'
				? c.ok('signed in', 'a session file exists — expiry shows only on a real call (notebooklm auth check --test)')
				: c.warn('signed in', 'notebooklm login — opens a browser, so a person runs it', 'no usable session under ~/.notebooklm (or $NOTEBOOKLM_HOME)');
			/Claude Code:\s+Installed/.test(sh('notebooklm', ['skill', 'status']))
				? c.ok('vendor skill', 'installed for Claude Code')
				: c.warn('vendor skill', 'notebooklm skill install', 'the command reference using-notebooklm defers to for every flag');
		}
		(dt.harnesses ?? []).includes('notebooklm')
			? c.ok('harness declared', 'compile writes NOTEBOOKLM.md')
			: c.bad('harness declared', 'add "notebooklm" to dreamteamer.harnesses in package.json, then npx dreamteamer compile', 'this is what makes NOTEBOOKLM.md — and the persona — exist');
		gitignores(root, '.cache/')
			? c.ok('.cache/ ignored', 'downloads and the export bundle land there')
			: c.warn('.cache/ ignored', 'add .cache/ to .gitignore', 'notebook downloads and the export bundle land there; a 40 MB podcast must never be staged');
		out.push(c.cap);
	}
```

Add after `readJson`:
```js
/** JSON out of a command's stdout, skipping any banner before the first `{`. */
export const readJsonText = (s) => { try { return JSON.parse(s.slice(s.indexOf('{'))); } catch { return null; } };
```

- [ ] **Step 4: Implement the setup steps in `bin/extensions.mjs`**

In the "What setup will do" list, after the record-guard line add:
```js
console.log('  · declare the notebooklm harness, so compile writes NOTEBOOKLM.md — when the notebooks module is installed');
console.log('  · add .cache/ to .gitignore, where notebook downloads land — when the notebooks module is installed');
```

Before `// 4. recompile`, add:
```js
// 3b. the notebooklm harness and the download folder — only when the notebooks module is here
if (has('notebooks')) {
	// ⚠ The engine's default when `harnesses` is UNSET is ['claude-code'] (compile.js). Writing
	// ['notebooklm'] alone would silently switch the operator's coding-agent harness OFF, so an unset
	// list is materialised as the default plus the new one, and a set list is appended to.
	const current = pkg.dreamteamer.harnesses ?? ['claude-code'];
	if (!current.includes('notebooklm')) {
		if (await yes('Declare the notebooklm harness in dreamteamer.harnesses, so compile writes NOTEBOOKLM.md?')) {
			pkg.dreamteamer.harnesses = [...current, 'notebooklm'];
			fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, '\t') + '\n');
			changed = true; done.push('declared the notebooklm harness');
		} else skipped.push('the notebooklm harness — without it there is no NOTEBOOKLM.md and no persona to apply');
	}
	if (!gitignores(root, '.cache/')) {
		if (await yes('Add .cache/ to .gitignore? Notebook downloads and the export bundle land there.')) {
			const gi = path.join(root, '.gitignore');
			const existing = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
			fs.writeFileSync(gi, existing && !existing.endsWith('\n') ? `${existing}\n.cache/\n` : `${existing}.cache/\n`);
			done.push('.gitignore — added .cache/'); changed = true;
		} else skipped.push('.cache/ in .gitignore — a downloaded podcast would be staged for commit');
	}
}
```

And extend the import line at the top:
```js
import { capabilities, capState, worst, findWorkspace, readJson, installedModules, gitignores, BUNDLE_FLOOR } from '../lib/capabilities.mjs';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node scripts/test.mjs --only=capabilities 2>&1 | grep -E '^# (tests|pass|fail)'`
Expected: `# fail 0`.

- [ ] **Step 6: Run the doctor for real in a consumer that has the module (the fixture cannot pin the vendor checks)**

Run, from the extensions repo: `node -e "import('./lib/capabilities.mjs').then(m=>{const ws=require('os').tmpdir()+'/ext-live-'+Date.now();require('fs').mkdirSync(ws+'/node_modules/@dreamteamer',{recursive:true});require('fs').symlinkSync(process.cwd(),ws+'/node_modules/@dreamteamer/extensions','dir');require('fs').writeFileSync(ws+'/package.json',JSON.stringify({name:'x',dependencies:{'@dreamteamer/extensions':'*'},dreamteamer:{harnesses:['claude-code','notebooklm']}}));require('fs').writeFileSync(ws+'/package-lock.json','{}');require('fs').writeFileSync(ws+'/.gitignore','.cache/\n');const c=m.capabilities(ws).find(c=>c.name==='notebooks');console.log(JSON.stringify(c.checks.map(x=>[x.label,x.state,x.detail]),null,1))})"`
Expected on this machine: `notebooklm ok`, `version ok 0.7.3`, `signed in ok`, `vendor skill ok`, `harness declared ok`, `.cache/ ignored ok`. Quote the output.

- [ ] **Step 7: Commit**

```bash
git add lib/capabilities.mjs bin/extensions.mjs tests/capabilities.test.mjs
git commit -m "doctor: the notebooks capability — six local checks, and setup declares the harness without dropping the engine default"
```

---

### Task 4: the skill, the module README, the package docs

**Files:**
- Create: `modules/notebooks/skills/using-notebooklm/SKILL.md`
- Create: `modules/notebooks/README.md`
- Modify: `README.md` (the "what you get" table; the "what needs setting up" table)
- Modify: `CHANGELOG.md` (a `0.3.0` entry at the top)
- Test: `tests/leak-gate.test.mjs`, `tests/compiles-alone.test.mjs` (the skill compiles), full `npm test`

- [ ] **Step 1: Write the skill**

`modules/notebooks/skills/using-notebooklm/SKILL.md`:
````markdown
---
name: using-notebooklm
description: use for any NotebookLM work in this workspace — creating notebooks, adding sources, asking questions, generating podcasts/video/slides/reports/quizzes, downloading artifacts, exporting the workspace into a notebook, applying a persona. load this BEFORE the vendor `notebooklm` skill, which owns the command syntax but not this workspace's rules.
---

# using notebooklm

**core principle:** the `notebooklm` CLI is a **dependency we don't own**. The vendor skill at
`~/.claude/skills/notebooklm/SKILL.md` (written by `notebooklm skill install`) is the authority on
every command, flag, option and JSON schema — read it for syntax. This file adds only what the vendor
can't know: this workspace's rules, and the traps measured against it.

## when to use

any NotebookLM task. **not for:** command syntax — that's the vendor skill, and copying its tables
in here is how they go stale.

## the lib, and how it is set up

`notebooklm-py` is a Python CLI. Install it as a tool, not into a project:

```bash
uv tool install notebooklm-py            # or: pip install "notebooklm-py[browser]"
notebooklm skill install                 # writes the vendor skill for Claude Code and Agent Skills
notebooklm --version                     # want >= 0.7.3 — the release these rules were measured on
```

Auth is machine state under **`~/.notebooklm/profiles/<profile>/storage_state.json`** (0.7.x; older
releases kept it one level up). It is never committed and never goes in `.env`. A second Google
account is a second home: `NOTEBOOKLM_HOME=~/.notebooklm-work notebooklm login`. Behind on version?
`uv tool upgrade notebooklm-py && notebooklm skill install` — the second command regenerates the
vendor skill, which is why we never edit it.

`npx dt-extensions doctor` reports all of this under **notebooks**, offline.

## preflight

```bash
notebooklm auth check --test   # --test is NOT optional, see below
```

**Always `--test`.** Bare `auth check` only inspects cookie *shape* and reports a valid session
against one Google has already expired — the next write then fails with
`UNEXPECTED_ERROR / Authentication expired`. `--test` actually fetches a token and catches it.

Expired means `notebooklm login`, which opens a browser: **the operator must run it.** An agent in
a non-interactive session cannot, and no flag works around it — stop and ask.

## the rules

**1. downloads go to `.cache/notebooklm/`, never the working directory.** The vendor skill's examples
are relative (`notebooklm download audio ./podcast.mp3`) and following them literally stages a 40 MB
file for commit. Always:

```bash
notebooklm download audio .cache/notebooklm/<notebook>/overview.mp3 -a <artifact_id> -n <notebook_id>
```

`.cache/` is gitignored (`dreamteamer init` writes the line; `npx dt-extensions setup` adds it to an
older workspace) — the materialised-remote-artifact convention: a copy of something whose home is
elsewhere, rebuilt on demand. Prose artifacts (report, mind-map, data-table, quiz as markdown) are
text and may land in `data/` as records — but only where a real collection fits, never invented on
the spot.

**2. pass `-n <notebook_id>` explicitly. Never `notebooklm use`.** `use` writes single-slot
`~/.notebooklm/context.json`; a workspace that spawns subagents would have them overwrite each
other's context. Same reason: prefer full UUIDs over partial ids in anything scripted.

**3. every notebook gets a record, in `notebooks`.** Rule 2 means the id has to live somewhere
greppable, and `notebooklm list | grep <title>` is a network call that breaks on duplicate titles.

```bash
notebooklm create "<title>" --json      # → {"notebook": {"id": "<uuid>", …}}
npx dreamteamer add notebooks --name "<title>" --notebook_id "<uuid>" \
  --description "<what it is for>" --account "dana.o@northwind.example" \
  [--company companies/<id>] [--tags purpose:<…>]
```

Write it the moment the notebook exists, not later. Three things worth knowing about the shape:
**`account`** says which Google login opens it — not derivable from anything, and a notebook is
invisible from the wrong one; **`status: throwaway`** is a real value, for smoke tests and spikes
nobody maintains; and the body is what it holds and what has been asked of it, **never a source list
or a count** — both go stale and are one `notebooklm source list -n <id>` away.

⚠ **`dt export notebooklm --create "<title>"` makes a notebook too, and writes NO record.** The
engine's verb renders the workspace into a notebook — one source per collection, sensitivity honoured
from the schema, the id kept in `.cache/dreamteamer/notebooklm/notebook.json` — but core knows no
`notebooks` collection, deliberately. Read the id out of `notebook.json` and add the record the same
way. The engine's own `using-dreamteamer` skill (`references/exporting.md`) carries the export's
judgment: what travels, the plan budget, syncing.

**4. `notebooklm configure` REPLACES the whole configuration, and `--mode` DISCARDS the persona.**
Three things, all measured 2026-09-08 and all silent at exit 0:

- **`--mode` and `--persona` are mutually exclusive and nothing says so.** `configure --persona … --response-length longer --mode default` answers `{mode: "default", configured: true}` — persona gone, response length gone, no error. Drop `--mode` and the identical call returns `{goal: "custom", persona: "…", response_length: "longer"}`.
- **Every call replaces the whole config.** `configure --response-length longer` alone wiped a 3,802-character persona. Send every setting you want in ONE call.
- **There is no read-only inspection.** A bare `configure`, the obvious way to check the settings, CLEARS them — which is how a persona was lost a second time, while verifying the first.

So the persona lives in a file under git, never only in the notebook. That file is **`NOTEBOOKLM.md`**,
written by `npx dreamteamer compile` when `package.json` declares the `notebooklm` harness
(`dreamteamer.harnesses`): a generated block that cannot go stale, and an optional hand-written
`## custom instructions — this workspace's additions` section above it for what a descriptor cannot
know. Apply it with **one** call:

```bash
npx dt-extensions notebook persona <notebook-id>          # --print to see it without sending
```

It FAILS if the notebook does not echo back the same length. Never `configure` by hand.

**5. an answer is real only with TEXT and at least one REFERENCE.** `notebooklm ask` has a third
outcome besides success and failure: **exit 0 with `{"answer": "\n", "references": []}`**, reached by
scoping a broad question with `-s` — measured at 253.7 s against 30.1 s for a good answer, so a slow
call is a warning sign rather than a sign of effort. Never trust `$?` alone; check both fields. Ask
one narrow, single-fact question per call, and do NOT reach for `-s` to escape the 52 MB
`RPCResponseTooLargeError` — that is what converts a loud failure into a silent one. `ask` also
carries conversation state across invocations unasked, so a prior failure can contaminate the next
answer; `--new --yes` starts clean.

## generation, briefly

Long jobs (audio 10-20 min, video 15-45 min) are fire-and-forget: start with `--json`, keep the
artifact id, and either check `artifact list` later or hand `artifact wait` to a subagent. Don't
poll in the main conversation. Audio, video, quiz, flashcards, infographic and slides rate-limit
on Google's side — that's expected, not a bug; the vendor skill's error table covers it.

## common mistakes

| mistake | why it bites |
|---|---|
| `notebooklm download audio ./out.mp3` | stages a binary for commit — use `.cache/notebooklm/` |
| `notebooklm use <id>` then a subagent | shared context file; the subagent retargets your notebook |
| creating a notebook and not recording it | the uuid survives only in scrollback — `dt export --create` included |
| copying the vendor skill's command tables into this file | they drift on every upgrade |
| `pip install git+…notebooklm-py` (main branch) | unreleased; use PyPI or a release tag |
| reading `$?` after `ask` and moving on | exit 0 with an empty answer is a real outcome — check text AND references |
| `configure --mode default` alongside a persona | the persona and the response length are discarded, exit 0, no error |
| a bare `configure` to see current settings | it CLEARS them — there is no read-only inspection |
| finding a source by its title | `source add --title` keeps the FILE NAME instead on most file uploads (0.7.3, measured) — keep the id `add` returns, and `source rename <id> <title>` afterwards |
| `harnesses: ["notebooklm"]` alone in package.json | the engine's default when the list is unset is `["claude-code"]`; naming only the new one switches the coding-agent harness off — list both |
````

- [ ] **Step 2: Write the module README**

`modules/notebooks/README.md`:
```markdown
# notebooks — what a descriptor cannot say

**`account` is a string, not a reference.** The workspace this was cut from types it as a reference
into an accounts collection; this package ships none, and the structure gate refuses a reference
nobody provides. The fact survives — a notebook is invisible from the wrong Google login, and nothing
can derive which one — as an address or a label. A workspace with an accounts collection re-types the
field in an overlay.

**The vendor skill is a dependency, and it is installed by the vendor.** `notebooklm skill install`
writes `~/.claude/skills/notebooklm/SKILL.md`; `using-notebooklm` here defers to it for every flag
and adds only this workspace's rules. Editing the vendor copy is how it drifts on the next upgrade.

**Two things the engine owns, deliberately not here:** `dt export notebooklm` (rendering the
workspace into a notebook) and the `NOTEBOOKLM.md` harness (the persona file compile writes). The
module sits on top of both: the record, the rules, and `npx dt-extensions notebook persona`.
```

- [ ] **Step 3: Edit the package README**

In the "what you get" table, change "Six modules." to "Seven modules." and add a row after **perspective**:
```markdown
| **notebooks** | Your NotebookLM notebooks as records, so the id every call needs is a grep away. The rules that keep the vendor CLI honest — the setting that wipes itself, the answer that is empty at exit 0 — and one safe command to apply a notebook's persona from the file compile writes. |
```

In the "to do this / you need" table add a row:
```markdown
| apply a notebook persona, or read a notebook | `notebooklm-py` 0.7.3+ (`uv tool install notebooklm-py`) and one `notebooklm login` |
```

- [ ] **Step 4: Add the CHANGELOG entry at the top**

```markdown
## 0.3.0 — 2026-09-10

**A seventh module: `notebooks`.** One record per NotebookLM notebook — its uuid, which Google login
opens it, what corpus it holds — and the `using-notebooklm` skill, which carries the rules the vendor
CLI cannot know about itself: `configure` replaces the whole configuration and `--mode` silently
discards the persona; `ask` exits 0 with an empty answer when a broad question is scoped; `source add
--title` keeps the file name. `account` is a plain string here, because this package ships no
accounts collection to point at.

**`npx dt-extensions notebook persona <id>`** applies `NOTEBOOKLM.md`'s persona — the block compile
generates plus the workspace's hand-written additions — in ONE `configure` call, never with `--mode`,
and fails unless the notebook echoes back the same length. It is the CLI's first verb that writes
over the network, and the only one: one setting, to one notebook the operator named.

**The doctor gains `notebooks`**: the vendor CLI on PATH and its version, a session file, the vendor
skill, the `notebooklm` harness declared, `.cache/` ignored — six checks, none of them a network
request. `setup` declares the harness without dropping the engine's default (`["claude-code"]` when
the list is unset — naming only the new one would switch the coding-agent harness off) and appends
`.cache/` where an older workspace lacks it.
```

- [ ] **Step 5: Run the leak gate and the compile gate**

Run: `node scripts/test.mjs --only=leak-gate 2>&1 | grep -E '^# (pass|fail)'; node scripts/test.mjs --only=compiles-alone 2>&1 | grep -E 'notebooks|^# (pass|fail)'`
Expected: `# fail 0` twice; `ok … notebooks (+ nothing)`.

- [ ] **Step 6: Run the whole suite and quote the exit code**

Run: `node scripts/test.mjs 2>&1 | grep -E '^# (tests|pass|fail|skipped)'; echo EXIT $?` — ⚠ that `$?` is grep's; run `node scripts/test.mjs >/dev/null 2>&1; echo EXIT $?` for the real one.
Expected: `# fail 0`, `EXIT 0`, tests ≥ 578 + 12 + 7.

- [ ] **Step 7: Commit**

```bash
git add modules/notebooks/skills/using-notebooklm/SKILL.md modules/notebooks/README.md README.md CHANGELOG.md
git commit -m "notebooks: the using-notebooklm skill with the 0.7.3 lib setup measured, the module README, and the 0.3.0 changelog"
```

---

### Task 5: verification in the running system

**Files:** none created. Evidence quoted in the final report.

- [ ] **Step 1: A virgin consumer, end to end**

In a scratch folder: `npm init -y`, `npm i <path-to-extensions> dreamteamer@0.24.0`, `npx dreamteamer init --name probe`, declare `"disable": ["assets","contacts","tasks","meetings","recordings","perspective"]` and `"harnesses": ["claude-code","notebooklm"]` in `package.json`, then:

```bash
npx dreamteamer compile && npx dreamteamer check
npx dreamteamer add notebooks --name "Harbor Mutual corpus" --notebook_id 00000000-0000-4000-8000-000000000000 --account dana.o@northwind.example
npx dreamteamer list notebooks
npx dt-extensions doctor
npx dt-extensions notebook persona --print | head -3
```
Expected: compile and check clean (`0 violations`); the record at `data/notebooks/harbor-mutual-corpus.notebook.md`; the doctor board shows **notebooks** with six rows; `--print` prints the generated persona's first lines.

- [ ] **Step 2: The live write, once, against a throwaway notebook**

From a workspace that has a `NOTEBOOKLM.md` and a notebook with `status: throwaway`, run `node <extensions>/bin/extensions.mjs notebook persona <that-id>` and quote the two output lines (`✔ notebook …`, `persona N/10000 chars · response length longer · configured true`) and the exit code. This is the one result a fixture cannot manufacture.

- [ ] **Step 3: Report** — the full-suite exit code, the virgin-consumer output, the live write. Then stop: the version bump and the tag are a person's.
