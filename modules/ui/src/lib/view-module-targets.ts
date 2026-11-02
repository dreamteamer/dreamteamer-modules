/**
 * WHERE A NEW VIEW CAN LAND — the Save as… form's module rows, as data.
 *
 * The workspace module is the default (it is the engine's own default for a write with no `?module=`).
 * Every module whose sources are in this workspace is offered by name: an inline `modules/*` module,
 * and a linked clone's (`git_modules/<clone>/modules/*`), which is how a view authored here reaches a
 * module's own repo. A module `npm install` put in `node_modules/` is DRAWN, locked, with the reason
 * on its row — the same judgement as the native picker (`lib/module-writable.ts`): a picker that hides
 * it answers "there is no such module", which is worse than one that says why it is not a target.
 */
import { isUnwritableModule } from './module-writable';
import type { ModuleEntry } from '../composables/modules';

export interface ViewModuleTarget {
	/** The `?module=` value; `null` is the workspace module — the engine's default, sent as no selector. */
	id: string | null;
	label: string;
	/** Quiet trailing text: the id, and where its sources live. */
	hint: string;
	locked: boolean;
	/** Why a locked row cannot be picked — on the row, before anybody picks it. */
	reason?: string;
}

export const LOCKED_REASON = 'installed by npm — a write there is erased by the next npm install';

export function viewModuleTargets(modules: ReadonlyArray<Pick<ModuleEntry, 'id' | 'title' | 'location' | 'path'>>, workspaceModule: string | null): ViewModuleTarget[] {
	const own = modules.find((m) => m.id === workspaceModule);
	const rows = modules
		.filter((m) => m.id !== workspaceModule)
		.map((m): ViewModuleTarget => {
			const locked = isUnwritableModule(m);
			const where = m.location === 'git_modules' ? `linked · ${m.path}` : m.path;
			return { id: m.id, label: m.title || m.id, hint: [m.id !== (m.title || m.id) ? m.id : '', where].filter(Boolean).join(' · '), locked, ...(locked ? { reason: LOCKED_REASON } : {}) };
		});
	// writable first, each half in the manifest's order — a locked row is not competing for the cursor
	rows.sort((a, b) => Number(a.locked) - Number(b.locked));
	return [{ id: null, label: 'Workspace module', hint: own ? `${own.id} · the default` : 'the default', locked: false }, ...rows];
}
