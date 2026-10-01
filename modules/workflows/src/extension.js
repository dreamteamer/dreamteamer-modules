// @dreamteamer/workflows — the engine extension entry.
//
// Loaded because the workspace DEPENDS on this package; `activate(dt)` receives the running engine's
// public API, and every engine call in this package goes through it (src/engine.js). The same
// package.json key makes this package a content module, so compile also discovers
// `collections/proofs.collection.yaml` and the two skills under `skills/`.
import { bind, dt } from './engine.js';
import { proveCommand, PROVE_USAGE } from './prove.js';
import { landCommand, LAND_USAGE } from './land.js';
import { worktreeCommand, WORKTREE_USAGE } from './worktrees.js';
import { analyze } from './analyze.js';

export const apiVersion = 1;

export default function activate(api) {
	bind(api);
	return {
		// A thrown refusal (a stray flag, a target that names nothing) reaches the engine's handler:
		// `✖ <message>`, exit 1, mirrored to stdout under `--hook`. A verdict is a RETURNED code.
		commands: {
			// ⚠ THE EXIT CODE IS THE WHOLE POINT OF `prove`: 0 pass · 1 fail · 3 unavailable · 4 no-fixture ·
			// 5 pending · 6 vacuous (2 stays reserved for a retired verb spelling, which the engine answers)
			prove: { usage: PROVE_USAGE, run: (ws, argv) => { dt.warnIfStale(ws.root); return proveCommand(ws, argv).code; } },
			land: { usage: LAND_USAGE, run: (ws, argv) => landCommand(ws, argv) },
			worktree: { usage: WORKTREE_USAGE, run: (ws, argv) => worktreeCommand(ws, argv) },
		},
		// `proofs/fixtures/` holds RECORDS a `writes` proof runs against, not proofs
		sourceKinds: [{ kind: 'proofs', exclude: ['fixtures'] }],
		analyze,
		hooks: { WorktreeCreate: 'worktree add --hook', WorktreeRemove: 'land --hook --dry-run' },
		orientation: 'before saying an artifact works, run `dt prove <artifact>` and quote its result.',
	};
}

