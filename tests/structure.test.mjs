// THE SHAPE OF EVERY MODULE, pinned: each one self-contained, its references owned or declared.
//
// The engine enforces the same discipline at compile time; it is restated here so a violation names
// the module and the field, rather than surfacing as a compile error in some consumer's workspace.
import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { MODULES, CORE, ALL, OWNER, moduleIds, descriptorsOf, mixinsOf, targetsOf, fieldsOf } from './helpers/descriptors.mjs';

const KINDS = new Set(['collections', 'skills', 'agents', 'commands', 'command-bindings', 'ui-views', 'mixins']);
const NON_SOURCE = new Set(['bin', 'src', 'lib', 'test', 'docs', 'scripts', 'node_modules']);

const modules = moduleIds();
const pkgOf = (m) => JSON.parse(fs.readFileSync(path.join(MODULES, m, 'package.json'), 'utf8'));
/** A dependency is spelled as the full package name; the folder is the name without the scope. */
const folderOf = (dep) => dep.replace(/^@dreamteamer\//, '');

describe('relations', () => {
	test('the scan sees the whole repo', () => {
		assert.ok(ALL.length >= 50, `expected every collection, saw ${ALL.length}`);
	});

	// A generated far side names the field that owns the relation. That field must exist on the
	// collection the mirror points at, and must point back here — otherwise compile has nothing to
	// stamp from, and the mirror is a column that never fills.
	test('every mirror_of names a field that points back', () => {
		const broken = [];
		for (const { file, doc } of ALL) {
			for (const [name, spec] of Object.entries(doc.fields ?? {})) {
				if (!spec?.mirror_of) continue;
				for (const target of targetsOf(spec)) {
					const owner = fieldsOf(target).get(spec.mirror_of);
					if (!owner) broken.push(`${file}: ${name} mirrors ${target}.${spec.mirror_of}, which does not exist`);
					else if (!targetsOf(owner).includes(doc.name)) broken.push(`${file}: ${name} mirrors ${target}.${spec.mirror_of}, which does not point at ${doc.name}`);
				}
			}
		}
		assert.deepEqual(broken, []);
	});
});

for (const m of modules) {
	describe(`module ${m}`, () => {
		const pkg = pkgOf(m);
		const mroot = path.join(MODULES, m);
		const deps = new Set((pkg.dreamteamer?.dependencies ?? []).map(folderOf));
		const peers = new Set(pkg.dreamteamer?.peerDependencies ?? []);
		/** May module m point at (or overlay) collection t? */
		const reaches = (t) => CORE.has(t) || OWNER.get(t) === m || deps.has(OWNER.get(t)) || peers.has(t);

		test('has a manifest the engine can read: name = folder, a description, an engine range', () => {
			assert.equal(pkg.name, `@dreamteamer/${m}`, 'the folder is the name without the scope; a disagreement makes dependencies ambiguous');
			assert.ok(pkg.dreamteamer && typeof pkg.dreamteamer.description === 'string' && pkg.dreamteamer.description.length > 40, 'dreamteamer.description orients every session');
			assert.ok(pkg.dreamteamer.engine, 'declare the engine range the module was compiled against');
		});
		test('carries only source kinds and the folders compile allows at a module root', () => {
			for (const e of fs.readdirSync(mroot, { withFileTypes: true })) {
				if (!e.isDirectory() || e.name.startsWith('.')) continue;
				assert.ok(KINDS.has(e.name) || NON_SOURCE.has(e.name), `${m}/${e.name}/ is neither a source kind nor an allowed folder — compile refuses the module`);
			}
		});
		test('every mixin a descriptor names is shipped by the same module', () => {
			const own = mixinsOf(m);
			for (const { file, doc } of descriptorsOf(m)) for (const mx of doc.mixins ?? []) assert.ok(own.has(mx), `${file}: mixin ${mx} is not shipped by ${m}`);
		});
		test('every reference target is owned, a declared dependency, a declared peer, or core', () => {
			for (const { file, doc } of descriptorsOf(m)) {
				for (const [name, spec] of Object.entries(doc.fields ?? {})) {
					for (const t of targetsOf(spec)) {
						assert.ok(reaches(t), `${file}: ${name} → ${t} — ${OWNER.has(t) ? `owned by ${OWNER.get(t)}, which ${m} neither depends on nor peers` : 'no module here provides it, and it is not a declared peer'}`);
					}
				}
			}
		});
		test('an overlay adds to a collection the module depends on or peers, never to one it cannot see', () => {
			for (const { file, doc } of descriptorsOf(m).filter((d) => d.doc.overlay)) {
				assert.ok(OWNER.has(doc.name), `${file}: overlays ${doc.name}, which no module here owns`);
				assert.notEqual(OWNER.get(doc.name), m, `${file}: overlays its own collection — put the field in the descriptor`);
				assert.ok(reaches(doc.name), `${file}: overlays ${doc.name} (owned by ${OWNER.get(doc.name)}), which ${m} neither depends on nor peers`);
			}
		});
		test('declared dependencies exist in this repo and form no cycle', () => {
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
				const owner = OWNER.get(p);
				assert.ok(owner && owner !== m, `${m} peers "${p}" — ${owner === m ? 'it owns that collection itself' : 'nothing in this repo provides it'}`);
			}
		});
	});
}
