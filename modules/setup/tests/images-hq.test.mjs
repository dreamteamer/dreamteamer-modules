// The `hq` template image, pinned by what its SOURCES promise — because the image is what a
// stranger's `dt-host start container … --template hq` runs, and everything in it travels to every
// person who pulls it. Three promises: nothing personal or secret is baked in, every version is
// pinned (an image is one version of everything), and the labels that make it a template to
// `dt-host list images` are present and agree with the modules the template actually installs.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMAGE = path.join(ROOT, 'images', 'hq');
const dockerfile = fs.readFileSync(path.join(IMAGE, 'Dockerfile'), 'utf8');
const entrypoint = fs.readFileSync(path.join(IMAGE, 'entrypoint.sh'), 'utf8');
const label = (name) => dockerfile.match(new RegExp(`dreamteamer\\.${name}="([^"]*)"`))?.[1];
const moduleNames = fs.readdirSync(path.join(ROOT, 'modules')).filter((m) => fs.existsSync(path.join(ROOT, 'modules', m, 'package.json')));

describe('images/hq — nothing personal, nothing secret', () => {
	test('no credential-shaped ENV, ARG or COPY reaches the image', () => {
		for (const line of [...dockerfile.split('\n'), ...entrypoint.split('\n')]) {
			assert.doesNotMatch(line, /^(ENV|ARG)\s+\S*(TOKEN|SECRET|PASSWORD|API_KEY|OAUTH)/i, `a credential-shaped build variable: ${line}`);
			assert.doesNotMatch(line, /^COPY\s+.*\.env\b/, `an .env copied into the image: ${line}`);
			assert.doesNotMatch(line, /sk-ant-|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN/, `a literal credential: ${line}`);
		}
	});

	test('no machine path, mail address, private-vault name or person in the sources', () => {
		const text = dockerfile + entrypoint;
		assert.doesNotMatch(text, /\/Users\/|\/home\/(?!node\b)[a-z]+/, 'a host path');
		assert.doesNotMatch(text, /[a-z0-9._%+-]+@[a-z0-9.-]+\.(com|io|co\.il|net|org)\b/i, 'a mail address');
		// Assembled, not spelled — a literal vault name here is itself a hit for the leak gate (its own test says so).
		assert.doesNotMatch(text, new RegExp(['gk-' + 'brain', 'dt-' + 'hq', 'hq[23]\\b'].join('|')), 'a private vault name');
		assert.doesNotMatch(text, /\p{Script=Hebrew}/u, 'Hebrew, which in this repo only ever comes from private data');
	});

	test('the entrypoint never writes a token or a password; the only .env it writes is FILES_FOLDER', () => {
		const writes = entrypoint.split('\n').filter((l) => /\.env/.test(l));
		assert.equal(writes.length, 1, `entrypoint touches .env in ${writes.length} places: ${writes}`);
		assert.match(writes[0], /FILES_FOLDER/);
		assert.doesNotMatch(entrypoint, /TOKEN|PASSWORD|SECRET/i);
	});
});

describe('images/hq — one version of everything', () => {
	test('every package the image installs is pinned through an ARG, never @latest', () => {
		for (const arg of ['DT_VERSION', 'EXT_VERSION', 'CLAUDE_VERSION', 'CODE_SERVER_VERSION']) {
			assert.match(dockerfile, new RegExp(`^ARG ${arg}=\\d+\\.\\d+\\.\\d+$`, 'm'), `${arg} is not pinned to an exact version`);
		}
		assert.doesNotMatch(dockerfile, /npm install[^\n]*@latest/, 'an @latest install');
		assert.doesNotMatch(dockerfile, /npm install -g[^\n]*\bdreamteamer\b(?!@\$\{DT_VERSION\})/, 'the engine installed unpinned');
	});

	test('the image installs the SAME engine version globally and inside the template', () => {
		const globalInstall = dockerfile.match(/npm install -g[^\n]*dreamteamer@\$\{DT_VERSION\}/);
		const templateInstall = dockerfile.match(/npm install[^\n]*dreamteamer@\$\{DT_VERSION\}[^\n]*@dreamteamer\/extensions@\$\{EXT_VERSION\}/);
		assert.ok(globalInstall, 'no pinned global engine install');
		assert.ok(templateInstall, 'no pinned template install of engine + extensions');
	});
});

describe('images/hq — the labels that make it a template', () => {
	test('template, ports, modules and engine labels are present', () => {
		assert.equal(label('template'), 'hq');
		assert.equal(label('ports'), '8080');
		assert.ok(label('modules'), 'no dreamteamer.modules label');
		assert.equal(label('engine'), '${DT_VERSION}');
	});

	test('the modules label is exactly the bundle minus the disable list, and every name is a real module', () => {
		const disabled = JSON.parse(dockerfile.match(/p\.dreamteamer\.disable=(\[[^\]]*\])/)[1].replace(/'/g, '"'));
		const labelled = label('modules').split(',').sort();
		for (const m of [...disabled, ...labelled]) assert.ok(moduleNames.includes(m), `"${m}" is not a module in modules/`);
		const expected = moduleNames.filter((m) => !disabled.includes(m)).sort();
		assert.deepEqual(labelled, expected, 'dreamteamer.modules disagrees with what the template installs');
	});

	test('both editor extensions are baked outside the home volume, and the template recommends ours', () => {
		assert.match(dockerfile, /code-server --extensions-dir \/opt\/code-server\/extensions --install-extension anthropic\.claude-code/);
		assert.match(dockerfile, /code-server --extensions-dir \/opt\/code-server\/extensions --install-extension dreamteamer\.dreamteamer-vscode/);
		assert.match(dockerfile, /\.vscode\/extensions\.json/);
		assert.match(entrypoint, /--extensions-dir \/opt\/code-server\/extensions/, 'the server must read the directory the extensions were baked into');
	});

	test('the entrypoint answers the git-autofetch prompt once, merging into the person\'s settings rather than replacing them', () => {
		assert.match(entrypoint, /"git\.autofetch": true/);
		assert.match(entrypoint, /if \(!\(k in s\)\)/, 'a key the person already set must win');
		assert.match(entrypoint, /\.local\/share\/code-server\/User\/settings\.json/, 'the settings file must be the one the server reads (--user-data-dir)');
	});

	test('the editor binds inside the container only, and the entrypoint compiles before it serves', () => {
		assert.match(entrypoint, /code-server --bind-addr 0\.0\.0\.0:8080 --auth none/);
		assert.ok(entrypoint.indexOf('dreamteamer compile') < entrypoint.indexOf('exec code-server'), 'code-server starts before the runtime is compiled');
		assert.match(dockerfile, /^EXPOSE 8080$/m);
		assert.match(dockerfile, /^USER node$/m, 'the template is built and served as root');
	});
});
