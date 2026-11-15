// THE SKILL INSTRUCTS IN THE ENGINE'S CURRENT VOCABULARY. Stage 12 and the proposal contract are
// the two places this skill tells an agent to WRITE schema, and both named spellings engine 0.33
// refuses: `dt add collections … --use-when` (an unknown flag on that verb) and a v1 draft descriptor
// (`schema` with `required`, `id`, `list_fields`), which compile no longer reads. A proposal body is
// the descriptor materialise writes, so a v1 draft fails at the step that acts on it.
import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills', 'running-retrospectives');
const read = (rel) => fs.readFileSync(path.join(SKILL_DIR, rel), 'utf8');
const SKILL = read('SKILL.md');
const PROPOSALS = read('references/findings-to-proposals.md');

describe('stage 12 creates a collection with verbs engine 0.33 accepts', () => {
	test('no `--use-when` flag anywhere in the skill', () => {
		assert.doesNotMatch(SKILL, /--use-when/);
	});

	test('use_when is set on the new collection with `dt set collections/<n> use_when=`', () => {
		const row = SKILL.split('\n').find((l) => l.includes('**materialise**'));
		assert.ok(row, 'no stage 12 row');
		assert.match(row, /dt add collections --name <n> --module <target_module> --description/);
		assert.match(row, /dt set collections\/<n> use_when="/);
	});
});

describe('a collection proposal body is a v2 descriptor', () => {
	test('the contract names no v1 descriptor key', () => {
		for (const re of [/list_fields/, /\bschema\b/, /title_template/, /x-[a-z]+/, /collection-template/, /\bid, /]) {
			assert.doesNotMatch(PROPOSALS, re);
		}
	});

	test('the contract names the v2 keys', () => {
		for (const key of ['`fields`', '`ids`', '`storage`', '`record_title`', '`mixins`', '`display.list.columns`', '`many: true`', '`required: true`', '`enum`']) {
			assert.ok(PROPOSALS.includes(key), `does not name ${key}`);
		}
	});

	test('its example descriptor is v2: `fields:` keyed by name, `ids:`, and no v1 key', () => {
		const block = /^ *```yaml\n([\s\S]*?)^ *```/m.exec(PROPOSALS);
		assert.ok(block, 'no yaml example');
		const indent = /^( *)/.exec(block[1])[1].length;
		const d = yaml.load(block[1].split('\n').map((l) => l.slice(indent)).join('\n'));
		for (const v1 of ['schema', 'id', 'list_fields', 'title_template', 'templates', 'extends']) assert.equal(d[v1], undefined, `v1 key ${v1}`);
		assert.ok(d.ids?.from, 'ids.from');
		assert.ok(d.fields && typeof d.fields === 'object' && !Array.isArray(d.fields), 'fields is a map');
		for (const [name, f] of Object.entries(d.fields)) {
			assert.ok(f.type, `${name} has no type`);
			assert.ok(f.description, `${name} has no description`);
		}
		assert.ok(Array.isArray(d.display?.list?.columns), 'display.list.columns');
	});
});

test('no v1 descriptor spelling anywhere in the skill folder', () => {
	const V1 = [/x-inverse/, /x-reference/, /x-body/, /title_template/, /collection-templates?\b/, /\bdt move\b/, /list_fields/, /codec: file/, /--use-when/];
	const hits = [];
	const walk = (dir) => {
		for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
			if (e.name === 'node_modules' || e.name === '__pycache__') continue;
			const p = path.join(dir, e.name);
			if (e.isDirectory()) { walk(p); continue; }
			if (!/\.(md|mjs|js|ya?ml)$/.test(e.name)) continue;
			fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
				for (const re of V1) if (re.test(line)) hits.push(`${path.relative(SKILL_DIR, p)}:${i + 1}  ${line.trim().slice(0, 90)}`);
			});
		}
	};
	walk(SKILL_DIR);
	assert.deepEqual(hits, []);
});
