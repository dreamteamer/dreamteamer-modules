// THE NAV AS DATA — what the VS Code extension draws as its Collections tree (its `tree.ts`), computed
// by the same decisions (`host/nav.js`, `host/sources.js`, `host/fsdata.js`) and returned as plain
// nodes, so a host with no native tree (dt web) draws the same folders, rows and order.
// `GET /nav` answers it. Each node is { kind, key, label, icon?, description?, tooltip?, route?, marks?,
// target?, children? }; `kind` is the tree item's contextValue (workspace · folder · namespace · collection ·
// view · layers · layer · layer-group · layer-collection · layer-note · message). Every folder, namespace and
// collection node carries `target`, the NavTarget a host sends back in a PATCH /nav op.
//
// Three cases (cr-dt-008): a workspace with nav.yaml draws it (`buildTree`); with no nav.yaml and none of the old
// settings (navGroups · navOrder · navHidden), the flat tree (`buildTree` with no document); with no nav.yaml and an
// old setting, the legacy tree it drew before (`legacyTree`) until the settings are migrated into nav.yaml. An
// unreadable nav.yaml draws the flat tree with the message on the workspace node's `notice`. The layers folder
// draws after the tree and its tails.
import fs from 'node:fs';
import path from 'node:path';
import { engine, engineLoaded } from './host/engine.js';
import { isRuntime, loadDescriptors, loadModules, loadUiViews, moduleDependencies, moduleNamespaces, navViewsOf, viewRow, workspaceModule } from './host/fsdata.js';
import { WORKSPACE_ROUTE, buildTree, collectionRow, folderModule, folderPresentation, groupLabel, hasNavSettings, legacyTree, moduleIcon, navGroupsOf, navOrderOf, navPathKey, rowMarks, groupedLayerFolders, layerEntries, layerNote, moduleLabel, routeFor, shouldFoldOutOfRecordTree, tailOrder } from './host/nav.js';
import { readNavDoc } from './nav-doc.js';
import { collectionSources, layerTitle, sourcesContext, sourcesStack } from './host/sources.js';
import { codiconFor } from './host/icon-name.js';

/** The four nav settings, read from a workspace's `.vscode/settings.json` (JSON with comments) — what
 *  http and web hosts use; the extension passes VS Code's merged configuration instead. */
export function workspaceNavSettings(root) {
	try {
		const text = fs.readFileSync(path.join(root, '.vscode', 'settings.json'), 'utf8');
		const raw = JSON.parse(stripJsonComments(text));
		return {
			navGroups: raw['dreamteamer.navGroups'],
			navOrder: raw['dreamteamer.navOrder'],
			navHidden: raw['dreamteamer.navHidden'],
			layersFolder: raw['dreamteamer.layersFolder'],
		};
	} catch {
		return {};
	}
}

/** Comments and trailing commas out of a JSONC text, strings left alone. */
function stripJsonComments(text) {
	let out = '';
	for (let i = 0, inStr = false; i < text.length; i++) {
		const c = text[i];
		if (inStr) { out += c; if (c === '\\') { out += text[++i] ?? ''; } else if (c === '"') inStr = false; continue; }
		if (c === '"') { inStr = true; out += c; continue; }
		if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue; }
		if (c === '/' && text[i + 1] === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i++; continue; }
		out += c;
	}
	return out.replace(/,(\s*[}\]])/g, '$1');
}

const groupsOf = navGroupsOf;
const orderOf = navOrderOf;

export { readNavDoc };

/** What a nav write is checked against: the rows the tree can draw (`collections`, in drawn tail order — what
 *  applyNavOp places unplaced rows by), every compiled collection (`known`, what a PUT may name: an internal
 *  collection is not drawn but is not unknown) and the declared namespaces. */
export function navOpContext(root) {
	const descriptors = loadDescriptors(root);
	const { titleOf } = engine().descriptor;
	return {
		collections: tailOrder(descriptors.filter((d) => !shouldFoldOutOfRecordTree(d)), titleOf),
		known: new Set(descriptors.map((d) => d.name)),
		namespaces: [...(engineLoaded() ? engine().namespaces : [])],
	};
}
const layerSettings = (root, key) => {
	try {
		const raw = JSON.parse(stripJsonComments(fs.readFileSync(path.join(root, 'git_modules', key, '.vscode', 'settings.json'), 'utf8')));
		return raw && typeof raw === 'object' ? raw : {};
	} catch { return {}; }
};

/**
 * The tree, top to bottom: one `workspace` node whose children are the top level.
 * @param {{ root: string, settings?: { navGroups?: unknown, navOrder?: unknown, navHidden?: unknown, layersFolder?: unknown } }} ctx
 */
export function navModel({ root, settings = workspaceNavSettings(root) }) {
	const descriptors = loadDescriptors(root);
	const modules = loadModules(root);
	const titleOf = new Map(modules.map((m) => [m.id, m.title]));
	const byName = new Map(descriptors.map((d) => [d.name, d]));
	const declared = engineLoaded() ? engine().namespaces : [];
	let srcCtx = null;
	const ctx = () => (srcCtx ??= sourcesContext(root, descriptors));
	const sourcesOf = (d) => { try { return collectionSources(root, d, ctx()); } catch { return undefined; } };

	const present = (node, row, module, about, opts) => {
		const p = folderPresentation(module, about, opts);
		node.icon = codiconFor(p.icon);
		if (p.tooltip) node.tooltip = p.tooltip;
		if (p.marks) node.marks = p.marks;
		if (p.route) node.route = p.route;
		return node;
	};
	const folderLook = (module, collections) => {
		const { displayOf } = engine().descriptor;
		const iconName = module
			? moduleIcon(modules.find((m) => m.id === module), (c) => {
					const d = byName.get(c);
					return d ? { icon: displayOf(d).nav?.icon, order: displayOf(d).nav?.order, runtime: isRuntime(d) } : undefined;
				})
			: undefined;
		const shared = collections?.some((d) => collectionRow(d, sourcesOf(d)).shared) ?? false;
		return { ...(iconName ? { icon: iconName } : {}), ...(shared ? { shared } : {}) };
	};
	const viewNode = (v) => {
		const r = viewRow(v);
		return { kind: 'view', key: `v/${v.id}`, label: r.label, icon: codiconFor(r.icon), ...(r.description ? { description: r.description } : {}), tooltip: r.tooltip, ...(v.route ? { route: v.route } : {}) };
	};
	const views = loadUiViews(root);
	const collectionNode = (d) => {
		const row = collectionRow(d, sourcesOf(d));
		const marks = rowMarks({ shared: row.shared });
		const kids = navViewsOf(views, d.name).map(viewNode);
		return {
			kind: 'collection', key: `c/${d.name}`, label: row.label, icon: codiconFor(row.icon), tooltip: row.tooltip, route: routeFor(d), target: { name: d.name },
			...(row.count !== undefined ? { description: String(row.count) } : {}), ...(marks ? { marks } : {}), ...(kids.length ? { children: kids } : {}),
		};
	};
	// the legacy tree's folders, keyed and targeted as the folders migrateNavSettings writes for them: a module or
	// group folder is { folder: <label as drawn> }, a namespace folder { namespace } — so a host's node keeps its
	// key across the migration
	const groupNode = (f, label, path = []) => {
		const module = folderModule(f, modules);
		const look = folderLook(module, f.collections);
		const ns = f.key.startsWith('ns:') ? f.key.slice(3) : null;
		const drawn = moduleLabel(f.key, label);
		const p = [...path, ns ? `ns:${ns}` : drawn];
		const node = present({ kind: ns ? 'namespace' : 'folder', key: navPathKey(ns ? 'n' : 'f', p), label: drawn, target: ns ? { name: ns } : { folder: p } }, '', module, undefined, look);
		node.children = [...f.collections.map(collectionNode), ...f.children.map((c) => groupNode(c, groupLabel(c.key, titleOf, f.key), p))];
		return node;
	};
	const layerEntriesOf = (layer) => {
		const s = layerSettings(root, layer.key);
		return layerEntries(layer.rows, descriptors, {
			declared,
			workspaceModule: workspaceModule(path.join(root, 'git_modules', layer.key)),
			dependsOn: moduleDependencies(root),
			namespacesOf: moduleNamespaces(root),
			navGroups: groupsOf(s['dreamteamer.navGroups']),
			navOrder: orderOf(s['dreamteamer.navOrder']),
			titleOf,
		});
	};
	const layerNodes = (layer, entries) => entries.map((e) => {
		if (e.kind === 'row') return { kind: 'layer-collection', key: `l/${layer}/c/${e.row.collection}`, label: e.row.title, icon: codiconFor(e.row.icon), description: String(e.row.count), tooltip: `${e.row.title} — ${e.row.count} record${e.row.count === 1 ? '' : 's'} from ${layer}`, route: e.row.route };
		const module = folderModule(e.folder, modules);
		const node = present({ kind: 'layer-group', key: `l/${layer}/${e.folder.key}`, label: e.label }, '', module, undefined, { icon: folderLook(module).icon, source: layer });
		node.children = layerNodes(layer, e.entries);
		return node;
	});
	const layerNode = (l) => {
		const module = folderModule({ layer: l.key }, modules);
		const node = present({ kind: 'layer', key: `l/${l.key}`, label: l.label }, '', module, `${l.key} — git_modules/${l.key}${l.installed ? '' : ' (not installed)'}`, { icon: folderLook(module).icon, shared: true, source: l.key });
		const note = layerNote(l);
		node.children = note ? [{ kind: 'layer-note', key: `l/${l.key}/note`, label: '', description: note }] : layerNodes(l.key, layerEntriesOf(l));
		return node;
	};

	let top;
	let notice;
	if (!descriptors.length) {
		top = [{ kind: 'message', key: 'message', label: 'no compiled collections — run: npm run compile', icon: 'info' }];
	} else {
		let layerGroups = [];
		try {
			const { layers } = sourcesStack(root, descriptors, ctx());
			layerGroups = groupedLayerFolders(layers, descriptors, settings.layersFolder, new Map(layers.map((l) => [l.name, layerTitle(root, l.name)])));
		} catch { /* a nav without the layers folder beats no nav */ }
		const layersEntries = layerGroups.map((g) => ({ kind: 'layers', label: g.label, layers: g.layers }));
		const layersNode = (e) => ({ kind: 'layers', key: `layers/${e.label}`, label: e.label, icon: 'layers', children: e.layers.map(layerNode) });
		let doc = null;
		let absent = false;
		try {
			doc = readNavDoc(root);
			absent = doc === null;
		} catch (e) {
			notice = String(e?.message ?? e);
			if (!/nav\.yaml/.test(notice)) notice = `nav.yaml: ${notice}`;
		}
		if (absent && hasNavSettings(settings)) {
			// the tree the person had, until the settings are migrated into nav.yaml (dt-nav migrate, or a host's first open)
			top = legacyTree(descriptors, settings, { declared, workspaceModule: workspaceModule(root), dependsOn: moduleDependencies(root), namespacesOf: moduleNamespaces(root), titleOf, layers: layersEntries }).map((e) =>
				e.kind === 'collection' ? collectionNode(e.descriptor)
					: e.kind === 'layers' ? layersNode(e)
						: groupNode(e.folder, groupLabel(e.folder.key, titleOf)));
		} else {
			const { titleOf: title } = engine().descriptor;
			top = [
				...buildTree({
					descriptors, doc, namespaces: declared, titleOf: title, nodeOf: collectionNode, icon: codiconFor,
					internal: shouldFoldOutOfRecordTree,
					namespaceTitle: (ns, parent) => groupLabel(`ns:${ns}`, titleOf, parent ? `ns:${parent}` : undefined),
				}),
				...layersEntries.map(layersNode),
			];
		}
	}
	return [{ kind: 'workspace', key: 'workspace', label: path.basename(root), icon: 'root-folder', route: WORKSPACE_ROUTE, ...(notice ? { notice } : {}), children: top }];
}
