// `dt-docker export container` / `dt-docker import container`, driven through the real binary against the
// fake Engine API — whose container files are a real folder and whose …/archive routes are the system
// `tar`, so the round trip is checked against a real tar on both ends. Every test asserts what reached
// the container (or did NOT), not that a code path ran.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HQ, harness, startFakeDocker } from './helpers/harness.js';

const PASS = 'correct horse battery staple';

/** A .tar.gz with exactly these entries — how a hostile export is made, since no honest tool writes one. */
function tarGz(entries) {
	const blocks = [];
	for (const e of entries) {
		const h = Buffer.alloc(512); const data = Buffer.from(e.data ?? '');
		h.write(e.name, 0, 100); h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
		h.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124); h.write('00000000000\0', 136);
		h.write(e.type ?? '0', 156); h.write(e.linkname ?? '', 157); h.write('ustar\u000000', 257, 'latin1');
		h.fill(32, 148, 156); let sum = 0; for (const b of h) sum += b; h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'latin1');
		blocks.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
	}
	return zlib.gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}
const tarRun = (args) => spawnSync('tar', args, { encoding: 'utf8', timeout: 30_000, killSignal: 'SIGKILL' }).stdout;
const listTarGz = (file) => tarRun(['-tzf', file]).split('\n').filter(Boolean);

describe('export and import a container\'s workspaces', () => {
	let h, dir, fsRoot, fake;
	const dt = (...args) => h.dt(...args);
	const at = (container, p) => path.join(fsRoot, container, p);
	const put = (container, p, data) => { fs.mkdirSync(path.dirname(at(container, p)), { recursive: true }); fs.writeFileSync(at(container, p), data); };
	const out = (n) => path.join(dir, n);
	/** Requests made after `since` — how "nothing was written" is asserted: no PUT, no chown. */
	const writesSince = async (since) => {
		const s = await fake.state();
		return { puts: s.requests.slice(since).filter((r) => r.method === 'PUT'), chowns: s.execs.filter((e) => e.Cmd[0] === 'chown') };
	};
	const mark = async () => (await fake.state()).requests.length;

	before(async () => {
		h = harness({ prefix: 'dth-a-' }); dir = h.dir;
		fsRoot = path.join(dir, 'fs'); fs.mkdirSync(fsRoot);
		fake = await startFakeDocker(h.sock, { images: [{ ref: HQ, labels: { 'dreamteamer.template': 'hq', 'dreamteamer.ports': '8080' } }], fsRoot });
		for (const name of ['hq-dana', 'hq-eli']) assert.equal(dt('start', 'container', name, '--template', 'hq', '--no-open').code, 0);
	});
	after(async () => { await fake.close(); h.cleanup(); });
	beforeEach(() => {
		fs.rmSync(path.join(fsRoot, 'hq-dana'), { recursive: true, force: true });
		put('hq-dana', 'workspaces/hq-dana/README.md', '# acme\n');
		put('hq-dana', 'workspaces/hq-dana/notes/2026-09-01--kickoff.md', 'dana met acme\n');
		put('hq-dana', 'workspaces/hq-dana/node_modules/pkg/index.js', 'module.exports = 1\n');
		put('hq-dana', 'workspaces/.files/hq-dana/recording.m4a', 'audio');
		put('hq-dana', 'home/node/.claude/.credentials.json', '{"token":"login-secret"}');
		fs.symlinkSync('README.md', at('hq-dana', 'workspaces/hq-dana/readme-link'));
		for (const f of fs.readdirSync(dir)) if (/\.(dtx|tgz|partial)$/.test(f)) fs.rmSync(out(f));
	});

	test('an encrypted export round-trips into an emptied workspace: files, a symlink, owned by node — and never node_modules, .files or the home', async () => {
		const e = dt('export', 'container', 'hq-dana', '--out', out('a.dtx'), { DT_EXPORT_PASSPHRASE: PASS });
		assert.equal(e.code, 0, e.out);
		assert.match(e.stdout, /hq-dana {2}2 files/);
		assert.match(e.stdout, /left behind: .*hq-dana\/node_modules/);
		assert.match(e.stdout, /left behind: .*\.files/);
		assert.match(e.stdout, /encrypted with the owner passphrase/);
		const bytes = fs.readFileSync(out('a.dtx'));
		assert.equal(bytes.subarray(0, 8).toString(), 'DTEXPORT');
		assert.ok(!bytes.includes('dana met acme') && !bytes.includes(PASS), 'plaintext or the passphrase is in the file');
		const s = await fake.state();
		const reads = s.requests.filter((r) => r.path.includes('/archive'));
		assert.ok(reads.length && reads.every((r) => r.method === 'GET' && r.path.endsWith('?path=%2Fworkspaces')), JSON.stringify(reads));
		// the fresh volume a new container would get
		fs.rmSync(at('hq-dana', 'workspaces/hq-dana'), { recursive: true }); fs.mkdirSync(at('hq-dana', 'workspaces/hq-dana'));
		const i = dt('import', 'container', 'hq-dana', out('a.dtx'), { DT_EXPORT_PASSPHRASE: PASS });
		assert.equal(i.code, 0, i.out);
		assert.equal(fs.readFileSync(at('hq-dana', 'workspaces/hq-dana/notes/2026-09-01--kickoff.md'), 'utf8'), 'dana met acme\n');
		assert.equal(fs.readlinkSync(at('hq-dana', 'workspaces/hq-dana/readme-link')), 'README.md');
		assert.ok(!fs.existsSync(at('hq-dana', 'workspaces/hq-dana/node_modules')));
		const chown = (await fake.state()).execs.filter((x) => x.Cmd[0] === 'chown').pop();
		assert.deepEqual({ Cmd: chown.Cmd, User: chown.User }, { Cmd: ['chown', '-R', 'node:node', '/workspaces/hq-dana'], User: 'root' });
	});

	test('--no-encrypt writes a plain .tar.gz rooted at the workspace folders, and says so', () => {
		fs.writeFileSync(at('hq-dana', 'workspaces/stray.txt'), 'not a workspace');
		const e = dt('export', 'container', 'hq-dana', '--out', out('p.tgz'), '--no-encrypt');
		assert.equal(e.code, 0, e.out);
		assert.match(e.stdout, /NOT encrypted/);
		const names = listTarGz(out('p.tgz'));
		assert.ok(names.includes('hq-dana/README.md'), names.join('\n'));
		assert.deepEqual(names.filter((n) => !n.startsWith('hq-dana/')), []);
		assert.deepEqual(names.filter((n) => /node_modules|\.files|home|credentials/.test(n)), []);
	});

	test('a stopped container exports; importing into it is refused, naming dt start', () => {
		assert.equal(dt('stop', 'container', 'hq-dana').code, 0);
		const e = dt('export', 'container', 'hq-dana', '--out', out('s.tgz'), '--no-encrypt');
		assert.equal(e.code, 0, e.out);
		const i = dt('import', 'container', 'hq-dana', out('s.tgz'), '--replace');
		assert.equal(i.code, 1);
		assert.match(i.out, /exited — import needs it running: dt-docker start container hq-dana/);
		assert.equal(dt('start', 'container', 'hq-dana', '--no-open').code, 0);
	});

	test('the passphrase is never an argument: --passphrase is refused, and with no env and no terminal nothing is written', () => {
		const a = dt('export', 'container', 'hq-dana', '--out', out('x.dtx'), '--passphrase', PASS);
		assert.equal(a.code, 1);
		assert.match(a.out, /never a flag/);
		const b = dt('export', 'container', 'hq-dana', '--out', out('x.dtx'));
		assert.equal(b.code, 1);
		assert.match(b.out, /DT_EXPORT_PASSPHRASE/);
		assert.ok(!fs.existsSync(out('x.dtx')) && !fs.existsSync(out('x.dtx.partial')));
		assert.equal(dt('import', 'container', 'hq-dana', out('x.dtx'), '--passphrase', PASS).code, 1);
	});

	test('a wrong passphrase is told apart from damage, and writes nothing', async () => {
		assert.equal(dt('export', 'container', 'hq-dana', '--out', out('w.dtx'), { DT_EXPORT_PASSPHRASE: PASS }).code, 0);
		const since = await mark();
		const r = dt('import', 'container', 'hq-dana', out('w.dtx'), '--replace', { DT_EXPORT_PASSPHRASE: 'not the passphrase' });
		assert.equal(r.code, 1);
		assert.match(r.out, /wrong passphrase .* nothing was written/);
		const w = await writesSince(since);
		assert.equal(w.puts.length, 0);
		assert.equal(fs.readFileSync(at('hq-dana', 'workspaces/hq-dana/README.md'), 'utf8'), '# acme\n');
	});

	test('a flipped byte, a truncated file and an appended chunk each fail authentication before anything is written', async () => {
		// enough data for several 64 KiB chunks, so the damage lands in the MIDDLE
		put('hq-dana', 'workspaces/hq-dana/big.bin', crypto.randomBytes(300_000));
		assert.equal(dt('export', 'container', 'hq-dana', '--out', out('t.dtx'), { DT_EXPORT_PASSPHRASE: PASS }).code, 0);
		const good = fs.readFileSync(out('t.dtx'));
		assert.ok(good.length > 3 * 65536, `only ${good.length} bytes`);
		const flipped = Buffer.from(good); flipped[100_000] ^= 1;
		// 72 header bytes, then chunks of 64 KiB + a 16-byte tag; the last is shorter and marked final.
		// Dropping exactly that last chunk leaves a file of whole, individually VALID chunks — only the
		// final mark tells it from a complete one.
		const boundary = good.subarray(0, 72 + Math.floor((good.length - 72 - 1) / 65552) * 65552);
		const cases = { flipped, 'cut mid-chunk': good.subarray(0, good.length - 100), 'cut at a chunk boundary': boundary, appended: Buffer.concat([good, good.subarray(72, 72 + 65552)]) };
		for (const [what, bytes] of Object.entries(cases)) {
			fs.writeFileSync(out('bad.dtx'), bytes);
			const since = await mark();
			const r = dt('import', 'container', 'hq-dana', out('bad.dtx'), '--replace', { DT_EXPORT_PASSPHRASE: PASS });
			assert.equal(r.code, 1, `${what}: ${r.out}`);
			assert.match(r.out, /the export is (damaged or truncated|truncated)/, what);
			assert.equal((await writesSince(since)).puts.length, 0, `${what} reached the container`);
		}
		assert.ok(fs.existsSync(at('hq-dana', 'workspaces/hq-dana/README.md')), 'a refused import emptied the workspace');
	});

	test('a workspace that already holds files is refused without --replace; --replace empties it first', () => {
		assert.equal(dt('export', 'container', 'hq-dana', '--out', out('r.tgz'), '--no-encrypt').code, 0);
		put('hq-dana', 'workspaces/hq-dana/stale.md', 'from before');
		const a = dt('import', 'container', 'hq-dana', out('r.tgz'));
		assert.equal(a.code, 1);
		assert.match(a.out, /\/workspaces\/hq-dana already holds files .* --replace/);
		assert.ok(fs.existsSync(at('hq-dana', 'workspaces/hq-dana/stale.md')));
		const b = dt('import', 'container', 'hq-dana', out('r.tgz'), '--replace');
		assert.equal(b.code, 0, b.out);
		assert.ok(!fs.existsSync(at('hq-dana', 'workspaces/hq-dana/stale.md')), '--replace left a stale file');
		assert.ok(fs.existsSync(at('hq-dana', 'workspaces/hq-dana/README.md')));
	});

	// Import checks the whole file (pass 1), then used to EMPTY the workspace and stream the file again
	// (pass 2). A file that changed in between — truncated, damaged, swapped — failed pass 2 half-way:
	// the old workspace deleted, part of the new one written, and a message saying "nothing was written".
	test('--replace with an export that is truncated between the two passes leaves the workspace exactly as it was, and says so', async () => {
		put('hq-dana', 'workspaces/hq-dana/big.bin', crypto.randomBytes(300_000));
		assert.equal(dt('export', 'container', 'hq-dana', '--out', out('p2.dtx'), { DT_EXPORT_PASSPHRASE: PASS }).code, 0);
		put('hq-dana', 'workspaces/hq-dana/stale.md', 'from before');
		const ws = at('hq-dana', 'workspaces/hq-dana');
		const snapshot = () => fs.readdirSync(ws, { recursive: true }).sort().map((f) => [f, fs.lstatSync(path.join(ws, f)).isFile() ? crypto.createHash('sha256').update(fs.readFileSync(path.join(ws, f))).digest('hex') : '']);
		const before = snapshot();
		// pass 1 has read the whole file when the importer asks for /proc/mounts; cut the file there
		await fake.truncateOnExec('cat /proc/mounts', out('p2.dtx'), Math.floor(fs.statSync(out('p2.dtx')).size / 2));
		const chowns = (await fake.state()).execs.filter((x) => x.Cmd[0] === 'chown').length;
		const r = dt('import', 'container', 'hq-dana', out('p2.dtx'), '--replace', { DT_EXPORT_PASSPHRASE: PASS });
		assert.equal(r.code, 1, r.out);
		assert.match(r.out, /truncated|damaged/);
		assert.doesNotMatch(r.out, /✔ imported/);
		assert.deepEqual(snapshot(), before, 'a failed replace changed the workspace');
		assert.match(r.out, /the upload stopped part-way; \/workspaces\/hq-dana is unchanged/);
		assert.doesNotMatch(r.out, /nothing was written/, 'pass 2 had written; the message must not say otherwise');
		assert.equal((await fake.state()).execs.filter((x) => x.Cmd[0] === 'chown').length, chowns, 'a failed import still chowned');
	});

	test('an export swapped between the two passes for one holding another workspace cannot write that workspace', async () => {
		assert.equal(dt('export', 'container', 'hq-dana', '--workspace', 'hq-dana', '--out', out('one.tgz'), '--no-encrypt').code, 0);
		put('hq-dana', 'workspaces/beta/x.md', 'beta');
		assert.equal(dt('export', 'container', 'hq-dana', '--out', out('two.tgz'), '--no-encrypt').code, 0);
		fs.rmSync(at('hq-dana', 'workspaces/beta'), { recursive: true });
		await fake.swapOnExec('cat /proc/mounts', out('one.tgz'), out('two.tgz'));
		const r = dt('import', 'container', 'hq-dana', out('one.tgz'), '--replace');
		assert.equal(r.code, 1, r.out);
		assert.match(r.out, /names a workspace the file did not hold when it was checked/);
		assert.ok(!fs.existsSync(at('hq-dana', 'workspaces/beta')), 'pass 2 wrote a workspace pass 1 never checked');
		assert.equal(fs.readFileSync(at('hq-dana', 'workspaces/hq-dana/README.md'), 'utf8'), '# acme\n');
	});

	test('a switch that fails part-way is never reported as an import: the message says what the workspace holds and where the complete import is', async () => {
		assert.equal(dt('export', 'container', 'hq-dana', '--out', out('sw.tgz'), '--no-encrypt').code, 0);
		put('hq-dana', 'workspaces/hq-dana/stale.md', 'from before');
		await fake.failExec('find /workspaces/hq-dana/.dt-import-'); // the step that moves the staged import up
		const r = dt('import', 'container', 'hq-dana', out('sw.tgz'), '--replace', '--json');
		assert.equal(r.code, 1, r.out);
		assert.equal(r.stdout, '', 'a failed import printed a result');
		assert.doesNotMatch(r.out, /✔ imported/);
		const staged = /and the rest is in (\/workspaces\/hq-dana\/\.dt-import-[0-9a-f]+)/.exec(r.out)?.[1];
		assert.ok(staged, r.out);
		assert.match(r.out, /replacing \/workspaces\/hq-dana failed while moving the import up — \/workspaces\/hq-dana may hold part of it/);
		assert.match(r.out, /Nothing was chowned — re-running the same import with --replace starts over/);
		assert.equal(fs.readFileSync(at('hq-dana', `${staged}/README.md`), 'utf8'), '# acme\n', 'the complete import is not where the message says');
		assert.ok(!fs.existsSync(at('hq-dana', 'workspaces/hq-dana/stale.md')));
		// and the advice holds: the same import with --replace lands cleanly, staging folder and all
		const again = dt('import', 'container', 'hq-dana', out('sw.tgz'), '--replace');
		assert.equal(again.code, 0, again.out);
		assert.deepEqual(fs.readdirSync(at('hq-dana', 'workspaces/hq-dana')).filter((f) => f.startsWith('.dt-import-')), []);
		assert.equal(fs.readFileSync(at('hq-dana', 'workspaces/hq-dana/README.md'), 'utf8'), '# acme\n');
	});

	test('an entry that escapes — absolute, .., a symlink out of its workspace, a hard link, a loose file — is refused and nothing is written', async () => {
		const hostile = {
			absolute: [{ name: '/etc/cron.d/x', data: 'x' }],
			dotdot: [{ name: 'hq-dana/', type: '5' }, { name: 'hq-dana/../../etc/x', data: 'x' }],
			'symlink out': [{ name: 'hq-dana/', type: '5' }, { name: 'hq-dana/l', type: '2', linkname: '../../etc/passwd' }],
			'symlink to another workspace': [{ name: 'hq-dana/', type: '5' }, { name: 'hq-dana/l', type: '2', linkname: '../hq-eli' }],
			'absolute symlink': [{ name: 'hq-dana/', type: '5' }, { name: 'hq-dana/l', type: '2', linkname: '/home/node/.claude' }],
			'hard link': [{ name: 'hq-dana/', type: '5' }, { name: 'hq-dana/h', type: '1', linkname: 'hq-dana/README.md' }],
			'loose file': [{ name: 'loose.txt', data: 'x' }],
		};
		for (const [what, entries] of Object.entries(hostile)) {
			fs.writeFileSync(out('h.tgz'), tarGz(entries));
			const since = await mark();
			const r = dt('import', 'container', 'hq-dana', out('h.tgz'), '--replace');
			assert.equal(r.code, 1, `${what}: ${r.out}`);
			assert.match(r.out, /nothing was written/, what);
			assert.equal((await writesSince(since)).puts.length, 0, `${what} reached the container`);
		}
		assert.ok(fs.existsSync(at('hq-dana', 'workspaces/hq-dana/README.md')));
	});

	test('a workspace that would land on the container\'s own layer is refused — it would vanish with the container', async () => {
		assert.equal(dt('export', 'container', 'hq-dana', '--out', out('o.tgz'), '--no-encrypt').code, 0);
		fs.mkdirSync(at('hq-eli', 'workspaces'), { recursive: true });
		const since = await mark();
		const r = dt('import', 'container', 'hq-eli', out('o.tgz'));
		assert.equal(r.code, 1);
		assert.match(r.out, /\/workspaces\/hq-dana would land on overlay, not a volume/);
		assert.equal((await writesSince(since)).puts.length, 0);
	});

	test('--workspace narrows both ends: export reads only that folder, import writes only that one', async () => {
		put('hq-dana', 'workspaces/beta/x.md', 'beta');
		const since = await mark();
		assert.equal(dt('export', 'container', 'hq-dana', '--workspace', 'hq-dana', '--out', out('n.tgz'), '--no-encrypt').code, 0);
		const reads = (await fake.state()).requests.slice(since).filter((r) => r.path.includes('/archive'));
		assert.deepEqual(reads.map((r) => r.path.split('?')[1]), ['path=%2Fworkspaces%2Fhq-dana']);
		assert.ok(listTarGz(out('n.tgz')).every((n) => n.startsWith('hq-dana/')));
		// both workspaces in one file; import only one of them
		assert.equal(dt('export', 'container', 'hq-dana', '--out', out('both.tgz'), '--no-encrypt').code, 0);
		fs.rmSync(at('hq-dana', 'workspaces/beta'), { recursive: true });
		const r = dt('import', 'container', 'hq-dana', out('both.tgz'), '--workspace', 'hq-dana', '--replace');
		assert.equal(r.code, 0, r.out);
		assert.ok(!fs.existsSync(at('hq-dana', 'workspaces/beta')), '--workspace imported a workspace it did not name');
		const miss = dt('import', 'container', 'hq-dana', out('both.tgz'), '--workspace', 'gamma');
		assert.match(miss.out, /holds no workspace gamma/);
	});

	test('secrets stay behind by default — .env and .git-credentials left out, userinfo and auth headers cut from .git/config; --with-secrets keeps them and says so', () => {
		put('hq-dana', 'workspaces/hq-dana/.env', 'API_KEY=sk-live-secret\n');
		put('hq-dana', 'workspaces/hq-dana/.env.example', 'API_KEY=\n');
		put('hq-dana', 'workspaces/hq-dana/sub/.env', 'NESTED=secret\n');
		put('hq-dana', 'workspaces/hq-dana/.git-credentials', 'https://dana:ghp_token@example.invalid\n');
		const config = '[core]\n\tbare = false\n[remote "origin"]\n\turl = https://dana:ghp_token@example.invalid/acme/hq.git\n\tpushurl = https://ghp_other@example.invalid/acme/hq.git\n[remote "ssh"]\n\turl = git@example.invalid:acme/hq.git\n[http "https://example.invalid/"]\n\textraheader = AUTHORIZATION: basic c2VjcmV0\n';
		put('hq-dana', 'workspaces/hq-dana/.git/config', config);
		const e = dt('export', 'container', 'hq-dana', '--out', out('sec.tgz'), '--no-encrypt');
		assert.equal(e.code, 0, e.out);
		assert.match(e.stdout, /left behind: .*hq-dana\/\.env\b/);
		assert.match(e.stdout, /hq-dana\/\.git-credentials/);
		const names = listTarGz(out('sec.tgz'));
		assert.deepEqual(names.filter((n) => /(^|\/)(\.env|\.git-credentials)$/.test(n)), []);
		assert.ok(names.includes('hq-dana/.env.example'), '.env.example is not a secret');
		const cfg = tarRun(['-xzOf', out('sec.tgz'), 'hq-dana/.git/config']);
		assert.match(cfg, /url = https:\/\/example\.invalid\/acme\/hq\.git/);
		assert.match(cfg, /pushurl = https:\/\/example\.invalid\/acme\/hq\.git/);
		assert.match(cfg, /url = git@example\.invalid:acme\/hq\.git/, 'an ssh remote is not a credential');
		assert.doesNotMatch(cfg, /ghp_|extraheader|c2VjcmV0/);
		assert.match(cfg, /bare = false/);
		const w = dt('export', 'container', 'hq-dana', '--out', out('with.tgz'), '--no-encrypt', '--with-secrets');
		assert.equal(w.code, 0, w.out);
		assert.match(w.out, /--with-secrets: .*INCLUDED/);
		const all = listTarGz(out('with.tgz'));
		assert.ok(all.includes('hq-dana/.env') && all.includes('hq-dana/.git-credentials'), all.join('\n'));
		assert.equal(tarRun(['-xzOf', out('with.tgz'), 'hq-dana/.git/config']), config);
	});

	test('import runs no install: it names the next command for a workspace with a package.json, once, and execs nothing of the repo\'s', async () => {
		put('hq-dana', 'workspaces/hq-dana/package.json', '{"name":"acme","scripts":{"postinstall":"echo ran"}}');
		assert.equal(dt('export', 'container', 'hq-dana', '--out', out('ci.tgz'), '--no-encrypt').code, 0);
		const before = (await fake.state()).execs.length;
		const r = dt('import', 'container', 'hq-dana', out('ci.tgz'), '--replace');
		assert.equal(r.code, 0, r.out);
		const next = r.stdout.split('\n').filter((l) => /npm ci/.test(l));
		assert.deepEqual(next, ['next, in /workspaces/hq-dana: npm ci && npx dreamteamer compile — import ran neither (both run code the workspace chose)']);
		const cmds = (await fake.state()).execs.slice(before).map((x) => x.Cmd[0]);
		assert.deepEqual(cmds.filter((c) => !['cat', 'find', 'rm', 'rmdir', 'chown'].includes(c)), [], `import ran ${cmds.join(', ')}`);
		fs.rmSync(at('hq-dana', 'workspaces/hq-dana/package.json'));
		assert.equal(dt('export', 'container', 'hq-dana', '--out', out('nopkg.tgz'), '--no-encrypt').code, 0);
		assert.doesNotMatch(dt('import', 'container', 'hq-dana', out('nopkg.tgz'), '--replace').out, /npm ci/, 'no package.json, no install line');
	});

	test('--as lands one workspace in a differently named container\'s own volume folder, under dt-new\'s name rule and the same overlay refusal', async () => {
		assert.equal(dt('export', 'container', 'hq-dana', '--workspace', 'hq-dana', '--out', out('as.dtx'), { DT_EXPORT_PASSPHRASE: PASS }).code, 0);
		fs.rmSync(at('hq-eli', 'workspaces'), { recursive: true, force: true }); fs.mkdirSync(at('hq-eli', 'workspaces/hq-eli'), { recursive: true });
		const r = dt('import', 'container', 'hq-eli', out('as.dtx'), '--as', 'hq-eli', { DT_EXPORT_PASSPHRASE: PASS });
		assert.equal(r.code, 0, r.out);
		assert.match(r.stdout, /imported \/workspaces\/hq-eli into hq-eli/);
		assert.equal(fs.readFileSync(at('hq-eli', 'workspaces/hq-eli/notes/2026-09-01--kickoff.md'), 'utf8'), 'dana met acme\n');
		assert.equal(fs.readlinkSync(at('hq-eli', 'workspaces/hq-eli/readme-link')), 'README.md');
		assert.ok(!fs.existsSync(at('hq-eli', 'workspaces/hq-dana')), 'the source name was written too');
		const chown = (await fake.state()).execs.filter((x) => x.Cmd[0] === 'chown').pop();
		assert.deepEqual(chown.Cmd, ['chown', '-R', 'node:node', '/workspaces/hq-eli']);
		for (const bad of ['Hq-Eli', 'hq_eli', 'files', '-x', 'a'.repeat(41)]) {
			const b = dt('import', 'container', 'hq-eli', out('as.dtx'), '--as', bad, '--replace', { DT_EXPORT_PASSPHRASE: PASS });
			assert.equal(b.code, 1, `${bad}: ${b.out}`);
			assert.match(b.out, /--as/, bad);
		}
		const since = await mark();
		const o = dt('import', 'container', 'hq-eli', out('as.dtx'), '--as', 'elsewhere', { DT_EXPORT_PASSPHRASE: PASS });
		assert.equal(o.code, 1);
		assert.match(o.out, /\/workspaces\/elsewhere would land on overlay, not a volume/);
		assert.equal((await writesSince(since)).puts.length, 0);
		put('hq-dana', 'workspaces/beta/x.md', 'beta');
		assert.equal(dt('export', 'container', 'hq-dana', '--out', out('two.tgz'), '--no-encrypt').code, 0);
		const two = dt('import', 'container', 'hq-eli', out('two.tgz'), '--as', 'hq-eli', '--replace');
		assert.equal(two.code, 1);
		assert.match(two.out, /--as names ONE workspace.*--workspace/);
		assert.equal(dt('import', 'container', 'hq-eli', out('two.tgz'), '--workspace', 'beta', '--as', 'hq-eli', '--replace').code, 0);
		assert.equal(fs.readFileSync(at('hq-eli', 'workspaces/hq-eli/x.md'), 'utf8'), 'beta');
		fs.rmSync(at('hq-dana', 'workspaces/beta'), { recursive: true });
	});

	test('--json: export and import print ONLY their JSON on stdout; the human lines go to stderr', () => {
		put('hq-dana', 'workspaces/hq-dana/package.json', '{"name":"acme"}');
		const e = dt('export', 'container', 'hq-dana', '--out', out('j.tgz'), '--no-encrypt', '--json');
		assert.equal(e.code, 0, e.out);
		const ej = JSON.parse(e.stdout);
		assert.equal(ej.encrypted, false);
		assert.deepEqual(ej.workspaces.map((w) => w.name), ['hq-dana']);
		assert.ok(ej.left_behind.includes('hq-dana/node_modules'));
		assert.match(e.out, /NOT encrypted/, 'the human line still reaches stderr');
		const i = dt('import', 'container', 'hq-dana', out('j.tgz'), '--replace', '--json');
		assert.equal(i.code, 0, i.out);
		const ij = JSON.parse(i.stdout);
		assert.deepEqual(ij.imported, ['/workspaces/hq-dana']);
		assert.deepEqual(ij.next, ['/workspaces/hq-dana']);
		assert.match(i.out, /next, in \/workspaces\/hq-dana/);
		fs.rmSync(at('hq-dana', 'workspaces/hq-dana/package.json'));
	});

	test('every credential-file NAME stays behind at any depth — .env and .env.*, .envrc, .npmrc, .netrc, .pypirc, .docker/config.json — while .env templates travel', () => {
		const secret = ['.env', '.env.local', '.env.production', '.envrc', '.npmrc', '.netrc', '.git-credentials', '.pypirc', '.docker/config.json'];
		const kept = ['.env.example', '.env.sample', '.env.template', 'docker/config.json', 'env.md'];
		for (const [i, f] of secret.entries()) { put('hq-dana', `workspaces/hq-dana/${f}`, `SECRET-MARKER-${i}\n`); put('hq-dana', `workspaces/hq-dana/pkg/deep/${f}`, `SECRET-MARKER-${i}\n`); }
		for (const f of kept) put('hq-dana', `workspaces/hq-dana/${f}`, 'kept\n');
		const e = dt('export', 'container', 'hq-dana', '--out', out('names.tgz'), '--no-encrypt');
		assert.equal(e.code, 0, e.out);
		const names = listTarGz(out('names.tgz'));
		for (const f of secret) for (const p of [`hq-dana/${f}`, `hq-dana/pkg/deep/${f}`]) assert.ok(!names.includes(p), `${p} travelled`);
		for (const f of kept) assert.ok(names.includes(`hq-dana/${f}`), `${f} was left behind`);
		assert.ok(!zlib.gunzipSync(fs.readFileSync(out('names.tgz'))).includes('SECRET-MARKER'), 'a marker is in the archive');
	});

	test('.git/config: userinfo cut from [url "…"] section names, every [credential] section dropped, extraheader dropped, the rest kept', () => {
		const config = [
			'[core]', '\tbare = false',
			'[url "https://dana:tok-one@example.invalid/"]', '\tinsteadOf = https://example.invalid/',
			'[credential]', '\thelper = "!f() { echo password=tok-two; }; f"',
			'[Credential "https://example.invalid"]', '\tusername = dana', '\thelper = store',
			'[credential.https://other.invalid]', '\thelper = tok-three',
			'[http]', '\textraheader = AUTHORIZATION: bearer tok-four',
			'[user]', '\tname = Dana', '',
		].join('\n');
		put('hq-dana', 'workspaces/hq-dana/.git/config', config);
		assert.equal(dt('export', 'container', 'hq-dana', '--out', out('gc.tgz'), '--no-encrypt').code, 0);
		const cfg = tarRun(['-xzOf', out('gc.tgz'), 'hq-dana/.git/config']);
		assert.doesNotMatch(cfg, /tok-(one|two|three|four)/);
		assert.doesNotMatch(cfg, /credential|helper|username|extraheader/i);
		assert.match(cfg, /\[url "https:\/\/example\.invalid\/"\]\n\tinsteadOf = https:\/\/example\.invalid\//);
		assert.match(cfg, /\[core\]\n\tbare = false/);
		assert.match(cfg, /\[user\]\n\tname = Dana/);
	});

	// The sanitizer rewrites a .git/config in memory, up to 1 MiB. A bigger one used to stream through
	// UNTOUCHED — its credential URL and all — because the rewrite silently fell back to a plain copy.
	test('a .git/config over 1 MiB never travels unsanitized: the export is refused naming it, and no file is left; --with-secrets still carries it', () => {
		const canary = 'CANARY-over-1mib';
		put('hq-dana', 'workspaces/hq-dana/.git/config', `[remote "origin"]\n\turl = https://dana:${canary}@example.invalid/acme/hq.git\n${'# padding\n'.repeat(120_000)}`);
		const e = dt('export', 'container', 'hq-dana', '--out', out('big.tgz'), '--no-encrypt');
		for (const f of [out('big.tgz'), out('big.tgz.partial')]) if (fs.existsSync(f)) assert.ok(!zlib.gunzipSync(fs.readFileSync(f)).includes(canary), `the credential in an oversized .git/config reached ${path.basename(f)}`);
		assert.equal(e.code, 1, e.out);
		assert.match(e.out, /hq-dana\/\.git\/config is 1\.2 MB — over the 1 MiB a \.git\/config is sanitized in; refusing to export it with its credentials\. Nothing was written/);
		assert.ok(!fs.existsSync(out('big.tgz')) && !fs.existsSync(out('big.tgz.partial')));
		const w = dt('export', 'container', 'hq-dana', '--out', out('big-with.tgz'), '--no-encrypt', '--with-secrets');
		assert.equal(w.code, 0, w.out);
		assert.ok(zlib.gunzipSync(fs.readFileSync(out('big-with.tgz'))).includes(canary), '--with-secrets is the owner asking for it unchanged');
	});

	// An export used to keep EVERY symlink, while import refuses one that leaves its workspace — so a
	// single `link -> /etc/hosts` made the whole file unimportable, discovered only on the other laptop.
	test('every symlink an export keeps, import accepts — under --as too; one that leaves its workspace is skipped and reported, never followed', async () => {
		const ws = at('hq-dana', 'workspaces/hq-dana');
		fs.mkdirSync(path.join(ws, 'sub'), { recursive: true });
		const kept = { inside: 'notes/2026-09-01--kickoff.md', 'sub/up': '../README.md', dangling: 'nowhere.md', here: '.' };
		const leaving = { abs: '/etc/hosts', escape: '../../etc/hosts', sibling: '../hq-eli', 'by-own-name': '../hq-dana/README.md', 'abs-own': '/workspaces/hq-dana/README.md', 'sub/climb': '../../hq-eli/x' };
		for (const [l, to] of Object.entries({ ...kept, ...leaving })) fs.symlinkSync(to, path.join(ws, l));
		const e = dt('export', 'container', 'hq-dana', '--workspace', 'hq-dana', '--out', out('links.tgz'), '--no-encrypt', '--json');
		assert.equal(e.code, 0, e.out);
		const names = listTarGz(out('links.tgz'));
		for (const l of Object.keys(kept)) assert.ok(names.includes(`hq-dana/${l}`), `${l} was not exported`);
		for (const l of Object.keys(leaving)) assert.ok(!names.includes(`hq-dana/${l}`), `${l} -> ${leaving[l]} was exported, and import refuses it`);
		assert.deepEqual(JSON.parse(e.stdout).skipped.filter((x) => /symlink/.test(x)).sort(), Object.entries(leaving).map(([l, to]) => `hq-dana/${l} (symlink to ${to}: import takes only a relative link that stays inside its workspace)`).sort());
		assert.match(e.out, /skipped: hq-dana\/abs \(symlink to \/etc\/hosts/);
		// the round trip: into the emptied workspace, and re-rooted into another container's own volume
		fs.rmSync(ws, { recursive: true }); fs.mkdirSync(ws);
		const i = dt('import', 'container', 'hq-dana', out('links.tgz'));
		assert.equal(i.code, 0, i.out);
		for (const [l, to] of Object.entries(kept)) assert.equal(fs.readlinkSync(path.join(ws, l)), to);
		fs.rmSync(at('hq-eli', 'workspaces'), { recursive: true, force: true }); fs.mkdirSync(at('hq-eli', 'workspaces/hq-eli'), { recursive: true });
		const as = dt('import', 'container', 'hq-eli', out('links.tgz'), '--as', 'hq-eli');
		assert.equal(as.code, 0, as.out);
		assert.equal(fs.readlinkSync(at('hq-eli', 'workspaces/hq-eli/sub/up')), '../README.md');
	});

	test('an export that fails part-way removes the .partial file', () => {
		const r = dt('export', 'container', 'hq-dana', '--workspace', 'hq-dana', '--workspace', 'ghost', '--out', out('err.dtx'), { DT_EXPORT_PASSPHRASE: PASS });
		assert.equal(r.code, 1);
		assert.match(r.out, /hq-dana has no \/workspaces\/ghost/);
		assert.ok(!fs.existsSync(out('err.dtx.partial')) && !fs.existsSync(out('err.dtx')));
	});

	for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
		test(`${sig} in the middle of an export removes the .partial file`, async () => {
			const { Id } = (await fake.state()).containers.find((c) => c.Name === '/hq-dana');
			await fake.hangNext(`/containers/${Id}/archive`); // the archive read is accepted and never answered
			const file = out(`sig-${sig}.dtx`);
			const child = h.spawnDt(['export', 'container', 'hq-dana', '--out', file], { DT_EXPORT_PASSPHRASE: PASS, DT_DOCKER_TIMEOUT: '60' });
			const exited = new Promise((ok) => child.on('exit', (c, s) => ok({ c, s })));
			const until = Date.now() + 15_000;
			while (!fs.existsSync(`${file}.partial`) && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
			assert.ok(fs.existsSync(`${file}.partial`), 'the export never started writing');
			child.kill(sig);
			const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
			const r = await exited; clearTimeout(timer);
			assert.deepEqual(r, { c: code, s: null });
			assert.ok(!fs.existsSync(`${file}.partial`) && !fs.existsSync(file), `${sig} left ciphertext behind`);
		});
	}

	test('an unknown flag is refused, not swallowed', () => {
		const r = dt('export', 'container', 'hq-dana', '--out', out('u.tgz'), '--no-encrpyt');
		assert.equal(r.code, 1);
		assert.match(r.out, /unknown flag "--no-encrpyt"/);
		assert.ok(!fs.existsSync(out('u.tgz')));
	});
});

// ⚠ The scrypt parameters sit in the header BEFORE its MAC can be checked — the MAC needs the key
// the parameters derive. So a header naming a bigger cost buys an attacker gigabytes and seconds of
// the importer's work with no passphrase at all. Only the exact v1 parameters are accepted, and the
// refusal must come before scrypt runs: a spy on crypto.scrypt, in-process, proves it never did.
describe('the sealed header: scrypt parameters are refused before scrypt runs', () => {
	const header = ({ log2N = 17, r = 8, p = 1, chunk = 65536 } = {}) => {
		const h = Buffer.alloc(72); Buffer.from('DTEXPORT').copy(h); h[8] = 1; h[9] = log2N; h[10] = r; h[11] = p; h.writeUInt32BE(chunk, 12);
		return Buffer.concat([h, Buffer.alloc(64)]);
	};
	test('N=2^20, r=16, p=4 or another chunk size: refused, scrypt never called; the exact v1 values reach scrypt', async () => {
		const { openSeal } = await import('../src/archive.js');
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-hdr-'));
		const real = crypto.scrypt; let calls = 0;
		crypto.scrypt = (...a) => { calls++; a[a.length - 1](null, Buffer.alloc(64)); };
		try {
			for (const bad of [{ log2N: 20 }, { log2N: 18 }, { r: 16 }, { p: 4 }, { log2N: 16 }, { chunk: 1 << 24 }]) {
				const f = path.join(dir, 'h.dtx'); fs.writeFileSync(f, header(bad));
				await assert.rejects(openSeal(f, 'any passphrase'), /parameters/, JSON.stringify(bad));
				assert.equal(calls, 0, `${JSON.stringify(bad)} reached scrypt`);
			}
			const f = path.join(dir, 'ok.dtx'); fs.writeFileSync(f, header());
			await assert.rejects(openSeal(f, 'any passphrase'), /wrong passphrase/);
			assert.equal(calls, 1, 'the spy is not wired: the v1 parameters never reached it');
		} finally { crypto.scrypt = real; fs.rmSync(dir, { recursive: true, force: true }); }
	});
});

// DTEXPORT v1 is a protocol, not an implementation detail: a file written by the engine BEFORE this
// package existed (test/fixtures/golden-v1.*, made by its `dt export container` against the same
// fake — a synthetic tree, passphrase below) must open here, and this writer must produce those bytes.
describe('the v1 format is preserved byte for byte', () => {
	const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
	const GOLDEN_PASS = 'golden fixture passphrase';
	const collect = async (it) => { const parts = []; for await (const b of it) parts.push(b); return Buffer.concat(parts); };

	test('the pre-extraction export decrypts to exactly the pre-extraction plain export, and re-sealing it under its own header reproduces the file', async () => {
		const { openSeal, unseal, seal } = await import('../src/archive.js');
		const dtx = fs.readFileSync(path.join(FIX, 'golden-v1.dtx'));
		const tgz = fs.readFileSync(path.join(FIX, 'golden-v1.tar.gz'));
		const key = await openSeal(path.join(FIX, 'golden-v1.dtx'), GOLDEN_PASS);
		assert.ok((await collect(unseal([dtx.subarray(72)], key))).equals(tgz), 'the golden export no longer decrypts to its plain twin');
		assert.ok((await collect(seal([tgz], { keys: key.keys, head: dtx.subarray(0, 72) }))).equals(dtx), 'this writer no longer produces the v1 bytes');
	});

	test('a multi-chunk seal follows docs/container-export-format.md, checked by an independent reading of the spec', async () => {
		const { seal } = await import('../src/archive.js');
		const head = Buffer.alloc(40); Buffer.from('DTEXPORT').copy(head); head[8] = 1; head[9] = 17; head[10] = 8; head[11] = 1; head.writeUInt32BE(65536, 12);
		crypto.randomFillSync(head, 16, 23);
		const enc = crypto.randomBytes(32); const mac = crypto.randomBytes(32);
		const full = Buffer.concat([head, crypto.createHmac('sha256', mac).update(head).digest()]);
		const plain = crypto.randomBytes(3 * 65536 + 1234);
		const file = await collect(seal([plain.subarray(0, 100_000), plain.subarray(100_000)], { keys: { enc, mac }, head: full }));
		assert.ok(file.subarray(0, 72).equals(full));
		assert.equal(file.length, 72 + 3 * (65536 + 16) + 1234 + 16);
		const back = [];
		for (let i = 0, at = 72; at < file.length; i++, at += 65552) {
			const last = at + 65552 >= file.length;
			const box = file.subarray(at, Math.min(at + 65552, file.length));
			const nonce = Buffer.concat([head.subarray(32, 39), Buffer.from([0, 0, 0, i, last ? 1 : 0])]);
			const d = crypto.createDecipheriv('aes-256-gcm', enc, nonce); d.setAuthTag(box.subarray(box.length - 16));
			back.push(d.update(box.subarray(0, box.length - 16)), d.final());
		}
		assert.ok(Buffer.concat(back).equals(plain));
	});

	test('dt-docker imports the pre-extraction export — encrypted and plain — into a fresh container', async () => {
		const h = harness({ prefix: 'dth-g-' });
		const fsRoot = path.join(h.dir, 'fs'); fs.mkdirSync(fsRoot);
		const fake = await startFakeDocker(h.sock, { images: [{ ref: HQ, labels: { 'dreamteamer.template': 'hq', 'dreamteamer.ports': '8080' } }], fsRoot });
		try {
			for (const [name, file] of [['hq-one', 'golden-v1.dtx'], ['hq-two', 'golden-v1.tar.gz']]) {
				// the two workspace folders the export holds, each a volume (the overlay refusal is tested above)
				const s = h.dt('start', 'container', name, '--template', 'hq', '--no-open', '--mount', `${name}-g:/workspaces/golden`, '--mount', `${name}-s:/workspaces/second`);
				assert.equal(s.code, 0, s.out);
				fs.mkdirSync(path.join(fsRoot, name, 'workspaces'), { recursive: true });
				const r = h.dt('import', 'container', name, path.join(FIX, file), { DT_EXPORT_PASSPHRASE: GOLDEN_PASS });
				assert.equal(r.code, 0, r.out);
				const ws = path.join(fsRoot, name, 'workspaces');
				assert.equal(fs.readFileSync(path.join(ws, 'golden/README.md'), 'utf8'), '# golden\n');
				assert.equal(fs.readFileSync(path.join(ws, 'golden', 'deep/'.repeat(25), 'long-path.txt'), 'utf8'), 'past 100 bytes\n');
				assert.equal(fs.readlinkSync(path.join(ws, 'golden/readme-link')), 'README.md');
				assert.equal(fs.readFileSync(path.join(ws, 'golden/.git/config'), 'utf8'), '[remote "origin"]\n\turl = https://example.invalid/golden.git\n');
				assert.ok(!fs.existsSync(path.join(ws, 'golden/.env')) && !fs.existsSync(path.join(ws, 'golden/node_modules')));
				assert.equal(fs.readFileSync(path.join(ws, 'second/package.json'), 'utf8'), '{"name":"second"}\n');
			}
		} finally { await fake.close(); h.cleanup(); }
	});
});
