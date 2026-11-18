/**
 * WHAT AN EXTENSION SAYS ABOUT A RECORD, as the webview draws it (cr-vscode-005). The host sends the
 * engine's `contributedNotes` lines — on a browse row as `$notes`, on the record page from `GET /notes`,
 * under each record on the Activity page — each with its `<collection>/<id>` references already found
 * and marked by whether this workspace holds them (`src/next-notes.ts`, `src/note-refs.ts`). Nothing
 * here reads the words: the sentence is the extension's (core's "in session by …"), drawn verbatim.
 */
import type { NextNote } from '@dreamteamer/protocol/host/next-notes';

export type { NextNote };

export const NOTES_KEY = '$notes';

/** The notes the host stamped on a browse row; `[]` when it has none. */
export function notesOfRow(row: Record<string, unknown>): NextNote[] {
	const v = row[NOTES_KEY];
	return Array.isArray(v) ? (v as NextNote[]) : [];
}

/** The row mark's tooltip: each sentence verbatim, one per line. */
export function markTitle(notes: readonly NextNote[]): string {
	return notes.map((n) => n.text).join('\n');
}

/** A note's text cut into plain runs and references at the host's offsets; a reference whose record
 *  this workspace does not hold stays text, so no link opens onto nothing. */
export function textParts(note: NextNote): Array<{ text: string; ref?: string }> {
	const out: Array<{ text: string; ref?: string }> = [];
	let at = 0;
	for (const r of [...(note.refs ?? [])].sort((a, b) => a.start - b.start)) {
		if (r.start < at || note.text.slice(r.start, r.end) !== r.ref) continue;
		if (r.start > at) out.push({ text: note.text.slice(at, r.start) });
		out.push(r.exists ? { text: r.ref, ref: r.ref } : { text: r.ref });
		at = r.end;
	}
	if (at < note.text.length) out.push({ text: note.text.slice(at) });
	// adjacent plain runs read as one
	return out.reduce<Array<{ text: string; ref?: string }>>((acc, p) => {
		const last = acc[acc.length - 1];
		if (last && !last.ref && !p.ref) last.text += p.text;
		else acc.push({ ...p });
		return acc;
	}, []);
}
