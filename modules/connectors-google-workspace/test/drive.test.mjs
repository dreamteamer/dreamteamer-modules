import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createDrive, parseRef } from '../lib/drive.mjs';
const md5 = value => createHash('md5').update(value).digest('hex');
const binary = { id: 'file-one', name: 'report.txt', mimeType: 'text/plain', md5Checksum: md5('payload'), size: '7' };
const temporary = () => fs.mkdtempSync(path.join(os.tmpdir(), 'drive-helper-'));
function mocked(files = [binary]) {
  const writes = [], reads = [];
  return { writes, reads, request: async (endpoint, opts = {}) => {
    if (opts.method && opts.method !== 'GET') { writes.push({ endpoint, opts }); return { id: 'saved', mimeType: opts.body?.mimeType, md5Checksum: md5('payload') }; }
    reads.push({ endpoint, opts });
    if (opts.raw) return Buffer.from('payload');
    if (endpoint === 'files') {
      const name = opts.params.q.match(/name = '([^']+)'/)?.[1];
      return { files: name ? files.filter(f => f.name === name) : files };
    }
    return binary;
  } };
}
test('references reject traversal, empty segments and unsafe root identifiers', () => {
  for (const value of ['../name', 'root/../name', 'root//name', 'root/name\\other', '/name']) assert.throws(() => parseRef(value));
  assert.deepEqual(parseRef('root/folder/report.txt'), { root: 'root', parts: ['folder', 'report.txt'] });
});
test('list paginates and rejects repeated tokens', async () => {
  const seen = [];
  const d = createDrive(async (_, { params }) => { seen.push(params); return params.pageToken ? { files: [{ id: 'two' }] } : { files: [{ id: 'one' }], nextPageToken: 'next' }; });
  assert.equal((await d.list('root')).length, 2); assert.equal(seen[1].pageToken, 'next'); assert.equal(seen[0].supportsAllDrives, 'true');
  await assert.rejects(createDrive(async () => ({ nextPageToken: 'same', files: [] })).list('root'), /repeated/);
});
test('ambiguous names and native permanent removal are refused', async () => {
  await assert.rejects(createDrive(mocked([binary, { ...binary, id: 'file-two' }]).request).exists('root/report.txt'), /Ambiguous/);
  const m = mocked([{ ...binary, mimeType: 'application/vnd.google-apps.document' }]);
  await assert.rejects(createDrive(m.request).mutate('rm', 'root/report.txt', null, { apply: true, permanent: true }), /native/);
  assert.equal(m.writes.length, 0);
});
test('mutations default to dry-run, explicit apply sends patch, rm requires extra opt-in', async () => {
  const m = mocked(), d = createDrive(m.request);
  assert.equal((await d.mutate('trash', 'root/report.txt')).dry_run, true); assert.equal(m.writes.length, 0);
  await d.mutate('trash', 'root/report.txt', null, { apply: true }); assert.deepEqual(m.writes[0].opts.body, { trashed: true });
  await assert.rejects(d.mutate('rm', 'root/report.txt'), /permanent/);
});
test('read verifies bytes, reuses checksum match and refuses overwriting drift', async () => {
  const dir = temporary();
  try {
    const d = createDrive(mocked().request), target = path.join(dir, 'download.txt');
    assert.equal((await d.read('root/report.txt', target)).content_verified, true);
    assert.equal((await d.read('root/report.txt', target)).reused, true);
    fs.writeFileSync(target, 'changed'); await assert.rejects(d.read('root/report.txt', target), /already exists/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('write never uploads placeholders and uploads binary multipart only on apply', async () => {
  const dir = temporary();
  try {
    const m = mocked([]), d = createDrive(m.request), source = path.join(dir, 'source.txt'); fs.writeFileSync(source, 'payload');
    assert.equal((await d.write('root/report.txt', source)).dry_run, true); assert.equal(m.writes.length, 0);
    const result = await d.write('root/report.txt', source, { apply: true }); assert.equal(result.content_verified, true);
    assert.equal(m.writes[0].opts.upload, true); assert.equal(Buffer.isBuffer(m.writes[0].opts.body), true);
    await assert.rejects(d.write('root/report.gdoc', source, { apply: true }), /pointer/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('mount reports missing or unverifiable files, never changes them', async () => {
  const dir = temporary();
  try {
    const d = createDrive(mocked().request);
    assert.equal((await d.checkMount('root', dir)).matches, false);
    fs.writeFileSync(path.join(dir, 'report.txt'), 'payload'); assert.equal((await d.checkMount('root', dir)).matches, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('tier defaults to keeping local data and only deletes after verified upload plus explicit flag', async () => {
  const dir = temporary();
  try {
    const source = path.join(dir, 'report.txt'); fs.writeFileSync(source, 'payload');
    const m = mocked([]), d = createDrive(m.request);
    await d.tier(dir, 'root', { layout: 'flat' }); assert.equal(m.writes.length, 0); assert.ok(fs.existsSync(source));
    await d.tier(dir, 'root', { apply: true, layout: 'flat' }); assert.ok(fs.existsSync(source));
    await d.tier(dir, 'root', { apply: true, deleteLocal: true, layout: 'flat' }); assert.equal(fs.existsSync(source), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('copy uses verified idempotence and refuses conflicting target content', async () => {
  const d = createDrive(mocked().request); assert.equal((await d.copy('root/report.txt', 'target')).reused, true);
  let n = 0; const bad = createDrive(async () => ({ files: [++n === 1 ? binary : { ...binary, md5Checksum: 'different' }] }));
  await assert.rejects(bad.copy('root/report.txt', 'target', { apply: true }), /different/);
});

test('recursive copy plans and applies a tree, rejects descendant target', async () => {
  const source = { id: 'source-dir', name: 'bundle', mimeType: 'application/vnd.google-apps.folder' }, writes = [];
  const request = async (endpoint, opts = {}) => {
    if (opts.method) { writes.push({ endpoint, opts }); return { id: 'new-item', md5Checksum: binary.md5Checksum }; }
    const q = opts.params.q;
    if (q.includes("'root'")) return { files: [source] };
    if (q.includes("'source-dir'")) return { files: [binary] };
    return { files: [] };
  };
  const d = createDrive(request);
  const plan = await d.copy('root/bundle', 'target'); assert.equal(plan.results.length, 2); assert.equal(writes.length, 0);
  const applied = await d.copy('root/bundle', 'target', { apply: true }); assert.equal(applied.results.length, 2); assert.equal(writes.length, 2);
  await assert.rejects(d.copy('root/bundle', 'source-dir', { apply: true }), /descendants/);
});
test('recursive mount catches nested missing content and local-only files', async () => {
  const dir = temporary();
  try {
    fs.mkdirSync(path.join(dir, 'bundle')); fs.writeFileSync(path.join(dir, 'extra.txt'), 'extra');
    const d = createDrive(async (_, { params }) => ({ files: params.q.includes("'root'") ? [{ id: 'child', name: 'bundle', mimeType: 'application/vnd.google-apps.folder' }] : [binary] }));
    const report = await d.checkMount('root', dir);
    assert.equal(report.recursive, true); assert.equal(report.matches, false);
    assert.ok(report.mismatches.some(m => m.name === 'bundle/report.txt' && m.state === 'missing'));
    assert.ok(report.mismatches.some(m => m.name === 'extra.txt' && m.state === 'local-only'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('CLI uses async request factory lazily and never authenticates rejected permanent removal', async () => {
  const { main } = await import('../bin/drive.mjs'); let starts = 0, output;
  const options = { requestFactory: async (account, service) => { starts++; assert.equal(account, 'dana@northwind.example'); assert.equal(service, 'drive'); return mocked().request; }, output: value => { output = JSON.parse(value); } };
  await assert.rejects(main(['rm', 'root/report.txt', '--as', 'dana@northwind.example'], options), /permanent/); assert.equal(starts, 0);
  assert.equal(await main(['ls', 'root', '--as', 'dana@northwind.example'], options), 0); assert.equal(starts, 1); assert.equal(output[0].id, binary.id);
});
test('tier retains local files when upload is unverified or fails', async () => {
  const dir = temporary();
  try {
    fs.writeFileSync(path.join(dir, 'report.txt'), 'payload');
    for (const fail of [false, true]) {
      const d = createDrive(async (_, opts) => { if (opts.method) { if (fail) throw new Error('synthetic failure'); return { id: 'unverified' }; } return { files: [] }; });
      const report = await d.tier(dir, 'root', { apply: true, deleteLocal: true, layout: 'flat' });
      assert.equal(report.failed, 1); assert.ok(fs.existsSync(path.join(dir, 'report.txt'))); assert.equal(report.results[0].deleted, false);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('folder move checks target ancestry before any mutation', async () => {
  const writes = [];
  const d = createDrive(async (endpoint, opts) => {
    if (opts.method) { writes.push(opts); return {}; }
    if (endpoint === 'files') return { files: [{ id: 'source', name: 'bundle', mimeType: 'application/vnd.google-apps.folder' }] };
    return { id: 'descendant', parents: ['source'] };
  });
  await assert.rejects(d.mutate('mv', 'root/bundle', 'descendant', { apply: true }), /descendants/);
  assert.equal(writes.length, 0);
});
test('CLI exits nonzero when an applied upload lacks checksum verification', async () => {
  const { main } = await import('../bin/drive.mjs');
  const dir = temporary();
  try {
    const local = path.join(dir, 'report.txt'); fs.writeFileSync(local, 'payload');
    let result;
    const code = await main(['write', 'root/report.txt', local, '--as', 'dana@northwind.example', '--apply'], {
      requestFactory: async () => async (_, options) => options.method ? { id: 'saved' } : { files: [] },
      output: text => { result = JSON.parse(text); },
    });
    assert.equal(code, 1); assert.equal(result.content_verified, false); assert.ok(fs.existsSync(local));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});


test('fatal tier errors preserve prior deletions and current upload result', async () => {
  for (const failure of ['changed-source', 'missing-source', 'missing-next-file']) {
    const dir = temporary();
    try {
      for (const name of ['a.txt', 'b.txt', 'c.txt']) fs.writeFileSync(path.join(dir, name), 'payload');
      let uploads = 0;
      const d = createDrive(async (_, options = {}) => {
        if (options.method === 'POST') {
          uploads++;
          if (uploads === 2) {
            if (failure === 'changed-source') fs.writeFileSync(path.join(dir, 'b.txt'), 'changed');
            else fs.unlinkSync(path.join(dir, failure === 'missing-source' ? 'b.txt' : 'c.txt'));
          }
          return { id: `saved-${uploads}`, md5Checksum: md5('payload') };
        }
        return { files: [] };
      });
      await assert.rejects(d.tier(dir, 'root', { apply: true, deleteLocal: true, layout: 'flat' }), error => {
        const results = error.partialResults;
        assert.equal(results[0].name, 'a.txt'); assert.equal(results[0].deleted, true);
        const last = results.at(-1);
        assert.equal(last.failed, true); assert.equal(last.deleted, false);
        if (failure === 'missing-next-file') {
          assert.equal(results[1].deleted, true); assert.equal(last.stage, 'inspect');
        } else {
          assert.equal(last.id, 'saved-2'); assert.equal(last.content_verified, true);
          assert.equal(last.stage, 'verify-local');
        }
        return true;
      });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});
