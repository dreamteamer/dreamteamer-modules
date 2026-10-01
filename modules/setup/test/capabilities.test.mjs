// The setup/doctor checks, pinned on fixtures. What a fixture CAN pin: the workspace resolver, which
// modules are found on which channel, which variables a module set needs, the bundle floor, and
// that the CLI's exit codes mean what they say. What it cannot: a real Google credential, a real
// ffmpeg — those are smoked by hand in a consumer and quoted, never manufactured here.
import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { findWorkspace, installedModules, capabilities, worst, capState, envKeys, BUNDLE_FLOOR, OURS } from '../lib/capabilities.mjs';

// the repo root — these tests were written at the root of dreamteamer/extensions, whose modules/ layout
// this repo keeps, so every `ROOT/modules/<m>/…` path still names the same file
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');
const CLI = path.join(ROOT, 'modules', 'setup', 'bin', 'setup.mjs');
const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

/** A fake consumer: package.json + lockfile, the engine linked in, and every official module linked as
 *  its own @dreamteamer/<id> dependency — the per-module shape this repo publishes. */
function consumer({ engineVersion = '0.31.0', deps = true, vars = [], disable = [], env = '', harnesses, gitignore } = {}) {
	const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-cap-')); made.push(ws);
	fs.mkdirSync(path.join(ws, 'node_modules', '@dreamteamer'), { recursive: true });
	fs.mkdirSync(path.join(ws, 'node_modules', 'dreamteamer'), { recursive: true });
	fs.writeFileSync(path.join(ws, "node_modules", "dreamteamer", "package.json"), JSON.stringify({ name: "dreamteamer", version: engineVersion, bin: { dreamteamer: "bin.js" }, dreamteamer: {} }));
	// an inert engine binary, so setup's recompile step neither fails nor reaches the network
	fs.writeFileSync(path.join(ws, "node_modules", "dreamteamer", "bin.js"), "#!/usr/bin/env node\nprocess.exit(0);\n", { mode: 0o755 });
	fs.mkdirSync(path.join(ws, "node_modules", ".bin"), { recursive: true });
	fs.symlinkSync(path.join("..", "dreamteamer", "bin.js"), path.join(ws, "node_modules", ".bin", "dreamteamer"));
	if (deps) for (const m of OURS) fs.symlinkSync(path.join(ROOT, 'modules', m), path.join(ws, 'node_modules', '@dreamteamer', m), 'dir');
	fs.writeFileSync(path.join(ws, 'package.json'), JSON.stringify({
		name: 'consumer', private: true, scripts: { check: 'dreamteamer check' },
		dependencies: { dreamteamer: '*', ...(deps ? Object.fromEntries(OURS.map((m) => [`@dreamteamer/${m}`, '*'])) : {}) },
		dreamteamer: { 'workspace-module': 'default', vars, disable, ...(harnesses ? { harnesses } : {}) },
	}, null, '\t'));
	fs.writeFileSync(path.join(ws, 'package-lock.json'), '{}');
	if (env) fs.writeFileSync(path.join(ws, '.env'), env);
	if (gitignore !== undefined) fs.writeFileSync(path.join(ws, '.gitignore'), gitignore);
	return ws;
}
const cap = (caps, name) => caps.find((c) => c.name === name);
const check = (caps, name, label) => cap(caps, name)?.checks.find((c) => c.label === label);

describe('findWorkspace', () => {
	test('walks up to the folder with package.json AND package-lock.json', () => {
		const ws = consumer();
		const deep = path.join(ws, 'a', 'b'); fs.mkdirSync(deep, { recursive: true });
		assert.equal(fs.realpathSync(findWorkspace(deep)), fs.realpathSync(ws));
	});
	test('a clone directly inside git_modules is never the workspace, even with a lockfile', () => {
		const ws = consumer();
		const clone = path.join(ws, 'git_modules', 'extensions'); fs.mkdirSync(path.join(clone, 'lib'), { recursive: true });
		fs.writeFileSync(path.join(clone, 'package.json'), '{}'); fs.writeFileSync(path.join(clone, 'package-lock.json'), '{}');
		assert.equal(fs.realpathSync(findWorkspace(path.join(clone, 'lib'))), fs.realpathSync(ws));
	});
	test('returns null outside any workspace', () => {
		const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-nows-')); made.push(d);
		assert.equal(findWorkspace(d), null);
	});
});

describe('installedModules', () => {
	test('finds every official module from node_modules, keyed by its id rather than its package name', () => {
		const found = installedModules(consumer());
		// the engine is a module too and is always found — filter to the official ones
		assert.deepEqual([...found.keys()].filter((k) => OURS.includes(k)).sort(), [...OURS].sort());
		assert.equal(found.get('projects').channel, 'node_modules');
	});
	test('finds a clone of this repo under git_modules, unpacked, on that channel (what `dt-setup link` makes)', () => {
		const ws = consumer({ deps: false });
		fs.mkdirSync(path.join(ws, 'git_modules'), { recursive: true });
		fs.symlinkSync(ROOT, path.join(ws, 'git_modules', 'dreamteamer-modules'), 'dir');
		assert.equal(installedModules(ws).get('meetings')?.channel, 'git_modules');
	});
	test('a workspace with none of them installed finds none of OURS (the engine still counts as a module)', () => {
		const found = installedModules(consumer({ deps: false }));
		assert.deepEqual([...found.keys()].filter((k) => OURS.includes(k)), []);
		assert.ok(found.has('dreamteamer'), 'the engine is a module and must still be discovered');
	});
	test('the engine floor holds on the copy channel too — every official module is tested on it, however it arrived', () => {
		const ws = consumer({ engineVersion: '0.29.0', deps: false });
		fs.mkdirSync(path.join(ws, 'modules'), { recursive: true });
		fs.symlinkSync(path.join(ROOT, 'modules', 'projects'), path.join(ws, 'modules', 'projects'), 'dir');
		const c = capabilities(ws).find((x) => x.name === 'workspace').checks.find((x) => x.label === 'engine');
		assert.equal(c.state, 'bad');
	});
});

describe('envKeys reads names only, and only ones with a value', () => {
	test('a blank value does not count as set', () => {
		const ws = consumer({ env: 'A=1\nB=\nC= \n# D=4\nE=x' });
		assert.deepEqual([...envKeys(ws)].sort(), ['A', 'E']);
	});
});

describe('the board', () => {
	test('an engine below the floor is UNAVAILABLE and the fix names the floor', () => {
		const caps = capabilities(consumer({ engineVersion: '0.29.0' }));
		const c = check(caps, 'workspace', 'engine');
		assert.equal(c.state, 'bad');
		assert.match(c.fix, new RegExp(BUNDLE_FLOOR.replace(/\./g, '\\.')));
	});
	test('the floor is satisfied on the engine this package pins', () => {
		assert.equal(check(capabilities(consumer()), 'workspace', 'engine').state, 'ok');
	});
	test('an undeclared variable is bad; declared but unset is only a warning; set is ok', () => {
		const bad = capabilities(consumer());
		assert.equal(check(bad, 'variables', 'FILES_FOLDER declared').state, 'bad');
		const warn = capabilities(consumer({ vars: ['FILES_FOLDER', 'INBOX_FOLDERS', 'REPOS_FOLDER'] }));
		assert.equal(check(warn, 'variables', 'FILES_FOLDER set').state, 'warn');
		const ok = capabilities(consumer({ vars: ['FILES_FOLDER', 'INBOX_FOLDERS', 'REPOS_FOLDER'], env: 'FILES_FOLDER=/x\nINBOX_FOLDERS=/y\nREPOS_FOLDER=/z' }));
		assert.equal(check(ok, 'variables', 'FILES_FOLDER').state, 'ok');
	});
	test('only the variables the INSTALLED modules use are asked for', () => {
		const caps = capabilities(consumer({ disable: ['recordings', 'meetings', 'perspective'] }));
		// tasks, contacts and assets need no template variable at all
		const labels = cap(caps, 'variables').checks.map((c) => c.label);
		assert.ok(!labels.some((l) => l.startsWith('INBOX_FOLDERS')), labels.join(','));
		assert.ok(!labels.some((l) => l.startsWith('REPOS_FOLDER')), labels.join(','));
	});
	test('the record guard is demanded until check chains it', () => {
		const ws = consumer({ vars: ['FILES_FOLDER', 'INBOX_FOLDERS', 'REPOS_FOLDER'] });
		assert.equal(check(capabilities(ws), 'record guard', 'chained').state, 'bad');
		const p = JSON.parse(fs.readFileSync(path.join(ws, 'package.json'), 'utf8'));
		p.scripts.check = 'dreamteamer check && node node_modules/@dreamteamer/perspective/bin/check-records.mjs';
		fs.writeFileSync(path.join(ws, 'package.json'), JSON.stringify(p));
		assert.equal(check(capabilities(ws), 'record guard', 'chained').state, 'ok');
	});
	test('a disabled module produces no capability of its own', () => {
		const caps = capabilities(consumer({ disable: ['recordings'] }));
		assert.equal(cap(caps, 'recordings'), undefined);
	});
	test('no fix is ever marked runnable unless it was given as `run` too', () => {
		for (const c of capabilities(consumer())) for (const chk of c.checks) {
			if (chk.state === 'ok') continue;
			assert.ok('fix' in chk && typeof chk.fix === 'string', `${c.name}/${chk.label} has no fix text`);
			assert.ok(chk.run === null || typeof chk.run === 'string');
		}
	});
});

describe('the CLI', () => {
	const run = (cwd, ...a) => spawnSync(process.execPath, [CLI, ...a], { cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
	test('doctor exits 0 on a degraded workspace, and 1 with --strict', () => {
		const ws = consumer();
		assert.equal(run(ws, 'doctor').status, 0);
		assert.equal(run(ws, 'doctor', '--strict').status, 1);
	});
	test('doctor --json is machine-readable and names the overall state', () => {
		const r = run(consumer(), 'doctor', '--json');
		const j = JSON.parse(r.stdout);
		assert.ok(['READY', 'DEGRADED', 'UNAVAILABLE'].includes(j.overall));
		assert.ok(Array.isArray(j.capabilities) && j.capabilities.length >= 2);
	});
	test('doctor writes nothing', () => {
		const ws = consumer();
		const before = fs.readdirSync(ws).sort().join(',') + fs.readFileSync(path.join(ws, 'package.json'), 'utf8');
		run(ws, 'doctor');
		const afterwards = fs.readdirSync(ws).sort().join(',') + fs.readFileSync(path.join(ws, 'package.json'), 'utf8');
		assert.equal(afterwards, before);
	});
	test('outside a workspace it refuses and says so', () => {
		const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-nows-')); made.push(d);
		const r = run(d, 'doctor');
		assert.equal(r.status, 1);
		assert.match(r.stderr, /Not inside a dreamteamer workspace/);
	});
	test('an unknown verb is refused with exit 2', () => {
		assert.equal(run(consumer(), 'frobnicate').status, 2);
	});
	test('setup creates .env with every value BLANK, so the doctor keeps saying unset', () => {
		// measured 2026-09-09 in a real consumer: setup wrote the EXAMPLE values into .env and the doctor
		// reported READY on placeholders like ~/Documents/vault-files — a green built from its own template
		const ws = consumer();
		const r = run(ws, 'setup', '--yes');
		assert.ok(fs.existsSync(path.join(ws, '.env')), r.stderr);
		const assigned = fs.readFileSync(path.join(ws, '.env'), 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l));
		assert.ok(assigned.length >= 3, assigned.join(','));
		for (const l of assigned) assert.match(l, /^[A-Z_]+=$/, `${l} carries a value — the doctor would count it as set`);
		assert.equal(check(capabilities(ws), 'variables', 'FILES_FOLDER set').state, 'warn', 'unset must stay visibly unset');
	});
	test('setup adds to .env.example only the keys it does not already have', () => {
		const ws = consumer();
		fs.writeFileSync(path.join(ws, '.env.example'), '# hand-written\nFILES_FOLDER=~/somewhere/real\n');
		run(ws, 'setup', '--yes');
		const ex = fs.readFileSync(path.join(ws, '.env.example'), 'utf8');
		assert.equal(ex.match(/^FILES_FOLDER=/gm).length, 1, 'a key the file already declares is never re-declared');
		assert.match(ex, /^WORK_CALENDARS=/m, 'a key the file lacked is added');
		assert.match(ex, /~\/somewhere\/real/, 'the existing value is untouched');
	});
	test('worst() ranks bad over warn over ok', () => {
		assert.equal(worst([{ checks: [{ state: 'ok' }, { state: 'warn' }] }]), 'DEGRADED');
		assert.equal(worst([{ checks: [{ state: 'warn' }, { state: 'bad' }] }]), 'UNAVAILABLE');
		assert.equal(worst([{ checks: [{ state: 'ok' }] }]), 'READY');
	});
});

describe('the notebooks capability', () => {
	test('OURS names every module this repo ships except setup itself — a module added without a row is a module the board cannot see', () => {
		const shipped = fs.readdirSync(path.join(ROOT, 'modules')).filter((m) => m !== 'setup' && fs.existsSync(path.join(ROOT, 'modules', m, 'package.json')));
		assert.deepEqual([...OURS].sort(), shipped.sort());
		assert.ok(OURS.includes('notebooks'));
		assert.ok(OURS.includes('users'), 'users is its own module so it renders at the nav root');
		assert.ok(OURS.includes('rnd'));
		assert.equal(installedModules(consumer()).get('notebooks')?.channel, 'node_modules');
		assert.equal(installedModules(consumer()).get('rnd')?.channel, 'node_modules');
	});
	test('rnd alone wants FILES_FOLDER (references and media_folder point into it), the way meetings and recordings do', () => {
		const caps = capabilities(consumer({ disable: ['recordings', 'meetings', 'perspective', 'notebooks', 'contacts', 'assets', 'projects'] }));
		assert.equal(check(caps, 'variables', 'FILES_FOLDER declared')?.state, 'bad');
	});
	// ⚠ WARN, NOT BAD, AND THAT IS THE TWO-ADAPTER RELEASE. Nothing under `notebooks` is `bad` any
	// more: the LOCAL adapter is a folder of markdown and needs no binary, no login and no harness, so
	// a machine with none of them still has a working notebook capability. Reporting UNAVAILABLE for
	// the absence of the EXTRA adapter would say the opposite on the very machine the claim is about.
	test('an undeclared notebooklm harness is a WARN — the local adapter never reads NOTEBOOKLM.md', () => {
		const c = check(capabilities(consumer()), 'notebooks', 'harness declared');
		assert.equal(c?.state, 'warn');
		assert.match(c.fix, /dreamteamer\.harnesses/);
		assert.match(c.detail, /local adapter never reads it/);
	});
	test('no notebooks check is `bad`, so a machine with no vendor CLI is DEGRADED and not UNAVAILABLE', () => {
		const caps = capabilities(consumer());
		assert.deepEqual(cap(caps, 'notebooks').checks.filter((c) => c.state === 'bad'), []);
		assert.notEqual(capState(cap(caps, 'notebooks')), 'UNAVAILABLE');
	});
	test('notebooks alone wants FILES_FOLDER — a wiki folder is a ${env:FILES_FOLDER}/… template', () => {
		const caps = capabilities(consumer({ disable: ['recordings', 'meetings', 'rnd', 'perspective', 'contacts', 'assets', 'projects'] }));
		assert.equal(check(caps, 'variables', 'FILES_FOLDER declared')?.state, 'bad');
	});
	// ⚠ THE ASSERTION REVERSED ON 2026-09-11, and the reversal is the feature. This used to warn until
	// FILES_FOLDER was both declared and set, because a wiki's folder was an `${env:…}` template and
	// every verb refused until it rendered. That IS a prerequisite, on the one adapter whose whole
	// claim is that it has none. Corpora live in the repo now, so the capability is READY on a bare
	// clone with no `.env`, no declared var, and no mount.
	test('the wikis folder check is ok with NO .env at all — the local adapter has no prerequisite', () => {
		assert.equal(check(capabilities(consumer()), 'notebooks', 'wikis folder')?.state, 'ok');
		assert.equal(check(capabilities(consumer({ vars: ['FILES_FOLDER'], env: 'FILES_FOLDER=/tmp/files\n' })), 'notebooks', 'wikis folder')?.state, 'ok');
	});

	// And the doctor still SAYS something about the legacy case rather than going silent on it: a
	// workspace whose records carry the old template does still need the variable, and a check that
	// stopped mentioning it would hide the one situation that can still refuse.
	test('with FILES_FOLDER unset the doctor still names the legacy corpora case', () => {
		const line = check(capabilities(consumer()), 'notebooks', 'legacy corpora');
		assert.ok(line, 'the legacy case must still be reported, not silently dropped');
		assert.match(line.detail ?? line.hint ?? '', /\$\{env:FILES_FOLDER\}/);
	});
	// ⚠ THIS TEST WAS THE BUG, TWICE OVER, AND BOTH SHAPES ARE WORTH KEEPING IN MIND.
	//
	// It used to assert that a missing `qmd` is `bad` — the opposite of the assertion thirty lines
	// above it, which has always said no notebooks check may be `bad`. Two tests, contradicting each
	// other, both green. They could both be green because the assertion sat behind `if (c.state !==
	// 'ok')`, and on the developer's machine qmd IS installed, so the state was `ok` and the body
	// never ran. CI has no qmd, took the other branch, and went red on the first push.
	//
	// So: a conditional around an assertion is a test that reports on the MACHINE, not on the code.
	// The fix is not to pick a branch — it is to remove the machine from the question. `bin()` resolves
	// through `command -v`, which reads process.env.PATH, so the absent case can be forced HERE and
	// asserted unconditionally on every machine, CI and laptop alike.
	const withoutQmd = (fn) => {
		const real = process.env.PATH ?? '';
		const r = spawnSync('command', ['-v', 'qmd'], { shell: true, encoding: 'utf8' });
		const qmdDir = r.status === 0 && r.stdout.trim() ? path.dirname(r.stdout.trim()) : null;
		process.env.PATH = qmdDir ? real.split(':').filter((d) => path.resolve(d) !== path.resolve(qmdDir)).join(':') : real;
		try { return fn(); } finally { process.env.PATH = real; }
	};

	test('qmd absent is a WARNING, never bad — grep is the floor and the module still works', () => {
		withoutQmd(() => {
			const c = check(capabilities(consumer()), 'notebooks', 'qmd');
			assert.ok(c, 'the qmd check must exist');
			assert.equal(c.state, 'warn', 'retrieval is optional: a bare clone greps, and every other verb is unaffected');
			assert.match(c.fix, /npm install -g @tobilu\/qmd/);
			assert.match(c.detail, /OPTIONAL/);
		});
	});

	test('and with qmd absent the whole capability is still not UNAVAILABLE', () => {
		withoutQmd(() => {
			const caps = capabilities(consumer());
			assert.deepEqual(cap(caps, 'notebooks').checks.filter((c) => c.state === 'bad'), []);
			assert.notEqual(capState(cap(caps, 'notebooks')), 'UNAVAILABLE');
		});
	});

	test('the notebooklm checks stay warnings — the extra adapter never blocks', () => {
		for (const label of ['notebooklm', 'harness declared']) {
			const c = check(capabilities(consumer()), 'notebooks', label);
			if (c && c.state !== 'ok') assert.notEqual(c.state, 'bad', `${label} must never be UNAVAILABLE — it is the optional adapter`);
		}
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
