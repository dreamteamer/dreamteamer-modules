// @dreamteamer/worktrees — the engine extension entry.
//
// Loaded because the workspace depends on this package (or carries it under modules/); `activate(dt)`
// receives the running engine's public API, and every engine call in this package goes through it
// (src/engine.js). The same package.json key makes this package a content module, so compile also
// discovers the `working-in-worktrees` skill.
import { bind } from './engine.js';
import { landCommand, LAND_USAGE } from './land.js';
import { worktreeCommand, WORKTREE_USAGE } from './worktrees.js';

export const apiVersion = 1;

export default function activate(api) {
	bind(api);
	return {
		// A thrown refusal (a stray flag, a target that names nothing) reaches the engine's handler:
		// `✖ <message>`, exit 1, mirrored to stdout under `--hook`.
		commands: {
			land: { usage: LAND_USAGE, run: (ws, argv) => landCommand(ws, argv) },
			worktree: { usage: WORKTREE_USAGE, run: (ws, argv) => worktreeCommand(ws, argv) },
		},
		hooks: { WorktreeCreate: 'worktree add --hook', WorktreeRemove: 'land --hook --dry-run' },
	};
}
