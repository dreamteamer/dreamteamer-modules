// `dt files <sub> …` — the one verb this extension adds, with its two subcommands.
import { dt } from './engine.js';

export const USAGE = [
	'  files sync [<drive>[/<subfolder>]] [--hash] [--rehash] [--prune] [--dry-run] [--json]',
	'                                              (walk each drive\'s folder and bring data/files level',
	'                                               with it: new files added, changed ones updated,',
	'                                               vanished ones marked missing, a hash-matched move',
	'                                               renamed. An unchanged file with unchanged pointers',
	'                                               is not written. --hash fills hashes still missing,',
	'                                               --rehash recomputes all, --prune removes missing',
	'                                               entries nobody annotated or references)',
	'  files status [--json]                       (per drive: resolves on this machine, exists,',
	'                                               entries, missing, cloud-only, last synced. No writes)',
].join('\n');

/** `dt files <sub> …` → exit code. Subcommands are wired in by later tasks. */
export async function filesCommand(ws, argv) {
	const { flags, pos } = dt.parseArgs(argv);
	const [sub, ...rest] = pos;
	const handlers = filesCommand.handlers;
	if (sub && handlers[sub]) return handlers[sub](ws, rest, flags);
	console.error(sub ? `dt files: unknown subcommand "${sub}"` : 'dt files: a subcommand is needed');
	console.error(`usage:\n${USAGE}`);
	return 2;
}
/** sub → (ws, positionals, flags) → exit code; `sync` and `status` register themselves here. */
filesCommand.handlers = {};
