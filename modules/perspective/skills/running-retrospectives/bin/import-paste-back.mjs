#!/usr/bin/env node
// import-paste-back — a reply from another AI tool ("what do you remember about me?") becomes the
// BODY of that tool's `sources` record. Verbatim is the whole point: only trailing whitespace is
// trimmed, so a Hebrew line, a `---` line and every blank line inside the reply survive.
//
// ⚠ It used to write an `perspective/answers` record. That collection was deleted on 2026-09-08
// when answers were folded into the question that asked them — and a paste-back has no question, so
// it had nowhere left to go. The right home was already declared: `sources.kind` has carried
// `paste-back` since v1, and a paste-back IS a source of evidence rather than an answer to anything.
// The text lands in the source's markdown BODY, where a long reply belongs, and the frontmatter keeps
// the perimeter facts (where it came from, how much of it there is).
//   node import-paste-back.mjs <file> --retrospective perspective/retrospective-sessions/<id> --origin paste-back-chatgpt [--data-root d]
import fs from 'node:fs';
import path from 'node:path';
import { DATA, templatize } from '../lib/vault.mjs';
import { recordPath, writeRecord, readRecord, contributorOf, writeSource } from '../lib/records.mjs';

const ORIGINS = ['paste-back-chatgpt', 'paste-back-gemini', 'paste-back-other'];
const AUTHOR = 'scripts/import-paste-back@2';

const argv = process.argv.slice(2);
const opt = (n, d = '') => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));

const file = positional[0];
const retrospectiveRef = opt('retrospective');
const origin = opt('origin');
if (!file || !fs.existsSync(file)) { console.error('usage: import-paste-back.mjs <file> --retrospective perspective/retrospective-sessions/<id> --origin ' + ORIGINS.join('|')); process.exit(2); }
if (!retrospectiveRef.startsWith('perspective/retrospective-sessions/')) { console.error('usage: --retrospective perspective/retrospective-sessions/<id> is required'); process.exit(2); }
if (!ORIGINS.includes(origin)) { console.error(`unknown --origin ${origin || '(missing)'} — one of ${ORIGINS.join(' | ')}`); process.exit(2); }

const sessionBase = retrospectiveRef.split('/').pop();
const dataRoot = opt('data-root', DATA);
// Every evidence and model id is keyed by the CONTRIBUTOR, not by the run — a re-run must update
// this person's records rather than write a parallel set beside them. Resolved LAZILY, on first
// use, so a script that should exit 2 on a bad argument still does.
let _who = null;
const who = () => (_who ??= contributorOf(retrospectiveRef, dataRoot));
const text = fs.readFileSync(file, 'utf8').replace(/\s+$/, '');

const id = `${who()}/paste-back--${origin}`;
const file_ = recordPath('sources', id, 'source', dataRoot);
const location = templatize(path.resolve(file));
const templated = location.startsWith('$'); // a path outside ${userHome}/${workspaceFolder}/${env:REPOS_FOLDER} never lands in a record

// A SECOND paste-back from the same tool APPENDS under its own dated heading rather than replacing
// the first. Re-asking the same tool months later is the point of asking it at all: what it
// remembers changes, and the change is the evidence.
let body = '';
try { body = readRecord(file_).body ?? ''; } catch { /* first import */ }
const stamp = new Date().toISOString().slice(0, 10);
const heading = `## pasted back ${stamp}`;
const next = body.includes(text)
	? body                                            // idempotent: the same text twice is one import
	: `${body.trim()}\n\n${heading}\n\n${text}\n`.trim() + '\n';
const imports = (next.match(/^## pasted back /gm) ?? []).length;

writeSource(file_, {
	retrospective: retrospectiveRef,
	kind: 'paste-back',
	label: origin,
	reach: 'available',
	location: templated ? location : undefined,
	counts: { imports, bytes: Buffer.byteLength(next, 'utf8') },
	read_with: 'import-paste-back@2',
	author: AUTHOR,
	creation_context: `Pasted back from ${origin.replace(/^paste-back-/, '')} and imported verbatim by import-paste-back.`,
	confidence: 'normal',
}, next);

process.stdout.write(`✔ sources/${id} · ${imports} import(s) · ${Buffer.byteLength(text, 'utf8')} bytes this one\n`);
