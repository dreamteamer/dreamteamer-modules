// The engine extension: `dt serve [--port <n>] [--host <addr>]`. Activation binds the running engine
// and nothing else — no port is bound and nothing is printed until the verb runs.
import { bind, dt } from './engine.js';
import { serve } from './app.js';

export const apiVersion = 1;

const USAGE = `  serve [--port <n>] [--host <addr>]   the REST api at /api (default 127.0.0.1:8080; --port 0 picks a free port)`;

/** `--port <n>` / `--port=<n>` and `--host <addr>` / `--host=<addr>`; anything else is refused. */
export function parseServeArgs(argv) {
	const out = { port: 8080, host: '127.0.0.1' };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		const m = /^--(port|host)(?:=(.*))?$/.exec(a);
		if (!m) throw new Error(`\`dt serve\` does not take "${a}" — usage: dt serve [--port <n>] [--host <addr>]`);
		const value = m[2] ?? argv[++i];
		if (value === undefined || value === '' || (m[2] === undefined && value.startsWith('--'))) throw new Error(`--${m[1]} needs a value`);
		if (m[1] === 'port') {
			if (!/^\d+$/.test(value) || Number(value) > 65535) throw new Error(`--port must be a number from 0 to 65535 (got "${value}")`);
			out.port = Number(value);
		} else out.host = value;
	}
	return out;
}

export default function activate(api) {
	bind(api);
	return {
		commands: {
			serve: {
				usage: USAGE,
				async run(ws, argv) {
					const opts = parseServeArgs(argv);
					dt.warnIfStale(ws.root);
					const server = await serve(ws, opts);
					// the verb's promise IS the process lifetime: it settles only when the server closes
					await new Promise((resolve) => server.once('close', resolve));
					return 0;
				},
			},
		},
	};
}
