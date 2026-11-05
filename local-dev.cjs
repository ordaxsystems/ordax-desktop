'use strict';
// Development-only Windows host: one OS checkout and its exact pinned Surface.
// The Electron shell can live in ordax-desktop without copying system/ source.
process.env.ORDAX_DESKTOP_LOCAL_DEV='1';
const {existsSync,lstatSync,readFileSync,realpathSync,symlinkSync,mkdirSync}=require('node:fs');
const {resolve,join,dirname}=require('node:path');
const {execFileSync,spawn}=require('node:child_process');
const {resolveInstalledGit}=require('./checkout.cjs');
const {developmentOsRoot,resolveTemplate}=require('./runtime.cjs');
const fail=message=>{throw Error('OrdaX local development: '+message)};
const SHA40=/^[0-9a-f]{40}$/;
function git(root,...args){
  // Local Git reads must neither prompt for credentials nor rely on the
  // launcher's PATH containing the globally installed Windows Git binary.
  return execFileSync(resolveInstalledGit(),
    ['-c','credential.helper=','-C',root,...args],{
      encoding:'utf8',windowsHide:true,timeout:15000,
      env:{...process.env,GIT_TERMINAL_PROMPT:'0'},
    }).trim();
}
function prepare(){
  const root=developmentOsRoot(__dirname);
  const source=resolve(process.env.ORDAX_SURFACE_CHECKOUT||join(root,'..','ordax-surface'));
  // An explicit checkout is a developer choice, never a new OS authority.
  // Prevent accidentally mounting the Desktop into unrelated Git projects.
  if(process.env.ORDAX_DESKTOP_OS_CHECKOUT){
    if(!existsSync(join(root,'.git')))fail('canonical ordax-os Git checkout required');
    const origin=git(root,'remote','get-url','origin');
    if(!/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)ordaxsystems\/ordax-os(?:\.git)?$/i.test(origin))
      fail('OS origin does not match the canonical repository');
    // Git for Windows may render --show-toplevel using POSIX-style drive
    // notation. --show-prefix checks root identity without path-format guesses.
    if(git(root,'rev-parse','--show-prefix')!=='')
      fail('selected OS directory is not the Git checkout root');
  }
  const lock=JSON.parse(readFileSync(join(root,'docs/contracts/surface-source.json'),'utf8'));
  if(lock.$schema!=='prototype-ordax.surface-source/1' || lock.status!=='canonical' ||
     lock.source_repository!=='ordaxsystems/ordax-surface' || !SHA40.test(lock.source_commit) ||
     JSON.stringify(lock.visual_source_paths)!==JSON.stringify(['system/surface/ui','system/surface/workspace']))
    fail('unrecognized canonical visual source lock');
  if(!existsSync(join(source,'.git')))fail('canonical ordax-surface checkout required: '+source);
  if(!/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)ordaxsystems\/ordax-surface(?:\.git)?$/i.test(git(source,'remote','get-url','origin')))
    fail('Surface origin does not match the canonical repository');
  const sourceSha=git(source,'rev-parse','HEAD');
  // In local HMR only, permit a fast-forward descendant of the verified
  // Surface lock. NSIS materialization remains pinned to the exact lock SHA.
  try { git(source,'merge-base','--is-ancestor',lock.source_commit,sourceSha); }
  catch { fail('Surface checkout must contain pinned '+lock.source_commit+'; current '+sourceSha); }
  if(!existsSync(join(root,'node_modules','vite','bin','vite.js')))
    fail('run npm ci at the canonical ordax-os checkout');
  if(!existsSync(join(__dirname,'node_modules','electron','path.txt')))
    fail('Electron binary missing; complete npm ci in the Windows Desktop shell');
  for(const segment of ['ui','workspace']){
    const target=join(source,'system','surface',segment);
    const link=join(root,'system','surface',segment);
    const stat=lstatSync(target);
    if(!stat.isDirectory()||stat.isSymbolicLink())fail('unsafe Surface source '+segment);
    if(existsSync(link)){
      if(realpathSync(link)!==realpathSync(target))fail('refusing to replace existing visual path '+link);
    }else{
      mkdirSync(dirname(link),{recursive:true});
      symlinkSync(target,link,'junction');
    }
  }
  return source;
}
if(require.main===module){
  try {
    const checkout=prepare();
    const root=resolveTemplate(__dirname,null,false);
    console.log('Canonical Surface linked for HMR: '+checkout);
    const child=spawn(process.execPath,[join(__dirname,'node_modules','electron','cli.js'),__dirname],{
      cwd:__dirname,env:{...process.env,ORDAX_DESKTOP_LOCAL_DEV:'1',ORDAX_DESKTOP_MCP_DEV:'1',
        ORDAX_DESKTOP_OS_CHECKOUT:root,ORDAX_DESKTOP_SURFACE_ROOT:checkout},
      stdio:'inherit',windowsHide:false});
    child.on('exit',code=>process.exitCode=code??1);
    child.on('error',err=>{console.error(err);process.exitCode=1});
  }catch(error){console.error(error.message);process.exitCode=1}
}
module.exports={prepare};
