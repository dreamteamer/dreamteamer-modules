// tasks 0.3.0 has no `lane` — what a fixture can pin: the shipped descriptor and views no longer name
// the field, and the migration's plan, write and no-op second run over a synthetic workspace. The
// workspace is invented whole: four tasks in the 0.2.x shape, one already in shape, one whose lane will
// not kebab-case, a workspace overlay that closed the field with an enum and a view that filters by it.
import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';
import { plan, migrateText, kebab, main } from '../bin/migrate-lanes-to-tags.mjs';

const MODULE = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SCRIPT = path.join(MODULE, 'bin', 'migrate-lanes-to-tags.mjs');
const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const put = (root, rel, text) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; };
const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const front = (root, rel) => yaml.load(/^---\n([\s\S]*?)\n---/.exec(read(root, rel))[1]);
const run = (root, ...args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, encoding: 'utf8' });

const T = 'data/tasks';
function fixture() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-lanes-'));
	made.push(root);
	put(root, 'package.json', '{"name":"northwind-workspace","private":true}\n');
	put(root, 'package-lock.json', '{}\n');
	put(root, `${T}/2026-01-05--send-harbor-mutual-the-proposal.task.md`,
		'---\nname: Send Harbor Mutual the proposal\nstatus: todo\nlane: CRM\nitem: meetings/2026-01-05--harbor-mutual-weekly\ntags:\n  - client:harbor-mutual\nauthor: agents/claude-code\n---\n\nDana asked for it by Friday.\n');
	put(root, `${T}/2026-01-06--ship-the-portal-build.task.md`,
		"---\nname: Ship the portal build\nlane: 'R&D'\nstatus: doing\n---\n");
	put(root, `${T}/2026-01-07--record-the-intro-episode.task.md`,
		'---\nname: Record the intro episode\nlane: Content\ntags: [content, video]\n---\n');
	put(root, `${T}/2026-01-08--file-the-quarterly-return.task.md`,
		'---\nname: File the quarterly return\nlane:\nstatus: todo\n---\n');
	put(root, `${T}/2026-01-09--book-the-northwind-review.task.md`,
		'---\nname: Book the Northwind review\nstatus: todo\ntags:\n  - crm\n---\n');
	put(root, `${T}/2026-01-10--renew-the-domain.task.md`,
		'---\nname: Renew the domain\nlane: ドメイン\n---\n');
	put(root, 'modules/default/collections/tasks.collection.yaml',
		'name: tasks\noverlay: true\nfields:\n  lane:\n    type: string\n    enum: [CRM, R&D, Content]\n');
	put(root, 'modules/default/ui-views/tasks-crm.ui-view.yaml',
		'route: /tasks/crm\nscope: collection\ncollection: collections/tasks\nfilter:\n  lane:\n    _eq: CRM\n');
	put(root, 'modules/default/ui-views/projects-board.ui-view.yaml',
		'route: /plan/by-lane\nscope: collection\ncollection: collections/activities\ndisplay:\n  list:\n    options:\n      group_by: lane\n');
	return root;
}

describe('tasks 0.3.0 ships no lane', () => {
	test('the descriptor declares no lane field and lists no lane column', () => {
		const d = yaml.load(fs.readFileSync(path.join(MODULE, 'collections', 'tasks.collection.yaml'), 'utf8'));
		assert.ok(!('lane' in d.fields), 'tasks.lane is gone');
		assert.ok(!d.display.list.columns.includes('lane'));
		assert.doesNotMatch(d.use_when, /\blane\b/);
	});
	test('no shipped view, skill or README line names the field', () => {
		for (const dir of ['ui-views', 'skills']) {
			for (const f of fs.readdirSync(path.join(MODULE, dir), { recursive: true })) {
				const p = path.join(MODULE, dir, f);
				if (fs.statSync(p).isFile()) assert.doesNotMatch(fs.readFileSync(p, 'utf8'), /\blane\b/, `${dir}/${f}`);
			}
		}
	});
	test('the board keeps status columns and bands by project, showing the tasks with none', () => {
		const v = yaml.load(fs.readFileSync(path.join(MODULE, 'ui-views', 'tasks-board.ui-view.yaml'), 'utf8'));
		assert.equal(v.display.list.options.lanes_by, 'status');
		assert.equal(v.display.list.options.group_by, 'project');
		assert.equal(v.display.list.options.show_ungrouped_rows, true);
	});
	test('the manifest is 0.3.0 or later and ships the migration as an npm bin', () => {
		const pkg = JSON.parse(fs.readFileSync(path.join(MODULE, 'package.json'), 'utf8'));
		// the release that dropped lane is 0.3.0; a later patch still ships the migration
		const [major, minor] = pkg.version.split('.').map(Number);
		assert.ok(major > 0 || minor >= 3, `tasks ${pkg.version} predates the migration`);
		assert.equal(pkg.bin['dt-migrate-lanes-to-tags'], 'bin/migrate-lanes-to-tags.mjs');
		assert.ok(pkg.files.includes('bin') && pkg.files.includes('lib'));
		assert.doesNotMatch(pkg.dreamteamer.description, /\blane\b/);
	});
});

describe('kebab and migrateText', () => {
	test('a lane value kebab-cases into a valid tag', () => {
		assert.equal(kebab('CRM'), 'crm');
		assert.equal(kebab('R&D'), 'r-d');
		assert.equal(kebab(' Área de Vida '), 'area-de-vida');
		assert.equal(kebab('ドメイン'), '');
	});
	test('a task with no lane is not a change', () => {
		assert.equal(migrateText('---\nname: x\ntags:\n  - crm\n---\n'), null);
	});
	test('the lane tag is added once — never beside the same tag', () => {
		const r = migrateText('---\nname: x\nlane: CRM\ntags:\n  - crm\n---\n');
		assert.equal(r.added, false);
		assert.equal(r.text, '---\nname: x\ntags:\n  - crm\n---\n');
	});
	test('the body and every other key are kept byte for byte', () => {
		const r = migrateText('---\nname: x\nlane: CRM\ncreation_context: >-\n  two lines\n  of context\n---\n\nThe body.\n');
		assert.equal(r.text, '---\nname: x\ntags:\n  - crm\ncreation_context: >-\n  two lines\n  of context\n---\n\nThe body.\n');
	});
});

describe('the migration over a workspace', () => {
	test('the dry run prints the plan, names what it will not convert and the overlay lines, and writes nothing', () => {
		const root = fixture();
		const before = read(root, `${T}/2026-01-05--send-harbor-mutual-the-proposal.task.md`);
		const r = run(root);
		assert.equal(r.status, 0, r.stderr);
		assert.match(r.stdout, /^workspace /);
		assert.match(r.stdout, /· data\/tasks\/2026-01-05--send-harbor-mutual-the-proposal\.task\.md {2}lane CRM → tag crm/);
		assert.match(r.stdout, /lane R&D → tag r-d/);
		assert.match(r.stdout, /lane Content → tag content \(already tagged\)/);
		assert.match(r.stdout, /2026-01-08--file-the-quarterly-return\.task\.md {2}empty lane removed/);
		assert.match(r.stdout, /! data\/tasks\/2026-01-10--renew-the-domain\.task\.md {2}lane "ドメイン" kebab-cases to nothing/);
		assert.match(r.stdout, /! modules\/default\/collections\/tasks\.collection\.yaml:4 {2}still names lane/);
		assert.match(r.stdout, /! modules\/default\/ui-views\/tasks-crm\.ui-view\.yaml:5 {2}still names lane/);
		assert.doesNotMatch(r.stdout, /projects-board/, 'a view of another collection is not a tasks leftover');
		assert.match(r.stdout, /\nrecords 4 · refs 0\nnothing written — pass --write to apply$/m);
		assert.equal(read(root, `${T}/2026-01-05--send-harbor-mutual-the-proposal.task.md`), before);
		assert.equal(run(root, '--dry-run').stdout, r.stdout, '--dry-run is the default');
	});

	test('--write moves each lane into tags and removes the key; the skipped task is untouched', () => {
		const root = fixture();
		const untouched = read(root, `${T}/2026-01-10--renew-the-domain.task.md`);
		const r = run(root, '--write');
		assert.equal(r.status, 0, r.stderr);
		assert.match(r.stdout, /records 4 · refs 0\nwritten\nthen: remove the lines above · dreamteamer compile · dreamteamer check/);
		const crm = front(root, `${T}/2026-01-05--send-harbor-mutual-the-proposal.task.md`);
		assert.deepEqual(crm.tags, ['client:harbor-mutual', 'crm']);
		assert.ok(!('lane' in crm));
		assert.equal(crm.item, 'meetings/2026-01-05--harbor-mutual-weekly');
		assert.match(read(root, `${T}/2026-01-05--send-harbor-mutual-the-proposal.task.md`), /\n---\n\nDana asked for it by Friday\.\n$/);
		assert.deepEqual(front(root, `${T}/2026-01-06--ship-the-portal-build.task.md`), { name: 'Ship the portal build', tags: ['r-d'], status: 'doing' });
		assert.deepEqual(front(root, `${T}/2026-01-07--record-the-intro-episode.task.md`).tags, ['content', 'video']);
		assert.deepEqual(front(root, `${T}/2026-01-08--file-the-quarterly-return.task.md`), { name: 'File the quarterly return', status: 'todo' });
		assert.equal(read(root, `${T}/2026-01-10--renew-the-domain.task.md`), untouched);
		assert.match(read(root, 'modules/default/collections/tasks.collection.yaml'), /lane:/, 'the overlay is reported, never edited');
	});

	test('a second run is a no-op', () => {
		const root = fixture();
		assert.equal(run(root, '--write').status, 0);
		const snapshot = fs.readdirSync(path.join(root, T)).map((f) => read(root, `${T}/${f}`));
		const again = run(root, '--write');
		assert.equal(again.status, 0, again.stderr);
		assert.match(again.stdout, /records 0 · refs 0/);
		assert.deepEqual(fs.readdirSync(path.join(root, T)).map((f) => read(root, `${T}/${f}`)), snapshot);
		assert.equal(plan(root).records.length, 0);
	});

	test('the store path comes from the compiled descriptor when the workspace moved it', () => {
		const root = fixture();
		put(root, '.dreamteamer/collections/tasks.collection.yaml', 'name: tasks\nstorage:\n  path: data/work/tasks\n  format: md\n');
		put(root, 'data/work/tasks/2026-02-01--call-priya.task.md', '---\nname: Call Priya\nlane: CRM\n---\n');
		const p = plan(root);
		assert.deepEqual(p.records.map((r) => path.basename(r.file)), ['2026-02-01--call-priya.task.md']);
	});

	test('arguments: --json is machine-readable, --write with --dry-run is refused', () => {
		const root = fixture();
		const logs = [];
		assert.equal(main(['--json'], { cwd: root, log: (s) => logs.push(s), error: () => {} }), 0);
		const j = JSON.parse(logs[0]);
		assert.equal(j.written, false);
		assert.equal(j.records, 4);
		assert.equal(j.refs, 0);
		assert.equal(j.skipped.length, 1);
		assert.equal(j.leftovers.length, 2);
		assert.equal(main(['--write', '--dry-run'], { cwd: root, log: () => {}, error: () => {} }), 2);
	});
});
