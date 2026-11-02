// The engine extension: `dt web [url|status|stop] [flags]`, and a `web` row in `dt doctor`.
import { main, parseArgs } from './cli.js';
import { running } from './runtime.js';

export const apiVersion = 1;
const USAGE = '  web [url|status|stop] [--port <n>] [--no-open] [--idle <minutes>] [--owner-pid <pid>]   the UI in your browser over this workspace (loopback; prints a sign-in URL)';

export default function activate() {
	return {
		commands: {
			web: {
				usage: USAGE,
				async run(ws, argv) { parseArgs(argv); return main(ws.root, argv); },
			},
		},
		doctor({ root }) {
			const r = running(root);
			return [{ label: 'web', state: 'ok', detail: r ? `running at http://127.0.0.1:${r.port} · pid ${r.pid}` : 'not running' }];
		},
	};
}
