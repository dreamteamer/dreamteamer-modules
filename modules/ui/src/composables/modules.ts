/**
 * The workspace's MODULES, as the Schema tab's `modules` surface needs them.
 *
 * Two reads, merged, and the split is deliberate:
 *  - `GET /items/modules` — the compiled module RECORDS (id, title, package name, namespaces,
 *    dependencies, what each ships). Ordinary records of an ordinary collection.
 *  - `GET /info` — the manifest's own `modules` array, which is where **location** and **path** come
 *    from. Not from a records read: how a module ARRIVED is a fact about the manifest, and asking the
 *    records for it would make the surface disagree with what actually compiled.
 *
 * ⚠ `location` is read with `channel` as a fallback, and that is not defensiveness — it is the
 * version skew this extension lives with. The field was `channel` up to engine 0.18 and is
 * `location` from the redesign on (values: `modules` · `git_modules` · `node_modules` · `root`,
 * the folder names the operator already knows). The manifest keeps a compat read of the old key for
 * one release, so both spellings are live in the field at once.
 */
import { ref } from 'vue';
import { api } from '../api/client';

export interface ModuleEntry {
	/** The record id — THE identity everywhere the operator types it (`--module <id>`). */
	id: string;
	/** What to call it. Authored, because an acronym cannot be derived. */
	title: string;
	/** The package name, verbatim — `@acme/core`. Differs from the id on a forked module. */
	name: string;
	/** How it arrived: `modules` · `git_modules` · `node_modules` · `root`. */
	location: string;
	/** Workspace-relative root of its sources. */
	path: string;
	namespaces: string[];
	dependencies: string[];
	peerDependencies: string[];
	/** Collections it contributed a source for. A merged collection appears under every contributor. */
	collections: string[];
	description: string;
}

interface ManifestModule {
	name?: string;
	location?: string;
	channel?: string;
	path?: string;
	root?: string;
}

const list = (v: unknown): string[] =>
	Array.isArray(v) ? v.map(String) : typeof v === 'string' && v.trim() ? [v] : [];

const modules = ref<ModuleEntry[]>([]);
/** The module a write with no `?module=` lands in (`/info`'s `workspace_module`); null when unknown. */
const workspaceModule = ref<string | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
let loaded = false;

async function load(): Promise<void> {
	loading.value = true;
	error.value = null;
	try {
		const [records, info] = await Promise.all([
			api.get<Array<Record<string, unknown>>>('/items/modules?limit=200'),
			// `/info` is a clean-contract READ, passed straight through by the adapter. Tolerated
			// failure: without it the list simply has no location/path column to fill, which is a
			// poorer table rather than a broken one.
			api.get<{ modules?: ManifestModule[]; workspace_module?: string | null }>('/info').catch(() => null),
		]);
		const byName = new Map<string, ManifestModule>();
		for (const m of info?.data?.modules ?? []) {
			if (m?.name) byName.set(String(m.name), m);
		}

		workspaceModule.value = info?.data?.workspace_module ?? null;
		modules.value = records.data.map((r) => {
			const name = String(r['name'] ?? r['id'] ?? '');
			const entry = byName.get(name);
			return {
				id: String(r['id'] ?? ''),
				title: String(r['title'] ?? r['id'] ?? name),
				name,
				location: String(entry?.location ?? entry?.channel ?? r['location'] ?? r['channel'] ?? ''),
				path: String(entry?.path ?? entry?.root ?? r['path'] ?? ''),
				namespaces: list(r['namespaces']),
				dependencies: list(r['dependencies']),
				peerDependencies: list(r['peer_dependencies'] ?? r['peerDependencies']),
				collections: list(r['collections']),
				description: String(r['description'] ?? ''),
			};
		});
		loaded = true;
	} catch (err) {
		error.value = err instanceof Error ? err.message : String(err);
	} finally {
		loading.value = false;
	}
}

/** Re-read only if something already has — same guard, and same reason, as `useCollections`. */
export async function refreshModules(): Promise<void> {
	if (!loaded) return;
	await load();
}

export function useModules() {
	if (!loaded) void load();
	return { modules, workspaceModule, loading, error, reload: load };
}
