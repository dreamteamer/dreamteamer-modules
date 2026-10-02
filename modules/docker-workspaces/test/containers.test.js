// dt-docker's container and image verbs, driven through the real binary against a fake Engine API on a
// Unix socket. Every assertion is about BEHAVIOUR a person depends on — what the create body
// carries, which port the second workspace gets, that a token never travels — not about a code path
// being reached. No Docker is needed to run this file.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PKG, HQ, harness as base, startFakeDocker } from './helpers/harness.js';

function harness(images = [{ ref: HQ, labels: { 'dreamteamer.template': 'hq', 'dreamteamer.ports': '8080', 'dreamteamer.modules': 'users,contacts' } }]) {
	return { ...base({ prefix: 'dth-c-' }), images };
}

describe('host mode — the verbs answer with NO workspace', () => {
	let h, fake;
	before(async () => { h = harness(); fake = await startFakeDocker(h.sock, { images: h.images, plain: ['plain-nginx'] }); });
	after(async () => { await fake.close(); h.cleanup(); });

	test('list containers on a bare host prints (none) at exit 0, and --json prints [] — a plain Docker container is invisible', () => {
		const r = h.dt('list', 'containers');
		assert.equal(r.code, 0, r.out);
		assert.match(r.stdout, /\(none\)/);
		const j = h.dt('list', 'containers', '--json');
		assert.deepEqual(JSON.parse(j.stdout), []);
	});

	test('list images shows the template with its labels, singular spelling included', () => {
		const r = h.dt('list', 'images');
		assert.equal(r.code, 0, r.out);
		assert.match(r.stdout, /hq\s+ghcr\.io\/dreamteamer\/hq:0\.6\.0/);
		const s = h.dt('list', 'image', '--json');
		assert.equal(JSON.parse(s.stdout)[0].template, 'hq');
	});

	test('start container <name> --template hq creates from the image, binds loopback:8100, mounts three volumes, injects no token', async () => {
		const r = h.dt('start', 'container', 'hq-dana', '--template', 'hq', '--no-open');
		assert.equal(r.code, 0, r.out);
		assert.match(r.stdout, /✔ created hq-dana from ghcr\.io\/dreamteamer\/hq:0\.6\.0/);
		// the bare URL opens the machine home; an image with no features file gets no ?tkn=
		assert.match(r.stdout, /· http:\/\/localhost:8100\/\n/);
		const st = await fake.state();
		const create = st.requests.find((q) => q.path.startsWith('/containers/create'));
		assert.ok(create, 'no create request reached Docker');
		assert.equal(create.path, '/containers/create?name=hq-dana');
		assert.equal(create.body.Labels['dreamteamer.workspace'], 'hq-dana');
		assert.equal(create.body.Labels['dreamteamer.template'], 'hq');
		assert.deepEqual(create.body.HostConfig.PortBindings, { '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '8100' }] });
		assert.deepEqual(create.body.HostConfig.Mounts.map((m) => `${m.Source}:${m.Target}`), ['dreamteamer-hq-dana-workspace:/workspaces/hq-dana', 'dreamteamer-hq-dana-home:/home/node', 'dreamteamer-hq-dana-files:/files']);
		assert.ok(create.body.Env.every((e) => !/CLAUDE|TOKEN|KEY/i.test(e)), `a credential-shaped env reached the container: ${create.body.Env}`);
		assert.ok(create.body.Env.includes('GIT_AUTHOR_NAME=Test Person'));
		assert.ok(create.body.Env.includes('DT_WORKSPACE_DIR=/workspaces/hq-dana'));
		assert.equal(create.body.Labels['dreamteamer.workdir'], '/workspaces/hq-dana');
		// the editor listens on every interface INSIDE; the host side stays loopback (PortBindings above)
		assert.ok(create.body.Env.includes('DT_LOCAL_BIND=0.0.0.0'), `no DT_LOCAL_BIND in ${create.body.Env}`);
		// its OWN bridge, created first with the two labels, and the ONLY network it is attached to
		assert.equal(create.body.HostConfig.NetworkMode, 'dreamteamer-hq-dana');
		assert.deepEqual(st.networks, [{ Name: 'dreamteamer-hq-dana', Driver: 'bridge', Labels: { dreamteamer: '1', 'dreamteamer.name': 'hq-dana' } }]);
		assert.ok(st.requests.findIndex((q) => q.path === '/networks/create') < st.requests.indexOf(create), 'the network was not created before the container');
		const started = st.requests.some((q) => /\/containers\/.+\/start$/.test(q.path));
		assert.ok(started, 'created but never started');
	});

	test('the create body adds NET_ADMIN — the root entrypoint\'s egress policy needs it — and no other privilege', async () => {
		const create = (await fake.state()).requests.find((q) => q.path === '/containers/create?name=hq-dana');
		assert.deepEqual(create.body.HostConfig.CapAdd, ['NET_ADMIN']);
		// nothing else widened: no other key beside the five the driver always sends
		assert.deepEqual(Object.keys(create.body.HostConfig).sort(), ['CapAdd', 'Mounts', 'NetworkMode', 'PortBindings', 'RestartPolicy']);
		assert.deepEqual(Object.keys(create.body).sort(), ['Env', 'ExposedPorts', 'HostConfig', 'Image', 'Labels']);
	});

	test('a second start on the same name is idempotent — no second create, same URL', async () => {
		const creates = async () => (await fake.state()).requests.filter((q) => q.path.startsWith('/containers/create')).length;
		const before = await creates();
		const r = h.dt('start', 'container', 'hq-dana', '--no-open');
		assert.equal(r.code, 0, r.out);
		assert.equal(await creates(), before);
		assert.match(r.stdout, /http:\/\/localhost:8100\//);
	});

	test('the second workspace gets the next port, and a STOPPED workspace keeps its port reserved', () => {
		const r = h.dt('start', 'container', 'hq-eli', '--template', 'hq', '--no-open');
		assert.equal(r.code, 0, r.out);
		assert.match(r.stdout, /localhost:8101\//);
		assert.equal(h.dt('stop', 'container', 'hq-dana').code, 0);
		const third = h.dt('start', 'container', 'hq-noa', '--template', 'hq', '--no-open');
		assert.equal(third.code, 0, third.out);
		assert.match(third.stdout, /localhost:8102\//, 'the stopped container\'s 8100 was handed out again');
	});

	test('get container <name> and get containers/<name> both answer with the categorised detail', () => {
		const a = h.dt('get', 'container', 'hq-eli');
		assert.equal(a.code, 0, a.out);
		const d = JSON.parse(a.stdout);
		assert.equal(d.name, 'hq-eli');
		assert.equal(d.port, 8101);
		assert.equal(d.volumes.workspace, 'dreamteamer-hq-eli-workspace');
		const b = h.dt('get', 'containers/hq-eli');
		assert.equal(JSON.parse(b.stdout).editor_url, d.editor_url);
	});

	test('start of an absent container without --template names the flag and exits 1', () => {
		const r = h.dt('start', 'container', 'hq-nobody');
		assert.equal(r.code, 1);
		assert.match(r.stderr, /--template <t>/);
	});

	test('an absent image is pulled before create', async () => {
		const r = h.dt('start', 'container', 'hq-pulled', '--template', 'other', '--no-open');
		assert.equal(r.code, 0, r.out);
		assert.deepEqual((await fake.state()).pulls, ['ghcr.io/dreamteamer/other:0.6.0']);
		assert.match(r.stdout, /pulling ghcr\.io\/dreamteamer\/other:0\.6\.0/);
	});

	test('DT_IMAGE_<template> pins a template to any image ref', async () => {
		fs.mkdirSync(h.home, { recursive: true });
		fs.appendFileSync(path.join(h.home, '.env'), 'DT_IMAGE_hq=ghcr.io/example/hq:9\n');
		const r = h.dt('start', 'container', 'hq-pinned', '--template', 'hq', '--no-open');
		assert.equal(r.code, 0, r.out);
		const { pulls } = await fake.state();
		assert.ok(pulls.includes('ghcr.io/example/hq:9'), `pulled ${pulls}`);
		fs.writeFileSync(path.join(h.home, '.env'), fs.readFileSync(path.join(h.home, '.env'), 'utf8').replace(/DT_IMAGE_hq=.*\n/, ''));
	});

	test('rm keeps the three volumes; rm --force removes them', async () => {
		const r = h.dt('rm', 'container', 'hq-noa');
		assert.equal(r.code, 0, r.out);
		assert.match(r.stdout, /kept volumes dreamteamer-hq-noa-workspace, dreamteamer-hq-noa-home, dreamteamer-hq-noa-files/);
		assert.deepEqual((await fake.state()).volumesRemoved, []);
		assert.ok(!(await fake.state()).networks.some((n) => n.Name === 'dreamteamer-hq-noa'), 'plain rm left the network behind');
		const f = h.dt('rm', 'container', 'hq-eli', '--force');
		assert.equal(f.code, 0, f.out);
		assert.deepEqual((await fake.state()).volumesRemoved, ['dreamteamer-hq-eli-workspace', 'dreamteamer-hq-eli-home', 'dreamteamer-hq-eli-files']);
		assert.ok(!(await fake.state()).networks.some((n) => n.Name === 'dreamteamer-hq-eli'), 'rm --force left the network behind');
		assert.ok((await fake.state()).networks.some((n) => n.Name === 'dreamteamer-hq-dana'), 'rm of one container removed another\'s network');
		assert.equal(h.dt('get', 'container', 'hq-eli').code, 1);
	});

	test('a verb aimed at anything but a container or an image is refused by name, and so is a verb the noun does not take', () => {
		const r = h.dt('start', 'tasks');
		assert.equal(r.code, 1);
		assert.match(r.stderr, /dt-docker start takes container <name> or image <ref> — "tasks" is neither/);
		assert.match(h.dt('stop', 'meetings/kickoff').stderr, /"meetings\/kickoff" is neither/);
		assert.match(h.dt('add', 'container', 'hq-x').stderr, /`add` is not a container verb — a container is made by dt-docker start container/);
		assert.match(h.dt('export', 'image', HQ).stderr, /`export` is a container verb/);
		assert.match(h.dt('frobnicate').stderr, /unknown command "frobnicate"/);
	});

	test('every form refuses a flag it does not take, naming the ones it does, before Docker is asked', async () => {
		const before = (await fake.state()).requests.length;
		for (const [args, flag] of [[['list', 'containers', '--force'], 'force'], [['rm', 'container', 'hq-dana', '--json'], 'json'], [['open', 'container', 'hq-dana', '--rotate-token'], 'rotate-token'], [['start', 'container', 'hq-dana', '--templte', 'hq'], 'templte'], [['add', 'image', '--template', 'x', '--force'], 'force']]) {
			const r = h.dt(...args);
			assert.equal(r.code, 1, `${args.join(' ')}: ${r.out}`);
			assert.match(r.stderr, new RegExp(`unknown flag "--${flag}" on \`dt-docker ${args[0]} ${args[1].replace(/s$/, '')}\` — known: `));
		}
		assert.equal((await fake.state()).requests.length, before, 'a refused flag still reached Docker');
	});

	test('a boolean flag never swallows the name after it', () => {
		const r = h.dt('get', 'container', '--json', 'hq-dana');
		assert.equal(r.code, 0, r.out);
		assert.equal(JSON.parse(r.stdout).Name, '/hq-dana');
	});

	test('add image --template pulls; rm image removes; start on an image is refused', async () => {
		const a = h.dt('add', 'image', '--template', 'third');
		assert.equal(a.code, 0, a.out);
		assert.ok((await fake.state()).pulls.includes('ghcr.io/dreamteamer/third:0.6.0'));
		assert.equal(h.dt('rm', 'image', 'ghcr.io/dreamteamer/third:0.6.0').code, 0);
		assert.equal(h.dt('get', 'image', 'ghcr.io/dreamteamer/third:0.6.0').code, 1);
		const s = h.dt('start', 'image', HQ);
		assert.equal(s.code, 1);
		assert.match(s.stderr, /an image is started by starting a container from it/);
	});

	test('setup writes the host defaults once, reports Docker, and leaves an existing .env alone', () => {
		const first = h.dt('setup');
		assert.equal(first.code, 0, first.out);
		assert.match(first.stdout, /docker\s+99\.0\.0-fake · api 1\.99/);
		const envFile = path.join(h.home, '.env');
		const text = fs.readFileSync(envFile, 'utf8');
		for (const k of ['DT_PORT_BASE=8100', 'DT_BIND=127.0.0.1', 'DT_REGISTRY=ghcr.io/dreamteamer', 'DT_DOCKER_TIMEOUT=30']) assert.ok(text.includes(k), `${k} missing from ${text}`);
		assert.ok(!text.includes('DT_TEMPLATE_TAG'), `setup pinned the template tag, so an engine upgrade would never move it: ${text}`);
		fs.appendFileSync(envFile, 'DT_PORT_BASE=9000\n');
		const second = h.dt('setup');
		assert.equal(second.code, 0, second.out);
		assert.match(second.stdout, /host env .* present/);
		assert.ok(fs.readFileSync(envFile, 'utf8').includes('DT_PORT_BASE=9000'), 'setup rewrote a value already set');
		const j = h.dt('setup', '--json');
		assert.equal(j.code, 0, j.out);
		const report = JSON.parse(j.stdout);
		assert.equal(report.docker.version, '99.0.0-fake');
		assert.deepEqual(report.defaults_written, []);
		assert.ok(report.templates.some((t) => t.template === 'hq'));
		assert.match(j.stderr, /docker\s+99\.0\.0-fake/, 'the human board goes to stderr under --json');
	});

	test('stop leaves the container exited, keeps its volumes, and --json prints the detail', () => {
		const r = h.dt('stop', 'container', 'hq-dana', '--json');
		assert.equal(r.code, 0, r.out);
		assert.match(r.stderr, /✔ stopped hq-dana · volumes kept/);
		const detail = JSON.parse(r.stdout);
		assert.equal(detail.state, 'exited');
		assert.equal(detail.volumes.home, 'dreamteamer-hq-dana-home');
		assert.equal(JSON.parse(h.dt('get', 'container', 'hq-dana').stdout).state, 'exited');
	});

	test('open prints the editor URL — bare, or one workspace on --workspace — and refuses a stopped or absent container', () => {
		const stopped = h.dt('open', 'container', 'hq-dana', '--no-open');
		assert.equal(stopped.code, 1);
		assert.match(stopped.stderr, /hq-dana is exited — dt-docker start container hq-dana/);
		assert.equal(h.dt('start', 'container', 'hq-dana', '--no-open').code, 0);
		const r = h.dt('open', 'container', 'hq-dana', '--no-open');
		assert.equal(r.code, 0, r.out);
		assert.equal(r.stdout.trim(), 'http://localhost:8100/');
		assert.equal(h.dt('open', 'container', 'hq-dana', '--no-open', '--workspace').stdout.trim(), 'http://localhost:8100/?folder=/workspaces/hq-dana');
		assert.equal(h.dt('open', 'container', 'hq-dana', '--no-open', '--workspace', 'second').stdout.trim(), 'http://localhost:8100/?folder=/workspaces/second');
		const bad = h.dt('open', 'container', 'hq-dana', '--no-open', '--workspace', '../etc');
		assert.equal(bad.code, 1);
		assert.match(bad.stderr, /--workspace takes a workspace folder name/);
		const attach = h.dt('open', 'container', 'hq-dana', '--vscode', '--no-open');
		assert.equal(attach.code, 0, attach.out);
		assert.equal(attach.stdout.trim(), `vscode-remote://attached-container+${Buffer.from('hq-dana').toString('hex')}/workspaces/hq-dana`);
		const gone = h.dt('open', 'container', 'hq-nobody', '--no-open');
		assert.equal(gone.code, 1);
		assert.match(gone.stderr, /no container "hq-nobody"/);
	});

	test('a container name that is not lowercase-and-safe is refused with the rule', () => {
		const r = h.dt('start', 'container', 'HQ Dana!', '--template', 'hq', '--no-open');
		assert.equal(r.code, 1);
		assert.match(r.stderr, /not a container name — lowercase letters, digits/);
	});

	test('DT_PORT_BASE below 1024 or non-numeric is refused before anything is created', async () => {
		const before = (await fake.state()).requests.filter((q) => q.path.startsWith('/containers/create')).length;
		for (const bad of ['80', 'eighty']) {
			const r = h.dt('start', 'container', 'hq-ports', '--template', 'hq', '--no-open', { DT_PORT_BASE: bad });
			assert.equal(r.code, 1, r.out);
			assert.match(r.stderr, /DT_PORT_BASE must be an integer port above 1023/);
		}
		assert.equal((await fake.state()).requests.filter((q) => q.path.startsWith('/containers/create')).length, before);
	});

	test('the process env outranks the host .env: DT_PORT_BASE=9200 lands the container on 9200', () => {
		const r = h.dt('start', 'container', 'hq-nine', '--template', 'hq', '--no-open', { DT_PORT_BASE: '9200' });
		assert.equal(r.code, 0, r.out);
		assert.match(r.stdout, /localhost:9200\//);
		assert.equal(h.dt('rm', 'container', 'hq-nine', '--force').code, 0);
	});

	test('a pull the registry refuses fails with the build and the pin as the two ways out', async () => {
		const r = h.dt('start', 'container', 'hq-missing', '--template', 'missing', '--no-open');
		assert.equal(r.code, 1);
		assert.match(r.stderr, /pull ghcr\.io\/dreamteamer\/missing:0\.6\.0: Docker answered 404/);
		assert.match(r.stderr, /docker build -t ghcr\.io\/dreamteamer\/missing:0\.6\.0/);
		assert.match(r.stderr, /DT_IMAGE_<template>/);
		assert.ok(!(await fake.state()).requests.some((q) => q.path.includes('name=hq-missing')), 'a container was created from an image that never arrived');
	});

	test('get image <ref> prints the row; a missing ref exits 1; rm image --force passes force to Docker', async () => {
		const g = h.dt('get', 'image', HQ);
		assert.equal(g.code, 0, g.out);
		assert.equal(JSON.parse(g.stdout).template, 'hq');
		const raw = h.dt('get', 'image', HQ, '--json');
		assert.ok(JSON.parse(raw.stdout).Config.Labels['dreamteamer.template']);
		assert.equal(h.dt('get', 'image', 'dreamteamer/nope:latest').code, 1);
		assert.equal(h.dt('add', 'image', '--template', 'forced').code, 0);
		assert.equal(h.dt('rm', 'image', 'ghcr.io/dreamteamer/forced:0.6.0', '--force').code, 0);
		const del = (await fake.state()).requests.find((q) => q.method === 'DELETE' && q.path.includes('forced'));
		assert.match(del.path, /force=true/);
	});

	test('a Docker container that is not a dreamteamer workspace is never touched', () => {
		const r = h.dt('get', 'container', 'plain-nginx');
		assert.equal(r.code, 1);
		assert.match(r.stderr, /not a dreamteamer workspace \(no dreamteamer\.workspace label\)/);
		assert.equal(h.dt('rm', 'container', 'plain-nginx').code, 1);
		assert.equal(h.dt('stop', 'container', 'plain-nginx').code, 1);
		const list = JSON.parse(h.dt('list', 'containers', '--json').stdout);
		assert.ok(!list.some((c) => c.name === 'plain-nginx'), 'list showed a container without the workspace label');
	});

	test('help documents every verb and every flag the dispatch accepts; --version names the package', async () => {
		const help = h.dt('help').stdout;
		for (const line of [/^ {2}setup {7}/m, /^ {2}start {7}container <name> --template <t>/m, /^ {2}stop {8}container <name>/m, /^ {2}open {8}container <name>/m, /^ {2}export {6}container <name> --out <file>/m, /^ {2}import {6}container <name> <file>/m, /DT_IMAGE_<template>/]) assert.match(help, line);
		const { FLAGS } = await import('../src/cli.js');
		for (const f of new Set(Object.values(FLAGS).flat())) assert.match(help, new RegExp(`--${f}\\b`), `--${f} is accepted but not in help`);
		const v = h.dt('--version');
		assert.equal(v.stdout.trim(), `@dreamteamer/docker-workspaces@${JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8')).version}`);
	});

	test('--mount adds bind and volume mounts beside the three; a mount aimed at an own volume is refused', async () => {
		const r = h.dt('start', 'container', 'hq-mounts', '--template', 'hq', '--no-open', '--mount', `${h.dir}:/mnt/shared:ro`, '--mount', 'team-files:/mnt/team');
		assert.equal(r.code, 0, r.out);
		const create = (await fake.state()).requests.find((q) => q.path === '/containers/create?name=hq-mounts');
		const extra = create.body.HostConfig.Mounts.slice(3);
		assert.deepEqual(extra, [{ Type: 'bind', Source: h.dir, Target: '/mnt/shared', ReadOnly: true }, { Type: 'volume', Source: 'team-files', Target: '/mnt/team', ReadOnly: false }]);
		assert.match(r.stdout, /mounts .*→\/mnt\/shared \(ro\), team-files→\/mnt\/team/);
		const d = JSON.parse(h.dt('get', 'container', 'hq-mounts').stdout);
		assert.deepEqual(d.mounts, [`${h.dir}:/mnt/shared:ro`, 'team-files:/mnt/team']);
		assert.equal(d.workspace_dir, '/workspaces/hq-mounts');
		const bad = h.dt('start', 'container', 'hq-bad', '--template', 'hq', '--no-open', '--mount', 'x:/home/node');
		assert.equal(bad.code, 1);
		assert.match(bad.stderr, /--mount cannot target \/home\/node/);
		assert.match(h.dt('start', 'container', 'hq-bad', '--template', 'hq', '--no-open', '--mount', 'x:/workspaces').stderr, /--mount cannot target \/workspaces —/);
		const shape = h.dt('start', 'container', 'hq-bad', '--template', 'hq', '--no-open', '--mount', 'nocolon');
		assert.equal(shape.code, 1);
		assert.match(shape.stderr, /--mount takes <host-path\|volume>:<container-path>\[:ro\]/);
	});

	test('--repo hands the clone URL to the container as DT_REPO, and refuses a word that is not a URL', async () => {
		const r = h.dt('start', 'container', 'hq-joined', '--template', 'hq', '--no-open', '--repo', 'https://github.com/example/hq-joined.git');
		assert.equal(r.code, 0, r.out);
		const create = (await fake.state()).requests.find((q) => q.path === '/containers/create?name=hq-joined');
		assert.ok(create.body.Env.includes('DT_REPO=https://github.com/example/hq-joined.git'));
		assert.match(r.stdout, /clones https:\/\/github\.com\/example\/hq-joined\.git on first start/);
		assert.equal(JSON.parse(h.dt('get', 'container', 'hq-joined').stdout).repo, 'https://github.com/example/hq-joined.git');
		const bad = h.dt('start', 'container', 'hq-bad2', '--template', 'hq', '--no-open', '--repo', 'not-a-url');
		assert.equal(bad.code, 1);
		assert.match(bad.stderr, /--repo takes a git URL or an absolute path/);
		for (const url of ['https://someone:tok-secret@example.invalid/x.git', 'https://tok-secret@example.invalid/x.git']) {
			const cred = h.dt('start', 'container', 'hq-cred', '--template', 'hq', '--no-open', '--repo', url);
			assert.equal(cred.code, 1, url);
			assert.match(cred.stderr, /--repo carries credentials in its URL/);
			assert.doesNotMatch(cred.out, /tok-secret/, 'the refusal echoed the credential');
		}
		assert.ok(!(await fake.state()).requests.some((q) => q.path === '/containers/create?name=hq-cred'));
	});

	test('setup --json refuses an unknown flag like every other verb', () => {
		const r = h.dt('setup', '--templte', 'hq');
		assert.equal(r.code, 1);
		assert.match(r.stderr, /unknown flag "--templte" on `dt-docker setup`/);
	});
});

describe('the image\'s URL token, the per-container network, and the mount rules', () => {
	// `hq6` stands for an hq 0.6+ image: its `fake.features` label gives it /opt/dt-image/features
	// listing url-token, and a dt-url-token that answers root only — the fake's model of the image.
	const HQ6 = 'ghcr.io/dreamteamer/hq6:0.6.0';
	let h, fake;
	before(async () => {
		h = harness([{ ref: HQ6, labels: { 'dreamteamer.template': 'hq6', 'dreamteamer.ports': '8080', 'fake.features': 'url-token' } }, { ref: HQ, labels: { 'dreamteamer.template': 'hq', 'dreamteamer.ports': '8080' } }, { ref: 'ghcr.io/dreamteamer/crash:0.6.0', labels: { 'dreamteamer.template': 'crash', 'fake.crashloop': '1' } }, { ref: 'ghcr.io/dreamteamer/failing:0.6.0', labels: { 'dreamteamer.template': 'failing', 'fake.createfail': '1' } }]);
		fake = await startFakeDocker(h.sock, { images: h.images });
	});
	after(async () => { await fake.close(); h.cleanup(); });
	const hostFiles = (dir) => fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).map((f) => path.join(dir, f)).filter((f) => fs.statSync(f).isFile()) : [];

	test('start on a url-token image reads the token by exec AS ROOT and prints it on the ONE URL line — never in a file, the create body or --json', async () => {
		const r = h.dt('start', 'container', 'hq-ada', '--template', 'hq6', '--no-open', '--json');
		assert.equal(r.code, 0, r.out);
		const st = await fake.state();
		const token = st.tokens['hq-ada'];
		assert.ok(token, 'no token was ever asked for');
		// under --json stdout is the JSON and nothing else; the human line (the one carrying the token)
		// goes to stderr, where a script piping stdout into a log or a parser never sees it
		assert.match(r.stderr, new RegExp(`· http://localhost:8100/\\?tkn=${token}\\n`));
		assert.ok(!r.stdout.includes(token), 'the token reached --json stdout');
		assert.equal(r.out.split(token).length - 1, 1, 'the token appeared on more than the one URL line');
		const show = st.execs.find((e) => e.Cmd[0] === 'dt-url-token');
		assert.deepEqual([show.Cmd, show.User, show.container], [['dt-url-token', 'show'], 'root', 'hq-ada']);
		assert.deepEqual(st.execs.find((e) => e.Cmd[0] === 'cat').Cmd, ['cat', '/opt/dt-image/features']);
		assert.ok(!JSON.stringify(st.requests.find((q) => q.path.startsWith('/containers/create')).body).includes(token));
		for (const f of hostFiles(h.home)) assert.ok(!fs.readFileSync(f, 'utf8').includes(token), `the token was written to ${f}`);
		assert.equal(JSON.parse(r.stdout).editor_url, 'http://localhost:8100/', 'stdout under --json is not exactly one JSON document');
	});

	test('open --json prints the detail as exactly one JSON document with no token; the URL goes to stderr', async () => {
		const token = (await fake.state()).tokens['hq-ada'];
		const r = h.dt('open', 'container', 'hq-ada', '--no-open', '--json');
		assert.equal(r.code, 0, r.out);
		const d = JSON.parse(r.stdout);
		assert.equal(d.name, 'hq-ada');
		assert.equal(d.editor_url, 'http://localhost:8100/');
		assert.ok(!r.stdout.includes(token), 'the token reached --json stdout');
		assert.equal(r.stderr.trim(), `http://localhost:8100/?tkn=${token}`);
	});

	test('open reads the same token; --workspace keeps ?folder= beside it', async () => {
		const token = (await fake.state()).tokens['hq-ada'];
		assert.equal(h.dt('open', 'container', 'hq-ada', '--no-open').stdout.trim(), `http://localhost:8100/?tkn=${token}`);
		assert.equal(h.dt('open', 'container', 'hq-ada', '--no-open', '--workspace').stdout.trim(), `http://localhost:8100/?folder=/workspaces/hq-ada&tkn=${token}`);
	});

	test('--rotate-token execs dt-url-token rotate as root and prints the NEW URL; the old token is gone', async () => {
		const old = (await fake.state()).tokens['hq-ada'];
		const r = h.dt('start', 'container', 'hq-ada', '--rotate-token', '--no-open');
		assert.equal(r.code, 0, r.out);
		const st = await fake.state();
		assert.notEqual(st.tokens['hq-ada'], old);
		assert.match(r.stdout, new RegExp(`http://localhost:8100/\\?tkn=${st.tokens['hq-ada']}\\n`));
		assert.ok(!r.out.includes(old));
		assert.deepEqual(st.execs.filter((e) => e.Cmd[1] === 'rotate').map((e) => e.User), ['root']);
	});

	test('an image with no features file gets the plain URL, and --rotate-token on it is refused by name', async () => {
		const r = h.dt('start', 'container', 'hq-old', '--template', 'hq', '--no-open');
		assert.equal(r.code, 0, r.out);
		assert.match(r.stdout, /· http:\/\/localhost:8101\/\n/);
		assert.ok(!(await fake.state()).execs.some((e) => e.container === 'hq-old' && e.Cmd[0] === 'dt-url-token'), 'dt-url-token was run on an image that lists no url-token');
		const rot = h.dt('start', 'container', 'hq-old', '--rotate-token', '--no-open');
		assert.equal(rot.code, 1);
		assert.match(rot.stderr, /no URL token .* --rotate-token needs hq 0\.6/);
	});

	test('the exec carries the Docker idle timer: an exec that never answers fails naming DT_DOCKER_TIMEOUT', async () => {
		await fake.hangNext('/exec/');
		const t0 = Date.now();
		const r = h.dt('open', 'container', 'hq-ada', '--no-open', { DT_DOCKER_TIMEOUT: '1' });
		assert.equal(r.code, 1, r.out);
		assert.match(r.stderr, /Docker did not answer within 1s .*DT_DOCKER_TIMEOUT/);
		assert.ok(Date.now() - t0 < 8000);
		assert.match((await fake.state()).hung.at(-1).path, /^\/exec\/.+\/start$/);
	});

	test('a network of that name dreamteamer did not make is refused, not joined', async () => {
		await fake.post('/networks/create', { Name: 'dreamteamer-hq-squat', Driver: 'bridge' });
		const r = h.dt('start', 'container', 'hq-squat', '--template', 'hq', '--no-open');
		assert.equal(r.code, 1);
		assert.match(r.stderr, /a Docker network "dreamteamer-hq-squat" exists that dreamteamer did not make/);
		assert.ok(!(await fake.state()).requests.some((q) => q.path === '/containers/create?name=hq-squat'));
	});

	test('a create Docker refuses removes the network and volumes THIS attempt made, never ones that were there, and says Docker\'s sentence', async () => {
		const post = fake.post;
		// fresh: nothing exists yet, so the network and all four named volumes are this attempt's
		const r = h.dt('start', 'container', 'hq-fail', '--template', 'failing', '--no-open', '--mount', 'team-new:/mnt/team');
		assert.equal(r.code, 1, r.out);
		assert.match(r.stderr, /create container hq-fail: Docker answered 500 — fake: create failed after the volumes were made/);
		let st = await fake.state();
		assert.ok(!st.networks.some((n) => n.Name === 'dreamteamer-hq-fail'), 'the failed create left its network behind');
		assert.deepEqual(st.volumes.filter((v) => v.includes('hq-fail') || v === 'team-new'), [], `left behind: ${st.volumes}`);
		// pre-existing: a network dreamteamer made earlier, the home volume and a shared volume — all kept
		await post('/networks/create', { Name: 'dreamteamer-hq-fail2', Driver: 'bridge', Labels: { dreamteamer: '1', 'dreamteamer.name': 'hq-fail2' } });
		await post('/volumes/create', { Name: 'dreamteamer-hq-fail2-home' });
		await post('/volumes/create', { Name: 'team-shared' });
		const removedBefore = st.volumesRemoved.length;
		assert.equal(h.dt('start', 'container', 'hq-fail2', '--template', 'failing', '--no-open', '--mount', 'team-shared:/mnt/team').code, 1);
		st = await fake.state();
		assert.ok(st.networks.some((n) => n.Name === 'dreamteamer-hq-fail2'), 'a network that was there before the attempt was removed');
		assert.ok(st.volumes.includes('dreamteamer-hq-fail2-home') && st.volumes.includes('team-shared'), `a pre-existing volume was removed: ${st.volumes}`);
		assert.deepEqual(st.volumesRemoved.slice(removedBefore).sort(), ['dreamteamer-hq-fail2-files', 'dreamteamer-hq-fail2-workspace']);
	});

	test('rm stops a crash-looping (restarting) container before removing it, and its network goes too', async () => {
		h.dt('start', 'container', 'hq-loop', '--template', 'crash', '--no-open');
		assert.equal((await fake.state()).containers.find((c) => c.Name === '/hq-loop').State.Status, 'restarting');
		const r = h.dt('rm', 'container', 'hq-loop', '--force');
		assert.equal(r.code, 0, r.out);
		const st = await fake.state();
		assert.ok(!st.containers.some((c) => c.Name === '/hq-loop'));
		assert.ok(!st.networks.some((n) => n.Name === 'dreamteamer-hq-loop'));
	});

	test('a --mount target outside /workspaces · /home/node · /files · /mnt is refused after .. is normalised, naming the roots', () => {
		for (const t of ['/etc', '/mnt/../etc', '/usr/local/bin', '/opt/dt-image', '/workspacesx/a', '/']) {
			const r = h.dt('start', 'container', 'hq-mt', '--template', 'hq', '--no-open', '--mount', `${h.dir}:${t}`);
			assert.equal(r.code, 1, `${t} was accepted`);
			assert.match(r.stderr, /the target must be under \/workspaces · \/home\/node · \/files · \/mnt/);
		}
		const ok = h.dt('start', 'container', 'hq-mt', '--template', 'hq', '--no-open', '--mount', `${h.dir}:/workspaces/extra/../shared/`);
		assert.equal(ok.code, 0, ok.out);
		assert.match(ok.stdout, /→\/workspaces\/shared\b/);
	});

	// runc resolves a mount DESTINATION through symlinks inside the rootfs: a volume mounted at
	// /workspaces/<name> that holds `evil -> /opt` makes `--mount x:/workspaces/<name>/evil` land on the
	// image's real /opt. The lexical target check cannot see that, so nesting itself is refused.
	test('a --mount target at or under ANOTHER mount\'s target — the three own volumes included — is refused', () => {
		for (const pair of [['x:/files/team'], ['x:/home/node/.config'], ['x:/workspaces/hq-nt/evil'], ['a:/mnt/a', 'b:/mnt/a/b'], ['b:/mnt/a/b', 'a:/mnt/a'], ['a:/mnt/a', 'b:/mnt/a']]) {
			const r = h.dt('start', 'container', 'hq-nt', '--template', 'hq', '--no-open', ...pair.flatMap((m) => ['--mount', m]));
			assert.equal(r.code, 1, `${pair} was accepted`);
			assert.match(r.stderr, /lies at or under .*another mount of this container/);
		}
		const ok = h.dt('start', 'container', 'hq-nt', '--template', 'hq', '--no-open', '--mount', 'a:/mnt/a', '--mount', 'b:/mnt/ab', '--mount', 'c:/workspaces/other');
		assert.equal(ok.code, 0, ok.out);
	});

	test('a bind whose host source lies inside (or is) another bind source of the same container is refused', () => {
		const inner = path.join(h.dir, 'inner');
		fs.mkdirSync(inner, { recursive: true });
		for (const pair of [[`${h.dir}:/mnt/a:ro`, `${inner}:/mnt/b`], [`${inner}:/mnt/b`, `${h.dir}:/mnt/a:ro`], [`${h.dir}:/mnt/a:ro`, `${h.dir}:/mnt/b`]]) {
			const r = h.dt('start', 'container', 'hq-nest', '--template', 'hq', '--no-open', '--mount', pair[0], '--mount', pair[1]);
			assert.equal(r.code, 1, `${pair} was accepted`);
			assert.match(r.stderr, /lies inside .* one container reaches a host folder through one mount/);
		}
		const sibling = path.join(h.dir, 'sibling');
		fs.mkdirSync(sibling, { recursive: true });
		assert.equal(h.dt('start', 'container', 'hq-nest', '--template', 'hq', '--no-open', '--mount', `${inner}:/mnt/a`, '--mount', `${sibling}:/mnt/b`).code, 0);
	});

	// macOS APFS and Windows NTFS are case-insensitive by default, and realpath keeps the case it was
	// GIVEN — so a path comparison alone lets `/x/INNER` beside `/x:ro` reach the ro folder writably.
	// Only meaningful where the filesystem folds case; on a case-sensitive one the spelling is absent.
	const folds = (() => { try { return fs.statSync(os.tmpdir().toUpperCase()).ino === fs.statSync(os.tmpdir()).ino; } catch { return false; } })();
	test('the nested-source refusal holds when the same folder is spelled in another case', { skip: !folds && 'this filesystem is case-sensitive' }, () => {
		const inner = path.join(h.dir, 'inner');
		fs.mkdirSync(inner, { recursive: true });
		const upper = path.join(path.dirname(h.dir), path.basename(h.dir).toUpperCase());
		for (const pair of [[`${h.dir}:/mnt/a:ro`, `${path.join(upper, 'INNER')}:/mnt/b`], [`${upper}:/mnt/a`, `${h.dir}:/mnt/b:ro`], [`${inner.toUpperCase()}:/mnt/b`, `${h.dir}:/mnt/a:ro`]]) {
			const r = h.dt('start', 'container', 'hq-case', '--template', 'hq', '--no-open', '--mount', pair[0], '--mount', pair[1]);
			assert.equal(r.code, 1, `${pair} was accepted`);
			assert.match(r.stderr, /lies inside .* one container reaches a host folder through one mount/);
		}
	});
});

describe('when Docker is not there', () => {
	test('every driver verb names the socket and the fix, at exit 1', () => {
		const h = harness();
		try {
			const r = h.dt('list', 'containers');
			assert.equal(r.code, 1);
			assert.match(r.stderr, /Docker is not reachable at .*d\.sock/);
			assert.match(r.stderr, /dt-docker setup/);
			const s = h.dt('setup');
			assert.equal(s.code, 1);
			assert.match(s.stdout + s.stderr, /docker\s+✖/);
		} finally { fs.rmSync(h.dir, { recursive: true, force: true }); }
	});
});

describe('every request to Docker carries a timer', () => {
	// The failure this exists for: Docker Desktop paused or still starting accepts the socket and
	// never answers. Without a timer every driver verb — and anything that waits on it — hangs.
	test('a daemon that accepts and never answers fails the verb within DT_DOCKER_TIMEOUT, naming the knob', async () => {
		const h = harness();
		const fake = await startFakeDocker(h.sock, { images: h.images });
		try {
			await fake.hangNext();
			const t0 = Date.now();
			const r = h.dt('list', 'containers', { DT_DOCKER_TIMEOUT: '1' });
			const took = Date.now() - t0;
			assert.equal(r.code, 1, r.out);
			assert.match(r.stderr, /Docker did not answer within 1s/);
			assert.match(r.stderr, /DT_DOCKER_TIMEOUT/);
			assert.ok(took < 8000, `took ${took}ms`);
			assert.deepEqual((await fake.state()).hung, [{ method: 'GET', path: '/containers/json' }]);
		} finally { await fake.close(); fs.rmSync(h.dir, { recursive: true, force: true }); }
	});
	test('the timer is idle-based: a pull that keeps streaming progress is not cut off by it', async () => {
		const h = harness([]);
		const fake = await startFakeDocker(h.sock, { images: [] });
		try {
			const r = h.dt('add', 'image', '--template', 'hq', { DT_DOCKER_TIMEOUT: '1' });
			assert.equal(r.code, 0, r.out);
			assert.deepEqual((await fake.state()).pulls, [HQ]);
		} finally { await fake.close(); fs.rmSync(h.dir, { recursive: true, force: true }); }
	});
});

describe('the no-dependency promise', () => {
	test('src imports node: modules and its own files only, package.json declares no dependency and no engine extension, and the bin is dt-docker', () => {
		for (const f of fs.readdirSync(path.join(PKG, 'src'))) {
			const src = fs.readFileSync(path.join(PKG, 'src', f), 'utf8');
			for (const m of src.matchAll(/^import [^;]* from '([^']+)';/gm)) assert.ok(m[1].startsWith('node:') || m[1].startsWith('./'), `${f} imports ${m[1]}`);
		}
		const pkg = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8'));
		for (const k of ['dependencies', 'peerDependencies', 'optionalDependencies']) assert.equal(pkg[k], undefined, `package.json declares ${k}`);
		// a module (it ships a skill), but never code the engine loads: dt-docker must run with no workspace
		assert.equal(pkg.dreamteamer?.extension, undefined, 'host declares an engine extension');
		assert.deepEqual(pkg.bin, { 'dt-docker': 'bin/dt-docker.js' });
	});
});
