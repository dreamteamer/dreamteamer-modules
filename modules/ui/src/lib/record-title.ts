/** Shared record-title resolution for EditRelation and ViewRelation. */
import type { ItemRecord } from '../api/types';

/** Best-effort human title for a relation-target record: explicit titleField, then title, then name, then id. */
export function titleOf(record: ItemRecord | null | undefined, titleField?: string): string {
	if (!record) return '';
	if (titleField && record[titleField] != null) return String(record[titleField]);
	if (record['title'] != null) return String(record['title']);
	if (record['name'] != null) return String(record['name']);
	if (record['id'] != null) return String(record['id']);
	return '';
}

/** Filename stem of a canonical record path (`/humans/ada.human.md` → `ada`), for un-expanded relation values. */
export function pathStem(path: string): string {
	const base = path.split('/').pop() ?? path;
	const dot = base.indexOf('.');
	return dot === -1 ? base : base.slice(0, dot);
}
