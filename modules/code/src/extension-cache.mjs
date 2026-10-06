import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const digest = data => createHash('sha256').update(data).digest('hex');

// Cache installation, never authentication or workspace data. The inventory must still match.
export async function installVsix({runtime, common, extensions, profile, vsix, id, run}) {
 const file=path.resolve(vsix), hash=digest(await fs.readFile(file));
 const marker=path.join(profile,`installed-${id}.json`);
 const inventory=async()=>{
  const bytes=await fs.readFile(path.join(extensions,'extensions.json'));
  const entries=JSON.parse(bytes.toString());
  const entry=entries.find(e=>e.identifier?.id?.toLowerCase()===id.toLowerCase());
  if(!entry) throw new Error('Extension absent from inventory');
  const location=entry.relativeLocation ? path.join(extensions,entry.relativeLocation) : entry.location?.path;
  if(!location) throw new Error('Extension location missing');
  await fs.access(path.join(location,'package.json'));
  return digest(bytes);
 };
 try {
  const saved=JSON.parse(await fs.readFile(marker,'utf8'));
  if(saved.hash===hash && saved.runtime===runtime && saved.inventory===await inventory()) return {installed:false};
 } catch { /* Missing, changed, or uninstalled: install and only then write the marker. */ }
 await run(runtime,[...common,'--install-extension',file,'--force']);
 // A failed verification cannot make a future launch skip installation.
 let signature;try {signature=await inventory();} catch {await fs.rm(marker,{force:true});return {installed:true};}
 await fs.writeFile(marker,JSON.stringify({hash,runtime,inventory:signature}),{mode:0o600});
 return {installed:true};
}

// Require marketplace provenance, not just an identical version from a local development VSIX.
export async function installMarketplace({runtime, common, extensions, profile, id, version, run}) {
 if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Extension version must be an exact x.y.z version');
 const marker=path.join(profile, `marketplace-${id}.json`);
 const verify=async()=>{
  const bytes=await fs.readFile(path.join(extensions,'extensions.json'));
  const entry=JSON.parse(bytes).find(e=>e.identifier?.id?.toLowerCase()===id.toLowerCase() && e.version===version);
  if(!entry?.relativeLocation) throw new Error('Marketplace extension missing from inventory');
  const manifest=JSON.parse(await fs.readFile(path.join(extensions,entry.relativeLocation,'package.json'),'utf8'));
  if(manifest.version!==version) throw new Error('Installed extension version mismatch');
  return digest(bytes);
 };
 try {
  const saved=JSON.parse(await fs.readFile(marker,'utf8'));
  if(saved.version===version && saved.runtime===runtime && saved.inventory===await verify()) return {installed:false};
 } catch {}
 await fs.rm(marker,{force:true});
 // code-server may skip an identical version even with --force; remove unverified provenance first.
 let present=false;
 try {present=JSON.parse(await fs.readFile(path.join(extensions,'extensions.json'),'utf8')).some(e=>e.identifier?.id?.toLowerCase()===id.toLowerCase());} catch {}
 if(present) await run(runtime,[...common,'--uninstall-extension',id]);
 await run(runtime,[...common,'--install-extension',`${id}@${version}`,'--force']);
 const inventory=await verify();
 await fs.writeFile(marker,JSON.stringify({version,runtime,inventory}),{mode:0o600});
 return {installed:true};
}
