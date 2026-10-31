// THE FACTORY CHAIN — what a fixture can pin: the frame-extraction plan, the descriptors' shape, the
// bindings' predicates naming real fields, and the doctor's rnd capability. The live ffmpeg run and a
// virgin-consumer `dt next` walk are smoked by hand and quoted in the commit.
import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { ffmpegArgs, parseArgs, main } from '../../../modules/rnd/skills/building-from-references/bin/extract-frames.mjs';

// the repo root — these tests were written at the root of dreamteamer/extensions, whose modules/ layout
// this repo keeps, so every `ROOT/modules/<m>/…` path still names the same file
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');
const RND = path.join(ROOT, 'modules', 'rnd');
const load = (rel) => yaml.load(fs.readFileSync(path.join(RND, rel), 'utf8'));
// rnd composes wikis and notebooklm (compose.json): a copy is judged in its origin's own tests, and the
// gates below see only what rnd authors — the /rnd:… family, its bindings, its skills.
const COPIES = new Set(Object.keys(JSON.parse(fs.readFileSync(path.join(RND, 'compose.json'), 'utf8')).files));
const authored = (kind, f) => !COPIES.has(`${kind}/${f}`);

describe('extract-frames — the ffmpeg plan', () => {
	test('one frame every N seconds at the given width, height following', () => {
		const [frames] = ffmpegArgs({ input: 'in.mp4', out: 'shots', every: 4, width: 1280 });
		assert.equal(frames.purpose, 'frames');
		assert.deepEqual(frames.argv, ['-v', 'error', '-y', '-i', 'in.mp4', '-vf', 'fps=1/4,scale=1280:-1', path.join('shots', 'f-%03d.png')]);
	});
	test('--sheet adds a tiled contact sheet at half width from the same sampling', () => {
		const calls = ffmpegArgs({ input: 'in.mp4', out: 'shots', every: 8, width: 1000, sheet: true });
		assert.deepEqual(calls.map((c) => c.purpose), ['frames', 'sheet']);
		assert.match(calls[1].argv.join(' '), /fps=1\/8,scale=500:-1,tile=4x6/);
	});
	test('refuses a missing input or output, and a non-positive interval or width, by name', () => {
		assert.throws(() => ffmpegArgs({ out: 'x' }), /--in/);
		assert.throws(() => ffmpegArgs({ input: 'x' }), /--out/);
		assert.throws(() => ffmpegArgs({ input: 'x', out: 'y', every: 0 }), /--every/);
		assert.throws(() => ffmpegArgs({ input: 'x', out: 'y', width: 'wide' }), /--width/);
	});
	test('parseArgs reads the flags and defaults the rest', () => {
		assert.deepEqual(parseArgs(['--in', 'a.mp4', '--out', 'd', '--sheet']), { input: 'a.mp4', out: 'd', every: 4, width: 1280, sheet: true, dryRun: false });
	});
	test('--dry-run prints the calls and exits 0 without ffmpeg', () => {
		const logs = []; const orig = console.log; console.log = (l) => logs.push(l);
		try { assert.equal(main(['--in', 'none.mp4', '--out', 'nowhere', '--dry-run']), 0); } finally { console.log = orig; }
		assert.equal(logs.length, 1); assert.match(logs[0], /^plan frames\s+ffmpeg /);
	});
	test('a bad invocation exits 2 with usage', () => {
		const errs = []; const orig = console.error; console.error = (l) => errs.push(l);
		try { assert.equal(main(['--out', 'x']), 2); } finally { console.error = orig; }
		assert.match(errs[0], /usage:/);
	});
});

describe('the descriptors', () => {
	// descriptor format v2: `fields` keyed by name, a field's `type` either a scalar or the collection it
	// points at, `many` for a list, `required` on the field, `mirror_of` on the generated far side
	const refs = load('collections/rnd/references.collection.yaml');
	const pdd = load('collections/rnd/design-docs.collection.yaml');
	const proto = load('collections/rnd/prototypes.collection.yaml');
	const products = load('collections/rnd/products.collection.yaml');
	test('a reference is an entity with a type enum that includes product, and a prd field', () => {
		assert.equal(refs.ids.from, '{{ name | slug }}');
		assert.deepEqual(Object.keys(refs.fields).filter((k) => refs.fields[k].required), ['name', 'type']);
		assert.ok(refs.fields.type.enum.includes('product'));
		assert.equal(refs.fields.prd.type, 'markdown');
		for (const f of ['reference_file', 'screenshots_folder']) assert.match(refs.fields[f].description, /\$\{env:FILES_FOLDER\}/);
	});
	// The chain's hops are FIELDS. A mirror is declared ONCE, on the generated far side, as `mirror_of`
	// naming the owning field on the collection its `type` points at.
	test('the design doc carries the chain: product, references, branding, plan, and the prototypes mirror', () => {
		const p = pdd.fields;
		assert.equal(p.product.type, 'rnd/products');
		assert.equal(p.references.type, 'rnd/references'); assert.equal(p.references.many, true);
		assert.equal(p.branding.type, 'markdown');
		assert.equal(p.plan.type, 'string', 'plan is a plain string — the plan may live elsewhere');
		assert.equal(p.prototypes.type, 'rnd/prototypes');
		assert.equal(p.prototypes.mirror_of, 'design_doc');
	});
	test('each mirror is owned on the far side by a field that names it', () => {
		// ⚠ ONE SIDE ONLY. The owning field (`design_doc`) is a plain reference; the generated side
		// carries `mirror_of`. The mirror is declared on the design doc, where a reader opening it can see it.
		assert.equal(proto.fields.design_doc.type, 'rnd/design-docs');
		assert.ok(!proto.fields.design_doc.mirror_of, 'the owning side of a mirror is a plain reference');
		const mirrors = [
			[pdd.fields.prototypes, 'rnd/prototypes', 'design_doc', proto],
			[products.fields.design_docs, 'rnd/design-docs', 'product', pdd],
			[refs.fields.design_docs, 'rnd/design-docs', 'references', pdd],
		];
		for (const [field, type, owner, far] of mirrors) {
			assert.equal(field.type, type); assert.equal(field.many, true); assert.equal(field.mirror_of, owner);
			assert.ok(far.fields[owner], `${type} has no field ${owner} for the mirror to name`);
		}
	});
	// `rnd/media-packs` was retired in 0.7.0: a whole collection to say "there is a folder of videos"
	// bought one thing a folder does not — the corpus it was generated from — and nothing else. That
	// pinning moved into the owning record's BODY, and the folder became a field on the record the media
	// belongs to. A `media-packs.collection.yaml` coming back is the regression this guards.
	test('the collections that carry media carry a media_folder ${env:FILES_FOLDER} template, and media-packs is gone', () => {
		for (const c of ['products', 'draft-docs', 'research-docs', 'design-docs']) {
			const f = load(`collections/rnd/${c}.collection.yaml`).fields.media_folder;
			assert.ok(f, `${c} has no media_folder`);
			assert.equal(f.type, 'string');
			assert.match(f.description, /\$\{env:FILES_FOLDER\}/, `${c}.media_folder must be a template, never a machine path`);
			assert.match(f.examples[0], new RegExp(`^\\$\\{env:FILES_FOLDER\\}/rnd/${c}/[^/]+/media$`), `${c}.media_folder example`);
		}
		assert.ok(!fs.existsSync(path.join(RND, 'collections/rnd/media-packs.collection.yaml')), 'media-packs was retired into media_folder');
	});

	// ⚠ `rnd/projects` was DELETED: this pack shipped two collections that both meant "a project"
	// — the plan module's `projects` (phases, gates, seats, risks) and this one — and a name
	// collision across two modules of one pack is the shape that leaves a workspace permanently
	// stale. A product IS the effort now; the plan that delivers it is `projects`. The two fields
	// that had nowhere else to go, `company` and `media_folder`, moved onto `rnd/products`, and
	// every reference that pointed at the deleted collection points at `projects` as a PEER — no
	// mirror, because a mirror would write a field into a module this one does not own. In v2 a
	// mirror onto `projects` would be an overlay of it carrying `mirror_of`; this module has none.
	test('rnd/projects is gone, folded into rnd/products, and nothing still points at it', () => {
		assert.ok(!fs.existsSync(path.join(RND, 'collections/rnd/projects.collection.yaml')),
			'rnd/projects came back');
		const products = load('collections/rnd/products.collection.yaml').fields;
		assert.equal(products.company?.type, 'companies', 'company did not survive the fold');
		assert.ok(products.media_folder, 'media_folder did not survive the fold');
		assert.equal(products.project.type, 'projects', 'products.project must name the plan module');
		const research = load('collections/rnd/research-docs.collection.yaml').fields;
		assert.equal(research.project.type, 'projects');
		const overlays = fs.readdirSync(path.join(RND, 'collections'), { recursive: true })
			.filter((f) => String(f).endsWith('.collection.yaml'))
			.map((f) => load(path.join('collections', String(f))))
			.filter((d) => d.overlay && d.name === 'projects');
		assert.deepEqual(overlays, [], 'a peer excuses a reference, never a mirror');
		// and the module declares the peer it now leans on
		const pkg = JSON.parse(fs.readFileSync(path.join(RND, 'package.json'), 'utf8'));
		assert.ok(pkg.dreamteamer.peer_collections.includes('projects'),
			'rnd references projects and must peer it');
	});

	test('a prototype carries live_url, iteration and deploy', () => {
		for (const f of ['live_url', 'iteration', 'deploy']) assert.ok(proto.fields[f], f);
		assert.equal(proto.fields.iteration.type, 'number');
	});
});

describe('0.2.0 — design docs, plans, reviews, tests and design systems', () => {
	const fieldsOf = (c) => load(`collections/rnd/${c}.collection.yaml`).fields;
	const exists = (c) => fs.existsSync(path.join(RND, `collections/rnd/${c}.collection.yaml`));
	// Every mirror is declared on the generated side and names an owning field that points back at it.
	const assertMirror = (coll, field, ownerColl, owner) => {
		const f = fieldsOf(coll)[field];
		assert.ok(f, `${coll} has no ${field}`);
		assert.equal(f.type, `rnd/${ownerColl}`); assert.equal(f.many, true); assert.equal(f.mirror_of, owner);
		const o = fieldsOf(ownerColl)[owner];
		assert.ok(o, `rnd/${ownerColl} has no ${owner} for ${coll}.${field} to mirror`);
		const targets = Array.isArray(o.type) ? o.type : [o.type];
		assert.ok(targets.includes(`rnd/${coll}`), `rnd/${ownerColl}.${owner} does not point at rnd/${coll}`);
	};
	test('the design doc collection is rnd/design-docs, stored under data/rnd/design-docs, and the old name is gone', () => {
		assert.ok(!exists('product-design-docs'), 'rnd/product-design-docs came back');
		const d = load('collections/rnd/design-docs.collection.yaml');
		assert.equal(d.name, 'rnd/design-docs');
		assert.equal(d.storage.path, 'data/rnd/design-docs');
	});
	test('every link to a design doc is spelled design_doc, and the design doc lists them back', () => {
		for (const c of ['prototypes', 'screens', 'user-stories']) {
			assert.equal(fieldsOf(c).design_doc?.type, 'rnd/design-docs', `${c}.design_doc`);
			for (const old of ['product_design_doc', 'product-design-doc']) assert.ok(!fieldsOf(c)[old], `${c} still carries ${old}`);
		}
		assertMirror('design-docs', 'prototypes', 'prototypes', 'design_doc');
		assertMirror('design-docs', 'screens', 'screens', 'design_doc');
		assertMirror('design-docs', 'user_stories', 'user-stories', 'design_doc');
		assertMirror('design-docs', 'superseded_by', 'design-docs', 'supersedes');
	});
	test('an implementation plan carries the writing-plans header as fields and points at the spec it implements', () => {
		const p = fieldsOf('implementation-plans');
		for (const f of ['goal', 'architecture', 'tech_stack', 'global_constraints', 'review_focus', 'execution', 'status', 'content']) assert.ok(p[f], f);
		assert.equal(p.spec.type, 'rnd/design-docs');
		assert.deepEqual(p.execution.enum, ['subagent-driven', 'native']);
		assert.equal(p.content.body, true);
		assertMirror('design-docs', 'implementation_plans', 'implementation-plans', 'spec');
	});
	test('a review lists its findings, and a finding lives in its review\'s folder', () => {
		assertMirror('reviews', 'findings', 'review-findings', 'review');
		const rf = load('collections/rnd/review-findings.collection.yaml');
		assert.equal(rf.fields.review.required, true);
		assert.equal(rf.ids.from, '{{ review | basename }}/{{ key }}');
		assert.match('2026-10-29--master-prd-compliance/otp-expiry-unspecified', new RegExp(rf.ids.pattern));
		assert.deepEqual(rf.fields.severity.enum, ['blocker', 'major', 'minor', 'nit']);
		assert.deepEqual(rf.fields.status.enum, ['open', 'accepted', 'fixed', 'wontfix', 'duplicate']);
		for (const f of ['location', 'failure_scenario', 'evidence', 'resolution']) assert.ok(rf.fields[f], f);
		assert.equal(rf.fields.issue.type, 'rnd/issues'); assert.equal(rf.fields.change_request.type, 'rnd/change-requests');
	});
	test('a review or a finding may name any R&D record as its subject, and each of those exists', () => {
		const subj = fieldsOf('reviews').subject.type;
		assert.deepEqual(fieldsOf('review-findings').subject.type, subj, 'a finding narrows within the same set');
		for (const t of ['rnd/design-docs', 'rnd/prototypes', 'rnd/screens', 'rnd/implementation-plans']) assert.ok(subj.includes(t), t);
		for (const t of subj) assert.ok(exists(t.replace(/^rnd\//, '')), `subject ${t} is not a collection here`);
	});
	test('a test names what it proves, and each covered collection lists its tests back', () => {
		assert.deepEqual(fieldsOf('tests').covers.type, ['rnd/user-stories', 'rnd/change-requests', 'rnd/issues', 'rnd/implementation-plans']);
		for (const c of ['user-stories', 'change-requests', 'issues']) assertMirror(c, 'tests', 'tests', 'covers');
		assertMirror('screens', 'tests', 'tests', 'screen');
		assertMirror('products', 'tests', 'tests', 'product');
	});
	test('a design system is a folder, and products and designs name the one they ship under', () => {
		const ds = load('collections/rnd/design-systems.collection.yaml');
		assert.equal(ds.storage.shape, 'folder'); assert.equal(ds.storage.entry, 'index.md');
		assert.equal(ds.fields.tokens.type, 'map');
		for (const c of ['products', 'design-docs']) assert.equal(fieldsOf(c).design_system?.type, 'rnd/design-systems', c);
		assertMirror('design-systems', 'products', 'products', 'design_system');
		assertMirror('design-systems', 'design_docs', 'design-docs', 'design_system');
	});
	test('a product lists its prototypes, change requests and issues', () => {
		assertMirror('products', 'prototypes', 'prototypes', 'product');
		assertMirror('products', 'change_requests', 'change-requests', 'products');
		assertMirror('products', 'issues', 'issues', 'product');
		assertMirror('issues', 'change_requests', 'change-requests', 'issue');
	});
});

describe('the lifecycle stages — one plainly written skill each, to one contract', () => {
	const STAGES = ['rnd-design', 'rnd-prototype', 'rnd-change-request', 'rnd-plan', 'rnd-implement', 'rnd-test', 'rnd-deploy', 'rnd-release'];
	const HEADINGS = ['## What you are doing', '## Before you start', '## Do this', "## Don't", '## Done when'];
	const skill = (id) => fs.readFileSync(path.join(RND, 'skills', id, 'SKILL.md'), 'utf8');
	const shipped = (c) => fs.existsSync(path.join(RND, `collections/${c}.collection.yaml`));
	for (const id of [...STAGES, 'recording-reviews']) {
		test(`${id}: its name is its folder, and the five headings come in order`, () => {
			const text = skill(id);
			const fm = yaml.load(text.match(/^---\n([\s\S]*?)\n---/)[1]);
			assert.equal(fm.name, id);
			const at = HEADINGS.map((h) => text.indexOf(`\n${h}\n`));
			for (let i = 0; i < at.length; i++) assert.ok(at[i] > 0, `${id} lacks "${HEADINGS[i]}"`);
			for (let i = 1; i < at.length; i++) assert.ok(at[i] > at[i - 1], `${id}: "${HEADINGS[i]}" comes before "${HEADINGS[i - 1]}"`);
		});
		test(`${id}: under 120 lines, carries its own procedure, and every rnd collection it names is shipped`, () => {
			const text = skill(id);
			assert.ok(text.split('\n').length <= 120, `${id} is ${text.split('\n').length} lines`);
			assert.doesNotMatch(text, /load superpowers:\S+ and follow/i, 'the bridge is retired: the skill carries the steps');
			for (const c of new Set([...text.matchAll(/\brnd\/([a-z-]+)\b/g)].map((m) => `rnd/${m[1]}`))) assert.ok(shipped(c), `${id} names ${c}, which is not shipped`);
		});
	}
	test('the three bridge skills are gone', () => {
		for (const id of ['writing-design-docs', 'writing-implementation-plans', 'executing-implementation-plans']) assert.ok(!fs.existsSync(path.join(RND, 'skills', id)), `${id} still ships`);
	});
	test('building-from-references hands prototypes to rnd-prototype instead of restating them', () => {
		assert.match(skill('building-from-references'), /rnd-prototype/);
	});
	test('the package ships the skills folder', () => {
		const pkg = JSON.parse(fs.readFileSync(path.join(RND, 'package.json'), 'utf8'));
		assert.ok(pkg.files.includes('skills'));
	});
});

describe('the commands, the bindings and the agent — every entry names a skill, every gate a real field', () => {
	const STAGES = ['rnd/design', 'rnd/review', 'rnd/prototype', 'rnd/change-request', 'rnd/plan', 'rnd/implement', 'rnd/test', 'rnd/deploy', 'rnd/release'];
	const commandsDir = path.join(RND, 'commands');
	const commands = fs.readdirSync(path.join(commandsDir, 'rnd')).filter((f) => f.endsWith('.command.md')).map((f) => `rnd/${f.replace('.command.md', '')}`);
	test('every command lives in the rnd folder — the family is one namespace — and the nine stage commands each name a skill folder that exists', () => {
		assert.deepEqual(fs.readdirSync(commandsDir).filter((f) => f.endsWith('.command.md') && authored('commands', f)), [], 'no authored command outside commands/rnd/ — the composed notebooklm commands keep their own ids');
		assert.equal(commands.length, 12, 'nine stages and the three reference-chain commands');
		for (const c of STAGES) {
			assert.ok(commands.includes(c), `${c} has no command file`);
			const text = fs.readFileSync(path.join(commandsDir, `${c}.command.md`), 'utf8');
			const fm = yaml.load(text.match(/^---\n([\s\S]*?)\n---/)[1]);
			assert.equal(fm.name, c);
			const skill = /load the \`([a-z-]+)\` skill/.exec(text)?.[1];
			assert.ok(skill, `${c} does not say which skill it loads`);
			assert.ok(fs.existsSync(path.join(RND, 'skills', skill, 'SKILL.md')), `${c} loads ${skill}, which is not shipped`);
		}
	});
	const dir = path.join(RND, 'command-bindings');
	const bindings = fs.readdirSync(dir).filter((f) => f.endsWith('.command-binding.yaml') && authored('command-bindings', f)).map((f) => ({ file: f, ...yaml.load(fs.readFileSync(path.join(dir, f), 'utf8')) }));
	test('thirty-one bindings: three on the reference chain, twenty-eight on the lifecycle', () => {
		assert.equal(bindings.length, 31);
		assert.equal(bindings.filter((b) => STAGES.includes(b.command.replace(/^commands\//, ''))).length, 28);
	});
	/** The fields of a collection by its qualified name, or null when it is not an rnd collection. */
	const fieldsByName = (name) => name.startsWith('rnd/') ? load(`collections/${name}.collection.yaml`).fields : null;
	for (const b of bindings) {
		test(`${b.file}: names a real command, and every gate reads a real field — one hop through a reference allowed`, () => {
			const cmd = b.command.replace(/^commands\//, '');
			assert.ok(fs.existsSync(path.join(commandsDir, `${cmd}.command.md`)), `${cmd} has no command file`);
			const coll = b.collection.replace(/^collections\//, '');
			const props = fieldsByName(coll);
			assert.ok(props, `${coll} is not an rnd collection`);
			const terms = (gate) => Object.entries(gate ?? {}).flatMap(([k, v]) => k === '_or' || k === '_and' ? v.flatMap((g) => terms(g)) : [[k, v]]);
			for (const gate of [b.available_when, b.done_when]) for (const [f, cond] of terms(gate)) {
				assert.ok(props[f], `${coll} has no field ${f}`);
				const hop = Object.keys(cond).find((k) => !k.startsWith('_'));
				if (hop) {
					const target = Array.isArray(props[f].type) ? props[f].type[0] : props[f].type;
					const far = fieldsByName(target);
					assert.ok(far && far[hop], `${coll}.${f} → ${target} has no field ${hop}`);
				}
			}
		});
	}
	test('building-from-references documents every command of the reference chain', () => {
		const skill = fs.readFileSync(path.join(RND, 'skills', 'building-from-references', 'SKILL.md'), 'utf8');
		for (const b of bindings) if (!STAGES.includes(b.command.replace(/^commands\//, ''))) assert.match(skill, new RegExp(`/${b.command.replace(/^commands\//, '').replace('/', ':')}`));
	});
	test('qa-manager is a separate reviewer: it loads recording-reviews, may not write files, and the builder agent dispatches it', () => {
		const text = fs.readFileSync(path.join(RND, 'agents', 'qa-manager.agent.md'), 'utf8');
		const fm = yaml.load(text.match(/^---\n([\s\S]*?)\n---/)[1]);
		assert.equal(fm.name, 'qa-manager');
		assert.deepEqual(fm.skills, ['skills/recording-reviews']);
		for (const tool of ['Write', 'Edit']) assert.ok(!fm.tools.includes(tool), `qa-manager must not have ${tool}`);
		assert.match(fs.readFileSync(path.join(RND, 'agents', 'rnd-agent.agent.md'), 'utf8'), /qa-manager/);
		assert.match(fs.readFileSync(path.join(RND, 'commands', 'rnd', 'review.command.md'), 'utf8'), /qa-manager/);
	});
	test('the rnd-agent loads every stage skill, and the package ships agents', () => {
		const text = fs.readFileSync(path.join(RND, 'agents', 'rnd-agent.agent.md'), 'utf8');
		const fm = yaml.load(text.match(/^---\n([\s\S]*?)\n---/)[1]);
		assert.equal(fm.name, 'rnd-agent');
		for (const s of ['rnd-design', 'rnd-prototype', 'rnd-change-request', 'rnd-plan', 'rnd-implement', 'rnd-test', 'rnd-deploy', 'rnd-release', 'recording-reviews']) assert.ok(fm.skills.includes(`skills/${s}`), `rnd-agent does not load ${s}`);
		for (const s of fm.skills) assert.ok(fs.existsSync(path.join(RND, 'skills', s.replace(/^skills\//, ''), 'SKILL.md')), `${s} is not shipped`);
		assert.ok(JSON.parse(fs.readFileSync(path.join(RND, 'package.json'), 'utf8')).files.includes('agents'));
	});
});

describe('the doctor', () => {
	test('an installed rnd module gets an rnd capability that names ffmpeg', async () => {
		const { capabilities } = await import('../../setup/lib/capabilities.mjs');   // the board lives in @dreamteamer/setup
		const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-rnd-'));
		fs.writeFileSync(path.join(ws, 'package.json'), JSON.stringify({ name: 'c', private: true, dependencies: { '@dreamteamer/extensions': '*' }, dreamteamer: {} }));
		fs.writeFileSync(path.join(ws, 'package-lock.json'), '{}');
		fs.mkdirSync(path.join(ws, 'node_modules', '@dreamteamer'), { recursive: true });
		fs.symlinkSync(ROOT, path.join(ws, 'node_modules', '@dreamteamer', 'extensions'), 'dir');
		const caps = capabilities(ws);
		const rnd = caps.find((c) => c.name === 'rnd');
		assert.ok(rnd, `no rnd capability; saw ${caps.map((c) => c.name).join(', ')}`);
		assert.ok(rnd.checks.some((k) => k.label === 'ffmpeg'));
		fs.rmSync(ws, { recursive: true, force: true });
	});
});

describe('0.3.0 — the lifecycle fields', () => {
	const cr = load('collections/rnd/change-requests.collection.yaml');
	const plan = load('collections/rnd/implementation-plans.collection.yaml');
	const tests = load('collections/rnd/tests.collection.yaml');
	const dd = load('collections/rnd/design-docs.collection.yaml');
	test('a change request names the designs it rests on, and the design doc lists its change requests back', () => {
		assert.equal(cr.fields.design_docs.type, 'rnd/design-docs'); assert.equal(cr.fields.design_docs.many, true);
		assert.equal(dd.fields.change_requests.type, 'rnd/change-requests'); assert.equal(dd.fields.change_requests.mirror_of, 'design_docs');
	});
	test('a plan may be written for a change request, which lists its plans back', () => {
		assert.equal(plan.fields.change_request.type, 'rnd/change-requests');
		assert.equal(cr.fields.implementation_plans.type, 'rnd/implementation-plans'); assert.equal(cr.fields.implementation_plans.mirror_of, 'change_request');
	});
	test('a review may name the person whose verdict closes it', () => {
		assert.equal(load('collections/rnd/reviews.collection.yaml').fields.human_reviewer.type, 'string');
		assert.match(fs.readFileSync(path.join(RND, 'agents', 'rnd-agent.agent.md'), 'utf8'), /human_reviewer/);
	});
	test('the stages leave their marks as fields: acceptance, verification and deployment on the change request, verification on the plan', () => {
		for (const f of ['accepted_on', 'verified_on', 'deployed_on']) assert.equal(cr.fields[f].type, 'datetime');
		assert.equal(cr.fields.accepted_by.type, 'string');
		assert.equal(plan.fields.verified_on.type, 'datetime');
	});
	test('the gates read those marks in order: deploy needs verified_on, test needs an approved code review, plan needs an active design', () => {
		const b = (f) => yaml.load(fs.readFileSync(path.join(RND, 'command-bindings', f), 'utf8'));
		assert.deepEqual(b('rnd--deploy--change-requests.command-binding.yaml').available_when.verified_on, { _nempty: true });
		assert.deepEqual(b('rnd--test--change-requests.command-binding.yaml').available_when.implementation_plans, { code_approved_on: { _nempty: true } });
		assert.deepEqual(b('rnd--plan--change-requests.command-binding.yaml').available_when.design_docs, { status: { _eq: 'active' } }, 'a request is planned against its active design — none is no longer enough (0.5.2: one next verb)');
		for (const f of fs.readdirSync(path.join(RND, 'command-bindings'))) if (authored('command-bindings', f) && !/prototype--prototypes|--products|ingest-reference|releases--stamp/.test(f)) assert.ok(b(f).done_when, `${f} has no done_when — the agent could loop on it`);
	});
	test('a defect takes the quick path: a plan may fix an issue, which lists its plans back', () => {
		assert.equal(plan.fields.issue.type, 'rnd/issues');
		assert.equal(load('collections/rnd/issues.collection.yaml').fields.implementation_plans.mirror_of, 'issue');
	});
	test('a test may be held out from the builder, a review counts its round, a design doc is a draft by default', () => {
		assert.deepEqual(tests.fields.visibility.enum, ['visible', 'held-out']);
		assert.equal(load('collections/rnd/reviews.collection.yaml').fields.round.default, 1);
		assert.equal(dd.fields.status.default, 'draft');
	});
	test('a test may cover a plan — a held-out test belongs to the plan it was written against', () => {
		assert.ok(tests.fields.covers.type.includes('rnd/implementation-plans'));
		assert.equal(plan.fields.tests.type, 'rnd/tests'); assert.equal(plan.fields.tests.mirror_of, 'covers');
	});
});

describe('0.3.0 — one persona collection', () => {
	const personas = load('collections/rnd/personas.collection.yaml');
	const f = personas.fields;
	test('personas carries kind: panel | product-role — required, with no default', () => {
		assert.equal(f.kind.type, 'string');
		assert.equal(f.kind.required, true);
		assert.deepEqual(f.kind.enum, ['panel', 'product-role']);
		assert.equal(f.kind.default, undefined, 'a record must say which shape it is');
	});
	test('the evidence rules bind a panel only, through constraints; a role must name its products', () => {
		assert.ok(!f.segment_rule.required, 'segment_rule is required of a panel, not of the field');
		assert.ok(!f.members.required, 'members is required of a panel, not of the field');
		assert.ok(!f.products.required, 'products is required of a role, not of the field');
		const byKind = Object.fromEntries(personas.constraints.map((c) => [c.if.properties.kind.const, c.then.required]));
		assert.deepEqual(byKind.panel, ['segment_rule', 'members']);
		assert.deepEqual(byKind['product-role'], ['products']);
		for (const c of personas.constraints) assert.deepEqual(c.if.required, ['kind'], 'a constraint fires only when kind is present');
	});
	test('the role fields moved onto personas, and the id comes from key when set', () => {
		assert.equal(f.key.type, 'string'); assert.match(f.key.pattern, /^\^/);
		assert.equal(f.products.type, 'rnd/products'); assert.equal(f.products.many, true);
		for (const k of ['goals', 'permissions', 'restrictions']) { assert.equal(f[k].type, 'string'); assert.equal(f[k].many, true); }
		assert.deepEqual(f.evidence_status.enum, ['source-backed', 'proposed']); assert.equal(f.evidence_status.default, 'proposed');
		assert.deepEqual(personas.ids.from, ['{{ key }}', '{{ name | slug }}']);
	});
	test('persona-probes and product-user-personas are gone', () => {
		for (const c of ['persona-probes', 'product-user-personas']) assert.ok(!fs.existsSync(path.join(RND, `collections/rnd/${c}.collection.yaml`)), `${c} came back`);
		const authoredText = fs.readdirSync(path.join(RND, 'collections', 'rnd')).map((x) => fs.readFileSync(path.join(RND, 'collections', 'rnd', x), 'utf8')).join('\n');
		assert.ok(!/product-user-personas|persona-probes/.test(authoredText), 'no descriptor still names a dropped collection');
	});
	test('user stories and journeys point their personas at rnd/personas, and personas lists them back', () => {
		const stories = load('collections/rnd/user-stories.collection.yaml').fields;
		const journeys = load('collections/rnd/user-journeys.collection.yaml').fields;
		assert.equal(stories.personas.type, 'rnd/personas'); assert.equal(stories.personas.many, true);
		assert.equal(journeys.personas.type, 'rnd/personas'); assert.equal(journeys.personas.many, true);
		assert.equal(f.user_stories.type, 'rnd/user-stories'); assert.equal(f.user_stories.mirror_of, 'personas');
		assert.equal(f.journeys.type, 'rnd/user-journeys'); assert.equal(f.journeys.mirror_of, 'personas');
	});
	test('the migration script ships in bin/ and the list view shows the kind', () => {
		assert.ok(fs.existsSync(path.join(RND, 'bin', 'migrate-personas.mjs')));
		assert.ok(personas.display.list.columns.includes('kind'));
	});
});

describe('change requests (0.5.1) — three sizes the descriptor spells out, and a list that reads newest first', () => {
	const cr = load('collections/rnd/change-requests.collection.yaml');
	test('name is a few words, description one line, the detail the body — each field description says so', () => {
		assert.match(cr.fields.name.description, /handful of words/i);
		assert.match(cr.fields.name.description, /never a sentence/i);
		assert.ok(cr.fields.name.examples?.length, 'name carries an example of the short form');
		assert.match(cr.fields.description.description, /one line/i);
		assert.match(cr.fields.content.description, /longer than one line/i);
		assert.match(cr.fields.acceptance.description, /repeat `--acceptance`/i, 'the comma-split trap is named where the writer reads');
	});
	test('the default list shows created, status, name, products — newest first (and, from 0.6.0, release)', () => {
		assert.deepEqual(cr.display.list.columns, ['created', 'status', 'name', 'products', 'release']);
		assert.equal(cr.display.list.sort, '-created');
	});
	test('the skill, the README and UPDATING.md carry the same rule', () => {
		const skill = fs.readFileSync(path.join(RND, 'skills/rnd-change-request/SKILL.md'), 'utf8');
		assert.match(skill, /`name` is a handful of words/);
		assert.match(skill, /Repeat `--acceptance` per entry/);
		const updating = fs.readFileSync(path.join(RND, 'UPDATING.md'), 'utf8');
		assert.match(updating, /## 0\.5\.1/);
		assert.match(updating, /short descriptive name/i);
		assert.ok(JSON.parse(fs.readFileSync(path.join(RND, 'package.json'), 'utf8')).files.includes('UPDATING.md'), 'UPDATING.md ships');
	});
});

describe('the review-gate experiment — a paired unattended run on a five-line change request, each ruling pinned', () => {
	const read = (rel) => fs.readFileSync(path.join(RND, rel), 'utf8');
	const skill = (id) => read(`skills/${id}/SKILL.md`);
	const agent = (id) => read(`agents/${id}.agent.md`);
	const binding = (f) => yaml.load(read(`command-bindings/${f}.command-binding.yaml`));
	const fieldsOf = (c) => load(`collections/rnd/${c}.collection.yaml`).fields;
	const RND_SKILLS = fs.readdirSync(path.join(RND, 'skills')).filter((d) => d.startsWith('rnd-') || d === 'recording-reviews');
	test('1. a many-valued reference is listed with _contains — no rnd skill filters covers by equality', () => {
		for (const id of RND_SKILLS) assert.doesNotMatch(skill(id), /--filter covers=/, `${id} filters covers by equality, which misses a test with several covers`);
		for (const id of ['rnd-test', 'rnd-implement']) assert.match(skill(id), /--where '\{"covers":\{"_contains":"rnd\//, `${id} lists tests by covers without _contains`);
		assert.match(fieldsOf('tests').covers.description, /_contains/);
	});
	test('2. held-out tests are the reviewer\'s: the plan names the classes, the plan review writes the records, the builder never reads them', () => {
		assert.match(skill('rnd-plan'), /## Held-out/);
		assert.match(skill('rnd-plan'), /review of the plan writes the `--visibility held-out` records/);
		assert.match(skill('rnd-plan'), /Don't write a `held-out` test/);
		assert.match(agent('qa-manager'), /`--visibility held-out`/);
		assert.match(agent('qa-manager'), /## Held-out/);
		assert.match(agent('rnd-agent'), /that review writes the plan's `held-out` tests/);
		assert.match(skill('rnd-implement'), /A `held-out` test is not yours to read or run/);
		assert.match(skill('recording-reviews'), /writes the plan's held-out tests/);
	});
	test('3. review_focus is the reviewer\'s probe list, not a promise of one test per line', () => {
		const rf = fieldsOf('implementation-plans').review_focus.description;
		assert.match(rf, /reviewer should probe/);
		assert.doesNotMatch(rf, /pinned by a test/);
		assert.doesNotMatch(skill('rnd-plan'), /a review-focus line/, 'rnd-plan still asks for a test per review-focus line');
	});
	test('4. the reviewer owns the review end to end; the builder answers findings and asks for the next round', () => {
		const rr = skill('recording-reviews');
		assert.match(rr, /Close it — the reviewer, never the builder/);
		assert.match(rr, /you never set `verdict` or `status` on the review/);
		assert.match(rr, /don't close one as the builder/);
		assert.doesNotMatch(rr, /Don't close a review while a finding is `open`\.\n/, 'the bare rule left who closes unsaid');
		assert.match(agent('qa-manager'), /The builder never sets a verdict or closes a review/);
		assert.match(agent('rnd-agent'), /you never set its `verdict` or close it/);
		assert.match(agent('rnd-agent'), /`fixed` or `wontfix`, with a `resolution`/);
	});
	test('5. a review of a change request\'s acceptance lines has its own kind, named by the skill, the command and the binding', () => {
		assert.ok(fieldsOf('reviews').kind.enum.includes('acceptance'));
		assert.match(skill('rnd-change-request'), /kind `acceptance`/);
		assert.match(skill('recording-reviews'), /kind `acceptance`/);
		assert.match(binding('rnd--review--change-requests').description, /acceptance/);
		assert.match(read('commands/rnd/review.command.md'), /--kind design\|acceptance\|/);
		assert.match(read('commands/rnd/change-request.command.md'), /kind `acceptance`/);
	});
	test('6. no asker, no rewrite: the acceptance lines stand, a gap is a question or a proposed line, ambiguity reads narrowest', () => {
		const dont = skill('rnd-change-request').split("## Don't")[1].split('## Done when')[0];
		assert.match(dont, /Don't edit the acceptance lines/);
		assert.match(dont, /PROPOSED line/);
		assert.match(dont, /narrowest reading/);
		assert.match(dont, /No asker, no rewrite/);
	});
	test('7. an active design doc changes by an appended dated ## Revisions entry, never in place', () => {
		const d = skill('rnd-design');
		assert.match(d, /Don't rewrite an `active` doc in place/);
		assert.match(d, /## Revisions/);
		assert.match(d, /next gate's review covers that entry/);
	});
	test('8. a stop on a second changes-requested is first an open question of kind needs-decision that blocks the subject', () => {
		for (const text of [agent('rnd-agent'), skill('recording-reviews')]) {
			assert.match(text, /`rnd\/open-questions` record of kind `needs-decision`/);
			assert.match(text, /`blocks` names the (reviewed record|subject)/);
			assert.match(text, /both reviews/);
		}
		assert.ok(fieldsOf('open-questions').kind.enum.includes('needs-decision'));
		assert.ok(fieldsOf('open-questions').blocks, 'open-questions has no blocks field');
	});
	test('9. verified_on is stamped on one record — the change request when the plan has one, else the plan — and the gates agree', () => {
		assert.match(skill('rnd-test'), /stamp ONE record/);
		assert.match(skill('rnd-test'), /never both/);
		assert.match(agent('rnd-agent'), /`verified_on` on that one record/);
		assert.match(agent('qa-manager'), /the change request when the plan has one, else the plan, never both/);
		assert.match(skill('recording-reviews'), /`verified_on=<now>` on ONE record/);
		assert.match(fieldsOf('implementation-plans').verified_on.description, /never on both/);
		// 0.5.2: the stage stamps tested_on on the one record; the test REVIEW's approve stamps verified_on
		const plan = binding('rnd--test--implementation-plans');
		assert.deepEqual(plan.available_when.change_request, { _empty: true }, 'a plan with a change request must not offer /rnd:test on the plan');
		assert.deepEqual(plan.done_when, { tested_on: { _nempty: true } });
		assert.deepEqual(binding('rnd--review--implementation-plans--test').done_when, { verified_on: { _nempty: true } });
		const cr = binding('rnd--test--change-requests');
		assert.deepEqual(cr.done_when, { tested_on: { _nempty: true } });
		assert.deepEqual(binding('rnd--review--change-requests--test').done_when, { verified_on: { _nempty: true } });
	});
	test('10. dt next lists every eligible command; the walk follows the lifecycle order and takes prototype and draft-prd only on request', () => {
		const a = agent('rnd-agent');
		assert.match(a, /lists every command the record is eligible for, not the one to run next/);
		assert.match(a, /`\/rnd:prototype` and `\/rnd:draft-prd` are taken only when the design doc asks for them/);
	});
	test('13. a finding is graded within the ask: major or blocker names the line it breaks, outside the ask is minor with a proposed line', () => {
		for (const text of [agent('qa-manager'), skill('recording-reviews')]) {
			assert.match(text, /names the acceptance line or story it breaks/);
			assert.match(text, /`minor` at most and carries a proposed acceptance line/);
		}
		assert.match(agent('qa-manager'), /Judge by effect, within the ask/);
		assert.match(agent('rnd-agent'), /a second `changes-requested`, a `blocker`, or a review that names a `human_reviewer` stops you/, 'the two-changes-requested breaker is unchanged');
	});
	test('the README carries the experiment\'s one-line summary in the 0.3.0 note and the scoping in the lifecycle paragraph', () => {
		const readme = read('README.md');
		assert.match(readme, /A paired experiment[\s\S]*stopped delivery on a tiny ask in\none unattended run/);
		assert.match(readme, /needs-decision/);
		assert.match(readme, /graded by its effect within the ask/);
	});
});

// 0.5.2 — A REVIEW AFTER EVERY STAGE. The walk itself — `dt next` naming exactly one verb at every stage, on a
// real engine — is test/review-gates.test.mjs; this pins the shape it rests on, so a descriptor edit that breaks
// the shape fails here by name.
describe('0.5.2 — a review after every stage, every review listed on its records', () => {
	const read = (rel) => fs.readFileSync(path.join(RND, rel), 'utf8');
	const desc = (c) => load(`collections/rnd/${c}.collection.yaml`);
	const fieldsOf = (c) => desc(c).fields;
	const binding = (f) => yaml.load(read(`command-bindings/${f}.command-binding.yaml`));
	test('a review names the change request it belongs to, and the request lists every one — mirror_of change_request', () => {
		assert.equal(fieldsOf('reviews').change_request.type, 'rnd/change-requests');
		const r = fieldsOf('change-requests').reviews;
		assert.equal(r.type, 'rnd/reviews'); assert.equal(r.many, true); assert.equal(r.mirror_of, 'change_request');
		assert.match(r.description, /^GENERATED/);
	});
	test('design docs, plans, tests, issues and features list theirs by subject', () => {
		const subj = fieldsOf('reviews').subject.type;
		for (const c of ['design-docs', 'implementation-plans', 'tests', 'issues', 'features']) {
			const r = fieldsOf(c).reviews;
			assert.ok(r, `${c} has no reviews mirror`);
			assert.equal(r.type, 'rnd/reviews'); assert.equal(r.many, true); assert.equal(r.mirror_of, 'subject', c);
			assert.ok(subj.includes(`rnd/${c}`), `rnd/reviews.subject cannot name rnd/${c}`);
		}
	});
	test('each mirror sits beside the plans and tests mirrors, where a record page draws them', () => {
		const at = (c, f) => Object.keys(fieldsOf(c)).indexOf(f);
		assert.equal(at('change-requests', 'reviews'), at('change-requests', 'implementation_plans') + 1);
		assert.equal(at('implementation-plans', 'reviews'), at('implementation-plans', 'tests') + 1);
	});
	test('the reviewer sets change_request on EVERY review of a lifecycle, the request itself included — skill, agent, command', () => {
		assert.match(read('skills/recording-reviews/SKILL.md'), /`change_request` goes on EVERY review in a request's lifecycle, whatever the subject — the request itself included/);
		assert.match(read('skills/recording-reviews/SKILL.md'), /--change_request rnd\/change-requests\/<id>/);
		assert.match(read('agents/qa-manager.agent.md'), /carries `change_request`, whatever its subject/);
		assert.match(read('commands/rnd/review.command.md'), /set `change_request` on the review whatever its subject/);
	});
	test('the stages stamp their marks as datetimes: tested_on by the test stage; code_approved_on and verified_on by the reviewer', () => {
		assert.equal(fieldsOf('change-requests').tested_on.type, 'datetime');
		for (const f of ['code_approved_on', 'tested_on', 'verified_on']) assert.equal(fieldsOf('implementation-plans')[f].type, 'datetime', f);
		assert.match(fieldsOf('change-requests').verified_on.description, /stamped by that reviewer/);
		assert.match(read('skills/recording-reviews/SKILL.md'), /A code review: `code_approved_on=<now>` on the plan/);
		assert.match(read('skills/rnd-test/SKILL.md'), /Don't review your own run, and don't stamp `verified_on`/);
	});
	test('after IMPLEMENT: a code review is bound to a done plan, done only by the stamp AND a code review AND an approve on the plan', () => {
		const b = binding('rnd--review--implementation-plans--code');
		assert.equal(b.command, 'commands/rnd/review');
		assert.deepEqual(b.available_when, { status: { _eq: 'done' } });
		assert.deepEqual(b.done_when.code_approved_on, { _nempty: true }, 'the stamp: a two-key condition on a many-valued reference matches across two reviews');
		assert.deepEqual(b.done_when.reviews, { kind: { _eq: 'code' } });
		assert.deepEqual(b.done_when._and, [{ reviews: { verdict: { _eq: 'approve' } } }]);
		assert.match(b.description, /kind code/); assert.match(b.description, /change_ref/);
	});
	test('after TEST and after DEPLOY: the test review needs tested_on and stamps verified_on; the live acceptance review sets implemented', () => {
		const t = binding('rnd--review--change-requests--test');
		assert.deepEqual(t.available_when.tested_on, { _nempty: true }); assert.deepEqual(t.available_when.verified_on, { _empty: true });
		assert.match(t.description, /kind test/);
		const d = binding('rnd--review--change-requests--deploy');
		// r1-05: a rejected request with deployed_on is offered nothing; 0.6.0: a request in a release waits for its publication
		assert.deepEqual(d.available_when, { deployed_on: { _nempty: true }, status: { _eq: 'accepted' }, _or: [{ release: { _empty: true } }, { release: { status: { _eq: 'published' } } }] });
		assert.deepEqual(d.done_when, { status: { _eq: 'implemented' } });
		assert.match(d.description, /kind acceptance/);
		assert.doesNotMatch(read('skills/rnd-deploy/SKILL.md'), /deployed_on=<now> status=implemented/, 'the deploy stage no longer sets implemented — the live review does');
		assert.doesNotMatch(read('commands/rnd/deploy.command.md'), /`status: implemented`/);
	});
	test('the rnd-agent never gives a review: it hands each to the qa-manager, and stops at one it cannot hand over', () => {
		const a = read('agents/rnd-agent.agent.md');
		assert.match(a, /Reviews are never yours to give/);
		assert.match(a, /You stop at each review you cannot hand over: without an Agent tool you stop/);
		assert.match(a, /names exactly one available verb at every stage/);
		assert.doesNotMatch(a, /load `recording-reviews` and review as a separate pass/, 'the self-review fallback is gone');
	});
	test('the stage map is declared on the change request: five stages in order, each gate a real binding, every lifecycle binding drawn once', () => {
		const cr = desc('change-requests');
		const stages = cr.display.record.options.stages;
		assert.equal(cr.fields[cr.display.record.options.stage_reviews]?.mirror_of, 'change_request', 'the stages pick from the request\'s reviews mirror');
		assert.deepEqual(stages.map((s) => s.title), ['design', 'plan', 'implement', 'test', 'deploy']);
		const kinds = fieldsOf('reviews').kind.enum;
		const drawn = [];
		for (const s of stages) {
			for (const f of s.fields) assert.ok(cr.fields[f], `stage ${s.title}: no field ${f}`);
			for (const m of s.reviews) {
				assert.deepEqual(Object.keys(m).filter((k) => !['kind', 'subject', 'before', 'since'].includes(k)), [], `stage ${s.title}: unknown matcher key`);
				if (m.subject && m.subject !== 'self') assert.ok(cr.fields[m.subject], `stage ${s.title}: subject ${m.subject}`);
				for (const k of ['before', 'since']) if (m[k]) assert.equal(cr.fields[m[k]]?.type, 'datetime', `stage ${s.title}: ${k} ${m[k]}`);
				for (const k of m.kind ?? []) assert.ok(kinds.includes(k), `stage ${s.title}: kind ${k}`);
			}
			for (const g of s.gate) {
				const b = binding(g);
				assert.equal(b.collection, 'collections/rnd/change-requests', `${g} is not bound to change requests`);
				drawn.push(g);
			}
		}
		const lifecycle = fs.readdirSync(path.join(RND, 'command-bindings')).filter((f) => f.endsWith('--change-requests.command-binding.yaml') || /--change-requests--[a-z]+\.command-binding\.yaml$/.test(f)).map((f) => f.replace('.command-binding.yaml', ''));
		assert.deepEqual([...drawn].sort(), [...lifecycle].sort(), 'every binding on a change request is one stage gate, drawn once');
		assert.equal(new Set(drawn).size, drawn.length);
	});
	test('released as 0.5.2, with UPDATING.md and the README release note', () => {
		assert.match(read('UPDATING.md'), /## 0\.5\.2 — /);
		assert.match(read('README.md'), /## 0\.5\.2 — from 0\.5\.1/);
	});
});

// 0.6.0 — RELEASES. The walk — one release per product and version, one `dt next` verb per release state, a
// request deployed by its release's publication — is test/releases.test.mjs on a real engine; this pins the
// shape it rests on, so a descriptor, binding or wording edit that breaks it fails here by name.
describe('0.6.0 — releases: a product\'s versions, each listing what it ships', () => {
	const read = (rel) => fs.readFileSync(path.join(RND, rel), 'utf8');
	const desc = (c) => load(`collections/rnd/${c}.collection.yaml`);
	const binding = (f) => yaml.load(read(`command-bindings/${f}.command-binding.yaml`));
	test('rnd/releases: product, version, repo, tag, status, cut_on, published_on, published_to, the notes body, and the two mirrors', () => {
		const r = desc('releases');
		const f = r.fields;
		assert.equal(r.name, 'rnd/releases');
		assert.equal(f.product.type, 'rnd/products'); assert.equal(f.product.required, true);
		assert.equal(f.version.required, true); assert.ok(new RegExp(f.version.pattern).test('0.6.0') && !new RegExp(f.version.pattern).test('v0.6.0'), 'semver, no leading v');
		assert.equal(f.repo.type, 'repos');
		assert.equal(f.tag.type, 'string');
		assert.deepEqual(f.status.enum, ['planned', 'cut', 'published', 'rolled-back']); assert.equal(f.status.default, 'planned');
		for (const d of ['cut_on', 'published_on']) assert.equal(f[d].type, 'datetime', d);
		assert.equal(f.published_to.many, true);
		assert.equal(f.notes.type, 'markdown'); assert.equal(f.notes.body, true);
		for (const [m, c] of [['change_requests', 'rnd/change-requests'], ['issues', 'rnd/issues']]) {
			assert.equal(f[m].type, c); assert.equal(f[m].many, true); assert.equal(f[m].mirror_of, 'release'); assert.match(f[m].description, /^GENERATED/);
		}
	});
	test('the id is <product>/<version>, or <product>/<package>/<version> for a product that ships several packages', () => {
		const r = desc('releases');
		assert.deepEqual(r.ids.from, ['{{ product | basename }}/{{ package }}/{{ version }}', '{{ product | basename }}/{{ version }}']);
		const re = new RegExp(r.ids.pattern);
		for (const ok of ['grantee-portal/1.4.0', 'northwind-modules/roster/0.5.2', 'grantee-portal/1.0.0-beta.1']) assert.ok(re.test(ok), ok);
		for (const bad of ['grantee-portal/v1.4.0', '1.4.0', 'a/b/c/1.4.0']) assert.ok(!re.test(bad), bad);
	});
	test('a step\'s marks are required by the step: the cut by repo, tag and cut_on; the publication by published_on and published_to', () => {
		const [cut, pub] = desc('releases').constraints;
		assert.deepEqual(cut.if.properties.status.enum, ['cut', 'published', 'rolled-back']); assert.deepEqual(cut.then.required, ['repo', 'tag', 'cut_on']);
		assert.equal(pub.if.properties.status.const, 'published'); assert.deepEqual(pub.then.required, ['published_on', 'published_to']);
	});
	test('a change request and an issue name their release; the product lists its releases, newest first by the releases list', () => {
		assert.equal(desc('change-requests').fields.release.type, 'rnd/releases');
		assert.equal(desc('issues').fields.release.type, 'rnd/releases');
		const m = desc('products').fields.releases;
		assert.equal(m.type, 'rnd/releases'); assert.equal(m.many, true); assert.equal(m.mirror_of, 'product');
		assert.equal(desc('releases').display.list.sort, '-created', 'a product page embeds the releases list in its own order');
	});
	test('the change-request list shows release; a release lists what it ships', () => {
		assert.ok(desc('change-requests').display.list.columns.includes('release'));
		const cols = desc('releases').display.list.columns;
		for (const c of ['version', 'product', 'status']) assert.ok(cols.includes(c), c);
	});
	test('/rnd:release: one verb per release state — plan, a person\'s cut, publish — each done by its own mark', () => {
		const plan = binding('rnd--release--releases--plan');
		const cut = binding('rnd--release--releases--cut');
		const pub = binding('rnd--release--releases--publish');
		for (const b of [plan, cut, pub]) { assert.equal(b.command, 'commands/rnd/release'); assert.equal(b.collection, 'collections/rnd/releases'); }
		assert.deepEqual(plan.available_when, { status: { _eq: 'planned' }, notes: { _empty: true } }); assert.deepEqual(plan.done_when, { notes: { _nempty: true } });
		assert.deepEqual(cut.available_when, { status: { _eq: 'planned' }, notes: { _nempty: true } }); assert.deepEqual(cut.done_when, { cut_on: { _nempty: true } });
		assert.match(cut.description, /a person's/); assert.match(cut.description, /never tags/);
		assert.deepEqual(pub.available_when, { status: { _eq: 'cut' } }); assert.deepEqual(pub.done_when, { published_on: { _nempty: true } });
		assert.match(pub.description, /deployed_on/);
	});
	test('a published release with a carried request unstamped answers the stamp step — the publication\'s last half, resumable (r1-04)', () => {
		const st = binding('rnd--release--releases--stamp');
		assert.equal(st.command, 'commands/rnd/release');
		assert.deepEqual(st.available_when, { status: { _eq: 'published' }, change_requests: { deployed_on: { _empty: true } } });
		assert.equal(st.done_when, undefined, 'no done_when: "every carried request stamped" is a negation the grammar cannot say; the binding stops being available');
		assert.match(read('commands/rnd/release.command.md'), /names the stamp step: only that last half/);
		assert.match(read('skills/rnd-release/SKILL.md'), /a step of its own when it is resumed/);
	});
	test('re-versioning a planned release is two writes in order — set version, then rename — said in the skill, the descriptor and UPDATING (r1-02)', () => {
		assert.match(read('skills/rnd-release/SKILL.md'), /`dt set rnd\/releases\/<id> version=<new>`, then `dt rename rnd\/releases\/<id> <product>\/<new>`/);
		assert.match(desc('releases').fields.version.description, /then `dt rename`/);
		assert.match(read('UPDATING.md'), /`dt set rnd\/releases\/<id> version=<new>`, then `dt rename rnd\/releases\/<id>/);
		assert.doesNotMatch(read('skills/rnd-release/SKILL.md'), /`dt rename` it\./, 'rename alone leaves version behind');
	});
	test('a request\'s deploy stage: /rnd:deploy without a release, /rnd:release with one — never both — and the stage map draws both', () => {
		const dep = binding('rnd--deploy--change-requests');
		const rel = binding('rnd--release--change-requests');
		assert.deepEqual(dep.available_when.release, { _empty: true });
		assert.deepEqual(rel.available_when, { status: { _eq: 'accepted' }, verified_on: { _nempty: true }, deployed_on: { _empty: true }, release: { _nempty: true } });
		assert.deepEqual(rel.done_when, dep.done_when);
		const deploy = desc('change-requests').display.record.options.stages.find((s) => s.title === 'deploy');
		assert.deepEqual(deploy.fields, ['release', 'deployed_on']);
		assert.deepEqual(deploy.gate, ['rnd--deploy--change-requests', 'rnd--release--change-requests', 'rnd--review--change-requests--deploy']);
	});
	test('the skill: the cut stops for a person, the publication stamps deployed_on on every request it carries', () => {
		const s = read('skills/rnd-release/SKILL.md');
		assert.match(s, /Tagging is publishing/);
		assert.match(s, /an agent never tags or pushes/);
		assert.match(s, /dt set rnd\/change-requests\/<cr> deployed_on=<published_on>/);
		assert.match(s, /npm view <package>@<version> version/);
		assert.match(read('commands/rnd/release.command.md'), /load the `rnd-release` skill/);
	});
	test('the rnd-agent stops at a release\'s cut, and never tags, pushes or publishes', () => {
		const a = read('agents/rnd-agent.agent.md');
		assert.match(a, /stop at its cut/);
		assert.match(a, /never tag, push or publish/);
	});
	test('dt check reads releases through rnd\'s own extension, which wraps the composed notebooklm entry', async () => {
		const pkg = JSON.parse(read('package.json'));
		assert.equal(pkg.dreamteamer.extension, './lib/extension.mjs');
		assert.equal(JSON.parse(read('compose.json')).extension, './lib/extension.mjs', 'named in compose.json, the shape core uses too');
		assert.match(read('lib/extension.mjs'), /from '\.\.\/src\/extension\.js'/);
		const { expectedId, releaseViolations } = await import('../lib/releases.mjs');
		assert.equal(expectedId({ product: 'rnd/products/grantee-portal', version: '1.4.0' }), 'grantee-portal/1.4.0');
		assert.equal(expectedId({ product: 'rnd/products/northwind-modules', package: 'roster', version: '0.5.2' }), 'northwind-modules/roster/0.5.2');
		const row = (id, version) => ({ id, file: `${id}.release.md`, fields: { product: 'rnd/products/grantee-portal', version } });
		assert.deepEqual(releaseViolations([row('grantee-portal/1.4.0', '1.4.0'), row('grantee-portal/1.5.0', '1.5.0')]), []);
		const v = releaseViolations([row('grantee-portal/1.4.0', '1.4.0'), row('grantee-portal/1.4.1', '1.4.0')]);
		assert.equal(v.filter((x) => /a second release of grantee-portal\/1\.4\.0/.test(x.message)).length, 2, 'both claimants are named');
		assert.equal(v.filter((x) => /names grantee-portal\/1\.4\.0 in its fields/.test(x.message)).length, 1);
	});
	test('released as 0.6.0, with UPDATING.md and the README release note', () => {
		assert.equal(JSON.parse(read('package.json')).version, '0.6.0');
		assert.match(read('UPDATING.md'), /## 0\.6\.0 — /);
		assert.match(read('README.md'), /## 0\.6\.0 — from 0\.5\.2/);
	});
});
