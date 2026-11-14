// THE NAV DOCUMENT'S OPERATIONS (cr-dt-008, task 8; rnd/tests dreamteamer-modules/nav-ops).
//
// nav.yaml is the left nav of a workspace, and every gesture a host offers — a drop, a menu entry — is one
// NavOp that `applyNavOp` turns into the next document. It is pure: the same document, op and context give
// the same document, and the input is never touched. A name the document does not place but the workspace
// has (an unplaced row in a tail, an unplaced namespace) is a valid target or anchor, and placing it never
// moves anything else on screen. Every refusal is a NavOpError naming its input, which a host answers 400.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { applyNavOp, NavOpError } from '../src/nav-doc.js';

/** The design's §3 example document. */
const EXAMPLE = () => ({
	tree: [
		{ folder: 'Work', icon: 'rocket', items: ['tasks', 'projects', { folder: 'Plans', items: ['deliverables', 'decisions', 'risks'] }, 'workflows'] },
		{ folder: 'People', items: ['users', 'teams', 'roles', 'responsibilities', 'agents'] },
		{ collection: 'contacts', icon: 'person' },
		{ namespace: 'rnd', items: ['rnd/change-requests', 'rnd/issues', { folder: 'Product', items: ['rnd/user-journeys', 'rnd/user-stories'] }] },
		{ folder: 'Old', hidden: true, items: ['metrics'] },
	],
	hidden: ['file-drives'],
});
/** The workspace beside it, in drawn tail order (by title): assets and companies trail the top level, rnd/reviews
 *  and rnd/tests trail inside rnd. */
const CTX = {
	collections: new Set(['agents', 'assets', 'companies', 'contacts', 'decisions', 'deliverables', 'file-drives', 'metrics', 'projects', 'responsibilities', 'risks', 'roles', 'tasks', 'teams', 'users', 'workflows', 'rnd/change-requests', 'rnd/issues', 'rnd/reviews', 'rnd/tests', 'rnd/user-journeys', 'rnd/user-stories']),
	namespaces: ['rnd'],
};
const FIVE = { collections: new Set(['assets', 'companies', 'contacts', 'tasks', 'users']), namespaces: [] };
const apply = (doc, op, ctx = CTX) => applyNavOp(doc, op, ctx);
const at = (doc, ...labels) => labels.reduce((items, l) => items.find((e) => e.folder === l || (l.startsWith('ns:') && e.namespace === l.slice(3))).items, doc.tree);
const nameOf = (e) => (typeof e === 'string' ? e : e.collection ?? (e.namespace ? `ns:${e.namespace}` : `folder:${e.folder}`));
/** The top level as drawn, by name: the placed entries, then the unplaced rows in tail order (no namespaces here). */
const drawnTop = (doc, ctx = FIVE) => {
	const placed = new Set([...doc.tree.map(nameOf), ...doc.hidden]);
	return [...doc.tree.map(nameOf), ...[...ctx.collections].filter((c) => !placed.has(c))];
};
const refuses = (fn, pattern) => assert.throws(fn, (e) => e instanceof NavOpError && pattern.test(e.message), `expected a NavOpError matching ${pattern}`);

describe('the seven operations on the design\'s example document', () => {
	test('move: into a folder (last), after a row, a folder to the top of another, an unplaced row after a placed one', () => {
		let d = apply(EXAMPLE(), { op: 'move', target: { name: 'contacts' }, into: { folder: ['Work'] } });
		assert.deepEqual(at(d, 'Work').at(-1), { collection: 'contacts', icon: 'person' });
		assert.ok(!d.tree.some((e) => e.collection === 'contacts'));
		d = apply(EXAMPLE(), { op: 'move', target: { name: 'tasks' }, after: { name: 'workflows' } });
		assert.deepEqual(at(d, 'Work').map(nameOf), ['projects', 'folder:Plans', 'workflows', 'tasks']);
		d = apply(EXAMPLE(), { op: 'move', target: { folder: ['Work', 'Plans'] }, into: { folder: ['People'] }, position: 'top' });
		assert.deepEqual(at(d, 'People').map(nameOf), ['folder:Plans', 'users', 'teams', 'roles', 'responsibilities', 'agents']);
		assert.deepEqual(at(d, 'Work').map(nameOf), ['tasks', 'projects', 'workflows']);
		d = apply(EXAMPLE(), { op: 'move', target: { name: 'companies' }, after: { name: 'contacts' } });
		assert.deepEqual(d.tree.map(nameOf), ['folder:Work', 'folder:People', 'contacts', 'companies', 'ns:rnd', 'folder:Old']);
		d = apply(EXAMPLE(), { op: 'move', target: { name: 'rnd/tests' }, after: { name: 'rnd/issues' } });
		assert.deepEqual(at(d, 'ns:rnd').map(nameOf), ['rnd/change-requests', 'rnd/issues', 'rnd/tests', 'folder:Product']);
	});
	test('new-folder: at the top level, and inside the namespace', () => {
		let d = apply(EXAMPLE(), { op: 'new-folder', label: 'Sales' });
		assert.deepEqual(d.tree.at(-1), { folder: 'Sales', items: [] });
		d = apply(EXAMPLE(), { op: 'new-folder', label: 'Drafts', into: { name: 'rnd' } });
		assert.deepEqual(at(d, 'ns:rnd').at(-1), { folder: 'Drafts', items: [] });
	});
	test('rename: a folder by its path, the namespace\'s own folder included', () => {
		const d = apply(EXAMPLE(), { op: 'rename', target: { folder: ['ns:rnd', 'Product'] }, label: 'Product line' });
		assert.deepEqual(at(d, 'ns:rnd', 'Product line'), ['rnd/user-journeys', 'rnd/user-stories']);
	});
	test('dissolve: the items take the folder\'s place in its parent', () => {
		const d = apply(EXAMPLE(), { op: 'dissolve', target: { folder: ['Work', 'Plans'] } });
		assert.deepEqual(at(d, 'Work'), ['tasks', 'projects', 'deliverables', 'decisions', 'risks', 'workflows']);
	});
	test('icon: set on a row (the long form), cleared (back to the name), set on a folder, set on an unplaced row (placed at the end of its parent)', () => {
		let d = apply(EXAMPLE(), { op: 'icon', target: { name: 'users' }, icon: 'account' });
		assert.deepEqual(at(d, 'People')[0], { collection: 'users', icon: 'account' });
		d = apply(EXAMPLE(), { op: 'icon', target: { name: 'contacts' }, icon: null });
		assert.equal(d.tree[2], 'contacts');
		d = apply(EXAMPLE(), { op: 'icon', target: { folder: ['Work'] }, icon: null });
		assert.equal('icon' in d.tree[0], false);
		d = apply(EXAMPLE(), { op: 'icon', target: { folder: ['People'] }, icon: 'organization' });
		assert.equal(d.tree[1].icon, 'organization');
		d = apply(EXAMPLE(), { op: 'icon', target: { name: 'rnd/reviews' }, icon: 'comment' });
		assert.deepEqual(at(d, 'ns:rnd').at(-1), { collection: 'rnd/reviews', icon: 'comment' });
		d = apply(EXAMPLE(), { op: 'icon', target: { name: 'rnd' }, icon: 'beaker' });
		assert.equal(d.tree[3].icon, 'beaker');
	});
	test('hide: a row by name, a folder by path, an unplaced namespace by name', () => {
		let d = apply(EXAMPLE(), { op: 'hide', target: { name: 'teams' } });
		assert.deepEqual(d.hidden, ['file-drives', 'teams']);
		assert.deepEqual(at(d, 'People').map(nameOf), ['users', 'teams', 'roles', 'responsibilities', 'agents'], 'a hidden row keeps its place');
		d = apply(EXAMPLE(), { op: 'hide', target: { folder: ['People'] } });
		assert.equal(d.tree[1].hidden, true);
		d = apply(EXAMPLE(), { op: 'hide', target: { name: 'lab' } }, { ...CTX, namespaces: ['rnd', 'lab'] });
		assert.deepEqual(d.hidden, ['file-drives', 'lab']);
	});
	test('show: a hidden row by name, a hidden folder by path', () => {
		let d = apply(EXAMPLE(), { op: 'show', target: { name: 'file-drives' } });
		assert.deepEqual(d.hidden, []);
		d = apply(EXAMPLE(), { op: 'show', target: { folder: ['Old'] } });
		assert.equal('hidden' in d.tree[4], false);
	});
	test('pure: the input document is never touched', () => {
		const doc = EXAMPLE();
		const before = structuredClone(doc);
		for (const op of [
			{ op: 'move', target: { name: 'tasks' }, into: { folder: ['People'] } },
			{ op: 'new-folder', label: 'X' }, { op: 'rename', target: { folder: ['Work'] }, label: 'Y' },
			{ op: 'dissolve', target: { folder: ['Work'] } }, { op: 'icon', target: { name: 'users' }, icon: 'x' },
			{ op: 'hide', target: { name: 'users' } }, { op: 'show', target: { name: 'file-drives' } },
		]) apply(doc, op);
		assert.deepEqual(doc, before);
	});
});

describe('the seven operations on an absent document', () => {
	const none = (op) => applyNavOp(null, op, FIVE);
	test('move contacts after tasks: the rows before it and the anchor are placed, users stays unplaced', () => {
		const d = none({ op: 'move', target: { name: 'contacts' }, after: { name: 'tasks' } });
		assert.deepEqual(d, { tree: ['assets', 'companies', 'tasks', 'contacts'], hidden: [] });
		assert.deepEqual(drawnTop(d), ['assets', 'companies', 'tasks', 'contacts', 'users']);
	});
	test('new-folder, icon, hide, show', () => {
		assert.deepEqual(none({ op: 'new-folder', label: 'CRM' }), { tree: [{ folder: 'CRM', items: [] }], hidden: [] });
		assert.deepEqual(none({ op: 'icon', target: { name: 'users' }, icon: 'account' }), { tree: [{ collection: 'users', icon: 'account' }], hidden: [] });
		assert.deepEqual(none({ op: 'hide', target: { name: 'tasks' } }), { tree: [], hidden: ['tasks'] });
		assert.deepEqual(none({ op: 'show', target: { name: 'users' } }), { tree: [], hidden: [] });
	});
	test('rename and dissolve name a folder, and there is none', () => {
		refuses(() => none({ op: 'rename', target: { folder: ['CRM'] }, label: 'Sales' }), /CRM/);
		refuses(() => none({ op: 'dissolve', target: { folder: ['CRM'] } }), /CRM/);
	});
});

describe('Move up, down, to top and to bottom on unplaced rows, by the contract\'s recipes', () => {
	const none = (op) => applyNavOp(null, op, FIVE);
	test('Move up on tasks (fourth): after the sibling two above', () => {
		assert.deepEqual(drawnTop(none({ op: 'move', target: { name: 'tasks' }, after: { name: 'companies' } })), ['assets', 'companies', 'tasks', 'contacts', 'users']);
	});
	test('Move up on the second child: to the top of its parent', () => {
		assert.deepEqual(drawnTop(none({ op: 'move', target: { name: 'companies' }, position: 'top' })), ['companies', 'assets', 'contacts', 'tasks', 'users']);
	});
	test('Move down on contacts: after the next sibling', () => {
		assert.deepEqual(drawnTop(none({ op: 'move', target: { name: 'contacts' }, after: { name: 'tasks' } })), ['assets', 'companies', 'tasks', 'contacts', 'users']);
	});
	test('Move to top and Move to bottom', () => {
		assert.deepEqual(drawnTop(none({ op: 'move', target: { name: 'users' }, position: 'top' })), ['users', 'assets', 'companies', 'contacts', 'tasks']);
		assert.deepEqual(drawnTop(none({ op: 'move', target: { name: 'assets' }, position: 'bottom' })), ['companies', 'contacts', 'tasks', 'users', 'assets']);
	});
	test('Move up on the first unplaced row after a placed tree: to the top level\'s first unplaced place', () => {
		const doc = { tree: ['users', 'tasks'], hidden: [] };
		const d = applyNavOp(doc, { op: 'move', target: { name: 'companies' }, after: { name: 'users' } }, FIVE);
		assert.deepEqual(drawnTop(d), ['users', 'companies', 'tasks', 'assets', 'contacts']);
	});
});

describe('namespaces and folders inside them', () => {
	const NS = { collections: new Set(['assets', 'tasks', 'rnd/issues', 'rnd/reviews']), namespaces: ['rnd'] };
	test('into { name: rnd } with rnd unplaced: the namespace entry is added at the end of the top level, the row lands last', () => {
		const d = applyNavOp(null, { op: 'move', target: { name: 'tasks' }, into: { name: 'rnd' } }, NS);
		assert.deepEqual(d.tree, [{ namespace: 'rnd', items: ['rnd/issues', 'rnd/reviews', 'tasks'] }]);
	});
	test('a namespace name that is also a collection: the collection as target, the namespace as into', () => {
		const ctx = { collections: new Set(['lab', 'lab/samples']), namespaces: ['lab'] };
		const d = applyNavOp(null, { op: 'move', target: { name: 'lab' }, into: { name: 'lab' } }, ctx);
		assert.deepEqual(d.tree, [{ namespace: 'lab', items: ['lab/samples', 'lab'] }]);
	});
	test('a folder inside the namespace: renamed, iconed, dragged into Work', () => {
		let d = apply(EXAMPLE(), { op: 'rename', target: { folder: ['ns:rnd', 'Product'] }, label: 'Spec' });
		d = apply(d, { op: 'icon', target: { folder: ['ns:rnd', 'Spec'] }, icon: 'book' });
		d = apply(d, { op: 'move', target: { folder: ['ns:rnd', 'Spec'] }, into: { folder: ['Work'] } });
		assert.deepEqual(at(d, 'Work').at(-1), { folder: 'Spec', icon: 'book', items: ['rnd/user-journeys', 'rnd/user-stories'] });
		assert.deepEqual(at(d, 'ns:rnd').map(nameOf), ['rnd/change-requests', 'rnd/issues']);
	});
	test('a label containing a slash round-trips as one path element', () => {
		let d = apply(EXAMPLE(), { op: 'new-folder', label: 'Sales/CRM' });
		d = apply(d, { op: 'move', target: { name: 'contacts' }, into: { folder: ['Sales/CRM'] } });
		d = apply(d, { op: 'rename', target: { folder: ['Sales/CRM'] }, label: 'Sales/CRM/EU' });
		assert.deepEqual(at(d, 'Sales/CRM/EU'), [{ collection: 'contacts', icon: 'person' }]);
		refuses(() => apply(d, { op: 'dissolve', target: { folder: ['Sales', 'CRM'] } }), /Sales/);
	});
});

describe('idempotent: hide, show and icon twice equal once', () => {
	for (const op of [
		{ op: 'hide', target: { name: 'teams' } }, { op: 'hide', target: { folder: ['Work'] } }, { op: 'hide', target: { name: 'companies' } },
		{ op: 'show', target: { name: 'file-drives' } }, { op: 'show', target: { folder: ['Old'] } },
		{ op: 'icon', target: { name: 'users' }, icon: 'account' }, { op: 'icon', target: { name: 'assets' }, icon: 'file-media' },
		{ op: 'icon', target: { folder: ['Work'] }, icon: null },
	]) {
		test(`${op.op} ${JSON.stringify(op.target)}`, () => {
			const once = apply(EXAMPLE(), op);
			assert.deepEqual(apply(once, op), once);
		});
	}
});

describe('refusals are NavOpErrors naming the input', () => {
	test('a name that is neither a collection nor a namespace of the workspace', () => {
		refuses(() => apply(EXAMPLE(), { op: 'move', target: { name: 'invoices' }, position: 'top' }), /invoices/);
		refuses(() => apply(EXAMPLE(), { op: 'move', target: { name: 'tasks' }, after: { name: 'invoices' } }), /invoices/);
		refuses(() => apply(EXAMPLE(), { op: 'hide', target: { name: 'invoices' } }), /invoices/);
	});
	test('a folder path that resolves to nothing', () => {
		refuses(() => apply(EXAMPLE(), { op: 'move', target: { name: 'tasks' }, into: { folder: ['Work', 'Nope'] } }), /Nope/);
		refuses(() => apply(EXAMPLE(), { op: 'rename', target: { folder: ['ns:lab'] }, label: 'X' }), /ns:lab/);
	});
	test('into a row', () => {
		refuses(() => apply(EXAMPLE(), { op: 'move', target: { name: 'tasks' }, into: { name: 'users' } }), /users/);
	});
	test('a folder into itself or its own descendant', () => {
		refuses(() => apply(EXAMPLE(), { op: 'move', target: { folder: ['Work'] }, into: { folder: ['Work'] } }), /Work/);
		refuses(() => apply(EXAMPLE(), { op: 'move', target: { folder: ['Work'] }, into: { folder: ['Work', 'Plans'] } }), /Work/);
		refuses(() => apply(EXAMPLE(), { op: 'move', target: { folder: ['Work'] }, after: { name: 'decisions' } }), /Work/);
	});
	test('a new or renamed label that is empty or starts with ns:', () => {
		refuses(() => apply(EXAMPLE(), { op: 'new-folder', label: '' }), /label/);
		refuses(() => apply(EXAMPLE(), { op: 'new-folder', label: '  ' }), /label/);
		refuses(() => apply(EXAMPLE(), { op: 'new-folder', label: 'ns:lab' }), /ns:lab/);
		refuses(() => apply(EXAMPLE(), { op: 'rename', target: { folder: ['Work'] }, label: 'ns:work' }), /ns:work/);
	});
	test('a malformed op: unknown op, missing target, both into and after, a bad position', () => {
		refuses(() => apply(EXAMPLE(), { op: 'frobnicate' }), /frobnicate/);
		refuses(() => apply(EXAMPLE(), null), /op/);
		refuses(() => apply(EXAMPLE(), { op: 'move' }), /target/);
		refuses(() => apply(EXAMPLE(), { op: 'hide', target: { folder: 'Work' } }), /target/);
		refuses(() => apply(EXAMPLE(), { op: 'move', target: { name: 'tasks' }, into: { folder: ['People'] }, after: { name: 'users' } }), /into.*after|after.*into/);
		refuses(() => apply(EXAMPLE(), { op: 'move', target: { name: 'tasks' }, position: 'middle' }), /position/);
		refuses(() => apply(EXAMPLE(), { op: 'icon', target: { name: 'tasks' }, icon: 3 }), /icon/);
	});
	test('NavOpError is an Error a host can tell apart', () => {
		const e = new NavOpError('x');
		assert.ok(e instanceof Error);
		assert.equal(e.name, 'NavOpError');
	});
});
