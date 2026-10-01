// THE SHAPE OF EVERY MODULE, pinned: each one self-contained, its references owned or declared.
//
// Self-contained means what the recipes repo learned the hard way — a `templates:` ref that leaves
// its module made a whole extraction uncompilable in a bare workspace — plus the dependency
// discipline the engine enforces at compile time, restated here so a violation names the module and
// the field rather than surfacing as a compile error in some consumer's workspace later.
import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const MODULES = path.join(ROOT, 'modules');
const KINDS = new Set(['collections', 'skills', 'agents', 'commands', 'command-bindings', 'ui-views', 'collection-templates']);
const NON_SOURCE = new Set(['bin', 'src', 'lib', 'tests', 'test', 'docs', 'scripts', 'node_modules']);
// The engine's own collections a module may reference without owning or declaring them.
const CORE = new Set(['repos', 'modules', 'collections', 'skills', 'agents', 'commands', 'command-bindings', 'ui-views', 'collection-templates']);

const modules = fs.readdirSync(MODULES).filter((m) => fs.statSync(path.join(MODULES, m)).isDirectory()).sort();
const pkgOf = (m) => JSON.parse(fs.readFileSync(path.join(MODULES, m, 'package.json'), 'utf8'));
/** A dependency is spelled as the full package name; the folder is the name without the scope. */
const folderOf = (dep) => dep.replace(/^@dreamteamer\//, '');

// Collections a module here may PEER although no module in this repo provides them — each names who
// does. Empty since every official module lives here; a peer nothing provides is a typo.
const PROVIDED_ELSEWHERE = new Map();

function* files(dir, ext) {
	if (!fs.existsSync(dir)) return;
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, e.name);
		if (e.isDirectory()) yield* files(p, ext);
		else if (p.endsWith(ext)) yield p;
	}
}
const descriptorsOf = (m) => [...files(path.join(MODULES, m, 'collections'), '.collection.yaml')].map((f) => ({ file: path.relative(ROOT, f), doc: yaml.load(fs.readFileSync(f, 'utf8')) }));

/** Every x-reference target in a schema, walking items and nested objects the way compile does. */
function refs(schema, at = '', out = []) {
	if (!schema || typeof schema !== 'object') return out;
	for (const [k, prop] of Object.entries(schema.properties ?? {})) {
		const holder = prop?.items && typeof prop.items === 'object' ? prop.items : prop;
		if (holder?.['x-reference']) out.push([`${at}${k}`, holder['x-reference']]);
		if (prop?.type === 'object') refs(prop, `${at}${k}.`, out);
	}
	return out;
}

const ownerOf = new Map(); // collection name -> module
for (const m of modules) for (const { doc } of descriptorsOf(m)) ownerOf.set(doc.name, m);


// ⚠ A RELATION DECLARED ON BOTH SIDES COMPILES CLEAN AND WARNS FOREVER.
//
// `x-inverse` on the owner and `x-inverse-of` on the target are TWO SPELLINGS OF ONE RELATION, and
// compile accepts either. Declare both and it still compiles to exactly the same thing — and prints
// `⚠ relation <owner>.<field>: declared on both sides — keep one` on EVERY compile, in EVERY
// consumer's workspace, forever. Two of those shipped (2026-09-11, found by running a real
// consumer's compile), and the cost is not the two lines: it is that a permanent warning teaches
// people to skim the warning block, which is how the next real one goes unread.
//
// Nothing else in the package can see this — `compiles-alone` asserts no ✖ and no /error/i, and a
// warning is neither. So it is asserted here, over every descriptor in every module at once.
describe('relations are declared on ONE side', () => {
	// ⚠ BOTH NODES, ALWAYS. A relation keyword may be authored on the ARRAY or inside its `items` —
	// compile hoists it onto whichever node carries `x-reference` (normalizeRelationKeywords), so the
	// raw descriptor has it in either place. A reader that looked at only one missed the real defect
	// this gate was written for: the first draft checked `items` alone and passed over an `x-inverse`
	// authored one level up, which is exactly how the two shipped warnings got in.
	const kw = (spec, name) => spec?.[name] ?? (spec?.items && typeof spec.items === 'object' ? spec.items[name] : undefined);
	const all = new Map();   // collection name -> properties
	for (const m of modules) for (const { doc } of descriptorsOf(m)) all.set(doc.name, doc.schema?.properties ?? {});

	test('the scan sees the whole package', () => {
		assert.ok(all.size >= 9, `expected every collection, saw ${all.size}`);
	});

	test('no x-inverse-of names an owner field that ALSO declares x-inverse', () => {
		const both = [];
		for (const [name, props] of all) {
			for (const [field, spec] of Object.entries(props)) {
				const of = kw(spec, 'x-inverse-of');
				if (typeof of !== 'string') continue;
				const dot = of.lastIndexOf('.');            // a collection name contains '/', so split at the LAST dot
				const ownerName = of.slice(0, dot), ownerField = of.slice(dot + 1);
				const owner = all.get(ownerName);
				assert.ok(owner, `${name}.${field} declares x-inverse-of "${of}" — no such collection`);
				const oSpec = owner[ownerField];
				assert.ok(oSpec, `${name}.${field} declares x-inverse-of "${of}" — ${ownerName} has no field "${ownerField}"`);
				if (kw(oSpec, 'x-inverse')) both.push(`${of}  ⟷  ${name}.${field}`);
			}
		}
		assert.deepEqual(both, [],
			'declared on both sides — compile warns on every run in every consumer. Keep ONE: either the '
			+ 'x-inverse on the owner, or the x-inverse-of on the target.\n  ' + both.join('\n  '));
	});
});

for (const m of modules) {
	describe(`module ${m}`, () => {
		const pkg = pkgOf(m);
		const mroot = path.join(MODULES, m);
		test('has a manifest the engine can read: name = folder, a description, an engine range', () => {
			assert.equal(pkg.name, `@dreamteamer/${m}`, 'the folder is the name without the scope; a disagreement makes dependencies ambiguous');
			assert.ok(pkg.dreamteamer && typeof pkg.dreamteamer.description === 'string' && pkg.dreamteamer.description.length > 40, 'dreamteamer.description is what orients every session — it is not optional');
			assert.ok(pkg.dreamteamer.engine, 'declare the engine range the module was compiled against');
		});
		test('carries only source kinds and the folders compile allows at a module root', () => {
			for (const e of fs.readdirSync(mroot, { withFileTypes: true })) {
				if (!e.isDirectory() || e.name.startsWith('.')) continue;
				assert.ok(KINDS.has(e.name) || NON_SOURCE.has(e.name), `${m}/${e.name}/ is neither a source kind nor an allowed folder — compile refuses the module`);
			}
		});
		test('every templates: reference stays inside the module', () => {
			const own = new Set([...files(path.join(mroot, 'collection-templates'), '.collection-template.yaml')].map((f) => `collection-templates/${path.basename(f, '.collection-template.yaml')}`));
			for (const { file, doc } of descriptorsOf(m)) {
				for (const t of doc.templates ?? []) assert.ok(own.has(t), `${file}: templates ${t} is not shipped by ${m} — a cross-module template made the July 2026 extraction uncompilable alone`);
			}
		});
		test('every x-reference target is owned, a declared dependency, a declared peer, core, or the wildcard', () => {
			const deps = new Set(pkg.dreamteamer.dependencies ?? []);
			const peers = new Set(pkg.dreamteamer.peerDependencies ?? []);
			for (const { file, doc } of descriptorsOf(m)) {
				for (const [field, raw] of refs(doc.schema)) {
					const targets = Array.isArray(raw) ? raw : [raw];
					for (const t of targets) {
						if (t === '*' || CORE.has(t)) continue;
						const owner = ownerOf.get(t);
						const ok = owner === m || (owner && deps.has(`@dreamteamer/${owner}`)) || peers.has(t);
						assert.ok(ok, `${file}: ${field} → ${t} — ${owner ? `owned by ${owner}, which ${m} neither depends on nor peers` : 'no module here provides it, and it is not a declared peer'}`);
					}
				}
			}
		});
		test('declared dependencies exist in this package and form no cycle', () => {
			const seen = new Set(); const trail = [];
			const visit = (n) => {
				assert.ok(fs.existsSync(path.join(MODULES, n, 'package.json')), `${m} depends on ${n}, which this repo does not ship`);
				assert.ok(!trail.includes(n), `cyclic dependencies: ${[...trail, n].join(' → ')}`);
				if (seen.has(n)) return;
				seen.add(n); trail.push(n);
				for (const d of pkgOf(n).dreamteamer.dependencies ?? []) visit(folderOf(d));
				trail.pop();
			};
			for (const d of pkg.dreamteamer.dependencies ?? []) visit(folderOf(d));
		});
		test('a declared peer is a collection some OTHER module provides (a peer nothing provides is a typo)', () => {
			for (const p of pkg.dreamteamer.peerDependencies ?? []) {
				if (PROVIDED_ELSEWHERE.has(p)) continue;
				const owner = ownerOf.get(p);
				assert.ok(owner && owner !== m, `${m} peers "${p}" — ${owner === m ? 'it owns that collection itself' : 'nothing in this repo provides it, and PROVIDED_ELSEWHERE does not name it'}`);
			}
		});
	});
}
