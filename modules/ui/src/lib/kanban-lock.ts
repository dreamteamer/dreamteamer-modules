/**
 * What a kanban may do with its COLUMN field — the one answer `ListKanban` reads (cr-vscode-009).
 *
 * The board asks the record form's own rule, `hasControl`, rather than restating it, so the two cannot
 * disagree: a field the edit form draws no control for (`editable: false`, `editable: 'create'`, or any
 * engine-held `kind`) is not one a drag may write. The engine's `editable: false` "locks only the UI and
 * lets the CLI and syncs through" — this is the UI honouring it on the one surface that wrote a field
 * without asking.
 *
 *  - `columns` — cards may not change column (a drop writes the column field).
 *  - `add`     — the column header `+` (a create prefilled with the column's value) is offered: the create
 *                form's rule, so a create-only field keeps it and a locked or engine-held one does not.
 *  - `reason`  — what a card on a locked board says on hover; null when nothing is locked.
 *
 * Manual ordering (a `position_field`) writes its own field, not the column's, so it stays available
 * within a card's column — the reason says so when it is on.
 */
import type { FieldRow } from '../api/types';
import { hasControl } from './field-row';

export interface KanbanLock {
	columns: boolean;
	add: boolean;
	reason: string | null;
}

export function kanbanLock(field: Pick<FieldRow, 'field' | 'title' | 'kind' | 'editable'> | null, opts: { reorder: boolean }): KanbanLock {
	if (!field) return { columns: false, add: true, reason: null };
	const columns = !hasControl(field, { create: false });
	const add = hasControl(field, { create: true });
	if (!columns) return { columns, add, reason: null };
	const name = field.title || field.field;
	const reason = opts.reorder
		? `${name} is not editable here — this card can be reordered within its column, not moved to another.`
		: `${name} is not editable here, so this card cannot be moved to another column.`;
	return { columns, add, reason };
}
