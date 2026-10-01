#!/usr/bin/env node
// extract-frames — turn a screen recording into the frames an agent can actually read, plus one
// contact sheet that shows the whole recording in a single image.
//
//   node extract-frames.mjs --in <recording> --out <folder> [--every <seconds>] [--width <px>] [--sheet] [--dry-run]
//
// `--every` (default 4) is seconds between frames; `--width` (default 1280) scales each frame, height
// follows. `--sheet` also writes `sheet.png`, a 4×N tile of the frames at half width — read that first.
// `--dry-run` prints the ffmpeg calls and touches nothing. ffmpeg is the only dependency, and the doctor
// (`npx dt-extensions doctor`, capability `rnd`) says whether it is on PATH.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** The ffmpeg argv lists a set of options becomes — pure, so a fixture can pin it. */
export function ffmpegArgs({ input, out, every = 4, width = 1280, sheet = false }) {
	if (!input) throw new Error('--in <recording> is required');
	if (!out) throw new Error('--out <folder> is required');
	const e = Number(every), wd = Number(width);
	if (!(e > 0)) throw new Error(`--every must be a positive number of seconds, got "${every}"`);
	if (!(wd > 0)) throw new Error(`--width must be a positive number of pixels, got "${width}"`);
	const calls = [
		{ purpose: 'frames', argv: ['-v', 'error', '-y', '-i', input, '-vf', `fps=1/${e},scale=${wd}:-1`, path.join(out, 'f-%03d.png')] },
	];
	// The sheet is read from the SAME sampling, at half width, four across. `tile` needs the count
	// per sheet, so a long recording becomes several numbered sheets rather than one unreadable one.
	if (sheet) calls.push({ purpose: 'sheet', argv: ['-v', 'error', '-y', '-i', input, '-vf', `fps=1/${e},scale=${Math.round(wd / 2)}:-1,tile=4x6`, path.join(out, 'sheet-%d.png')] });
	return calls;
}

export function parseArgs(argv) {
	const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
	return { input: opt('in'), out: opt('out'), every: opt('every') ?? 4, width: opt('width') ?? 1280, sheet: argv.includes('--sheet'), dryRun: argv.includes('--dry-run') };
}

export function main(argv) {
	let opts, calls;
	try { opts = parseArgs(argv); calls = ffmpegArgs(opts); }
	catch (e) { console.error(`✖ ${e.message}\nusage: extract-frames.mjs --in <recording> --out <folder> [--every <s>] [--width <px>] [--sheet] [--dry-run]`); return 2; }
	for (const c of calls) console.log(`${opts.dryRun ? 'plan' : 'run '} ${c.purpose.padEnd(6)} ffmpeg ${c.argv.join(' ')}`);
	if (opts.dryRun) return 0;
	if (!fs.existsSync(opts.input)) { console.error(`✖ ${opts.input} does not exist`); return 1; }
	fs.mkdirSync(opts.out, { recursive: true });
	for (const c of calls) {
		try { execFileSync('ffmpeg', c.argv, { stdio: ['ignore', 'inherit', 'inherit'] }); }
		catch (e) { console.error(`✖ ffmpeg ${c.purpose} failed — ${e.code === 'ENOENT' ? 'ffmpeg is not on PATH (macOS: brew install ffmpeg)' : e.message}`); return 1; }
	}
	const frames = fs.readdirSync(opts.out).filter((f) => /^f-\d+\.png$/.test(f)).length;
	const sheets = fs.readdirSync(opts.out).filter((f) => /^sheet-\d+\.png$/.test(f)).length;
	console.log(`✔ ${frames} frame(s)${sheets ? ` · ${sheets} sheet(s)` : ''} → ${opts.out}`);
	return frames ? 0 : 1;
}

/** ⚠ RUN AS A SCRIPT — AND THROUGH A SYMLINK. `process.argv[1]` is the path as INVOKED and
 *  `import.meta.url` the path RESOLVED; under preview mode this module is reached through a
 *  `git_modules/<name>` symlink into a clone elsewhere, so the two are different strings for the same
 *  file and a `===` between them is false. The entry guard then never fires — no output, exit 0, and
 *  a reader sees a clean run. Measured 2026-09-11; `tests/script-entry.test.mjs` holds it. */
const isMain = () => {
	if (!process.argv[1]) return false;
	const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
	return real(process.argv[1]) === real(fileURLToPath(import.meta.url));
};

if (isMain()) process.exit(main(process.argv.slice(2)));
