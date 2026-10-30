// @dreamteamer/core — the engine extension entry. `activate(dt)` receives the running engine's
// public API; the same package.json key makes this package a content module, so compile also
// discovers its collections, views, skill, command and binding.
import { bind } from './engine.js';
import { filesCommand, USAGE } from './cli.js';
import './sync.js';    // registers filesCommand.handlers.sync
import { doctorFiles } from './status.js';  // also registers filesCommand.handlers.status
import { checkFiles } from './check.js';

export const apiVersion = 1;

export default function activate(api) {
	bind(api);
	return {
		commands: { files: { usage: USAGE, run: (ws, argv) => filesCommand(ws, argv) } },
		check: (ctx) => checkFiles(ctx),
		doctor: (ctx) => doctorFiles(ctx),
	};
}
