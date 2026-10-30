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

describe('the superpowers bridge — one skill per hand-off, each naming the records it writes', () => {
	const skill = (id) => fs.readFileSync(path.join(RND, 'skills', id, 'SKILL.md'), 'utf8');
	const bridges = {
		'writing-design-docs': { pairs: ['superpowers:brainstorming'], writes: ['rnd/design-docs', 'rnd/user-stories', 'rnd/open-questions'] },
		'writing-implementation-plans': { pairs: ['superpowers:writing-plans'], writes: ['rnd/implementation-plans', 'rnd/tests'] },
		'executing-implementation-plans': { pairs: ['superpowers:executing-plans', 'superpowers:subagent-driven-development'], writes: ['rnd/implementation-plans', 'rnd/tests', 'rnd/issues'] },
		'recording-reviews': { pairs: ['superpowers:requesting-code-review', 'superpowers:receiving-code-review'], writes: ['rnd/reviews', 'rnd/review-findings'] },
	};
	for (const [id, { pairs, writes }] of Object.entries(bridges)) {
		test(`${id}: its name is its folder, and its description names the superpowers skill it pairs with`, () => {
			const text = skill(id);
			const fm = yaml.load(text.match(/^---\n([\s\S]*?)\n---/)[1]);
			assert.equal(fm.name, id);
			for (const p of pairs) assert.ok(fm.description.includes(p), `${id} description does not name ${p}`);
		});
		test(`${id}: every collection it says it writes is a collection here`, () => {
			const text = skill(id);
			for (const c of writes) {
				assert.ok(text.includes(c), `${id} does not mention ${c}`);
				assert.ok(fs.existsSync(path.join(RND, `collections/${c}.collection.yaml`)), `${c} is not shipped`);
			}
		});
	}
	test('each bridge overrides the file location the superpowers skill would use', () => {
		for (const id of ['writing-design-docs', 'writing-implementation-plans']) assert.match(skill(id), /never a (markdown )?file under docs\//);
	});
	test('the package ships the skills folder', () => {
		const pkg = JSON.parse(fs.readFileSync(path.join(RND, 'package.json'), 'utf8'));
		assert.ok(pkg.files.includes('skills'));
	});
});

describe('the bindings name real commands and real fields', () => {
	const dir = path.join(RND, 'command-bindings');
	const bindings = fs.readdirSync(dir).filter((f) => f.endsWith('.command-binding.yaml')).map((f) => yaml.load(fs.readFileSync(path.join(dir, f), 'utf8')));
	test('six bindings, one per hop', () => { assert.equal(bindings.length, 6); });
	for (const b of bindings) {
		test(`${b.command} → ${b.collection}`, () => {
			const cmd = b.command.replace(/^commands\//, '');
			assert.ok(fs.existsSync(path.join(RND, 'commands', `${cmd}.command.md`)), `${cmd} has no command file`);
			const coll = b.collection.replace(/^collections\/rnd\//, '');
			const props = load(`collections/rnd/${coll}.collection.yaml`).fields;
			for (const pred of [b['can-enter'], b['can-exit']]) for (const f of Object.keys(pred ?? {})) assert.ok(props[f], `${coll} has no field ${f} for ${cmd}`);
		});
	}
	test('the skill documents every command it is the mechanics behind', () => {
		const skill = fs.readFileSync(path.join(RND, 'skills', 'building-from-references', 'SKILL.md'), 'utf8');
		for (const b of bindings) assert.match(skill, new RegExp(`/${b.command.replace(/^commands\//, '')}`));
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
	test('deploy stamps deployed_on on the change request', () => {
		assert.equal(cr.fields.deployed_on.type, 'datetime');
	});
	test('a test may cover a plan — a Review Focus line is proof about no one story', () => {
		assert.ok(tests.fields.covers.type.includes('rnd/implementation-plans'));
		assert.equal(plan.fields.tests.type, 'rnd/tests'); assert.equal(plan.fields.tests.mirror_of, 'covers');
	});
});
