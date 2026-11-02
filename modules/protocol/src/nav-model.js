// THE NAV AS DATA — what the VS Code extension draws as its Collections tree (its `tree.ts`), computed
// by the same decisions (`host/nav.js`, `host/sources.js`, `host/fsdata.js`) and returned as plain
// nodes, so a host with no native tree (dt web) draws the same folders, rows, marks and order.
// `GET /nav` answers it. Each node is { kind, key, label, icon?, description?, tooltip?, route?, marks?,
// children? }; `kind` is the tree item's contextValue (workspace · group · collection · view · layers ·
// layer · layer-group · layer-collection · layer-note · message).
import fs from 'node:fs';
import path from 'node:path';
import { engine, engineLoaded } from './host/engine.js';
import { isRuntime, loadDescriptors, loadModules, loadUiViews, moduleDependencies, moduleNamespaces, navViewsOf, viewRow, workspaceModule } from './host/fsdata.js';
import { WORKSPACE_ROUTE, collectionRow, folderModule, folderPresentation, groupTopLevel, groupLabel, moduleIcon, rowMarks, groupedLayerFolders, layerEntries, layerNote, moduleLabel, navHiddenOf, orderTopLevel, routeFor, withoutHidden } from './host/nav.js';
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

const groupsOf = (raw) => {
	const out = new Map();
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
	for (const [key, ids] of Object.entries(raw)) if (Array.isArray(ids)) out.set(key, ids.filter((i) => typeof i === 'string'));
	return out;
};
const orderOf = (raw) => (Array.isArray(raw) ? raw.filter((n) => typeof n === 'string') : []);
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
			kind: 'collection', key: `c/${d.name}`, label: row.label, icon: codiconFor(row.icon), tooltip: row.tooltip, route: routeFor(d),
			...(row.count !== undefined ? { description: String(row.count) } : {}), ...(marks ? { marks } : {}), ...(kids.length ? { children: kids } : {}),
		};
	};
	const groupNode = (f, label) => {
		const module = folderModule(f, modules);
		const look = folderLook(module, f.collections);
		const node = present({ kind: 'group', key: `g/${f.key}`, label: moduleLabel(f.key, label) }, `g/${f.key}`, module, undefined, look);
		node.children = [...f.collections.map(collectionNode), ...f.children.map((c) => groupNode(c, groupLabel(c.key, titleOf, f.key)))];
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
	if (!descriptors.length) {
		top = [{ kind: 'message', key: 'message', label: 'no compiled collections — run: npm run compile', icon: 'info' }];
	} else {
		let layerGroups = [];
		try {
			const { layers } = sourcesStack(root, descriptors, ctx());
			layerGroups = groupedLayerFolders(layers, descriptors, settings.layersFolder, new Map(layers.map((l) => [l.name, layerTitle(root, l.name)])));
		} catch { /* a nav without the layers folder beats no nav */ }
		const { top: rows, folders } = groupTopLevel(descriptors, declared, workspaceModule(root), moduleDependencies(root), groupsOf(settings.navGroups), moduleNamespaces(root), titleOf);
		const layersEntries = layerGroups.map((g) => ({ kind: 'layers', label: g.label, layers: g.layers }));
		top = withoutHidden(orderTopLevel(rows, folders, orderOf(settings.navOrder), layersEntries), navHiddenOf(settings.navHidden)).map((e) =>
			e.kind === 'collection' ? collectionNode(e.descriptor)
				: e.kind === 'layers' ? { kind: 'layers', key: `layers/${e.label}`, label: e.label, icon: 'layers', children: e.layers.map(layerNode) }
					: groupNode(e.folder, groupLabel(e.folder.key, titleOf)));
	}
	return [{ kind: 'workspace', key: 'workspace', label: path.basename(root), icon: 'root-folder', route: WORKSPACE_ROUTE, children: top }];
}
