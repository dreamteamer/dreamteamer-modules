// The contract's workspace: a REAL one, made by the engine it is handed (`dt init`, the engine linked as
// `node_modules/dreamteamer`, compiled, committed), so every host is asked about what the compiler
// actually produces. Synthetic cast only.
//
//   projects     name · status (an enum carrying colours) · rank (position) · media (a folder template)
//   tasks        name · done · project → projects
//   lab/samples  a namespaced collection (its name carries a slash; routes send it encoded)
//   a ui-view, a skill, a command and its binding on projects
//   git_modules/northwind-archive — a record LAYER holding one `projects` record
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TIMEOUT = 60_000;
const GIT_ENV = {
	...process.env,
	GIT_AUTHOR_NAME: 'Dana Oren', GIT_AUTHOR_EMAIL: 'dana@northwind.example',
	GIT_COMMITTER_NAME: 'Dana Oren', GIT_COMMITTER_EMAIL: 'dana@northwind.example',
	GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
};

export const SOURCES = {
	'collections/projects.collection.yaml': `name: projects
description: A piece of work for a client.
use_when: a client engagement starts and its work needs tracking
ids:
  from: '{{ name | slug }}'
fields:
  name:
    type: string
    required: true
  status:
    type: string
    enum:
      active: { color: charts.green }
      paused: { color: charts.orange }
  rank:
    type: position
  media:
    type: string
  notes:
    type: markdown
    body: true
display:
  nav:
    icon: briefcase
    order: 1
`,
	'collections/tasks.collection.yaml': `name: tasks
description: One thing to do for a project.
use_when: a commitment on a project surfaces
ids:
  from: '{{ name | slug }}'
fields:
  name:
    type: string
    required: true
  done:
    type: boolean
  project:
    type: projects
`,
	'collections/lab/samples.collection.yaml': `name: lab/samples
description: One sample taken in the lab.
use_when: a sample is logged
ids:
  from: '{{ name | slug }}'
fields:
  name:
    type: string
    required: true
`,
	'ui-views/projects-board.ui-view.yaml': `route: /projects-board
scope: collection
collection: collections/projects
display:
  nav:
    title: Projects board
    order: 2
  list:
    layout: kanban
    options:
      lanes_by: status
`,
	'skills/reviewing-projects/SKILL.md': `---
name: reviewing-projects
description: use when a project's status is being reviewed with the client
---

# reviewing-projects

Read the project, then its tasks.
`,
	'commands/review-project.command.md': `---
name: review-project
description: review one project with the client
argument-hint: <projects/id>
---
load the reviewing-projects skill.
`,
	'command-bindings/review-project--projects.command-binding.yaml': `command: commands/review-project
collection: collections/projects
scope: record
available_when:
  status:
    _eq: active
done_when:
  status:
    _eq: paused
description: review an active project
`,
};

const LAYER = 'northwind-archive';

/**
 * Build the fixture with the engine at `engineDir` (a dreamteamer checkout or package with `bin/` and
 * `src/api.js`). Returns `{ root, layer, git, dt, head, cleanup }`.
 */
export function makeFixture({ engineDir: given, tmp = os.tmpdir() } = {}) {
	const engineDir = given && path.resolve(given);
	if (!engineDir || !fs.existsSync(path.join(engineDir, 'bin', 'dreamteamer.js'))) throw new Error(`makeFixture: no engine at ${engineDir}`);
	const root = fs.realpathSync(fs.mkdtempSync(path.join(tmp, 'dt-contract-')));
	const bin = path.join(engineDir, 'bin', 'dreamteamer.js');
	const git = (args, cwd = root) => execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8', timeout: TIMEOUT }).trim();
	const dt = (...args) => {
		const r = spawnSync(process.execPath, [bin, ...args], { cwd: root, env: GIT_ENV, encoding: 'utf8', timeout: TIMEOUT, killSignal: 'SIGKILL' });
		return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
	};
	const must = (r, what) => { if (r.status !== 0) throw new Error(`fixture ${what} failed:\n${r.stdout}\n${r.stderr}`); return r; };

	git(['init', '-q']);
	must(dt('init'), 'init');
	fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
	fs.symlinkSync(fs.realpathSync(engineDir), path.join(root, 'node_modules', 'dreamteamer'), 'dir');
	const pkgFile = path.join(root, 'package.json');
	const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
	pkg.dependencies = { ...pkg.dependencies, dreamteamer: '*' };
	pkg.dreamteamer = { ...pkg.dreamteamer, namespaces: ['lab'], git_modules: { [LAYER]: { url: 'https://git.example/northwind/archive.git', ref: 'main', records: ['projects'] } } };
	fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, '\t') + '\n');
	for (const [rel, text] of Object.entries(SOURCES)) {
		const file = path.join(root, 'modules', 'default', rel);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, text);
	}
	// the layer: another workspace's clone, holding one projects record, committed in its own repo
	const layer = path.join(root, 'git_modules', LAYER);
	fs.mkdirSync(path.join(layer, 'data', 'projects'), { recursive: true });
	fs.writeFileSync(path.join(layer, 'package.json'), JSON.stringify({ name: LAYER, private: true, dreamteamer: { data_path: 'data' } }, null, '\t') + '\n');
	fs.writeFileSync(path.join(layer, 'data', 'projects', 'harbor-mutual-archive.project.md'), '---\nname: Harbor Mutual archive\nstatus: paused\n---\nHeld by the layer.\n');
	git(['init', '-q'], layer);
	git(['add', '-A'], layer);
	git(['commit', '-qm', 'layer: one project'], layer);
	fs.appendFileSync(path.join(root, '.gitignore'), '\ngit_modules/\n');

	must(dt('compile'), 'compile');
	must(dt('add', 'projects', '--name', 'Northwind launch', '--status', 'active', '--media', '${env:DT_CONTRACT_FILES}/northwind'), 'add project');
	must(dt('add', 'projects', '--name', 'Harbor Mutual renewal', '--status', 'paused'), 'add project');
	must(dt('add', 'tasks', '--name', 'Brief Dana', '--project', 'projects/northwind-launch'), 'add task');
	must(dt('add', 'lab/samples', '--name', 'Sample one'), 'add sample');
	git(['add', '-A']);
	git(['commit', '-qm', 'fixture: Northwind']);
	return {
		root,
		layer,
		git,
		dt,
		head: () => git(['rev-parse', 'HEAD']),
		cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
	};
}
