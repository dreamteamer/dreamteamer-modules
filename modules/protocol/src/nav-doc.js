// THE NAV DOCUMENT — nav.yaml at a workspace's root, the left nav the operator arranges (cr-dt-008). This file is
// the protocol's half of the cross-repo contract: the types every host speaks (NavDoc, NavTarget, NavOp, in
// nav-doc.d.ts) and `applyNavOp`, the one pure function every gesture goes through — a drop, a menu entry, a
// PATCH /nav. The engine reads, validates and writes the file (dreamteamer 0.49); a host turns a gesture into one
// NavOp, applies it here and writes the result.
//
//   NavDoc    = { tree: Entry[], hidden: string[] }
//   Entry     = string | { collection, icon? } | { folder, icon?, hidden?, items } | { namespace, icon?, hidden?, items? }
//   NavTarget = { name } | { folder: string[] }   — a folder path from the top level; a namespace entry is the
//               path element `ns:<name>`; labels match exactly and are never joined into one string
//
// What the document does not place still exists: a collection it does not name trails its parent (the top level,
// or its namespace) in drawn order, and a namespace it does not name draws after the top level's unplaced rows.
// Such a name is a valid target and a valid anchor. Placing one never moves anything else on screen: an anchor
// among unplaced rows first places, in drawn order, the rows of its parent that draw before it and itself.

/** A refused op: the message names the input. A host answers it 400. */
export class NavOpError extends Error {
	constructor(message) {
		super(message);
		this.name = 'NavOpError';
	}
}

const OPS = new Set(['move', 'new-folder', 'rename', 'dissolve', 'icon', 'hide', 'show']);
const POSITIONS = new Set(['top', 'bottom']);
const show = (v) => JSON.stringify(v);

/** The name a collection entry places, or undefined for a folder or a namespace entry. */
export const collectionOf = (e) => (typeof e === 'string' ? e : e && typeof e === 'object' && typeof e.collection === 'string' ? e.collection : undefined);
const isFolder = (e) => e && typeof e === 'object' && typeof e.folder === 'string';
const isNamespace = (e) => e && typeof e === 'object' && typeof e.namespace === 'string';
/** The items array of a folder or a namespace entry, created on a namespace entry that has none. */
const itemsOf = (e) => (Array.isArray(e.items) ? e.items : (e.items = []));

/** An absent or partial document as a whole one, deep-copied: what every op starts from. */
export function normalizeNavDoc(doc) {
	const d = doc && typeof doc === 'object' ? structuredClone(doc) : {};
	return { tree: Array.isArray(d.tree) ? d.tree : [], hidden: Array.isArray(d.hidden) ? d.hidden.filter((h) => typeof h === 'string') : [] };
}

/** The namespace a collection draws in: the longest declared namespace its name starts with (`rnd/issues` → rnd). */
export function namespaceOf(name, namespaces) {
	let best = '';
	for (const ns of namespaces) if (name.startsWith(`${ns}/`) && ns.length > best.length) best = ns;
	return best;
}

/** Every entry in document order (depth first), with the array that holds it and its ancestors. */
function* walk(items, ancestors = []) {
	for (let i = 0; i < items.length; i++) {
		const e = items[i];
		yield { entry: e, parent: items, index: i, ancestors };
		if ((isFolder(e) || isNamespace(e)) && Array.isArray(e.items)) yield* walk(e.items, [...ancestors, e]);
	}
}

/** The names the document places: every collection entry, every namespace entry, and every hidden name. */
export function placedNames(doc) {
	const out = new Set(doc.hidden);
	for (const { entry } of walk(doc.tree)) {
		const c = collectionOf(entry);
		if (c !== undefined) out.add(c);
		else if (isNamespace(entry)) out.add(`ns:${entry.namespace}`);
	}
	return out;
}
const isPlacedCollection = (placed, name) => placed.has(name);
const isPlacedNamespace = (placed, ns, doc) => placed.has(`ns:${ns}`) || doc.hidden.includes(ns);

function checkTarget(t, what) {
	if (!t || typeof t !== 'object') throw new NavOpError(`${what} is missing — a NavTarget is { name } or { folder: [labels] }`);
	if (typeof t.name === 'string' && t.name.trim()) return t;
	if (Array.isArray(t.folder) && t.folder.length && t.folder.every((l) => typeof l === 'string')) return t;
	throw new NavOpError(`${what} ${show(t)} is not a NavTarget — { name: string } or { folder: [labels] }`);
}

/** A folder path to its entry (a folder or a namespace entry), first occurrence at each level. */
function resolvePath(doc, path) {
	let items = doc.tree;
	let found;
	const ancestors = [];
	for (const el of path) {
		const ns = el.startsWith('ns:') ? el.slice(3) : null;
		const i = items.findIndex((e) => (ns !== null && isNamespace(e) && e.namespace === ns) || (isFolder(e) && e.folder === el));
		if (i < 0) throw new NavOpError(`no folder ${show(path)} in nav.yaml — ${show(el)} is not there`);
		if (found) ancestors.push(found.entry);
		found = { entry: items[i], parent: items, index: i };
		items = Array.isArray(items[i].items) ? items[i].items : [];
	}
	return { ...found, ancestors };
}

const firstCollection = (doc, name) => {
	for (const w of walk(doc.tree)) if (collectionOf(w.entry) === name) return w;
	return undefined;
};
const firstNamespace = (doc, ns) => {
	for (const w of walk(doc.tree)) if (isNamespace(w.entry) && w.entry.namespace === ns) return w;
	return undefined;
};

/** The drawn tail order of a level: the unplaced collections whose parent is that level, in `collections` order. */
const unplacedRowsOf = (doc, ctx, ns) => {
	const placed = placedNames(doc);
	return [...ctx.collections].filter((c) => !isPlacedCollection(placed, c) && namespaceOf(c, ctx.namespaces) === ns);
};
/** The parent namespace of a namespace (`rnd/lab` → rnd), '' at the top. */
const parentNamespaceOf = (ns, namespaces) => namespaceOf(ns, namespaces.filter((n) => n !== ns));
/** The unplaced namespaces drawn inside a level, in `namespaces` order. */
const unplacedNamespacesOf = (doc, ctx, parentNs) =>
	ctx.namespaces.filter((n) => !isPlacedNamespace(placedNames(doc), n, doc) && parentNamespaceOf(n, ctx.namespaces) === parentNs);

/** The items array a level's unplaced tails draw in: the top level, or the namespace's entry — placed first, at
 *  the end of its own parent, when the document does not name it yet. */
function levelItems(doc, ctx, ns) {
	if (!ns) return doc.tree;
	return itemsOf(ensureNamespace(doc, ctx, ns).entry);
}

/** The namespace entry, materialised at the end of its parent's level when the document does not place it. */
function ensureNamespace(doc, ctx, ns) {
	const at = firstNamespace(doc, ns);
	if (at) return at;
	const parent = levelItems(doc, ctx, parentNamespaceOf(ns, ctx.namespaces));
	parent.push({ namespace: ns });
	return { entry: parent.at(-1), parent, index: parent.length - 1 };
}

/** Place, at the end of the level they draw in, the unplaced rows of that level that draw before `name` and `name`
 *  itself — the drawing of everything else is unchanged. */
function materialiseRow(doc, ctx, name) {
	const ns = namespaceOf(name, ctx.namespaces);
	const rows = unplacedRowsOf(doc, ctx, ns);
	const items = levelItems(doc, ctx, ns);
	// a row the document hides without placing draws nowhere; as an anchor it is placed at the end of its level
	for (const r of rows.includes(name) ? rows.slice(0, rows.indexOf(name) + 1) : [name]) items.push(r);
	return firstCollection(doc, name);
}

/** Place every unplaced tail of a level (its rows, then its namespaces), so what is appended next draws last. */
function materialiseTails(doc, ctx, ns) {
	const items = levelItems(doc, ctx, ns);
	for (const r of unplacedRowsOf(doc, ctx, ns)) items.push(r);
	for (const n of unplacedNamespacesOf(doc, ctx, ns)) items.push({ namespace: n });
}

const knows = (ctx, name) => ctx.collections.has(name) || ctx.namespaces.includes(name);

/**
 * A `{ name }` target as an entry: a placed collection (first occurrence), else an unplaced one the workspace has,
 * else a placed namespace entry, else an unplaced namespace. `unplaced` says the entry is not in the document yet.
 */
function resolveName(doc, ctx, name) {
	const c = firstCollection(doc, name);
	if (c) return { ...c, kind: 'collection' };
	if (ctx.collections.has(name)) return { kind: 'collection', unplaced: true, name };
	const n = firstNamespace(doc, name);
	if (n) return { ...n, kind: 'namespace' };
	if (ctx.namespaces.includes(name)) return { kind: 'namespace', unplaced: true, name };
	throw new NavOpError(`${show(name)} is neither a collection nor a namespace of this workspace`);
}

function resolveTarget(doc, ctx, t) {
	if (typeof t.name === 'string') return resolveName(doc, ctx, t.name);
	const r = resolvePath(doc, t.folder);
	return { ...r, kind: isNamespace(r.entry) ? 'namespace' : 'folder' };
}

/** An `into` destination: a folder or a namespace entry. `{ name }` names a namespace (materialised when unplaced);
 *  a collection is never a destination. */
function resolveInto(doc, ctx, t) {
	if (typeof t.name === 'string') {
		if (ctx.namespaces.includes(t.name) || firstNamespace(doc, t.name)) return ensureNamespace(doc, ctx, t.name);
		if (ctx.collections.has(t.name)) throw new NavOpError(`cannot move into ${show(t.name)} — it is a row, not a folder or a namespace`);
		throw new NavOpError(`${show(t.name)} is neither a collection nor a namespace of this workspace`);
	}
	return resolvePath(doc, t.folder);
}

/** Take an entry out of its array. */
const detach = (w) => w.parent.splice(w.parent.indexOf(w.entry), 1)[0];

function validLabel(label, what = 'label') {
	if (typeof label !== 'string' || !label.trim()) throw new NavOpError(`the ${what} is empty — a folder needs a name`);
	if (label.startsWith('ns:')) throw new NavOpError(`the ${what} ${show(label)} starts with ns:, which names a namespace in a folder path`);
	return label;
}

/**
 * The next document after one operation. Pure: `doc` is never touched; an absent document is `{ tree: [], hidden: [] }`.
 * `ctx.collections` iterates in drawn tail order (by title — what the host's `tailOrder()` gives) and
 * `ctx.namespaces` lists the workspace's namespaces in drawn order.
 * @param {import('./nav-doc.js').NavDoc | null | undefined} input
 * @param {import('./nav-doc.js').NavOp} op
 * @param {{ collections: Set<string>, namespaces: string[] }} ctx
 */
export function applyNavOp(input, op, ctx) {
	if (!op || typeof op !== 'object' || typeof op.op !== 'string') throw new NavOpError(`not an op: ${show(op)} — { op: move | new-folder | rename | dissolve | icon | hide | show, … }`);
	if (!OPS.has(op.op)) throw new NavOpError(`unknown op ${show(op.op)} — one of ${[...OPS].join(', ')}`);
	const c = { collections: ctx?.collections instanceof Set ? ctx.collections : new Set(ctx?.collections ?? []), namespaces: [...(ctx?.namespaces ?? [])] };
	const doc = normalizeNavDoc(input);
	switch (op.op) {
		case 'move': return move(doc, c, op);
		case 'new-folder': {
			const label = validLabel(op.label);
			if (op.into !== undefined) checkTarget(op.into, 'into');
			const items = op.into ? itemsOf(resolveInto(doc, c, op.into).entry) : doc.tree;
			items.push({ folder: label, items: [] });
			return doc;
		}
		case 'rename': {
			const t = checkTarget(op.target, 'target');
			if (!Array.isArray(t.folder)) throw new NavOpError(`rename takes { folder: [labels] }, not ${show(t)}`);
			const label = validLabel(op.label);
			const w = resolvePath(doc, t.folder);
			if (!isFolder(w.entry)) throw new NavOpError(`${show(t.folder)} is a namespace; its label is its module's title`);
			w.entry.folder = label;
			return doc;
		}
		case 'dissolve': {
			const t = checkTarget(op.target, 'target');
			if (!Array.isArray(t.folder)) throw new NavOpError(`dissolve takes { folder: [labels] }, not ${show(t)}`);
			const w = resolvePath(doc, t.folder);
			if (!isFolder(w.entry)) throw new NavOpError(`${show(t.folder)} is a namespace, not a folder — only a folder dissolves`);
			w.parent.splice(w.index, 1, ...(w.entry.items ?? []));
			return doc;
		}
		case 'icon': return icon(doc, c, op);
		case 'hide':
		case 'show': return visibility(doc, c, op);
	}
	return doc;
}

function move(doc, ctx, op) {
	const target = checkTarget(op.target, 'target');
	if (op.into !== undefined && op.after !== undefined) throw new NavOpError('a move takes into or after, never both');
	if (op.position !== undefined && !POSITIONS.has(op.position)) throw new NavOpError(`position ${show(op.position)} is not top or bottom`);
	if (op.position !== undefined && op.after !== undefined) throw new NavOpError('position places within into (or the top level), never beside after');
	if (op.into !== undefined) checkTarget(op.into, 'into');
	if (op.after !== undefined) checkTarget(op.after, 'after');
	// resolve the target once against the document as given, so an unknown name is refused before anything moves
	const first = resolveTarget(doc, ctx, target);
	const sameName = op.after && typeof op.after.name === 'string' && typeof target.name === 'string' && op.after.name === target.name;
	if (sameName) return doc;

	// the destination — anchors among unplaced rows are placed first, so nothing else moves on screen
	let dest; // { items, index } — where the target is inserted
	if (op.after) {
		let anchor = typeof op.after.name === 'string' ? resolveName(doc, ctx, op.after.name) : { ...resolvePath(doc, op.after.folder) };
		if (anchor.unplaced) anchor = anchor.kind === 'collection' ? materialiseRow(doc, ctx, anchor.name) : materialiseNamespace(doc, ctx, anchor.name);
		dest = { anchor: anchor.entry };
	} else {
		const parent = op.into ? resolveInto(doc, ctx, op.into) : null;
		const items = parent ? itemsOf(parent.entry) : doc.tree;
		if (op.position === 'top') dest = { items, top: true };
		else {
			// last: a level with unplaced tails (the top level, a namespace) places them first, so the target draws
			// after them; a folder has none
			if (!parent) materialiseTails(doc, ctx, '');
			else if (isNamespace(parent.entry)) materialiseTails(doc, ctx, parent.entry.namespace);
			dest = { items, top: false, parent: parent?.entry };
		}
	}

	// the target as it stands now (placing an anchor may have placed it too: Move down on an unplaced row)
	let t = typeof target.name === 'string' ? resolveName(doc, ctx, target.name) : { ...resolvePath(doc, target.folder), kind: first.kind };
	let entry;
	if (t.unplaced) entry = t.kind === 'namespace' ? { namespace: t.name } : t.name;
	else {
		entry = t.entry;
		if (isFolder(entry) || isNamespace(entry)) {
			const within = (e) => e === entry || [...walk(Array.isArray(entry.items) ? entry.items : [])].some((w) => w.entry === e);
			const into = dest.anchor ? null : dest.parent ?? (dest.items === doc.tree ? null : findOwner(doc, dest.items));
			if (into && within(into)) throw new NavOpError(`cannot move ${show(target.folder ?? target.name)} into itself or a folder inside it`);
			if (dest.anchor && dest.anchor !== entry && within(dest.anchor)) throw new NavOpError(`cannot move ${show(target.folder ?? target.name)} after something inside it`);
			if (dest.anchor === entry) return doc;
		}
		detach(t);
	}
	if (dest.anchor) {
		const w = locate(doc, dest.anchor);
		w.parent.splice(w.parent.indexOf(dest.anchor) + 1, 0, entry);
	} else if (dest.top) dest.items.unshift(entry);
	else dest.items.push(entry);
	return doc;
}

/** The entry whose items array this is (undefined for the top level). */
function findOwner(doc, items) {
	for (const { entry } of walk(doc.tree)) if (entry && typeof entry === 'object' && entry.items === items) return entry;
	return undefined;
}
/** Where an entry sits now. */
function locate(doc, entry) {
	for (const w of walk(doc.tree)) if (w.entry === entry) return w;
	throw new NavOpError('internal: an anchor left the document');
}
/** An unplaced namespace used as an anchor: its level's unplaced rows and the namespaces drawn before it, then it. */
function materialiseNamespace(doc, ctx, ns) {
	const parentNs = parentNamespaceOf(ns, ctx.namespaces);
	const items = levelItems(doc, ctx, parentNs);
	for (const r of unplacedRowsOf(doc, ctx, parentNs)) items.push(r);
	const before = unplacedNamespacesOf(doc, ctx, parentNs);
	for (const n of before.slice(0, before.indexOf(ns) + 1)) items.push({ namespace: n });
	return firstNamespace(doc, ns);
}

function icon(doc, ctx, op) {
	const t = checkTarget(op.target, 'target');
	if (op.icon !== null && (typeof op.icon !== 'string' || !op.icon.trim())) throw new NavOpError(`icon ${show(op.icon)} is neither a codicon name nor null`);
	const r = resolveTarget(doc, ctx, t);
	if (r.unplaced) {
		if (op.icon === null) return doc; // nothing to clear on a row the document does not hold
		if (r.kind === 'collection') levelItems(doc, ctx, namespaceOf(r.name, ctx.namespaces)).push({ collection: r.name, icon: op.icon });
		else levelItems(doc, ctx, parentNamespaceOf(r.name, ctx.namespaces)).push({ namespace: r.name, icon: op.icon });
		return doc;
	}
	if (r.kind === 'collection') {
		const name = collectionOf(r.entry);
		r.parent[r.index] = op.icon === null ? name : { collection: name, icon: op.icon };
	} else if (op.icon === null) delete r.entry.icon;
	else r.entry.icon = op.icon;
	return doc;
}

function visibility(doc, ctx, op) {
	const t = checkTarget(op.target, 'target');
	const hide = op.op === 'hide';
	if (typeof t.name === 'string') {
		// a name the document already holds may be hidden or shown even when its module is gone, so a stale
		// entry can be cleaned; any other name must be the workspace's
		if (!knows(ctx, t.name) && !placedNames(doc).has(t.name) && !firstNamespace(doc, t.name)) resolveName(doc, ctx, t.name);
		if (hide) {
			if (!doc.hidden.includes(t.name)) doc.hidden.push(t.name);
		} else {
			doc.hidden = doc.hidden.filter((h) => h !== t.name);
			const ns = firstNamespace(doc, t.name);
			if (ns && !ctx.collections.has(t.name)) delete ns.entry.hidden;
		}
		return doc;
	}
	const w = resolvePath(doc, t.folder);
	if (hide) w.entry.hidden = true;
	else delete w.entry.hidden;
	return doc;
}
