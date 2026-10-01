// The two small helpers this package needs from nowhere else. Copied, not imported: `dt-docker` runs
// on a machine with no workspace and no engine installed, so it depends on nothing but Node.
import fs from 'node:fs';

/** `.env` TEXT → Map. Never shell-evaluates. `KEY=value`, optional `export `, optional single or double
 *  quotes (a quoted value may span lines; an unquoted one runs to the end of its line and keeps any
 *  trailing `# comment`). `KEY =value` does not match and is dropped. */
export function parseEnvValues(text) {
	const out = new Map();
	const re = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=("(?:[^"\\]|\\.)*"|'[^']*'|[^\n]*)$/gm;
	let m;
	while ((m = re.exec(text))) {
		let v = m[2].trim();
		if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
		out.set(m[1], v);
	}
	return out;
}

/** Write a whole document to stdout synchronously — `console.log` to a pipe may still be buffered
 *  when the verb calls `process.exit`, and a JSON document cut short is worse than none. */
export const emit = (s, fd = 1) => {
	const buf = Buffer.from(s + '\n');
	let off = 0;
	while (off < buf.length) {
		try { off += fs.writeSync(fd, buf, off, buf.length - off); } catch (e) { if (e.code !== 'EAGAIN') throw e; }
	}
};
