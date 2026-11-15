// ACCEPTANCE — CORE NEEDS NO LINKEDIN AND NO GOOGLE CALENDAR (cr-modules-018; rnd/tests
// dreamteamer-modules/cr-modules-018-t1 … t5, t7, t8). One describe per acceptance line of the change
// request, measured on the real engine: `dt install @dreamteamer/core --from` a folder packed from this repo
// into a fresh workspace, with a HOME of its own for every run and no network. Line 4 reads
// `@dreamteamer/connectors-google-workspace` (the acceptance review's finding: the operator renamed the
// package after the line was written); line 1 covers the calendar setup unit by its id, not only by the
// words "LinkedIn" and "Google", which its status line never printed. Line 2's "list" is the LISTING —
// the compiled command and skill files, their harness copies, `dt next`, and the `commands:` / `skills:` /
// verbs-bound entries of the instruction files — not any prose that names a connector's command beside
// the connector's package name. Lines 6 and the switch from google-workspace 0.3.0 need the published
// 0.12.0 set and live in cr-modules-018-existing-workspaces.test.mjs.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { ROOT, closure, packedInto, virginWorkspace, run, cleanup, engineMeets, pkgOf, ENGINE_VERSION } from './helpers/workspace.ts';

const made = [];
after(() => { cleanup(); for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = (p) => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p))); made.push(d); return d; };
/** A HOME of its own for every engine run: nothing reads or writes the person's real one. */
const HOME = () => ({ HOME: tmp('dtm-HOME-') });

const skip = !engineMeets('core') ? `a module preset installs on engine 0.49.0 or later; testing ${ENGINE_VERSION}` : false;

const MOVED = ['scrape-contact', 'fetch-meetings', 'scraping-contacts', 'fetching-meetings'];
const NAMES = new RegExp(`(?<![\\w-])/?(${MOVED.join('|')})(?![\\w-])`);
const ROUTES = { 'contacts-needs-linkedin': '/contacts/needs-linkedin', 'contacts-review-linkedin': '/contacts/review-linkedin' };
const FIXTURES = path.join(ROOT, 'tests', 'fixtures', 'cr-modules-018', 'data');
const SYNC_ROW = 'team@northwind.example | northwind | dana@northwind.example';

let FROM;
const from = () => (FROM ??= packedInto(tmp('dtm-018-from-'), ...new Set([...closure('core'), ...closure('connectors-linkedin'), ...closure('connectors-google-workspace')])));

function coreOnly() {
	const root = virginWorkspace();
	const r = run(root, ['install', '@dreamteamer/core', '--from', from(), '--no-input'], HOME());
	assert.equal(r.status, 0, `dt install @dreamteamer/core: exit ${r.status}\n${r.stderr}\n${r.stdout.slice(-1500)}`);
	return root;
}

/** Every file under `dir`, relative to it, sorted. */
function walk(dir, base = dir) {
	if (!fs.existsSync(dir)) return [];
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const p = path.join(dir, e.name);
		return e.isDirectory() ? walk(p, base) : [path.relative(base, p)];
	}).sort();
}

/** The entries of an instruction file that LIST commands and skills: a module's `skills: … · commands: …`
 *  line, and every line of the VERBS BOUND TO COLLECTIONS block. */
function listingLines(text) {
	const lines = text.split('\n');
	const out = lines.filter((l) => /^\s+(skills|commands|verbs|runs):\s/.test(l));
	const at = lines.findIndex((l) => l.startsWith('VERBS BOUND TO COLLECTIONS'));
	if (at >= 0) for (const l of lines.slice(at + 1)) { if (!l.startsWith('- ')) break; out.push(l); }
	return out;
}

describe('core only — lines 1, 2, 5 and 8', { skip }, () => {
	let root;
	before(() => { root = coreOnly(); });

	describe('t1 core-only shows no LinkedIn or Google (line 1)', () => {
		test('dt status names neither LinkedIn nor Google, and lists no meetings setup unit', () => {
			const s = run(root, ['status'], HOME());
			assert.equal(s.status, 0, s.stderr);
			const out = s.stdout + s.stderr;
			assert.doesNotMatch(out, /linkedin/i, out);
			assert.doesNotMatch(out, /google/i, out);
			assert.doesNotMatch(out, /WORK_CALENDARS|LINKEDIN_USER_AGENT/, out);
			// the module line `meetings  no setup` is the meetings PACKAGE; a setup unit named meetings is what left
			assert.deepEqual(out.split('\n').filter((l) => /^\s*(\S+ › )?meetings\s/.test(l) && !/^\s*meetings\s+no setup\s*$/.test(l)), [], out);
			const j = run(root, ['status', '--json'], HOME());
			assert.equal(j.status, 0, j.stderr);
			assert.deepEqual(JSON.parse(j.stdout).setup.filter((l) => l.unit === 'meetings'), [], 'a meetings setup unit is still declared');
		});
		test('dt doctor names neither LinkedIn nor Google, and has no meetings unit block', () => {
			const d = run(root, ['doctor'], HOME());
			const out = d.stdout + d.stderr;
			assert.doesNotMatch(out, /linkedin/i, out);
			assert.doesNotMatch(out, /google/i, out);
			assert.doesNotMatch(out, /WORK_CALENDARS|LINKEDIN_USER_AGENT/, out);
			assert.doesNotMatch(d.stdout, /^(\S+ › )?meetings — /m, d.stdout);
		});
		test('.env.example names neither LINKEDIN_USER_AGENT nor WORK_CALENDARS', () => {
			const example = path.join(root, '.env.example');
			if (!fs.existsSync(example)) return;
			const text = fs.readFileSync(example, 'utf8');
			assert.doesNotMatch(text, /LINKEDIN_USER_AGENT/);
			assert.doesNotMatch(text, /WORK_CALENDARS/);
		});
	});

	describe('t2 core-only compiles no scraper or sync (line 2)', () => {
		test('no compiled command or skill of the four names', () => {
			for (const f of ['commands/scrape-contact.command.md', 'commands/fetch-meetings.command.md', 'skills/scraping-contacts', 'skills/fetching-meetings']) {
				assert.ok(!fs.existsSync(path.join(root, '.dreamteamer', f)), `.dreamteamer/${f} was compiled`);
			}
			const named = walk(path.join(root, '.dreamteamer')).filter((f) => /^(commands|skills|command-bindings)\//.test(f) && NAMES.test(f));
			assert.deepEqual(named, []);
		});
		test('no harness copy of either command or skill under .claude/, .agents/ or .cursor/', () => {
			const copies = ['.claude', '.agents', '.cursor'].flatMap((h) => walk(path.join(root, h)).map((f) => `${h}/${f}`)).filter((f) => NAMES.test(f));
			assert.deepEqual(copies, []);
		});
		test('dt next contacts and dt next meetings name neither command', () => {
			for (const c of ['contacts', 'meetings']) {
				const n = run(root, ['next', c], HOME());
				assert.equal(n.status, 0, n.stderr);
				assert.doesNotMatch(n.stdout, /scrape-contact|fetch-meetings(?![\w-])/, `dt next ${c}:\n${n.stdout}`);
			}
		});
		test('no commands:, skills: or verbs-bound entry of the instruction files names any of the four', () => {
			const files = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md'].filter((f) => fs.existsSync(path.join(root, f)));
			assert.ok(files.includes('CLAUDE.md') || files.includes('AGENTS.md'), 'the compile wrote no instruction file');
			for (const f of files) {
				const text = fs.readFileSync(path.join(root, f), 'utf8');
				const listing = listingLines(text);
				assert.ok(listing.length > 0, `${f}: no listing lines found — the reader no longer matches the format`);
				assert.deepEqual(listing.filter((l) => NAMES.test(l)), [], `${f} lists a moved command or skill`);
			}
		});
	});

	describe('t5 records written before the change still check (line 5)', () => {
		test('the fixture contacts and meeting, copied byte for byte, pass dt check on core alone', () => {
			const files = walk(FIXTURES);
			assert.ok(files.some((f) => f.startsWith('contacts/')) && files.some((f) => f.startsWith('meetings/')), 'the fixtures hold no contact or meeting');
			for (const f of files) {
				fs.mkdirSync(path.dirname(path.join(root, 'data', f)), { recursive: true });
				fs.copyFileSync(path.join(FIXTURES, f), path.join(root, 'data', f));
			}
			const c = run(root, ['check'], HOME());
			assert.equal(c.status, 0, `${c.stdout}\n${c.stderr}`);
			assert.match(c.stdout + c.stderr, /0 violations/);
			for (const f of files) assert.ok(fs.readFileSync(path.join(root, 'data', f)).equals(fs.readFileSync(path.join(FIXTURES, f))), `dt check changed data/${f}`);
			// the enriched contact keeps every LinkedIn field as written
			const enriched = fs.readFileSync(path.join(root, 'data', 'contacts', 'dana-oren.contact.md'), 'utf8');
			for (const line of ['linkedin_degree: 2nd', 'linkedin_mutuals: 3', '  - linkedin:unsure', 'status: enriched', 'review_note: ']) assert.ok(enriched.includes(line), line);
		});
		test('the compiled contacts descriptor still declares linkedin, linkedin_degree and linkedin_mutuals', () => {
			const d = yaml.load(fs.readFileSync(path.join(root, '.dreamteamer', 'collections', 'contacts.collection.yaml'), 'utf8'));
			assert.equal(d.fields.linkedin?.type, 'url');
			assert.deepEqual(d.fields.linkedin_degree?.enum, ['1st', '2nd', '3rd', 'none']);
			assert.equal(d.fields.linkedin_mutuals?.type, 'integer');
		});
	});

	describe('t8 core-only lists no LinkedIn view (line 8, first half)', () => {
		test('no compiled ui-view routes /contacts/needs-linkedin or /contacts/review-linkedin', () => {
			const dir = path.join(root, '.dreamteamer', 'ui-views');
			const routes = walk(dir).filter((f) => f.endsWith('.ui-view.yaml')).map((f) => yaml.load(fs.readFileSync(path.join(dir, f), 'utf8'))?.route);
			for (const r of Object.values(ROUTES)) assert.ok(!routes.includes(r), `${r} is compiled`);
			for (const id of Object.keys(ROUTES)) assert.ok(!fs.existsSync(path.join(dir, `${id}.ui-view.yaml`)), `${id} is compiled`);
		});
	});

	describe('t3 connectors-linkedin brings the scraper back (lines 3 and 8, second half)', () => {
		before(() => {
			const r = run(root, ['install', '@dreamteamer/connectors-linkedin', '--from', from(), '--no-input'], HOME());
			assert.equal(r.status, 0, `dt install @dreamteamer/connectors-linkedin: exit ${r.status}\n${r.stderr}\n${r.stdout.slice(-1500)}`);
		});
		test('/scrape-contact and the scraping-contacts skill are compiled, and dt next contacts names it', () => {
			assert.ok(fs.existsSync(path.join(root, '.dreamteamer', 'commands', 'scrape-contact.command.md')));
			assert.ok(fs.existsSync(path.join(root, '.dreamteamer', 'skills', 'scraping-contacts', 'SKILL.md')));
			const n = run(root, ['next', 'contacts'], HOME());
			assert.equal(n.status, 0, n.stderr);
			assert.match(n.stdout, /scrape-contact/);
		});
		test('.env.example and dt status name LINKEDIN_USER_AGENT', () => {
			assert.match(fs.readFileSync(path.join(root, '.env.example'), 'utf8'), /^LINKEDIN_USER_AGENT=/m);
			const s = run(root, ['status'], HOME());
			assert.equal(s.status, 0, s.stderr);
			assert.match(s.stdout, /connectors-linkedin\s.*LINKEDIN_USER_AGENT/);
		});
		test('both LinkedIn views are compiled, with their routes', () => {
			for (const [id, route] of Object.entries(ROUTES)) {
				const f = path.join(root, '.dreamteamer', 'ui-views', `${id}.ui-view.yaml`);
				assert.ok(fs.existsSync(f), `${id} is not compiled`);
				assert.equal(yaml.load(fs.readFileSync(f, 'utf8')).route, route);
			}
		});
	});
});

describe('t4 connectors-google-workspace brings the sync back (line 4)', { skip }, () => {
	let root;
	before(() => {
		root = coreOnly();
		const r = run(root, ['install', '@dreamteamer/connectors-google-workspace', '--from', from(), '--no-input'], HOME());
		// 3: installed and compiled, a setup unit still waiting for its input (the calendar rows)
		assert.ok(r.status === 0 || r.status === 3, `dt install @dreamteamer/connectors-google-workspace: exit ${r.status}\n${r.stderr}\n${r.stdout.slice(-1500)}`);
	});
	test('/fetch-meetings and the fetching-meetings skill are compiled, and dt next meetings names it', () => {
		assert.ok(fs.existsSync(path.join(root, '.dreamteamer', 'commands', 'fetch-meetings.command.md')));
		assert.ok(fs.existsSync(path.join(root, '.dreamteamer', 'skills', 'fetching-meetings', 'SKILL.md')));
		const n = run(root, ['next', 'meetings'], HOME());
		assert.equal(n.status, 0, n.stderr);
		assert.match(n.stdout, /fetch-meetings(?![\w-])/);
	});
	test('dt status shows the calendar setup line connectors-google-workspace › meetings', () => {
		const s = run(root, ['status'], HOME());
		assert.equal(s.status, 0, s.stderr);
		assert.match(s.stdout, /connectors-google-workspace › meetings\s/, s.stdout);
	});
	test('dt setup meetings writes WORK_CALENDARS again', () => {
		fs.appendFileSync(path.join(root, '.gitignore'), '\n.env\n');
		const r = run(root, ['setup', 'meetings', '--input', `calendar=${SYNC_ROW}`, '--no-input'], HOME());
		assert.equal(r.status, 0, r.stdout + r.stderr);
		assert.match(fs.readFileSync(path.join(root, '.env'), 'utf8'), /^WORK_CALENDARS=/m);
	});
});

describe('t7 UPDATING names both connectors (line 7)', () => {
	const section = () => {
		const text = fs.readFileSync(path.join(ROOT, 'modules', 'core', 'UPDATING.md'), 'utf8');
		const at = text.indexOf('\n## 0.13.0');
		assert.ok(at >= 0, 'UPDATING.md has no ## 0.13.0 section');
		const rest = text.slice(at + 1);
		const end = rest.indexOf('\n## ', 1);
		return end < 0 ? rest : rest.slice(0, end);
	};
	test('core is 0.13.0 and its UPDATING has the section', () => {
		assert.equal(pkgOf('core').version, '0.13.0');
		section();
	});
	test('the section installs connectors-linkedin beside /scrape-contact and connectors-google-workspace beside /fetch-meetings', () => {
		// a paragraph and the fenced block right after it are one unit: "to keep X, install:" then the command
		const paras = section().split(/\n\s*\n/).reduce((acc, p) => {
			if (p.startsWith('```') && acc.length) acc[acc.length - 1] += `\n\n${p}`; else acc.push(p);
			return acc;
		}, []);
		// `dt install` or `npx dreamteamer install` — the same verb, as UPDATING spells it for a workspace
		const beside = (pkg, capability) => paras.some((p) => new RegExp(`\\b(dt|dreamteamer) install ${pkg.replace('/', '\\/')}(?![\\w-])`).test(p) && p.includes(capability));
		assert.ok(beside('@dreamteamer/connectors-linkedin', '/scrape-contact'), 'no paragraph installs @dreamteamer/connectors-linkedin to keep /scrape-contact');
		assert.ok(beside('@dreamteamer/connectors-google-workspace', '/fetch-meetings'), 'no paragraph installs @dreamteamer/connectors-google-workspace to keep /fetch-meetings');
	});
});
