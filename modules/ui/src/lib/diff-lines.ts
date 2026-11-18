/**
 * Unified-diff text → per-line classification, for minimal +/- coloring in the item-history diff
 * expander (no diff-rendering lib — the server already computed the diff text, this just decides
 * how to color each line). File/hunk header lines (`---`/`+++`/`diff --git`/`index`/`@@`) classify
 * as `meta` before the bare `+`/`-` prefix check, since those lines start with the same characters.
 */
export type DiffLineKind = 'add' | 'remove' | 'context' | 'meta';

export interface ClassifiedDiffLine {
	text: string;
	kind: DiffLineKind;
}

const META_PREFIXES = ['+++', '---', 'diff --git', 'diff ', 'index ', '@@'];

function classifyLine(line: string): DiffLineKind {
	if (META_PREFIXES.some((prefix) => line.startsWith(prefix))) return 'meta';
	if (line.startsWith('+')) return 'add';
	if (line.startsWith('-')) return 'remove';
	return 'context';
}

export function classifyDiffLines(diff: string): ClassifiedDiffLine[] {
	if (!diff) return [];
	// A trailing newline would otherwise produce a spurious empty final "context" line.
	const text = diff.endsWith('\n') ? diff.slice(0, -1) : diff;
	if (text === '') return [];
	return text.split('\n').map((line) => ({ text: line, kind: classifyLine(line) }));
}
