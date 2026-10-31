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
import { findWorkspace, installedModules, capabilities, worst, capState, envKeys, BUNDLE_FLOOR, OURS, originsOf, rootOf, binOf, gpuCheck, transcriptionHome, GGML_SIZE } from '../lib/capabilities.mjs';

// the repo root
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
		dreamteamer: { workspace_module: 'default', vars, disable, ...(harnesses ? { harnesses } : {}) },
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
		const caps = capabilities(consumer({ disable: ['modules/core', 'modules/recordings', 'modules/meetings', 'modules/perspective'] }));
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
		const caps = capabilities(consumer({ disable: ['modules/core', 'modules/recordings'] }));
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
		// example values written into .env would read as set, and the doctor would report READY on placeholders
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

describe('the wikis and notebooklm capabilities', () => {
	test('OURS names every module this repo ships except setup itself — a module added without a row is a module the board cannot see', () => {
		const shipped = fs.readdirSync(path.join(ROOT, 'modules')).filter((m) => m !== 'setup' && fs.existsSync(path.join(ROOT, 'modules', m, 'package.json')));
		assert.deepEqual([...OURS].sort(), shipped.sort());
		assert.ok(OURS.includes('wikis'));
		assert.ok(OURS.includes('notebooklm'));
		assert.ok(OURS.includes('companies') && OURS.includes('meeting-docs'), 'the 2026-10-01 splits each have a row');
		assert.ok(OURS.includes('users'), 'users is its own module so it renders at the nav root');
		assert.ok(OURS.includes('rnd'));
		assert.equal(installedModules(consumer()).get('wikis')?.channel, 'node_modules');
		assert.equal(installedModules(consumer()).get('rnd')?.channel, 'node_modules');
	});
	test('rnd alone wants FILES_FOLDER (references and media_folder point into it), the way meetings and recordings do', () => {
		const caps = capabilities(consumer({ disable: ['modules/core', 'modules/recordings', 'modules/meetings', 'modules/perspective', 'modules/wikis', 'modules/contacts', 'modules/assets', 'modules/projects'] }));
		assert.equal(check(caps, 'variables', 'FILES_FOLDER declared')?.state, 'bad');
	});
	// The local adapter needs no binary, login or harness, so the extra adapter's absence is a warning.
	test('an undeclared notebooklm harness is a WARN — a local wiki never reads NOTEBOOKLM.md', () => {
		const c = check(capabilities(consumer()), 'notebooklm', 'harness declared');
		assert.equal(c?.state, 'warn');
		assert.match(c.fix, /dreamteamer\.harnesses/);
		assert.match(c.detail, /local wiki never reads it/);
	});
	test('no wikis or notebooklm check is `bad`, so a machine with no vendor CLI is DEGRADED and not UNAVAILABLE', () => {
		const caps = capabilities(consumer());
		for (const id of ['wikis', 'notebooklm']) {
			assert.deepEqual(cap(caps, id).checks.filter((c) => c.state === 'bad'), [], id);
			assert.notEqual(capState(cap(caps, id)), 'UNAVAILABLE', id);
		}
	});
	test('wikis alone wants FILES_FOLDER — a legacy wiki folder is a ${env:FILES_FOLDER}/… template', () => {
		const caps = capabilities(consumer({ disable: ['modules/core', 'modules/recordings', 'modules/meetings', 'modules/rnd', 'modules/perspective', 'modules/contacts', 'modules/assets', 'modules/projects'] }));
		assert.equal(check(caps, 'variables', 'FILES_FOLDER declared')?.state, 'bad');
	});
	// Corpora live in the repo, so the wikis capability is READY on a bare clone with no .env.
	test('the wikis folder check is ok with NO .env at all — the local adapter has no prerequisite', () => {
		assert.equal(check(capabilities(consumer()), 'wikis', 'wikis folder')?.state, 'ok');
		assert.equal(check(capabilities(consumer({ vars: ['FILES_FOLDER'], env: 'FILES_FOLDER=/tmp/files\n' })), 'wikis', 'wikis folder')?.state, 'ok');
	});

	// A record still carrying the old template needs the variable, so the doctor names that case.
	test('with FILES_FOLDER unset the doctor still names the legacy corpora case', () => {
		const line = check(capabilities(consumer()), 'wikis', 'legacy corpora');
		assert.ok(line, 'the legacy case must still be reported, not silently dropped');
		assert.match(line.detail ?? line.hint ?? '', /\$\{env:FILES_FOLDER\}/);
	});
	// `bin()` resolves through `command -v`, which reads PATH, so stripping qmd's directory from PATH
	// forces the absent case on every machine and the assertion runs unconditionally.
	const withoutQmd = (fn) => {
		const real = process.env.PATH ?? '';
		const r = spawnSync('command', ['-v', 'qmd'], { shell: true, encoding: 'utf8' });
		const qmdDir = r.status === 0 && r.stdout.trim() ? path.dirname(r.stdout.trim()) : null;
		process.env.PATH = qmdDir ? real.split(':').filter((d) => path.resolve(d) !== path.resolve(qmdDir)).join(':') : real;
		try { return fn(); } finally { process.env.PATH = real; }
	};

	test('qmd absent is a WARNING, never bad — grep is the floor and the module still works', () => {
		withoutQmd(() => {
			const c = check(capabilities(consumer()), 'wikis', 'qmd');
			assert.ok(c, 'the qmd check must exist');
			assert.equal(c.state, 'warn', 'retrieval is optional: a bare clone greps, and every other verb is unaffected');
			assert.match(c.fix, /npm install -g @tobilu\/qmd/);
			assert.match(c.detail, /OPTIONAL/);
		});
	});

	test('and with qmd absent the whole capability is still not UNAVAILABLE', () => {
		withoutQmd(() => {
			const caps = capabilities(consumer());
			assert.deepEqual(cap(caps, 'wikis').checks.filter((c) => c.state === 'bad'), []);
			assert.notEqual(capState(cap(caps, 'wikis')), 'UNAVAILABLE');
		});
	});

	test('the notebooklm checks stay warnings — the extra adapter never blocks', () => {
		for (const label of ['notebooklm', 'harness declared']) {
			const c = check(capabilities(consumer()), 'notebooklm', label);
			if (c && c.state !== 'ok') assert.notEqual(c.state, 'bad', `${label} must never be UNAVAILABLE — it is the optional adapter`);
		}
	});

	test('a declared notebooklm harness is ok', () => {
		assert.equal(check(capabilities(consumer({ harnesses: ['claude-code', 'notebooklm'] })), 'notebooklm', 'harness declared')?.state, 'ok');
	});
	test('.cache/ missing from .gitignore is a warn; present is ok', () => {
		assert.equal(check(capabilities(consumer({ gitignore: 'node_modules/\n' })), 'notebooklm', '.cache/ ignored')?.state, 'warn');
		assert.equal(check(capabilities(consumer({ gitignore: 'node_modules/\n.cache/\n' })), 'notebooklm', '.cache/ ignored')?.state, 'ok');
	});
	test('the module switched off shows no wikis capability — once rnd, which composes it, is off too', () => {
		assert.equal(cap(capabilities(consumer({ disable: ['modules/core', 'modules/wikis', 'modules/rnd'] })), 'wikis'), undefined);
	});
	// rnd composes wikis and notebooklm (modules/rnd/compose.json), so a workspace with rnd alone has
	// both capabilities, read from rnd's own package — the same stand-in core is for users or meetings.
	test('rnd stands in for wikis and notebooklm: the capabilities exist, and resolve to rnd\'s root and prefixed bin', () => {
		const ws = consumer({ disable: ['modules/core', 'modules/wikis', 'modules/notebooklm'] });
		const mods = installedModules(ws);
		assert.ok(!mods.has('wikis') && !mods.has('notebooklm') && mods.has('rnd'));
		assert.deepEqual(originsOf(mods, 'rnd'), ['wikis', 'notebooklm']);
		assert.equal(fs.realpathSync(rootOf(mods, 'wikis')), fs.realpathSync(path.join(ROOT, 'modules', 'rnd')));
		assert.equal(path.basename(binOf(mods, 'wikis', 'wiki.mjs')), 'wikis-wiki.mjs');
		assert.equal(path.basename(binOf(mods, 'notebooklm', 'notebook.mjs')), 'notebooklm-notebook.mjs');
		assert.ok(fs.existsSync(binOf(mods, 'wikis', 'wiki.mjs')), 'the prefixed copy is shipped');
		const caps = capabilities(ws);
		assert.ok(cap(caps, 'wikis'), 'the wikis capability, from rnd');
		assert.ok(cap(caps, 'notebooklm'), 'the notebooklm capability, from rnd');
		assert.equal(check(caps, 'wikis', 'wikis folder')?.state, 'ok');
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

describe('the transcriber: models where the skill reads them, and whether the GPU pass can run', () => {
	test('the transcriber folder defaults to one folder in the per-machine cache and follows TRANSCRIPTION_HOME', () => {
		assert.equal(transcriptionHome({}, '/home/dana'), '/home/dana/.cache/dreamteamer/transcription');
		assert.equal(transcriptionHome({ TRANSCRIPTION_HOME: '' }, '/home/dana'), '/home/dana/.cache/dreamteamer/transcription');
		assert.equal(transcriptionHome({ TRANSCRIPTION_HOME: '~/t' }, '/home/dana'), '/home/dana/t');
		assert.equal(transcriptionHome({ TRANSCRIPTION_HOME: '/srv/t' }, '/home/dana'), '/srv/t');
		assert.equal(transcriptionHome({ TRANSCRIBING_MODELS_DIR: '/srv/m' }, '/home/dana'), '/home/dana/.cache/dreamteamer/transcription', 'the old variable moves nothing');
	});
	const mac = { platform: 'darwin', arch: 'arm64' };
	test('Apple Silicon with whisper-cli and whole weights is metal', () => {
		const g = gpuCheck({ ...mac, whisperCli: '/opt/homebrew/bin/whisper-cli', ggmlSize: GGML_SIZE });
		assert.equal(g.state, 'ok');
		assert.match(g.detail, /^metal/);
	});
	test('a missing whisper-cli is an optional warning that names the install', () => {
		const g = gpuCheck({ ...mac, whisperCli: null, ggmlSize: GGML_SIZE });
		assert.equal(g.state, 'warn');
		assert.match(g.fix, /brew install whisper-cpp/);
		assert.match(g.detail, /optional/);
	});
	test('missing or partial weights are a warning, never ok', () => {
		for (const size of [null, GGML_SIZE - 1]) {
			const g = gpuCheck({ ...mac, whisperCli: '/opt/homebrew/bin/whisper-cli', ggmlSize: size });
			assert.equal(g.state, 'warn', String(size));
			assert.match(g.fix, /transcribe_meeting\.py setup/);
		}
	});
	test('off Apple Silicon there is no GPU engine — ok, and says the CPU pass runs', () => {
		for (const m of [{ platform: 'linux', arch: 'x64' }, { platform: 'darwin', arch: 'x64' }]) {
			const g = gpuCheck({ ...m, whisperCli: '/usr/bin/whisper-cli', ggmlSize: GGML_SIZE });
			assert.equal(g.state, 'ok');
			assert.match(g.detail, /^cpu/);
		}
	});
	test('the recordings capability carries a gpu line', () => {
		const ws = consumer({ disable: ['modules/core'] });
		const c = cap(capabilities(ws), 'recordings');
		assert.ok(c, 'no recordings capability');
		assert.ok(c.checks.some((k) => k.label === 'gpu'), c.checks.map((k) => k.label).join(', '));
		assert.ok(!c.checks.some((k) => /^TRANSCRIB/.test(k.label)), 'the folder has a working default — no variable to demand');
	});
});
