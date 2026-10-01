// The effort ladder's four decisions. Every assertion here pins a MEASURED behaviour or a silent
// failure, never a shape — the rungs' numbers live in lib/find.mjs's header and in the experiment
// records behind it.
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { buildQueryDocument, stripLineAnchor, agreedReference, contentWords, suggestEffort, collectionOfAgreeing, RUNGS } from '../lib/find.mjs';

describe('the structured query document (rung 2)', () => {
	test('emits intent first, then one line per lane, in qmd\'s grammar', () => {
		const doc = buildQueryDocument({ question: 'what broke the build', lex: 'ci build failure', vec: 'the build stopped working', hyde: 'The build broke because a test was red.' });
		assert.deepEqual(doc.split('\n'), [
			'intent: what broke the build',
			'lex: ci build failure',
			'vec: the build stopped working',
			'hyde: The build broke because a test was red.',
		]);
	});

	// ⚠ THE POINT OF THE RUNG. Two questions that no backend answers fail for OPPOSITE reasons and are
	// rescued by OPPOSITE lanes — a vocabulary gap goes lex 1 / vec 3, an abstraction gap goes lex MISS
	// / vec 1. Repeating one string across all three lanes would ask the same question three ways in
	// the same words, which hedges nothing and is the failure the rung exists to fix.
	test('the lanes DIFFER when nothing is supplied — lex is reduced, vec is the prose', () => {
		const doc = buildQueryDocument({ question: 'the thing we ship is mostly stuff nobody needs' });
		const lex = doc.split('\n').find((l) => l.startsWith('lex: '));
		const vec = doc.split('\n').find((l) => l.startsWith('vec: '));
		assert.notEqual(lex.slice(5), vec.slice(5), 'a lex lane identical to the vec lane is not a hedge');
		assert.equal(vec, 'vec: the thing we ship is mostly stuff nobody needs');
		assert.ok(!lex.includes(' is '), 'lex should carry content words, not the sentence');
	});

	// ⚠ NO MECHANICAL HYDE. A hypothetical answer cannot be derived from the question without a model,
	// and inventing one from the question's own words would just be the vec lane again.
	test('hyde is OMITTED when not supplied, never faked from the question', () => {
		const doc = buildQueryDocument({ question: 'what broke the build' });
		assert.ok(!doc.includes('hyde:'), 'an unsupplied hyde lane must not be invented');
		assert.ok(doc.includes('lex:') && doc.includes('vec:'));
	});

	test('refuses an empty question rather than emitting a document that matches everything', () => {
		assert.throws(() => buildQueryDocument({ question: '   ' }), /needs a question/);
		assert.throws(() => buildQueryDocument({}), /needs a question/);
	});

	test('content words drop stopwords and keep dotted domain tokens', () => {
		assert.deepEqual(contentWords('what is the .vscodeignore for'), ['.vscodeignore']);
		assert.deepEqual(contentWords('the store add runs at 55-73 records'), ['store', 'add', 'runs', '55-73', 'records']);
	});
});

describe('the line anchor (the silent failure)', () => {
	// ⚠ qmd returns `path:line`. Skipping this makes every graph lookup resolve NOTHING while the paths
	// still look correct in the output — it fails without an error, and it cost a debugging round.
	test('strips a trailing :line so a hit resolves to a real file', () => {
		assert.equal(stripLineAnchor('issues/2026-08-02--x.issue.md:8'), 'issues/2026-08-02--x.issue.md');
		assert.equal(stripLineAnchor('a/b.md:12:4'), 'a/b.md');
	});
	test('leaves a path with no anchor alone, and does not eat a dated filename', () => {
		assert.equal(stripLineAnchor('a/b.md'), 'a/b.md');
		assert.equal(stripLineAnchor('issues/2026-09-10--every-published-vsix.issue.md'), 'issues/2026-09-10--every-published-vsix.issue.md');
	});
});

describe('the agreed reference (rung 3)', () => {
	// ⚠ DERIVED FROM THE HITS. Measured: 6 of 7 hits carrying a `repo` agreed, and that agreement is
	// the whole signal — the expansion key is never known in advance.
	test('finds the reference a majority of the carrying hits agree on', () => {
		const got = agreedReference(['repos/ext', 'repos/ext', null, 'repos/eng', 'repos/ext', undefined]);
		assert.deepEqual(got, { ref: 'repos/ext', agreeing: 3, carrying: 4 });
	});

	// ⚠ REFUSES RATHER THAN GUESSES. Expanding through a weak plurality hands back a confident set
	// built on one coincidence — worse than returning nothing, because it looks like an answer.
	test('returns null on a tie — a plurality is not agreement', () => {
		assert.equal(agreedReference(['a', 'b']), null);
		assert.equal(agreedReference(['a', 'a', 'b', 'b']), null);
	});
	test('returns null when one hit agrees only with itself', () => {
		assert.equal(agreedReference(['a']), null, 'a single carrying hit cannot establish a shared parent');
		assert.equal(agreedReference(['a', null, null]), null);
	});
	test('returns null when nothing carries the field at all', () => {
		assert.equal(agreedReference([]), null);
		assert.equal(agreedReference([null, undefined, '']), null);
	});
	test('a clear majority still wins when some hits carry nothing', () => {
		assert.deepEqual(agreedReference(['x', 'x', 'x', null, null, 'y']), { ref: 'x', agreeing: 3, carrying: 4 });
	});
});

describe('routing', () => {
	// ⚠ A quoted phrase means the asker is QUOTING the corpus, not describing it — and on the corpus's
	// own words lexical scores MRR 1.00 in 9ms while the full pipeline scores the same in ~22,900ms.
	test('a quoted question routes to rung 0, where it is 2,500x cheaper for the same rank-1 answer', () => {
		assert.equal(suggestEffort('"npm test is two runners"'), 0);
		assert.equal(suggestEffort("'store add runs at 55-73 records per second'"), 0);
	});
	test('a described question routes to rung 2, because it can fail on either vocabulary or abstraction', () => {
		assert.equal(suggestEffort('the thing we ship is mostly stuff nobody needs'), 2);
		assert.equal(suggestEffort('we tested a fresh agent cold on a handful of tasks'), 2);
	});
	// ⚠ Rung 3 is a decision about what the ASKER wants back — every member of a referenced set — and a
	// heuristic on wording has no business making that for them.
	test('never routes to rung 3 on its own', () => {
		for (const q of ['what is broken in the editor extension', 'list everything we shipped', 'which records cite this'])
			assert.notEqual(suggestEffort(q), 3, 'set-shaped intent is the caller\'s to declare, not a guess from wording');
	});
	test('every rung names a qmd verb and says why it exists', () => {
		for (const [n, r] of Object.entries(RUNGS)) {
			assert.ok(['search', 'vsearch', 'query'].includes(r.verb), `rung ${n} must name a real qmd verb`);
			assert.ok(r.why.length > 20, `rung ${n} must say why it exists`);
		}
	});
});

describe('the collection an expansion filters (the escaped defect)', () => {
	// ⚠ REGRESSION. Taking the collection from the FIRST hit shipped and failed silently: the first hit
	// was a draft-doc carrying no reference field, so the expansion filtered the wrong collection, the
	// engine exited non-zero, and the rung reported "the hits agree on no reference" — a refusal that
	// reads as principled and is a bug. Every unit test was green; only the live walk caught it.
	test('comes from the records that CARRY the agreed reference, not from the first hit', () => {
		const carried = [
			{ ref: null, collection: 'rnd/draft-docs' },          // ← the first hit, and the old bug
			{ ref: null, collection: 'rnd/product-design-docs' },
			{ ref: 'repos/ext', collection: 'rnd/issues' },
			{ ref: 'repos/ext', collection: 'rnd/issues' },
			{ ref: 'repos/eng', collection: 'rnd/issues' },
		];
		assert.equal(collectionOfAgreeing(carried, 'repos/ext'), 'rnd/issues');
	});
	test('takes the commonest when the agreeing records span several collections', () => {
		const carried = [
			{ ref: 'r/x', collection: 'rnd/features' },
			{ ref: 'r/x', collection: 'rnd/issues' },
			{ ref: 'r/x', collection: 'rnd/issues' },
		];
		assert.equal(collectionOfAgreeing(carried, 'r/x'), 'rnd/issues');
	});
	test('returns null when nothing carries the agreed reference', () => {
		assert.equal(collectionOfAgreeing([{ ref: 'a', collection: 'c' }], 'b'), null);
		assert.equal(collectionOfAgreeing([], 'a'), null);
		assert.equal(collectionOfAgreeing(null, 'a'), null);
	});
});
