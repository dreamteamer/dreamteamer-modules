// THE SESSION READER, pinned against a synthetic transcript: the `cost-state` line wins, the usage sum
// stands in when it is missing (once per request, never once per content block), a turn is a human
// prompt and nothing else, a tool call is a `tool_use` block, and the JSON is the record's fields —
// every one a field the `sessions` descriptor declares.
import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';
import { CORE } from '../../../scripts/compose-core.mjs';
import { parseTranscript, usageTotals, fieldsOf, encodeCwd, transcriptPathOf, main, PRICES } from '../bin/session-save.mjs';

const FIXTURE = path.join(CORE, 'test', 'fixtures', 'session.jsonl');
const SESSION = '0f3a6c2e-1b4d-4e8a-9c7f-2d5e8a1b3c4d';
const text = fs.readFileSync(FIXTURE, 'utf8');
const withoutCostState = text.split('\n').filter((l) => !l.includes('"cost-state"')).join('\n');
const descriptor = yaml.load(fs.readFileSync(path.join(CORE, 'collections', 'core', 'sessions.collection.yaml'), 'utf8'));

describe('the fixture is the shape a real transcript has', () => {
	test('forty lines, one request split over two assistant lines, a compaction, a sidechain, a meta line, a cost-state', () => {
		const lines = text.trim().split('\n');
		assert.equal(lines.length, 40);
		const types = lines.map((l) => JSON.parse(l).type);
		for (const t of ['user', 'assistant', 'system', 'cost-state', 'ai-title', 'last-prompt', 'attachment', 'api-request']) assert.ok(types.includes(t), `no ${t} line`);
		assert.equal(lines.filter((l) => l.includes('"requestId":"r1"') && l.includes('"assistant"')).length, 2, 'r1 spans two assistant lines');
	});
});

describe('counting', () => {
	const p = parseTranscript(text);
	test('a turn is a human prompt — not a tool result, not a sidechain, not a meta line', () => {
		assert.equal(p.turns, 3);
	});
	test('a tool call is one tool_use block, across every assistant line', () => {
		assert.equal(p.toolCalls, 4);
	});
	test('a request is counted once however many lines its response spans; a compaction is counted', () => {
		assert.equal(p.requests.size, 6);
		assert.equal(p.compactions, 1);
	});
	test('the session id, the title and the models come from the lines that carry them', () => {
		assert.equal(p.sessionId, SESSION);
		assert.equal(p.title, 'Northwind calendar sync');
		assert.deepEqual([...p.models].sort(), ['claude-fable-5-1', 'claude-sonnet-5-5']);
	});
});

describe('the metrics', () => {
	test('cost-state wins: its per-model tokens, its cost, its durations and its line counts', () => {
		const f = fieldsOf(parseTranscript(text));
		assert.equal(f.input_tokens, 46); assert.equal(f.output_tokens, 450);
		assert.equal(f.cache_read_tokens, 13600); assert.equal(f.cache_write_tokens, 900);
		assert.equal(f.cost_usd, 0.42);
		assert.equal(f.wall_minutes, 10); assert.equal(f.api_minutes, 1.5);
		assert.equal(f.lines_added, 12); assert.equal(f.lines_removed, 3);
		assert.deepEqual(f.models, ['claude-fable-5-1', 'claude-sonnet-5-5']);
		assert.equal(f.started, '2026-10-28T09:00:00.000Z');
	});
	test('without cost-state, usage is summed once per request and priced from the table', () => {
		const p = parseTranscript(withoutCostState);
		assert.equal(p.costState, null);
		const u = usageTotals(p.requests);
		assert.equal(u.input_tokens, 35); assert.equal(u.output_tokens, 360);
		assert.equal(u.cache_read_tokens, 11000); assert.equal(u.cache_write_tokens, 800);
		// fable: 30 in · 320 out · 9500 read · 500 at the 5-minute rate · 300 at the 1-hour rate; sonnet: 5 · 40 · 1500
		const fable = PRICES['claude-fable-5'], sonnet = PRICES['claude-sonnet-5'];
		const expected = 30 * fable.input + 320 * fable.output + 9500 * fable.read + 500 * fable.write5m + 300 * fable.write1h + 5 * sonnet.input + 40 * sonnet.output + 1500 * sonnet.read;
		assert.ok(Math.abs(u.cost_usd - expected) < 1e-9, `${u.cost_usd} vs ${expected}`);
		const f = fieldsOf(p);
		assert.equal(f.cost_usd, 0.0315);
		const stamps = withoutCostState.split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((l) => (l.type === 'user' || l.type === 'assistant') && !l.isSidechain).map((l) => Date.parse(l.timestamp));
		assert.equal(f.wall_minutes, Math.round((Math.max(...stamps) - Math.min(...stamps)) / 6000) / 10, 'first to last human or assistant line');
		assert.equal(f.api_minutes, undefined); assert.equal(f.lines_added, undefined);
		assert.equal(f.started, p.first);
	});
	test('a model the table does not price leaves cost empty rather than wrong', () => {
		const p = parseTranscript(withoutCostState.replace(/claude-sonnet-5-5/g, 'claude-nova-9-0'));
		assert.equal(fieldsOf(p).cost_usd, undefined);
	});
});

describe('the JSON shape', () => {
	test('every key is a field the sessions descriptor declares, with the type the value has', () => {
		const f = fieldsOf(parseTranscript(text), { sessionId: SESSION, transcript: '${env:FILES_FOLDER}/sessions/2026/10/x.jsonl' });
		for (const [k, v] of Object.entries(f)) {
			const spec = descriptor.fields[k];
			assert.ok(spec, `${k} is not a field of sessions`);
			if (spec.type === 'integer') assert.ok(Number.isInteger(v), `${k} = ${v}`);
			if (spec.type === 'number') assert.equal(typeof v, 'number', `${k} = ${v}`);
			if (spec.many) assert.ok(Array.isArray(v), `${k} is many`);
		}
		assert.deepEqual(Object.keys(f), ['name', 'started', 'ended', 'harness', 'session_id', 'transcript', 'turns', 'tool_calls', 'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'cost_usd', 'models', 'wall_minutes', 'api_minutes', 'lines_added', 'lines_removed']);
		assert.equal(f.harness, 'claude-code'); assert.equal(f.session_id, SESSION);
	});
	test('the id pattern accepts the harness session id beside the dated shape', () => {
		const re = new RegExp(descriptor.ids.pattern);
		assert.match(SESSION, re);
		assert.match('2026/10/2026-10-28--northwind-calendar', re);
		assert.doesNotMatch('Not An Id', re);
	});
});

describe('finding the transcript', () => {
	test('the project folder is the cwd with every character but letters and digits as a dash, under the config dir', () => {
		assert.equal(encodeCwd('/Users/someone/work/northwind'), '-Users-someone-work-northwind');
		assert.equal(transcriptPathOf(SESSION, '/Users/someone/work/northwind', { CLAUDE_CONFIG_DIR: '/tmp/cfg' }), path.join('/tmp/cfg', 'projects', '-Users-someone-work-northwind', `${SESSION}.jsonl`));
	});
	test('the CLI reads the session from the env, prints the fields, and exits 1 with no session or no transcript', () => {
		const log = console.log, err = console.error; const out = []; console.log = (s) => out.push(s); console.error = () => {};
		try {
			assert.equal(main(['--json', '--transcript', FIXTURE], { CLAUDE_CODE_SESSION_ID: SESSION }), 0);
			assert.equal(JSON.parse(out[0]).turns, 3);
			assert.equal(main(['--json'], {}), 1, 'no session id');
			assert.equal(main(['--json', '--session', SESSION, '--transcript', path.join(os.tmpdir(), 'no-such.jsonl')], {}), 1, 'no transcript');
			assert.equal(main(['--json', '--transcript', FIXTURE, '--session', SESSION, '--set', 'worker=users/dana-oren'], {}), 0);
			assert.equal(JSON.parse(out[1]).worker, 'users/dana-oren', '--set passes a field through');
		} finally { console.log = log; console.error = err; }
	});
	test('run as a script, --json prints the same fields', () => {
		const r = spawnSync(process.execPath, [path.join(CORE, 'bin', 'session-save.mjs'), '--json', '--session', SESSION, '--transcript', FIXTURE], { encoding: 'utf8' });
		assert.equal(r.status, 0, r.stderr);
		assert.equal(JSON.parse(r.stdout).cost_usd, 0.42);
	});
});
