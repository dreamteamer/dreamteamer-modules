// THE STAGE WRITERS — the lifecycle keeps a change request's `stage` current as it moves the request: each
// stage's skill and the review whose approve moves it spell the write, `stage=` LAST on the line (so the
// 0.7.0 tag pins stay whole and leaving it out is dropping the last token). Rule (a): only on a request
// that already carries a stage or lives in the workspace's own root, retried without `stage` when the
// request's home refuses the field. The filing reads the target layer instead. A step that sends a request
// back writes the stage of the earliest gate `dt next --json` names.
import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const RND = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const skill = (s) => fs.readFileSync(path.join(RND, 'skills', s, 'SKILL.md'), 'utf8');
const agent = (a) => fs.readFileSync(path.join(RND, 'agents', `${a}.agent.md`), 'utf8');
const lit = (s) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

const RULE_A = 'already carries a `stage` or whose `$repo` in `dt get rnd/change-requests/<id> --json` is `.`';
const RETRY = 'run the same `dt set` again without `stage`';

describe('each writer spells its stage write, stage last', () => {
	const ROWS = [
		['rnd-change-request', '--stage design'],
		['rnd-design', 'dt set rnd/change-requests/<id> tags=<each existing> tags=designed stage=design-review'],
		['recording-reviews', 'dt set rnd/change-requests/<id> stage=acceptance'],
		['recording-reviews', '`stage=plan` (already `accepted`)'],
		['recording-reviews', 'dt set rnd/change-requests/<id> status=accepted accepted_by=<you> accepted_on=<now> stage=plan'],
		['recording-reviews', 'status=rejected stage=rejected'],
		['recording-reviews', 'a plan approved → `dt set rnd/change-requests/<id> stage=implement`'],
		['recording-reviews', 'a code review approved → `dt set rnd/change-requests/<id> stage=test`'],
		['recording-reviews', 'dt set rnd/change-requests/<id> verified_on=<now> stage=deploy'],
		['recording-reviews', '`stage=live-check` when `deployed_on` is already set'],
		['recording-reviews', 'dt set rnd/change-requests/<id> status=implemented stage=done'],
		['rnd-plan', 'dt set rnd/change-requests/<id> stage=plan-review'],
		['rnd-implement', 'dt set rnd/change-requests/<id> tags=<each existing> tags=implemented stage=code-review'],
		['rnd-test', 'dt set rnd/change-requests/<id> tested_on=<now> tags=<each existing> tags=tested stage=test-review'],
		['rnd-test', 'with `stage=test` last on the same write'],
		['rnd-deploy', 'dt set rnd/change-requests/<id> deployed_on=<now> tags=<each existing> tags=deployed stage=live-check'],
		['rnd-release', 'dt set rnd/change-requests/<cr> deployed_on=<published_on> tags=<each existing> tags=deployed stage=live-check'],
		['rnd-release', 'release=<the next planned release, or empty> stage=deploy'],
	];
	for (const [s, line] of ROWS) test(`${s}: ${line}`, () => assert.match(skill(s), lit(line)));

	test('a two-write step commits the other record and the request together, by id', () => {
		for (const s of ['recording-reviews', 'rnd-plan', 'rnd-implement']) assert.match(skill(s), /commit(ted)? (both|with the (plan|doc|design doc)) (together )?by id|committed together by id/i, s);
	});
});

describe('rule (a), the filing rule, and the send-back', () => {
	const WRITERS = ['rnd-design', 'recording-reviews', 'rnd-plan', 'rnd-implement', 'rnd-test', 'rnd-deploy', 'rnd-release'];
	for (const s of WRITERS) test(`${s} carries rule (a) and the retry without stage`, () => {
		assert.match(skill(s), lit(RULE_A));
		assert.match(skill(s), lit(RETRY));
	});
	for (const a of ['rnd-agent', 'qa-manager']) test(`${a} carries rule (a) and names stage among what it writes`, () => {
		assert.match(agent(a), lit(RULE_A));
		assert.match(agent(a), lit(RETRY));
		assert.match(agent(a), /`stage`/);
	});
	test('the rnd-agent writes stage only through a stage', () => {
		assert.match(agent('rnd-agent'), /never outside a stage/);
	});

	test('rnd-change-request reads the target layer before filing into it', () => {
		const t = skill('rnd-change-request');
		assert.match(t, lit(`dt list rnd/change-requests -w <layer> --where '{"stage":{"_nempty":true}}'`));
		assert.match(t, /pass `--stage` only when it lists one/);
		assert.match(t, /own root, always/);
		assert.match(t, lit('run the same `dt add` again without `--stage`'));
	});

	test('the send-back reads dt next --json and maps every binding; recording-reviews carries the whole table', () => {
		for (const s of ['recording-reviews', 'rnd-implement', 'rnd-test']) {
			assert.match(skill(s), lit('dt next rnd/change-requests/<id> --json'), s);
			assert.match(skill(s), /earliest/, s);
		}
		const t = skill('recording-reviews');
		const map = [
			['rnd--design--change-requests', 'design'], ['rnd--review--change-requests--design', 'design-review'],
			['rnd--review--change-requests', 'acceptance'], ['rnd--plan--change-requests', 'plan'],
			['rnd--review--change-requests--plan', 'plan-review'], ['rnd--implement--change-requests', 'implement'],
			['rnd--review--change-requests--code', 'code-review'], ['rnd--test--change-requests', 'test'],
			['rnd--review--change-requests--test', 'test-review'], ['rnd--deploy--change-requests', 'deploy'],
			['rnd--release--change-requests', 'deploy'], ['rnd--review--change-requests--deploy', 'live-check'],
		];
		for (const [b, s] of map) assert.match(t, lit(`| \`${b}\` | \`${s}\` |`), b);
	});

	test('no skill writes a stage without rule (a) beside it', () => {
		for (const s of fs.readdirSync(path.join(RND, 'skills'))) {
			const t = skill(s);
			if (/stage=[a-z]/.test(t) && s !== 'rnd-change-request') assert.match(t, lit(RULE_A), s);
		}
	});
});
