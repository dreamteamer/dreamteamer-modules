// The engine extension: `dt web …` (cli.js's grammar), `dt serve` — a client token of the pane's own server, the
// one process (cr-modules-017 §8) — and a `web` row in `dt doctor`: running or not, the level, and the hook.
import { main, parseArgs, USAGE } from './cli.js';
import { hookInstalled } from './hook.js';
import { probeServer, stateFile } from './runtime.js';
import { readWorkspaceState } from './state.js';

export const apiVersion = 1;
export const SERVE_IS_TOKEN = 'dt serve is dt web token now: loopback only, a client token of the pane\'s server — dt web token [--read|--edit]';
const WEB_USAGE = `  web [open|show|select|selection|hook|token|list|revoke|status|stop|start] …   the pane: the UI over this workspace on loopback, its level, its selection and the chat's hook (${USAGE.replace(/^usage: /, '')})`;
const SERVE_USAGE = '  serve [--read|--edit] [--name <n>]   a client token and the API base of this workspace\'s dt web server (dt web token)';

export default function activate() {
	return {
		commands: {
			web: {
				usage: WEB_USAGE,
				async run(ws, argv) { parseArgs(argv); return main(ws.root, argv); },
			},
			serve: {
				usage: SERVE_USAGE,
				async run(ws, argv) {
					if (argv.some((a) => /^--(host|port|token)(=|$)/.test(a))) { console.error(`✖ ${SERVE_IS_TOKEN}`); return 2; }
					const args = ['token', ...argv];
					if (!argv.some((a) => /^--name(=|$)/.test(a))) args.push('--name', 'serve');
					parseArgs(args);
					return main(ws.root, args);
				},
			},
		},
		async doctor({ root }) {
			// running = the server proves it is the runtime file's, never a live pid alone (runtime.js `probeServer`)
			const p = await probeServer(stateFile(root));
			const r = p?.proven ? p : null;
			let level = 'edit';
			try { level = readWorkspaceState(root).level; } catch { /* unreadable: the default */ }
			const word = level[0].toUpperCase() + level.slice(1);
			const rows = [{ label: 'web', state: 'ok', detail: `${r ? `running at http://127.0.0.1:${r.port} · pid ${r.pid}` : 'not running'} · level ${word}` }];
			rows.push(hookInstalled(root)
				? { label: 'web hook', state: 'ok', detail: 'the chat sees the pane (.claude/settings.local.json)' }
				: { label: 'web hook', state: 'warn', detail: 'the chat cannot see the pane', fix: 'dt web hook --install' });
			return rows;
		},
	};
}
