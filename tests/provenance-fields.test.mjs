// THE PROVENANCE QUAD IS DRAWN AS PROVENANCE. Every module that ships `author · creation_context ·
// source · confidence` titles the provenance `source` field "Information source" and files the quad
// under ONE collapsed "Provenance" form section.
//
// ⚠ Why: an editor that reads records from several roots marks where a record's FILE comes from as its
// source, under the title; the provenance `source` row a few lines below — empty, editable, titled
// "Source" — read as the same fact. They are different facts (where the INFORMATION came from vs where
// the file lives), the quad is mostly agent-written, and a person editing a record should not have to
// step over it. The title keeps the key `source`, so nothing migrates; `collapsed` is ignored by an
// engine older than the one that draws it, so the section is simply open there.
//
// A `source` field that means something else (why a screen exists, which transcript a conversation was
// read from) keeps its own title and stays out of the section; the other three still go in it.
import { test } from 'node:test';
import assert from 'node:assert';
import { ALL } from './helpers/descriptors.mjs';

const PROVENANCE = /^where the information came from/i;
const withQuad = ALL.filter(({ doc }) => doc.fields?.author && doc.fields?.creation_context && doc.fields?.confidence);

test('the gate reads the descriptors it judges', () => {
	// a pin that matches nothing passes vacuously
	assert.ok(withQuad.length >= 40, `only ${withQuad.length} descriptors carry the provenance fields — the reader is broken`);
});

test('every provenance `source` field is titled "Information source"', () => {
	const untitled = withQuad
		.filter(({ doc }) => PROVENANCE.test(String(doc.fields.source?.description ?? '')))
		.filter(({ doc }) => doc.fields.source.title !== 'Information source')
		.map(({ file }) => file);
	assert.deepEqual(untitled, [], 'title the provenance source field: `title: Information source`');
});

test('the provenance fields sit in one collapsed "Provenance" form section, and nowhere else', () => {
	const wrong = [];
	for (const { file, doc } of withQuad) {
		const sections = doc.display?.form?.sections ?? [];
		const prov = sections.filter((s) => s.title === 'Provenance');
		const want = ['author', 'creation_context', ...(PROVENANCE.test(String(doc.fields.source?.description ?? '')) ? ['source'] : []), 'confidence'];
		if (prov.length !== 1) { wrong.push(`${file}: ${prov.length} Provenance sections`); continue; }
		if (prov[0].collapsed !== true) wrong.push(`${file}: the Provenance section is not collapsed`);
		const missing = want.filter((f) => !prov[0].fields.includes(f));
		if (missing.length) wrong.push(`${file}: ${missing.join(', ')} not in the Provenance section`);
		const elsewhere = sections.filter((s) => s.title !== 'Provenance').flatMap((s) => s.fields ?? []).filter((f) => want.includes(f));
		if (elsewhere.length) wrong.push(`${file}: ${elsewhere.join(', ')} also in another section`);
		if (!PROVENANCE.test(String(doc.fields.source?.description ?? '')) && prov[0].fields.includes('source')) wrong.push(`${file}: a non-provenance source field is in the Provenance section`);
	}
	assert.deepEqual(wrong, []);
});
