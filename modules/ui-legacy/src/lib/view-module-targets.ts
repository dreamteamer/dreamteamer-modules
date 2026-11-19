/**
 * WHERE A NEW VIEW CAN LAND — the module choice of Save as… and of a ui-view's record page, as data.
 *
 * The workspace module is the default (it is the engine's own default for a write with no `?module=`).
 * Every module whose sources are in this workspace is a choice: an inline `modules/*` module, and a
 * linked clone's (`git_modules/<clone>/modules/*`), which is how a view authored here reaches a module's
 * own repo. A module `npm install` put in `node_modules/` is never a choice — a write there is erased
 * by the next install — and the form says so ONCE (`lockedNote`), with their names on hover, the same
 * judgement as the native picker (`lib/module-writable.ts`): a picker that hides them in silence
 * answers "there is no such module", which is worse than one sentence saying why.
 *
 * ⚠ ONE DROPDOWN, NOT A LIST (cr-vscode-010). Until 0.24.26 each target was a radio row with its full
 * source path under it and every npm module drawn locked with the same reason; with a workspace of
 * ~19 modules the Save as… popover ran ~1800px and Save sat below the window. A choice now carries
 * no path in its label or hint: the path is the option's hover (`title`) and one line under the
 * control for the selected module (`whereOf`).
 */
import { isUnwritableModule } from './module-writable';
import type { ModuleEntry } from '../composables/modules';
import type { Choice } from './listbox';

export interface ViewModuleTarget {
	/** The `?module=` value; `null` is the workspace module — the engine's default, sent as no selector. */
	id: string | null;
	label: string;
	/** Quiet trailing text: the id, and where its sources live (kept for callers that read it). */
	hint: string;
	locked: boolean;
	/** Why a locked row cannot be picked. */
	reason?: string;
	/** The module's id on EVERY row — on the workspace row the workspace module's, '' when none is declared. */
	name: string;
	/** Workspace-relative root of its sources; '' when unknown. */
	path: string;
	/** Its sources are a linked clone's (`git_modules/`). */
	linked: boolean;
	/** The workspace module's row. */
	workspace: boolean;
}

export const LOCKED_REASON = 'installed by npm — a write there is erased by the next npm install';

export function viewModuleTargets(modules: ReadonlyArray<Pick<ModuleEntry, 'id' | 'title' | 'location' | 'path'>>, workspaceModule: string | null): ViewModuleTarget[] {
	const own = modules.find((m) => m.id === workspaceModule);
	const rows = modules
		.filter((m) => m.id !== workspaceModule)
		.map((m): ViewModuleTarget => {
			const locked = isUnwritableModule(m);
			const linked = m.location === 'git_modules';
			const where = linked ? `linked · ${m.path}` : m.path;
			return {
				id: m.id,
				label: m.title || m.id,
				hint: [m.id !== (m.title || m.id) ? m.id : '', where].filter(Boolean).join(' · '),
				locked,
				...(locked ? { reason: LOCKED_REASON } : {}),
				name: m.id,
				path: m.path ?? '',
				linked,
				workspace: false,
			};
		});
	// writable first, each half in the manifest's order — a locked row is not competing for the cursor
	rows.sort((a, b) => Number(a.locked) - Number(b.locked));
	const workspace: ViewModuleTarget = {
		id: null,
		label: 'Workspace module',
		hint: own ? `${own.id} · the default` : 'the default',
		locked: false,
		name: own?.id ?? '',
		path: own?.path ?? '',
		linked: own?.location === 'git_modules',
		workspace: true,
	};
	return [workspace, ...rows];
}

/**
 * The record page's targets: a MOVE names a module, never "the default", so the workspace row takes the
 * workspace module's id and says so in its label — and with no workspace module declared there is
 * nothing to name, so the row goes (and a view whose module is not read yet matches no row).
 */
export function recordPageTargets(targets: ViewModuleTarget[], workspaceModule: string | null): ViewModuleTarget[] {
	return targets.flatMap((t) => {
		if (!t.workspace) return [t];
		if (!workspaceModule) return [];
		return [{ ...t, id: workspaceModule, label: `${workspaceModule} (workspace module)` }];
	});
}

/**
 * Where a module's sources live, in one line: `<id> · linked · <path>`. The workspace row names the
 * workspace module (its `id` is the no-selector `null`); a workspace with none declared reads
 * `the default`, so the line under the control is never blank.
 */
export function whereOf(t: ViewModuleTarget): string {
	return [t.name, t.linked ? 'linked' : '', t.path].filter(Boolean).join(' · ') || 'the default';
}

/**
 * The dropdown's choices, in the targets' order, and the npm-installed modules split out. A choice's
 * hint is keyed on the row's FLAGS, never on its label text: the Save as… workspace row (`id` null,
 * label `Workspace module`) is hinted with the module's id; the record page's (its label already
 * names the module) is not; a linked module reads `linked`; an inline one nothing.
 */
export function moduleChoices(targets: ViewModuleTarget[]): { choices: Choice[]; locked: ViewModuleTarget[] } {
	const choices: Choice[] = [];
	const locked: ViewModuleTarget[] = [];
	for (const t of targets) {
		if (t.locked) {
			locked.push(t);
			continue;
		}
		const hint = t.workspace ? (t.id === null && t.name ? t.name : undefined) : t.linked ? 'linked' : undefined;
		choices.push({ value: t.id, text: t.label, title: whereOf(t), ...(hint ? { hint } : {}) });
	}
	return { choices, locked };
}

/** The one sentence for the modules that are not offered. */
export function lockedNote(count: number): string {
	return count === 1
		? '1 module installed by npm is not offered — a write there is erased by the next npm install.'
		: `${count} modules installed by npm are not offered — a write there is erased by the next npm install.`;
}
