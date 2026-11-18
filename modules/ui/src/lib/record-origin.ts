/**
 * WHERE A RECORD COMES FROM, AND ITS REPO STATE — the record page's sub-header, beside the commit line:
 *
 *     ● project-a layer · ahead 1 · uncommitted
 *     ● org module
 *     ● my-hq · uncommitted
 *     env folder · never committed
 *
 * ONE line instead of the old "shared from ● project-a" under the title, which sat a few rows above the
 * provenance field also titled "Source" (design 2026-10-30, Q1-D + Q2-A/E). The ORIGIN is `$source` /
 * `$source-kind` (where the file is read from — the host's `src/sources.ts`); the REPO STATE is
 * `$repo`, `$dirty` and `$ahead` (`src/repo-state.ts`), which an engine without `Store#locate`
 * (0.39.1 and older) does not send — then the line is the origin alone, never a guess.
 *
 * Pure, so every wording here is a test (`test/unit/record-origin.test.ts`).
 */
import type { SourceVia } from '../api/types';
import { SOURCE_FIELD, SOURCE_KIND_FIELD } from './sources';

export const REPO_FIELD = '$repo';
export const DIRTY_FIELD = '$dirty';
export const AHEAD_FIELD = '$ahead';

export type OriginKind = 'own' | 'layer' | 'module' | 'env';

export interface RecordOrigin {
	/** The root's name — the source mark's word. Null for an env-pointed root, which is a folder on this
	 *  machine and drawn as one. */
	name: string | null;
	kind: OriginKind;
	/** `ahead 2` · `uncommitted` · `never committed`, in that order — empty when there is nothing to say
	 *  or the engine cannot say it. */
	state: string[];
	/** The hover: the whole fact in a sentence. */
	tooltip: string;
	/** The engine named a repo that commits it — so "no commit holds this record yet" is a fact, not a
	 *  guess (a compiled kind's file, and an engine without `$repo`, say nothing about commits). */
	inRepo: boolean;
}

/** The record's origin and repo state, or null before the record (and its source) is known. */
export function recordOrigin(record: Record<string, unknown> | null | undefined): RecordOrigin | null {
	if (!record) return null;
	const name = typeof record[SOURCE_FIELD] === 'string' ? (record[SOURCE_FIELD] as string) : null;
	const sourceKind = record[SOURCE_KIND_FIELD];
	const knowsRepo = REPO_FIELD in record;
	const repo = record[REPO_FIELD];
	if (knowsRepo && repo === null) {
		return { name: null, kind: 'env', state: ['never committed'], tooltip: 'Kept in a folder on this machine, outside every git repo here — saved, never committed.', inRepo: false };
	}
	if (!name) return null;
	const kind: OriginKind = sourceKind === 'layer' || sourceKind === 'module' ? sourceKind : 'own';
	const state: string[] = [];
	const ahead = record[AHEAD_FIELD];
	if (typeof ahead === 'number' && ahead > 0) state.push(`ahead ${ahead}`);
	if (record[DIRTY_FIELD] === true) state.push('uncommitted');
	const where = kind === 'layer' ? `Read from the record layer ${name}` : kind === 'module' ? `Read from the module ${name}'s shared list` : `Read from ${name}, this workspace`;
	const repoWords = typeof repo === 'string' ? ` — committed in ${repo === '.' ? 'this workspace\'s repo' : repo}` : '';
	const stateWords = [
		typeof ahead === 'number' && ahead > 0 ? `${ahead} commit${ahead === 1 ? '' : 's'} not pushed` : '',
		record[DIRTY_FIELD] === true ? 'changes on disk no commit holds yet' : '',
	].filter(Boolean).join('; ');
	return { name, kind, state, tooltip: `${where}${repoWords}.${stateWords ? ` ${stateWords[0]!.toUpperCase()}${stateWords.slice(1)}.` : ''}`, inRepo: typeof repo === 'string' };
}

/** The kind's word after the mark — none for the workspace's own root, which needs no qualifier. */
export function originKindWord(kind: OriginKind): string {
	return kind === 'layer' ? 'layer' : kind === 'module' ? 'module' : kind === 'env' ? 'env folder' : '';
}

/**
 * The CLASS word after the mark, when the host said what the root is (cr-vscode-004): `layer`,
 * `linked clone`, `package` — and none for the workspace's own root. A host that did not say falls back
 * to the kind's word, so the line never loses a word it used to have.
 */
export function originClassWord(kind: OriginKind, via: SourceVia | undefined): string {
	if (kind === 'env' || !via) return originKindWord(kind);
	return via === 'layer' ? 'layer' : via === 'clone' ? 'linked clone' : via === 'package' ? 'package' : '';
}
