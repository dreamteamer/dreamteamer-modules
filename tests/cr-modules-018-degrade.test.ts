// THE SYNC AND THE SCRAPER ARE NAMED WITH THE CONNECTOR THAT SHIPS THEM (cr-modules-018, task 3;
// rnd/tests dreamteamer-modules/cr-modules-018-t-degrade).
//
// From core 0.13.0 the calendar sync (`/fetch-meetings`, the `fetching-meetings` skill) ships with
// `@dreamteamer/connectors-google-workspace` and the LinkedIn scraper (`/scrape-contact`, the
// `scraping-contacts` skill) with `@dreamteamer/connectors-linkedin`; neither is a member of core. So a core
// member that still names one of them must say, in the same paragraph, which package ships it — a person on
// core alone is told what to install instead of being sent to a command or a skill that is not there. A
// reference (`commands/fetch-meetings` in a workflow step) is not prose: `dt check` and the workflow
// installer refuse it by name, so it is not counted. Design history (`docs/`) and README/UPDATING version
// sections (`## <version>`) keep the spellings of their day (house rule 11) and are exempt.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const MODULES = path.join(ROOT, 'modules');
const pkgOf = (m) => JSON.parse(fs.readFileSync(path.join(MODULES, m, 'package.json'), 'utf8'));

const GWS = '@dreamteamer/connectors-google-workspace';
const LINKEDIN = '@dreamteamer/connectors-linkedin';
/** Each name a core member may not leave bare, the pattern that finds it, and the package that ships it. */
const NAMES = [
	{ name: '/fetch-meetings', re: /(?<!commands)\/fetch-meetings(?![\w-])/, pkg: GWS },
	{ name: 'fetching-meetings', re: /(?<![\w-])fetching-meetings(?![\w-])/, pkg: GWS },
	{ name: '/scrape-contact', re: /(?<!commands)\/scrape-contact(?![\w-])/, pkg: LINKEDIN },
	{ name: 'scraping-contacts', re: /(?<![\w-])scraping-contacts(?![\w-])/, pkg: LINKEDIN },
];
/** A compiled skill folder core no longer ships. */
const SKILL_PATH = /\.dreamteamer\/skills\/(fetching-meetings|scraping-contacts)(?![\w-])/;

/** Core's members, read off its preset: folder names. */
const MEMBERS = Object.keys(pkgOf('core').dreamteamer.preset).map((p) => p.replace(/^@dreamteamer\//, '')).sort();

/** Every file module `m` ships (package.json plus its `files` list), repo-relative, `docs/` excluded. */
function shippedFiles(m) {
	const dir = path.join(MODULES, m);
	const out = [];
	const walk = (p) => {
		if (!fs.existsSync(p)) return;
		if (fs.statSync(p).isDirectory()) {
			if (path.basename(p) === 'docs' || path.basename(p) === 'node_modules') return;
			for (const e of fs.readdirSync(p).sort()) walk(path.join(p, e));
		} else out.push(path.relative(ROOT, p));
	};
	walk(path.join(dir, 'package.json'));
	for (const f of pkgOf(m).files ?? []) walk(path.join(dir, f));
	return out;
}

/** A text file's prose, with README/UPDATING version sections (`## 0.1.5 …`) cut out; null for binary. */
function proseOf(file) {
	const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
	if (text.includes('\u0000')) return null;
	const atPackageRoot = path.dirname(file).split(path.sep).length === 2;
	if (!(atPackageRoot && /^(README|UPDATING)\.md$/.test(path.basename(file)))) return text;
	const kept = [];
	let inVersion = false;
	for (const line of text.split('\n')) {
		if (/^## /.test(line)) inVersion = /^## v?\d+\.\d+\.\d+/.test(line);
		else if (/^# /.test(line)) inVersion = false;
		if (!inVersion) kept.push(line);
	}
	return kept.join('\n');
}

/** Every paragraph (a blank-line-separated block) that names a moved capability without its package. */
function bareNames(text) {
	const out = [];
	for (const para of text.split(/\n[ \t]*\n/)) {
		for (const { name, re, pkg } of NAMES) {
			if (re.test(para) && !para.includes(pkg)) out.push(`${name} without ${pkg}: «${para.trim().slice(0, 160).replace(/\s+/g, ' ')}…»`);
		}
	}
	return out;
}

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const paragraphsNaming = (text, re) => text.split(/\n[ \t]*\n/).filter((p) => re.test(p));

describe('the checker is not vacuous', () => {
	test('a bare name is caught, a reference and a named package are not', () => {
		assert.equal(bareNames('1. run `/fetch-meetings <range>` first.').length, 1);
		assert.equal(bareNames('load `scraping-contacts` for the profile.').length, 1);
		assert.equal(bareNames('    command: commands/fetch-meetings\n    command: commands/scrape-contact').length, 0);
		assert.equal(bareNames(`run \`/fetch-meetings\` (it ships with \`${GWS}\`).`).length, 0);
		assert.equal(bareNames(`\`/fetch-meetings\` (\`${GWS}\`) then \`/scrape-contact\`.`).length, 1, 'each name needs its own package');
		assert.equal(bareNames('`/fetch-meeting-screenshots <range>`').length, 0, 'a longer command name is not the sync');
	});
	test('core has seventeen members to scan', () => {
		assert.equal(MEMBERS.length, 17);
		for (const m of ['meetings', 'contacts', 'meeting-docs', 'recordings', 'workflows']) assert.ok(MEMBERS.includes(m), m);
	});
});

describe('task 3: the commands that run the sync or the scraper degrade by name', () => {
	test('/process-new-meetings step 1: without /fetch-meetings, skip the sync, say so, work from the meetings in the workspace', () => {
		const text = read('modules/meeting-docs/commands/process-new-meetings.command.md');
		const step1 = paragraphsNaming(text, /^1\. \*\*`\/fetch-meetings/m);
		assert.equal(step1.length, 1, 'step 1 still runs /fetch-meetings');
		assert.match(step1[0], new RegExp(`not installed \\(it ships with \`${GWS}\`\\), skip the sync, say so in the report`));
		assert.match(step1[0], /work from the meetings already in the workspace/);
		assert.deepEqual(bareNames(text), []);
	});
	test('/match-recording-to-meeting rung 2: without fetching-meetings, go to rung 3 and say why', () => {
		const text = read('modules/recordings/commands/match-recording-to-meeting.command.md');
		const rung2 = paragraphsNaming(text, /^2\. \*\*not in the workspace/m);
		assert.equal(rung2.length, 1);
		assert.match(rung2[0], /fetching-meetings/);
		assert.match(rung2[0], new RegExp(`not installed \\(it ships with \`${GWS}\`\\), go to rung 3 and say why`));
		assert.deepEqual(bareNames(text), []);
	});
	test('ingesting-recordings describes the name convention in place, not by a skill core lacks', () => {
		const text = read('modules/recordings/skills/ingesting-recordings/SKILL.md');
		assert.doesNotMatch(text, /fetching-meetings/);
		assert.match(text, /`<original> \(English gloss\)`, as the calendar sync writes it/);
	});
	test('customer-factory: its body names the connector each of two steps needs; the steps are unchanged', () => {
		const text = read('modules/workflows/data/workflows/customer-factory.workflow.md');
		const [, front, body] = text.split(/^---\s*$/m);
		assert.match(front, /- name: sync the calendar\n {4}command: commands\/fetch-meetings\n/);
		assert.match(front, /- name: enrich the new people\n {4}command: commands\/scrape-contact\n/);
		const intro = body.split(/^## 1\. /m)[0];
		assert.match(intro, new RegExp(`sync the calendar[^\\n]*${GWS}`));
		assert.match(intro, new RegExp(`enrich the new people[^\\n]*${LINKEDIN}`));
		assert.match(intro, /npx dt-workflows install customer-factory` refuses/);
		assert.deepEqual(bareNames(text), []);
	});
	test('the workflows README no longer says every command customer-factory names is in core', () => {
		assert.doesNotMatch(read('modules/workflows/README.md'), /Every command it names is in core/);
	});
	test('meeting-docs points the calendar sync\'s setup at the connector, not at a meetings SETUP.md', () => {
		const text = read('modules/meeting-docs/README.md');
		assert.doesNotMatch(text, /`SETUP\.md` of\s+\*\*meetings\*\*/);
	});
	test('versions: meeting-docs 0.1.5, recordings 0.5.3, workflows 0.1.3, each with a "nothing to do" README section', () => {
		for (const [m, v] of [['meeting-docs', '0.1.5'], ['recordings', '0.5.3'], ['workflows', '0.1.3']]) {
			assert.equal(pkgOf(m).version, v, m);
			const section = read(`modules/${m}/README.md`).split(new RegExp(`^## ${v.replace(/\./g, '\\.')}\\b`, 'm'))[1];
			assert.ok(section, `${m}: no ## ${v} section`);
			assert.match(section.split(/^## /m)[0], /wording only; nothing to do/i, `${m}: the ## ${v} section`);
		}
	});
});

describe('core members name the connector beside every sync or scraper name', () => {
	for (const m of MEMBERS) {
		test(`${m}: every shipped paragraph naming /fetch-meetings, fetching-meetings, /scrape-contact or scraping-contacts names the package that ships it`, () => {
			const bad = [];
			for (const f of shippedFiles(m)) {
				const prose = proseOf(f);
				if (prose != null) bad.push(...bareNames(prose).map((b) => `${f}: ${b}`));
			}
			assert.deepEqual(bad, []);
		});
	}
	test('no core member points at .dreamteamer/skills/fetching-meetings or .dreamteamer/skills/scraping-contacts', () => {
		const bad = [];
		for (const m of MEMBERS) for (const f of shippedFiles(m)) {
			const prose = proseOf(f);
			if (prose == null) continue;
			prose.split('\n').forEach((line, i) => { if (SKILL_PATH.test(line)) bad.push(`${f}:${i + 1}: ${line.trim().slice(0, 140)}`); });
		}
		assert.deepEqual(bad, []);
	});
});
