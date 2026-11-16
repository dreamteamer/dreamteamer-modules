// SPEAKERS NAMED IN THE MEETING PIPELINE (cr-modules-019 task 12). `@dreamteamer/recordings` names a transcript's
// voices with /identify-speakers and asks about the rest once, at the end of the run; this file proves what the
// meeting-docs prose tells a session to do with that (design sections 11 and 12, with section 21's "For the
// plan" and the agent decision `…-plan-an-unattended-run-holds-a-whole-engagement`):
//   - /process-new-meetings runs step 4b, /identify-speakers, after transcription and before the summary, with no
//     command typed; asks every recording's question as one message at the end of the run; folds every held
//     meeting once after the reply, answered or skipped; holds a whole engagement in an unattended run; lists
//     the documents written before a name;
//   - summary, critique and tasks write a provisional speaker as `<Name> (unconfirmed)`.
// Text only: nothing here runs a command or touches a record. Test names starting `line 20 `, `line 27 `,
// `line 30 `, `line 34 ` and `line 39 ` are the node half of those acceptance lines, run by name pattern.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { MODULES } from '../../../tests/helpers/workspace.mjs';

const read = (rel) => fs.readFileSync(path.join(MODULES, rel), 'utf8');
const flat = (s) => s.replace(/\s+/g, ' ');
const PIPE = read('meeting-docs/commands/process-new-meetings.command.md');
const FLAT = flat(PIPE);

/** A second-level section of a markdown file, from its heading to the next one (or the end). */
const section = (text, heading) => {
	const at = text.indexOf(`\n## ${heading}`);
	if (at < 0) return '';
	const next = text.indexOf('\n## ', at + 4);
	return text.slice(at, next < 0 ? undefined : next);
};

/** One numbered step of the sequence: from `<n>. ` at a line start to the next numbered step or heading. */
const step = (n) => {
	const m = new RegExp(`^${n}\\. [\\s\\S]*?(?=^\\d+b?\\. |^\\*\\*A meeting with|^## |(?![\\s\\S]))`, 'm').exec(PIPE);
	return m ? flat(m[0]) : '';
};

const END = flat(section(PIPE, 'at the end of the run'));
/** The part of the end-of-run section that starts at a bold label, up to the next bold run label. */
const part = (label) => {
	const at = END.indexOf(`**${label}**`);
	if (at < 0) return '';
	const rest = END.slice(at + label.length + 4);
	const next = rest.search(/\*\*(Attended run|Unattended run|Only a person answers)\b/);
	return next < 0 ? rest : rest.slice(0, next);
};
const ATTENDED = part('Attended run');
const UNATTENDED = part('Unattended run');
const REPORT = flat(section(PIPE, 'report'));

// ── line 27: names with no command typed, before the summary; one message at the end ─────────────────────

test('line 27 step 4b runs /identify-speakers after transcription and before the summary step', () => {
	const transcribe = PIPE.search(/^4\. \*\*`\/transcribe-recording/m);
	const identify = PIPE.search(/^4b\. \*\*`\/identify-speakers/m);
	const summarize = PIPE.search(/^6\. \*\*`\/summarize-meeting/m);
	assert.ok(transcribe > 0, 'step 4 is /transcribe-recording');
	assert.ok(identify > transcribe, 'step 4b, /identify-speakers, comes after transcription');
	assert.ok(summarize > identify, 'and before the summary step');
});

test('line 27 step 4b covers every recording transcribed in this run or still waiting, with no command typed by the user', () => {
	const b = step('4b');
	assert.match(b, /every recording transcribed in this run/);
	assert.match(b, /still `speaker_naming: waiting`/);
	assert.match(b, /the user types no command/i);
	assert.match(b, /asks nothing (now|here)/, 'step 4b asks nothing: the question waits for the end of the run');
});

test('line 27 step 4b is skipped and said when the installed recordings has no /identify-speakers', () => {
	const b = step('4b');
	assert.match(b, /When the installed `@dreamteamer\/recordings` has no `\/identify-speakers`/);
	assert.match(b, /skip this step, say so in the report/);
});

test('line 27 steps 6 and 7 are not held: they run for every meeting with the names that exist', () => {
	assert.match(FLAT, /Steps 6 and 7 run for every meeting with the names that exist/);
});

test('line 27 the questions of all recordings are one message at the end of the run, then --shown', () => {
	assert.ok(END, 'process-new-meetings has a `## at the end of the run` section');
	assert.ok(PIPE.indexOf('\n## at the end of the run') > PIPE.search(/^10\. /m), 'it comes after the sequence');
	assert.match(END, /\*\*one message\*\*/);
	const question = END.indexOf('identify --question');
	const shown = END.indexOf('identify --shown');
	assert.ok(question > 0, 'the message is `identify --question`');
	assert.match(END, /over every recording with an open question/);
	assert.match(END, /in the same message as the pipeline's other end-of-run questions/);
	assert.ok(shown > question, '`identify --shown` follows the question');
	assert.match(END, /right after asking/i);
	assert.match(END, /never one per recording/);
});

test('line 27 --stop-after lists identify, between transcribe and screenshots', () => {
	assert.match(FLAT, /`--stop-after <step>` halts after that step \([^)]*`transcribe`, `identify`, `screenshots`/);
});

test('line 27 the README says the pipeline names speakers after transcription and asks once at the end', () => {
	const readme = flat(read('meeting-docs/README.md'));
	assert.match(readme, /`\/identify-speakers`/);
	assert.match(readme, /one question at the end of the run/);
	assert.match(readme, /\(unconfirmed\)/);
});

test('the identify flags the pipeline names are the ones the recordings entry takes', () => {
	const entry = read('recordings/bin/transcribe.mjs');
	for (const flag of ['--question', '--shown', '--answer']) {
		assert.match(PIPE, new RegExp(`identify ${flag}`), `process-new-meetings names identify ${flag}`);
		assert.ok(entry.includes(flag), `recordings' transcribe.mjs takes ${flag}`);
	}
	assert.match(PIPE, /node node_modules\/@dreamteamer\/recordings\/bin\/transcribe\.mjs identify --question/);
});

test('the floor on @dreamteamer/recordings stays >=0.3.0, which keeps the step-4b skip reachable', () => {
	const pkg = JSON.parse(read('meeting-docs/package.json'));
	assert.equal(pkg.peerDependencies['@dreamteamer/recordings'], '>=0.3.0');
	assert.ok(pkg.dreamteamer.dependencies.includes('@dreamteamer/recordings'));
});

test('no meeting-docs prose names the developer\'s calibration tools', () => {
	const files = ['README.md'];
	const walk = (rel) => {
		for (const e of fs.readdirSync(path.join(MODULES, 'meeting-docs', rel), { withFileTypes: true })) {
			const r = path.join(rel, e.name);
			if (e.isDirectory()) walk(r);
			else if (e.name.endsWith('.md')) files.push(r);
		}
	};
	walk('commands');
	walk('skills');
	for (const f of files) {
		const text = read(`meeting-docs/${f}`);
		assert.doesNotMatch(text, /evaluate-speakers|transcribe\.mjs label\b/, f);
	}
});

// ── line 34: each engagement takes the call once ──────────────────────────────────────────────────────────

test('line 34 steps 8 and 9 are held back for a meeting whose recording still waits; one with no open question runs 6 to 9 in one pass', () => {
	assert.match(FLAT, /\*\*Steps 8 and 9 are held back\*\* for every meeting with a recording still `waiting`/);
	assert.match(FLAT, /A meeting with no open question runs steps 6 to 9 in one pass, as today/);
});

test('line 34 an attended run, after the reply, folds every held meeting once, answered or skipped', () => {
	assert.ok(ATTENDED, 'the end-of-run section has an **Attended run** part');
	assert.match(ATTENDED, /identify --answer/);
	assert.match(ATTENDED, /one `\/update-engagements` over the batch/);
	assert.match(ATTENDED, /for every held-back meeting, \*\*answered or skipped\*\*/);
	assert.match(ATTENDED, /stays open for the next attended run's question/);
	assert.match(ATTENDED, /takes the call now, once, with the names that exist/);
});

test('line 34 the refresh order is summary, tasks, critique, then one engagement update', () => {
	const order = ['/summarize-meeting', '/extract-tasks-from-meetings', '/analyze-meetings', '/update-engagements'].map((c) => ATTENDED.indexOf(`\`${c}`));
	for (const [i, at] of order.entries()) assert.ok(at > 0, `the attended run names step ${i}`);
	assert.deepEqual([...order].sort((a, b) => a - b), order, 'summary, tasks, critique, then the engagement update');
	assert.match(ATTENDED, /still gated as step 8 is/);
});

test('line 34 an unattended run holds a whole engagement while any of its meetings in the batch waits', () => {
	assert.ok(UNATTENDED, 'the end-of-run section has an **Unattended run** part');
	assert.match(UNATTENDED, /Ask nothing, run no `--shown` and no `--answer`/);
	assert.match(UNATTENDED, /Step 8 runs only for meetings with no open question/);
	assert.match(UNATTENDED, /`\/update-engagements engagements\/<id>`/);
	assert.match(UNATTENDED, /\*\*none of whose meetings in this batch waits\*\*/);
	assert.match(UNATTENDED, /held whole/);
	assert.match(UNATTENDED, /listed in the report/);
	assert.match(UNATTENDED, /next attended run/);
});

test('line 34 only a person answers: the agent never answers the question itself', () => {
	assert.match(END, /An agent never answers the question itself and never runs `identify --answer` or `--confirm` without a person's reply in the conversation/);
});

test('line 34 the report names the held-back meetings and the engagements held whole', () => {
	assert.match(REPORT, /every meeting whose steps 8 and 9 were held back/);
	assert.match(REPORT, /every engagement held whole/);
});

// ── line 39: documents written before the name ───────────────────────────────────────────────────────────

test('line 39 after the reply, every meeting whose names changed is summarised and its tasks extracted again', () => {
	assert.match(ATTENDED, /for each meeting whose names changed, `\/summarize-meeting` and `\/extract-tasks-from-meetings` again/);
});

test('line 39 the report lists every document written before a name it now carries', () => {
	assert.match(REPORT, /\*\*every document written before a name it now carries\*\*/);
	assert.match(REPORT, /written again in this run, or listed as written before the name/);
	assert.match(REPORT, /`identify --answer`/, 'the list comes from the documents the answer reply names');
});

// ── lines 20 and 30: a provisional name is written unconfirmed ───────────────────────────────────────────

const MARK = (file) => {
	const text = flat(read(`meeting-docs/${file}`));
	assert.match(text, /`transcription\.speaker_sources`/, `${file} reads speaker_sources`);
	assert.match(text, /`status: provisional`/, `${file} names the provisional status`);
	assert.match(text, /`<Name> \(unconfirmed\)`/, `${file} writes <Name> (unconfirmed)`);
	assert.match(text, /wherever a statement is attributed/, file);
	assert.match(text, /names were machine-written/, `${file}: the provenance says the names were machine-written`);
	assert.match(text, /used as today, unmarked/, `${file}: an unverified name is used as today`);
	assert.match(text, /With no `speaker_sources` key at all/, `${file}: no speaker_sources → as today`);
};

test('line 20 a summary marks a provisional speaker as unconfirmed, and its provenance says the names were machine-written', () => {
	MARK('commands/summarize-meeting.command.md');
	assert.match(flat(read('meeting-docs/commands/summarize-meeting.command.md')), /`creation_context`[^.]*names were machine-written/);
});

for (const file of ['commands/analyze-meetings.command.md', 'skills/analyzing-meetings/SKILL.md']) {
	test(`line 30 a critique marks a provisional speaker as unconfirmed: ${file}`, () => MARK(file));
}

test('line 30 a task marks a provisional speaker as unconfirmed: commands/extract-tasks-from-meetings.command.md', () => {
	MARK('commands/extract-tasks-from-meetings.command.md');
});
