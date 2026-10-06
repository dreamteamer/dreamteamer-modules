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

/** Every flag this verb takes is a switch: none of them carries a value. */
export const BOOLEAN_FLAGS = ['hash', 'rehash', 'prune', 'dry-run', 'json'];

/** The engine's `parseArgs` hands the word after a `--flag` to that flag as its value, so
 *  `sync --dry-run drive/rnd` arrives as `{ 'dry-run': 'drive/rnd' }` with the drive gone from `pos`.
 *  For each switch in BOOLEAN_FLAGS that came back holding words, the words go back to `pos` and the
 *  switch becomes `true`. Given the `argv` that was parsed, `pos` is rebuilt in the order it was
 *  typed; without it the recovered words are appended. Pure: the input is not changed. */
export function normalizeArgs({ flags, pos }, argv) {
	const out = { ...flags };
	const recovered = [];
	for (const k of BOOLEAN_FLAGS) {
		if (!(k in out)) continue;
		const words = [].concat(out[k]).filter((v) => typeof v === 'string');
		if (!words.length) continue;
		recovered.push(...words);
		out[k] = true;
	}
	if (!recovered.length) return { flags: out, pos: [...pos] };
	if (!argv) return { flags: out, pos: [...pos, ...recovered] };
	// Walk argv the way the engine did, keeping every word that is now a positional, in typed order.
	const ordered = [];
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (!a.startsWith('--')) { ordered.push(a); continue; }
		if (a.includes('=')) continue;
		if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
			const next = argv[++i];
			if (BOOLEAN_FLAGS.includes(a.slice(2))) ordered.push(next);
		}
	}
	return { flags: out, pos: ordered };
}

/** `dt files <sub> …` → exit code. Subcommands are wired in by later tasks. */
export async function filesCommand(ws, argv) {
	const { flags, pos } = normalizeArgs(dt.parseArgs(argv), argv);
	const [sub, ...rest] = pos;
	const handlers = filesCommand.handlers;
	if (sub && handlers[sub]) return handlers[sub](ws, rest, flags);
	console.error(sub ? `dt files: unknown subcommand "${sub}"` : 'dt files: a subcommand is needed');
	console.error(`usage:\n${USAGE}`);
	return 2;
}
/** sub → (ws, positionals, flags) → exit code; `sync` and `status` register themselves here.
 *  No prototype, so `dt files constructor` finds nothing rather than `Object`. */
filesCommand.handlers = Object.create(null);
