import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

function line(value, label) {
  if (typeof value !== 'string' || !value.trim() || /[\x00-\x1f\x7f]/.test(value)) throw new Error(`Invalid ${label}`);
  return value;
}
function absolute(value, home, label) {
  value = line(value, label);
  if (value.startsWith('~/')) value = path.join(home, value.slice(2));
  if (!path.isAbsolute(value)) throw new Error(`${label} must be absolute or home-relative`);
  return path.normalize(value);
}
const quote = (value) => JSON.stringify(value);
const within = (root, candidate) => candidate === root || candidate.startsWith(root + path.sep);

export function validateConfig(input, {home = os.homedir()} = {}) {
  if (!input || !Array.isArray(input.identities) || !input.identities.length) throw new Error('Provide a nonempty identities array');
  const ids = new Set(); const aliases = new Set();
  const rows = input.identities.map((r) => {
    if (!r || !/^[a-z][a-z0-9-]*$/.test(r.id ?? '')) throw new Error('Invalid identity id');
    if (ids.has(r.id)) throw new Error('Duplicate identity id'); ids.add(r.id);
    const alias = line(r.sshAlias, 'SSH alias');
    if (!/^[a-z][a-z0-9-]*$/.test(alias) || aliases.has(alias)) throw new Error('Invalid or duplicate SSH alias'); aliases.add(alias);
    const host = line(r.host, 'SSH host');
    if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host)) throw new Error('Invalid SSH host');
    const root = absolute(r.root, home, 'identity root');
    if (/[?*\[\]\\]/.test(root)) throw new Error('Identity root cannot contain Git glob characters');
    const name = line(r.name, 'commit name'); const email = line(r.email, 'commit email');
    if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw new Error('Invalid commit email');
    return {id:r.id, root, name, email, sshAlias:alias, host, keyPath:absolute(r.keyPath, home, 'key path'), configPath:path.join(home, `.gitconfig-${r.id}`)};
  });
  for (let i=0; i<rows.length; i++) for (let j=i+1; j<rows.length; j++) {
    if (within(rows[i].root,rows[j].root) || within(rows[j].root,rows[i].root)) throw new Error('Overlapping identity roots are ambiguous');
  }
  return rows;
}

/** Pure proposal: no configuration or key files are read or written. */
export function renderPlan(input, options) {
  const rows = validateConfig(input, options);
  return {
    warning: 'Proposal only. Review with the owner before changing machine configuration. Contains owner-supplied identity values; keep private.',
    gitIncludes: rows.map(r=>`[includeIf ${quote(`gitdir:${r.root}/`)}]\n\tpath = ${quote(r.configPath)}\n`).join('\n'),
    identityFiles: rows.map(r=>({path:r.configPath, content:`[user]\n\tname = ${quote(r.name)}\n\temail = ${quote(r.email)}\n`})),
    sshBlocks: rows.map(r=>`Host ${r.sshAlias}\n  HostName ${r.host}\n  User git\n  IdentityFile ${quote(r.keyPath)}\n  IdentitiesOnly yes\n`).join('\n'),
    clonePatterns: rows.map(r=>({id:r.id, remote:`git@${r.sshAlias}:<owner>/<repository>.git`, destination:r.root})),
  };
}

/** Local Git config checks only. Never invokes SSH or reads key contents. */
export function inspectRepository(repo, input, {home = os.homedir(), env = process.env} = {}) {
  const rows = validateConfig(input,{home});
  const cwd = path.resolve(repo);
  const run = (args) => spawnSync('git',args,{cwd,env,encoding:'utf8',timeout:5000,stdio:['ignore','pipe','ignore']});
  const top = run(['rev-parse','--show-toplevel']);
  if (top.error || top.status !== 0) return {state:'unavailable', reason:'Not a readable local Git working tree, or Git unavailable'};
  const canonical = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
  const selected = rows.find(r=>within(canonical(r.root),canonical(top.stdout.trim())));
  if (!selected) return {state:'unconfigured', reason:'Repository is outside configured identity roots'};
  const value = (key) => {const r=run(['config','--get',key]); return r.status===0?r.stdout.trim():null;};
  // get-url can apply insteadOf; no network operation is made.
  const remoteResult=run(['remote','get-url','origin']);
  const remote=remoteResult.status===0?remoteResult.stdout.trim():'';
  const expectedAlias = remote.startsWith(`git@${selected.sshAlias}:`) || remote.startsWith(`ssh://git@${selected.sshAlias}/`);
  const checks={commitName:value('user.name')===selected.name,commitEmail:value('user.email')===selected.email,originAlias:expectedAlias};
  return {state:Object.values(checks).every(Boolean)?'configured':'degraded',checks,
    authentication:'not-tested', note:'Matching local configuration does not prove account ownership, remote permissions or SSH key selection. Includes may differ for linked worktrees.'};
}
