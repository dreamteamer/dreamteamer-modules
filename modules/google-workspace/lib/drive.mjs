import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const FOLDER = 'application/vnd.google-apps.folder';
const STUB = /\.(gdoc|gsheet|gslides|gform|gdraw|gmap|gsite|glink|gjam|gtable|gscript|icloud)$/i;
const digest = bytes => createHash('md5').update(bytes).digest('hex');
const esc = value => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const native = file => file?.mimeType?.startsWith('application/vnd.google-apps.') && file.mimeType !== FOLDER;
const fields = 'id,name,mimeType,size,md5Checksum,parents,trashed,webViewLink';
export function parseRef(ref) {
  if (typeof ref !== 'string' || !ref) throw new Error('A Drive root/path reference is required.');
  const [root, ...parts] = ref.split('/');
  if (!/^[A-Za-z0-9_-]+$/.test(root) || parts.some(p => !p || p === '.' || p === '..' || /[\\\x00-\x1f]/.test(p))) throw new Error('Invalid Drive reference.');
  return { root, parts };
}
const requireFile = ref => { const parsed = parseRef(ref); if (!parsed.parts.length) throw new Error('A path beneath the root is required.'); return parsed; };
const safeName = name => { if (typeof name !== 'string' || !name || ['.', '..'].includes(name) || /[/\\\x00-\x1f]/.test(name)) throw new Error('Expected a single safe filename.'); return name; };

export function createDrive(request) {
  const api = (endpoint, options = {}) => request(endpoint, { ...options, params: { supportsAllDrives: 'true', ...options.params } });
  async function listChildren(parent, name) {
    const files = [], seen = new Set(); let pageToken;
    do {
      const result = await api('files', { params: { q: `'${esc(parent)}' in parents and trashed = false${name === undefined ? '' : ` and name = '${esc(name)}'`}`, fields: `nextPageToken,files(${fields})`, pageSize: 1000, includeItemsFromAllDrives: 'true', pageToken } });
      files.push(...(result.files ?? [])); pageToken = result.nextPageToken;
      if (pageToken && seen.has(pageToken)) throw new Error('Drive pagination repeated a token.');
      if (pageToken) seen.add(pageToken);
    } while (pageToken);
    return files;
  }
  async function child(parent, name) {
    const matches = await listChildren(parent, name);
    if (matches.length > 1) throw new Error('Ambiguous Drive name; resolve duplicates before acting.');
    return matches[0] ?? null;
  }
  async function folder(ref, { create = false } = {}) {
    const { root, parts } = parseRef(ref); let parent = root;
    for (const name of parts) {
      let found = await child(parent, name);
      if (!found && create) found = await api('files', { method: 'POST', params: { fields }, body: { name, mimeType: FOLDER, parents: [parent] } });
      if (!found) return null;
      if (found.mimeType !== FOLDER) throw new Error('A Drive path component is not a folder.');
      parent = found.id;
    }
    return parent;
  }
  async function locate(ref) {
    const { root, parts } = requireFile(ref), name = parts.pop();
    const parent = await folder([root, ...parts].join('/'));
    return { parent, file: parent ? await child(parent, name) : null, name };
  }
  const needed = async ref => { const hit = await locate(ref); if (!hit.file) throw new Error('Drive file was not found.'); return hit; };
  async function list(ref) { const parent = await folder(ref); if (!parent) throw new Error('Drive folder was not found.'); return listChildren(parent); }
  async function exists(ref) { const hit = await locate(ref); return { exists: !!hit.file, file: hit.file }; }
  async function read(ref, destination) {
    const { file } = await needed(ref);
    if (native(file) || file.mimeType === FOLDER) throw new Error('Only binary files can be materialized; export native documents explicitly.');
    if (!destination || !path.isAbsolute(destination)) throw new Error('An explicit absolute destination is required.');
    if (fs.existsSync(destination)) {
      if (fs.lstatSync(destination).isSymbolicLink()) throw new Error('Refusing a symbolic-link destination.');
      const old = fs.readFileSync(destination);
      if (file.md5Checksum && digest(old) === file.md5Checksum) return { path: destination, reused: true, content_verified: true };
      throw new Error('Destination already exists with unverified or different content.');
    }
    const bytes = await api(`files/${encodeURIComponent(file.id)}`, { params: { alt: 'media' }, raw: true });
    if (!Buffer.isBuffer(bytes)) throw new Error('Drive download did not return bytes.');
    if (file.md5Checksum && digest(bytes) !== file.md5Checksum) throw new Error('Drive download checksum mismatch.');
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, bytes, { flag: 'wx', mode: 0o600 });
    return { path: destination, reused: false, content_verified: !!file.md5Checksum };
  }
  async function write(ref, local, { apply = false } = {}) {
    const { root, parts } = requireFile(ref), name = parts.pop();
    if (STUB.test(local) || STUB.test(name)) throw new Error('Refusing a local cloud placeholder or native-document pointer.');
    if (fs.lstatSync(local).isSymbolicLink() || !fs.statSync(local).isFile()) throw new Error('Upload requires a regular non-symlink file.');
    const bytes = fs.readFileSync(local), md5 = digest(bytes), hit = await locate(ref);
    if (hit.file && (native(hit.file) || hit.file.mimeType === FOLDER)) throw new Error('Refusing to overwrite a native document or folder.');
    if (hit.file?.md5Checksum === md5) return { id: hit.file.id, reused: true, content_verified: true, md5 };
    if (!apply) return { dry_run: true, operation: 'write', ref, size: bytes.length, would_overwrite: !!hit.file };
    const parent = hit.parent ?? await folder([root, ...parts].join('/'), { create: true });
    const metadata = hit.file ? {} : { name, parents: [parent] };
    const boundary = `dt-${randomUUID()}`;
    const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const saved = await api(hit.file ? `files/${encodeURIComponent(hit.file.id)}` : 'files', { upload: true, method: hit.file ? 'PATCH' : 'POST', params: { uploadType: 'multipart', fields }, headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
    return { id: saved.id, md5, content_verified: saved.md5Checksum === md5, reused: false };
  }
  async function mutate(operation, ref, value, { apply = false, permanent = false } = {}) {
    if (operation === 'rm' && !permanent) throw new Error('Permanent removal requires --permanent; prefer recoverable trash.');
    if (!['trash', 'rm', 'mv', 'rename'].includes(operation)) throw new Error('Unknown Drive mutation.');
    const { file, parent } = await needed(ref);
    if (operation === 'rm' && (native(file) || file.mimeType === FOLDER)) throw new Error('Permanent deletion of native documents or folders is not supported.');
    let params = { fields }, body;
    if (operation === 'trash') body = { trashed: true };
    if (operation === 'rename') body = { name: safeName(value) };
    if (operation === 'mv') {
      const target = await folder(value); if (!target) throw new Error('Target folder was not found.');
      if (target === parent) return { id: file.id, unchanged: true };
      if (file.mimeType === FOLDER) {
        const seen = new Set(); let queue = [target];
        while (queue.length) {
          const current = queue.shift();
          if (current === file.id) throw new Error('Cannot move a folder into itself or its descendants.');
          if (seen.has(current)) continue;
          seen.add(current); if (seen.size > 10000) throw new Error('Folder ancestry exceeds the safety limit.');
          const metadata = await api(`files/${encodeURIComponent(current)}`, { params: { fields: 'id,parents' } });
          queue.push(...(metadata.parents ?? []));
        }
      }
      const collision = await child(target, file.name); if (collision && collision.id !== file.id) throw new Error('Target name already exists.');
      params = { ...params, addParents: target, removeParents: parent };
    }
    if (operation === 'rename') { const collision = await child(parent, value); if (collision && collision.id !== file.id) throw new Error('Target name already exists.'); }
    if (!apply) return { dry_run: true, operation, ref, id: file.id, target: value ?? null, permanent: operation === 'rm' };
    await api(`files/${encodeURIComponent(file.id)}`, { method: operation === 'rm' ? 'DELETE' : 'PATCH', params, body });
    return { id: file.id, operation, applied: true, permanent: operation === 'rm' };
  }
  async function copy(ref, destination, { apply = false } = {}) {
    const { file } = await needed(ref), target = await folder(destination);
    if (!target) throw new Error('Destination folder was not found.');
    const nodes = new Map(), visiting = new Set();
    async function collect(entry) {
      safeName(entry.name);
      if (visiting.has(entry.id)) throw new Error('Source folder graph contains a cycle.');
      if (nodes.has(entry.id)) throw new Error('Source contains a repeated file identifier.');
      if (nodes.size >= 10000) throw new Error('Copy exceeds the safety limit.');
      if (entry.mimeType === 'application/vnd.google-apps.shortcut') throw new Error('Resolve shortcuts explicitly before copying.');
      const node = { ...entry, children: [] }; nodes.set(entry.id, node);
      if (entry.mimeType === FOLDER) {
        visiting.add(entry.id);
        const children = await listChildren(entry.id), names = new Set();
        for (const item of children) {
          if (names.has(item.name)) throw new Error('Source contains duplicate names.');
          names.add(item.name); node.children.push(await collect(item));
        }
        visiting.delete(entry.id);
      }
      return node;
    }
    const tree = await collect(file);
    if (nodes.has(target)) throw new Error('Cannot copy into the source or its descendants.');
    const results = [];
    async function copyNode(node, parent) {
      const collision = parent ? await child(parent, node.name) : null;
      if (node.mimeType === FOLDER) {
        if (collision && collision.mimeType !== FOLDER) throw new Error('Destination folder name conflicts with a file.');
        let destinationId = collision?.id;
        if (!destinationId && apply) destinationId = (await api('files', { method: 'POST', params: { fields }, body: { name: node.name, mimeType: FOLDER, parents: [parent] } })).id;
        results.push({ source_id: node.id, id: destinationId ?? null, folder: true, reused: !!collision, dry_run: !apply });
        for (const entry of node.children) await copyNode(entry, destinationId);
        return;
      }
      if (collision) {
        if (node.md5Checksum && collision.md5Checksum === node.md5Checksum) {
          results.push({ source_id: node.id, id: collision.id, reused: true, content_verified: true }); return;
        }
        throw new Error('Destination name exists with different or unverifiable content.');
      }
      if (!apply) { results.push({ source_id: node.id, dry_run: true, would_copy: true }); return; }
      const saved = await api(`files/${encodeURIComponent(node.id)}/copy`, { method: 'POST', params: { fields }, body: { name: node.name, parents: [parent] } });
      const verified = !!node.md5Checksum && saved.md5Checksum === node.md5Checksum;
      results.push({ source_id: node.id, id: saved.id, copied: true, content_verified: verified });
      if (node.md5Checksum && !verified) throw new Error('Copied content checksum was not verified.');
    }
    try { await copyNode(tree, target); } catch (error) { error.partialResults = results; throw error; }
    return file.mimeType === FOLDER ? { dry_run: !apply, results } : results[0];
  }
  async function checkMount(ref, local) {
    const root = await folder(ref); if (!root) throw new Error('Drive folder was not found.');
    const mismatches = [], visited = new Set(); let checked = 0;
    async function inspect(parent, directory, prefix = '') {
      if (visited.has(parent)) throw new Error('Remote folder graph contains a cycle or repeated identifier.');
      visited.add(parent); if (visited.size > 10000) throw new Error('Mount traversal exceeds the safety limit.');
      if (fs.existsSync(directory) && (fs.lstatSync(directory).isSymbolicLink() || !fs.statSync(directory).isDirectory())) {
        mismatches.push({ name: prefix || '.', state: 'not-a-local-directory' }); return;
      }
      const remote = await listChildren(parent), names = new Set();
      for (const file of remote) {
        safeName(file.name);
        if (names.has(file.name)) throw new Error('Remote folder contains duplicate names.');
        names.add(file.name); checked++;
        const label = prefix + file.name, target = path.join(directory, file.name);
        if (file.mimeType === FOLDER) { await inspect(file.id, target, label + '/'); continue; }
        if (native(file)) { mismatches.push({ name: label, state: 'not-checked-native' }); continue; }
        if (!fs.existsSync(target)) { mismatches.push({ name: label, state: 'missing' }); continue; }
        if (!fs.lstatSync(target).isFile() || fs.lstatSync(target).isSymbolicLink()) { mismatches.push({ name: label, state: 'not-a-regular-file' }); continue; }
        if (!file.md5Checksum || digest(fs.readFileSync(target)) !== file.md5Checksum) mismatches.push({ name: label, state: 'checksum-unverified-or-different' });
      }
      if (fs.existsSync(directory)) for (const name of fs.readdirSync(directory)) {
        if (!name.startsWith('.') && !names.has(name)) mismatches.push({ name: prefix + name, state: 'local-only' });
      }
    }
    await inspect(root, local);
    return { checked, matches: mismatches.length === 0, mismatches, recursive: true };
  }
  async function tier(local, root, { apply = false, deleteLocal = false, layout = 'year-month' } = {}) {
    parseRef(root); if (!['flat', 'year-month'].includes(layout)) throw new Error('Unsupported tier layout.');
    const results = []; let active;
    try {
      for (const name of fs.readdirSync(local).sort()) {
        if (name.startsWith('.') || STUB.test(name)) continue;
        active = { name, deleted: false, stage: 'inspect' };
        const source = path.join(local, name), stat = fs.lstatSync(source);
        if (!stat.isFile() || stat.isSymbolicLink()) { active = undefined; continue; }
        const date = name.match(/(20\d{2})[ ._-]?(0[1-9]|1[0-2])/);
        const sub = layout === 'flat' ? '' : date ? `${date[1]}/${date[2]}/` : 'unsorted/';
        active.stage = 'read-source';
        const before = digest(fs.readFileSync(source)); let result;
        active.stage = 'upload';
        try { result = await write(`${root}/${sub}${name}`, source, { apply }); }
        catch { results.push({ name, failed: true, deleted: false, error: 'Upload failed; local file retained.', remote_state: 'unknown' }); active = undefined; continue; }
        active = { name, ...result, deleted: false, stage: 'verify-local' };
        if (apply && deleteLocal && result.content_verified === true) {
          if (digest(fs.readFileSync(source)) !== before || result.md5 !== before) throw new Error('Local file changed during upload; not deleting.');
          active.stage = 'delete-local';
          fs.unlinkSync(source); active.deleted = true;
        }
        const { stage, ...completed } = active;
        results.push(completed); active = undefined;
      }
    } catch (error) {
      if (active) results.push({ ...active, failed: true, error: 'Tiering stopped during this stage; inspect local and remote state before retrying.' });
      error.partialResults = results;
      throw error;
    }
    return { dry_run: !apply, failed: results.filter(r => r.failed || (apply && !r.content_verified)).length, results };
  }
  return { list, exists, read, write, mutate, copy, checkMount, tier };
}
