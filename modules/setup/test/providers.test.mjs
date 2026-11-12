// THE COMPATIBILITY OWNERSHIP MAP, across version skew. A legacy row may give way to a module's own
// rows only when that module is installed, enabled, ships a provider this setup understands, and the
// provider actually returns the check. Every other combination keeps the legacy row — and no check is
// ever on the board twice. Synthetic workspaces only; nothing here proves an account or a calendar.
import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { capabilities, loadProviders, OWNERSHIP, OURS } from '../lib/capabilities.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');
const CLI = path.join(ROOT, 'modules', 'setup', 'bin', 'setup.mjs');
const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

/** A consumer with every official module linked in, except those `replace` swaps for a fixture folder. */
function consumer({ disable = [], replace = {}, env = '' } = {}) {
	const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'setup-providers-'))); made.push(ws);
	fs.mkdirSync(path.join(ws, 'node_modules', '@dreamteamer'), { recursive: true });
	fs.mkdirSync(path.join(ws, 'node_modules', 'dreamteamer'), { recursive: true });
	fs.writeFileSync(path.join(ws, 'node_modules', 'dreamteamer', 'package.json'), JSON.stringify({ name: 'dreamteamer', version: '0.43.0', dreamteamer: {} }));
	for (const m of OURS) {
		const at = path.join(ws, 'node_modules', '@dreamteamer', m);
		if (replace[m]) replace[m](at); else fs.symlinkSync(path.join(ROOT, 'modules', m), at, 'dir');
	}
	fs.writeFileSync(path.join(ws, 'package.json'), JSON.stringify({ name: 'consumer', private: true, dependencies: Object.fromEntries(OURS.map((m) => [`@dreamteamer/${m}`, '*'])), dreamteamer: { disable } }, null, '\t'));
	fs.writeFileSync(path.join(ws, 'package-lock.json'), '{}');
	if (env) fs.writeFileSync(path.join(ws, '.env'), env);
	return ws;
}
/** The module folder as an older release shipped it: everything except its setup provider. */
const withoutProvider = (id) => (at) => fs.cpSync(path.join(ROOT, 'modules', id), at, { recursive: true, filter: (src) => !/(^|[\\/])(test|lib[\\/](meetings|google)-setup\.mjs)$/.test(path.relative(path.join(ROOT, 'modules', id), src)) });
/** The module folder with its provider replaced by `source`. */
const withProvider = (id, file, source) => (at) => { withoutProvider(id)(at); fs.writeFileSync(path.join(at, 'lib', file), source); };

const cap = (caps, name) => caps.find((c) => c.name === name);
const labels = (c) => c.checks.map((x) => x.label);
const LEGACY = { meetings: ['WORK_CALENDARS', 'credential files', 'account access'], 'google-workspace': ['local prerequisites'] };
const PROVIDED = {
	meetings: ['meetings.work-calendars', 'meetings.oauth-client', 'meetings.credential-files', 'meetings.account-access'],
	'google-workspace': ['google.runtime', 'google.client-config', 'google.credential-store', 'google.stored-accounts', 'google.credential-placement', 'google.account-authorization'],
};
const ids = (c) => c.checks.map((x) => x.id ?? `legacy:${x.label}`);
const unique = (caps) => { for (const c of caps) assert.equal(new Set(labels(c)).size, labels(c).length, `${c.name} repeats a row: ${labels(c)}`); };

describe('the ownership map', () => {
	test('names only modules this repo ships, each with a provider file that exports the mapped checks', async () => {
		for (const [name, owner] of Object.entries(OWNERSHIP)) {
			assert.ok(OURS.includes(owner.provider), owner.provider);
			const m = await import(pathToFileURL(path.join(ROOT, 'modules', owner.provider, owner.entry)).href);
			assert.ok(owner.protocols.includes(m.SETUP_PROVIDER.protocol), name);
			for (const id of Object.values(owner.rows).flat()) assert.ok(m.SETUP_PROVIDER.checks.includes(id), `${name}: ${id}`);
			assert.ok(fs.existsSync(path.join(ROOT, 'modules', owner.provider, 'SETUP.md')), `${owner.provider} ships SETUP.md`);
		}
	});
});

describe('version skew', () => {
	test('old setup, new modules: the legacy board (no providers) is unchanged and still works', () => {
		const caps = capabilities(consumer());
		for (const [name, rows] of Object.entries(LEGACY)) assert.deepEqual(labels(cap(caps, name)), rows, name);
		assert.equal(cap(caps, 'google-workspace').checks[0].state, 'warn', 'the new module\'s dt-google doctor still answers the legacy call');
		assert.ok(cap(caps, 'meetings').checks.every((c) => !('id' in c)));
	});
	test('old setup, new modules: the published 0.2.1 capabilities file runs against them', async (t) => {
		const old = spawnSync('git', ['show', 'e27aee9:modules/setup/lib/capabilities.mjs'], { cwd: ROOT, encoding: 'utf8' });
		if (old.status !== 0) return t.skip('the 0.2.1 source is not in this clone\'s history');
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-021-')); made.push(dir);
		fs.writeFileSync(path.join(dir, 'capabilities.mjs'), old.stdout);
		const legacy = await import(pathToFileURL(path.join(dir, 'capabilities.mjs')).href);
		const caps = legacy.capabilities(consumer());
		for (const [name, rows] of Object.entries(LEGACY)) assert.deepEqual(labels(cap(caps, name)), rows, name);
	});
	test('new setup, new modules: each owned capability shows its module\'s rows once, legacy rows gone', async () => {
		const ws = consumer();
		const providers = await loadProviders(ws);
		assert.deepEqual([...providers.keys()].sort(), ['google-workspace', 'meetings']);
		const caps = capabilities(ws, { providers });
		unique(caps);
		for (const name of Object.keys(OWNERSHIP)) {
			const c = cap(caps, name);
			assert.deepEqual(ids(c), PROVIDED[name], name);
			assert.equal(c.provider, `@dreamteamer/${name}`);
			assert.equal(c.setup, path.join('node_modules', '@dreamteamer', name, 'SETUP.md'));
			for (const row of c.checks) { assert.equal(row.run, null); assert.equal(typeof row.fix, 'string'); }
		}
		assert.ok(!labels(cap(caps, 'google-workspace')).includes('local prerequisites'));
		assert.equal(cap(caps, 'meetings').checks.find((r) => r.id === 'meetings.account-access').state, 'warn', 'still unverified');
		// every capability nobody owns is the legacy one, untouched
		const legacy = capabilities(ws);
		for (const c of caps.filter((x) => !OWNERSHIP[x.name])) assert.deepEqual(c, cap(legacy, c.name));
	});
	test('new setup, old modules: a module without a provider keeps the legacy rows', async () => {
		const ws = consumer({ replace: { meetings: withoutProvider('meetings'), 'google-workspace': withoutProvider('google-workspace') } });
		const providers = await loadProviders(ws);
		assert.equal(providers.size, 0);
		const caps = capabilities(ws, { providers });
		for (const [name, rows] of Object.entries(LEGACY)) assert.deepEqual(labels(cap(caps, name)), rows, name);
	});
	test('an unsupported protocol, a provider that throws, or one that fails to load keeps the legacy rows', async () => {
		const meta = (protocol) => `export const SETUP_PROVIDER = { protocol: ${protocol}, module: '@dreamteamer/meetings', checks: ['meetings.work-calendars','meetings.credential-files','meetings.account-access'] };\n`;
		for (const source of [
			`${meta(2)}export function inspect() { return { checks: [] }; }\n`,
			`${meta(1)}export function inspect() { throw new Error('synthetic failure at /home/dana'); }\n`,
			`${meta(1)}import './missing-file.mjs';\nexport function inspect() { return { checks: [] }; }\n`,
			`${meta(1)}export function inspect() { return { checks: [{ id: 'meetings.work-calendars', label: 'x', state: 'maybe' }] }; }\n`,
		]) {
			const ws = consumer({ replace: { meetings: withProvider('meetings', 'meetings-setup.mjs', source) } });
			const caps = capabilities(ws, { providers: await loadProviders(ws) });
			assert.deepEqual(labels(cap(caps, 'meetings')), LEGACY.meetings, source);
			assert.doesNotMatch(JSON.stringify(caps), /synthetic failure/);
		}
	});
	test('a provider that omits one check replaces only the rows it supplies, and duplicates nothing', async () => {
		const source = `export const SETUP_PROVIDER = { protocol: 1, module: '@dreamteamer/meetings', checks: ['meetings.work-calendars','meetings.credential-files'] };
export function inspect() { return { checks: [
	{ id: 'meetings.work-calendars', label: 'calendar rows', state: 'ok', status: 'configured', detail: 'synthetic', fix: '' },
	{ id: 'meetings.credential-files', label: 'credential files', state: 'warn', status: 'missing', detail: 'synthetic', fix: 'synthetic' },
	{ id: 'meetings.account-access', label: 'undeclared', state: 'warn', status: 'unverified', detail: 'synthetic', fix: 'synthetic' },
] }; }\n`;
		const ws = consumer({ replace: { meetings: withProvider('meetings', 'meetings-setup.mjs', source) } });
		const c = cap(capabilities(ws, { providers: await loadProviders(ws) }), 'meetings');
		assert.deepEqual(ids(c), ['meetings.work-calendars', 'meetings.credential-files', 'legacy:account access'], 'an undeclared row is not taken');
		unique([c]);
	});
	test('a disabled provider contributes nothing; core standing in for meetings supplies its composed provider', async () => {
		const off = consumer({ disable: ['modules/meetings', 'modules/core', 'modules/google-workspace'] });
		const providers = await loadProviders(off);
		assert.equal(providers.size, 0);
		const caps = capabilities(off, { providers });
		assert.equal(cap(caps, 'meetings'), undefined);
		assert.equal(cap(caps, 'google-workspace'), undefined);
		const composed = consumer({ disable: ['modules/meetings'] });
		const viaCore = await loadProviders(composed);
		assert.equal(viaCore.get('meetings')?.module, '@dreamteamer/core');
		assert.equal(viaCore.get('meetings').setup, path.join('node_modules', '@dreamteamer', 'core', 'SETUP.md'), 'the composed package routes to its own SETUP.md');
		const c = cap(capabilities(composed, { providers: viaCore }), 'meetings');
		assert.deepEqual(ids(c), PROVIDED.meetings);
		assert.equal(c.setup, path.join('node_modules', '@dreamteamer', 'core', 'SETUP.md'));
		// the composed copy plans a command that names core's prefixed script
		const coreProvider = await import(pathToFileURL(path.join(ROOT, 'modules', 'core', 'lib', 'meetings-setup.mjs')).href);
		fs.writeFileSync(path.join(composed, '.gitignore'), '.env\n');
		const step = coreProvider.plan({ root: composed, env: {}, rows: ['team@northwind.example | northwind | dana@northwind.example'] }).actions[0];
		assert.match(step.command[1], /modules\/core\/bin\/meetings-setup\.mjs$/);
		assert.ok(fs.existsSync(path.resolve(composed, step.command[1])));
	});
	test('the provider reads the same .env the board does', async () => {
		const ws = consumer({ env: 'WORK_CALENDARS="team@northwind.example | northwind | dana@northwind.example"\n' });
		const c = cap(capabilities(ws, { providers: await loadProviders(ws) }), 'meetings');
		assert.equal(c.checks.find((r) => r.id === 'meetings.work-calendars').state, 'ok');
		assert.doesNotMatch(JSON.stringify(c), /dana@/);
	});
});

describe('the CLI', () => {
	const run = (cwd, ...a) => spawnSync(process.execPath, [CLI, ...a], { cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
	test('doctor --json carries the module-owned rows and their owner; doctor writes nothing', () => {
		const ws = consumer();
		const before = fs.readdirSync(ws).sort().join();
		const r = run(ws, 'doctor', '--json');
		assert.equal(r.status, 0, r.stderr);
		const j = JSON.parse(r.stdout);
		assert.deepEqual(ids(cap(j.capabilities, 'meetings')), PROVIDED.meetings);
		assert.equal(fs.readdirSync(ws).sort().join(), before);
		assert.match(run(ws, 'doctor').stdout, /checks owned by @dreamteamer\/meetings — setup steps: node_modules\/@dreamteamer\/meetings\/SETUP\.md/);
	});
});
