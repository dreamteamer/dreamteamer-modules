// notebooklm — the engine extension. Two contributions, both about one consumer that is not a coding
// agent:
//   commands.notebooklm   `dt notebooklm …` — render the workspace as NotebookLM sources, optionally sync
//   harnesses.notebooklm  NOTEBOOKLM.md's managed block, on every compile while the harness is enabled
// The engine hands `activate` its own public API; nothing here imports the engine.
import { bind } from './engine.js';
import { notebooklmCommand, USAGE } from './export.js';
import { render } from './harness.js';

export const apiVersion = 1;

export default function activate(dt) {
	bind(dt);
	return {
		commands: { notebooklm: { usage: USAGE, run: (ws, argv) => notebooklmCommand(ws, argv) } },
		harnesses: { notebooklm: render },
	};
}
