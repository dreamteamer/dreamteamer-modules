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
	const refs = load('collections/rnd/references.collection.yaml');
	const pdd = load('collections/rnd/product-design-docs.collection.yaml');
	const proto = load('collections/rnd/prototypes.collection.yaml');
	const products = load('collections/rnd/products.collection.yaml');
	test('a reference is an entity with a type enum that includes product, and a prd field', () => {
		assert.equal(refs.id.generate, '{{ name | slug }}');
		assert.deepEqual(refs.schema.required, ['name', 'type']);
		assert.ok(refs.schema.properties.type.enum.includes('product'));
		assert.equal(refs.schema.properties.prd.format, 'markdown');
		for (const f of ['reference_file', 'screenshots_folder']) assert.match(refs.schema.properties[f].description, /\$\{env:FILES_FOLDER\}/);
	});
	// The chain's hops are FIELDS, and each mirror is declared on both sides consistently (spelling A on the
	// owner, spelling B on the target) — the companies convention, so a reader of either file sees it.
	test('the design doc carries the chain: product, references, branding, plan, and the prototypes mirror', () => {
		const p = pdd.schema.properties;
		assert.equal(p.product['x-reference'], 'rnd/products');
		assert.equal(p.references.items['x-reference'], 'rnd/references');
		assert.equal(p.branding.format, 'markdown');
		assert.equal(p.plan.type, 'string'); assert.ok(!('x-reference' in p.plan), 'plan is a plain string — the plan may live elsewhere');
		assert.equal(p.prototypes['x-inverse-of'], 'rnd/prototypes.design_doc');
	});
	test('each mirror is owned on the far side by a field that names it', () => {
		// ⚠ ONE SIDE ONLY. `design_doc` used to declare `x-inverse` as well, which compiles to exactly
		// the same relation and warns on every compile in every consumer ("declared on both sides").
		// The mirror is declared on the design doc, where a reader opening it can see it.
		assert.ok(!proto.schema.properties.design_doc['x-inverse'],
			'declaring both sides is a permanent warning in every consumer — tests/modules-structure.test.mjs is the gate');
		assert.equal(pdd.schema.properties.prototypes['x-inverse-of'], 'rnd/prototypes.design_doc');
		assert.equal(products.schema.properties.design_docs['x-inverse-of'], 'rnd/product-design-docs.product');
		assert.equal(refs.schema.properties.design_docs['x-inverse-of'], 'rnd/product-design-docs.references');
	});
	// `rnd/media-packs` was retired in 0.7.0: a whole collection to say "there is a folder of videos"
	// bought one thing a folder does not — the corpus it was generated from — and nothing else. That
	// pinning moved into the owning record's BODY, and the folder became a field on the record the media
	// belongs to. A `media-packs.collection.yaml` coming back is the regression this guards.
	test('the collections that carry media carry a media_folder ${env:FILES_FOLDER} template, and media-packs is gone', () => {
		for (const c of ['products', 'draft-docs', 'research-docs', 'product-design-docs']) {
			const f = load(`collections/rnd/${c}.collection.yaml`).schema.properties.media_folder;
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
	// mirror, because a mirror would write a field into a module this one does not own.
	test('rnd/projects is gone, folded into rnd/products, and nothing still points at it', () => {
		assert.ok(!fs.existsSync(path.join(RND, 'collections/rnd/projects.collection.yaml')),
			'rnd/projects came back');
		const products = load('collections/rnd/products.collection.yaml').schema.properties;
		assert.equal(products.company?.['x-reference'], 'companies', 'company did not survive the fold');
		assert.ok(products.media_folder, 'media_folder did not survive the fold');
		assert.equal(products.project['x-reference'], 'projects', 'products.project must name the plan module');
		assert.ok(!products.project['x-inverse'], 'a peer excuses a reference, never a mirror');
		const research = load('collections/rnd/research-docs.collection.yaml').schema.properties;
		assert.equal(research.project['x-reference'], 'projects');
		assert.ok(!research.project['x-inverse'], 'the mirror had to go with the repoint');
		// and the module declares the peer it now leans on
		const pkg = JSON.parse(fs.readFileSync(path.join(RND, 'package.json'), 'utf8'));
		assert.ok(pkg.dreamteamer.peerDependencies.includes('projects'),
			'rnd references projects and must peer it');
	});

	test('a prototype carries live_url, iteration and deploy', () => {
		for (const f of ['live_url', 'iteration', 'deploy']) assert.ok(proto.schema.properties[f], f);
		assert.equal(proto.schema.properties.iteration.type, 'number');
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
			const props = load(`collections/rnd/${coll}.collection.yaml`).schema.properties;
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
