// The static server the browser tools play against: the config's `serve` command (default python3's
// http.server on 127.0.0.1), on a free port, stopped when the tool exits.
import { spawn } from 'node:child_process';
import net from 'node:net';

export const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.unref(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });

/** split a command template into argv, filling {port} and {public} */
export function command(template, { port, publicDir }) {
	return template.split(/\s+/).filter(Boolean).map((a) => a.replace('{port}', String(port)).replace('{public}', publicDir));
}

/** → { base, stop } — base is `http://127.0.0.1:<port>/index.html` */
export async function serve(c, port = null) {
	const p = port || await freePort();
	const [cmd, ...args] = command(c.serve, { port: p, publicDir: c.paths.public });
	const proc = spawn(cmd, args, { stdio: 'ignore', cwd: c.dir });
	const stop = () => { try { proc.kill('SIGTERM'); } catch { /* gone */ } };
	process.once('exit', stop);
	const base = `http://127.0.0.1:${p}/index.html`;
	for (let t = 0; t < 100; t++) {
		try { const r = await fetch(base); if (r.ok) return { base, stop, port: p }; } catch { /* not up yet */ }
		await new Promise((r) => setTimeout(r, 100));
	}
	stop();
	throw new Error(`the static server did not start on ${p} (${c.serve})`);
}
