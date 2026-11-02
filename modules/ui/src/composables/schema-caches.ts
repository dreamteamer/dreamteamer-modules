/**
 * The live wiring for `lib/schema-refresh.ts` — every module-level schema cache the app holds, in
 * one object, so that "did we miss one?" is a question you can answer by reading a single file.
 *
 * The split is not ceremony: `lib/` is this repo's PURE tier (tier 1 bundles it with esbuild and
 * runs it in plain node), and each import below reaches `api/transport.ts`, which registers a
 * `window` message listener at import time. One of them in `lib/` is a `ReferenceError: window is
 * not defined` before any assertion runs.
 *
 * ⚠ WHEN YOU ADD A MODULE-LEVEL SCHEMA CACHE, ADD IT HERE. The symptom of forgetting is not an
 * error — it is one stale panel in an otherwise refreshed app, which reads as a rendering bug and
 * gets debugged as one.
 */
import type { SchemaCaches } from '../lib/schema-refresh';
import { invalidateContract } from '../api/adapter';
import { invalidateServerInfo } from '../api/info';
import { refreshCollections } from './collections';
import { invalidateRelations, reloadCachedFields } from './fields';

export const liveSchemaCaches: SchemaCaches = {
	invalidateContract,
	invalidateServerInfo,
	invalidateRelations,
	refreshCollections,
	reloadCachedFields,
};
