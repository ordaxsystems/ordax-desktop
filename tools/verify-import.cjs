'use strict';
// Import provenance only. This is not a Native runtime or signing authority.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {resolve,join,isAbsolute}=require('node:path');
const {spawnSync}=require('node:child_process');
const SHA=/^[0-9a-f]{40}$/;
function git(root,...args){
  const r=spawnSync('git',['-C',root,...args],{
    encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:4*1024*1024
  });
  if(r.error||r.status!==0)throw Error('Git source verification failed: '+(r.stderr||r.error?.message||args.join(' ')));
  return r.stdout.trim();
}
function canonicalOrigin(root,name){
  const url=git(root,'remote','get-url','origin');
  const pattern=new RegExp('^(?:https://github[.]com/|git@github[.]com:|ssh://git@github[.]com/)' +
    'ordaxsystems/'+name+'(?:[.]git)?$','i');
  assert.match(url,pattern,'unexpected Git source repository');
  assert.equal(git(root,'rev-parse','--show-prefix'),'','Git checkout must be at repository root');
}
function verifyImport({desktopRoot=resolve(__dirname,'..'),osRoot=process.env.ORDAX_DESKTOP_OS_CHECKOUT}={}){
  if(!osRoot||!isAbsolute(osRoot))throw Error('ORDAX_DESKTOP_OS_CHECKOUT must be an absolute OS checkout');
  desktopRoot=resolve(desktopRoot);osRoot=resolve(osRoot);
  for(const directory of [desktopRoot,osRoot]){
    const stat=fs.lstatSync(directory);
    if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Source checkout is not a real directory');
  }
  const receipt=JSON.parse(fs.readFileSync(join(desktopRoot,'docs','source-import.json'),'utf8'));
  assert.equal(receipt.schema,'ordax.desktop-source-import/1');
  assert.equal(receipt.target_repository,'ordaxsystems/ordax-desktop');
  assert.equal(receipt.source_repository,'ordaxsystems/ordax-os');
  assert.equal(receipt.source_prefix,'tools/windows-desktop');
  for(const v of [receipt.source_commit,receipt.source_tree_sha,receipt.imported_commit]){
    assert.match(v,SHA,'missing exact source revision');
  }
  assert.equal(receipt.files,41);
  canonicalOrigin(desktopRoot,'ordax-desktop');
  canonicalOrigin(osRoot,'ordax-os');
  assert.equal(git(osRoot,'rev-parse','HEAD'),receipt.source_commit,
    'OS checkout differs from import receipt');
  assert.equal(git(osRoot,'rev-parse',receipt.source_commit+':'+receipt.source_prefix),
    receipt.source_tree_sha,'original Electron source tree changed');
  git(desktopRoot,'merge-base','--is-ancestor',receipt.imported_commit,'HEAD');
  function treeEntries(root,revision){
    return git(root,'ls-tree','-rz',revision).split('\0').filter(Boolean)
      .filter(entry=>!/\t[.]gitignore$/.test(entry)).sort();
  }
  const imported=treeEntries(desktopRoot,receipt.imported_commit);
  const original=treeEntries(osRoot,receipt.source_commit+':'+receipt.source_prefix);
  assert.deepEqual(imported,original,'imported Electron files diverge from exact source Git blobs');
  assert.equal(imported.length,receipt.files,'incomplete Electron import');
  const paths=git(desktopRoot,'ls-tree','-r','--name-only','HEAD').split(/\r?\n/);
  for(const name of paths)if(/^(?:system\/|bootstrap\/|docs\/contracts\/|models\/|out\/|tools\/windows-emulator\/)/.test(name))
    throw Error('Desktop repository includes foreign OS/Surface source: '+name);
  const distribution=JSON.parse(fs.readFileSync(join(osRoot,'docs','contracts','distribution-profiles.json'),'utf8'));
  const surface=JSON.parse(fs.readFileSync(join(osRoot,'docs','contracts','surface-source.json'),'utf8'));
  assert.equal(distribution.source_authority?.repository,'ordaxsystems/ordax-os');
  assert.equal(surface.source_repository,'ordaxsystems/ordax-surface');
  assert.equal(surface.status,'canonical');
  assert.match(surface.source_commit,SHA);
  return {source_commit:receipt.source_commit,files:receipt.files,surface_commit:surface.source_commit};
}
if(require.main===module){
  try{
    const info=verifyImport();
    console.log('ORDAX_DESKTOP_SOURCE_IMPORT=PASS files='+info.files+
      ' os='+info.source_commit+' surface='+info.surface_commit);
  }catch(error){console.error(error.message);process.exitCode=1;}
}
module.exports={verifyImport};
