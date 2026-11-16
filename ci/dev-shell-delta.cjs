'use strict';
// Windows Dev shell inspector and recovery for interrupted legacy transactions.
// Installed Electron embeds the SHA-256 ASAR header in its executable.
// Replacing app.asar alone cannot satisfy that binary-level integrity gate.
// Native OS/Surface updates remain owned by the verified ordax-pull channel.
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {execFileSync}=require('node:child_process');
const REMOTE='https://github.com/ordaxsystems/ordax-desktop.git';
const SHA=/^[0-9a-f]{40}$/;
const MAX_HEADER=12*1024*1024,MAX_BLOB=2*1024*1024,MAX_ARCHIVE=250*1024*1024;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const decodeJson=text=>JSON.parse(String(text).replace(/^\uFEFF/,''));
const assert=(cond,message)=>{if(!cond)throw Error(message)};

function parseArchive(bytes){
  assert(Buffer.isBuffer(bytes)&&bytes.length>=16&&bytes.length<=MAX_ARCHIVE,'Untrusted ASAR size');
  const marker=bytes.readUInt32LE(0),outer=bytes.readUInt32LE(4);
  const pickle=bytes.readUInt32LE(8),jsonLen=bytes.readUInt32LE(12);
  const start=8+outer;
  assert(marker===4&&outer===4+pickle&&pickle%4===0 &&
    jsonLen>0&&jsonLen<=MAX_HEADER&&16+jsonLen<=start&&start<=bytes.length,
    'Invalid ASAR header');
  const header=JSON.parse(bytes.subarray(16,16+jsonLen).toString('utf8'));
  assert(header&&typeof header==='object'&&!Array.isArray(header)&&
    header.files&&typeof header.files==='object','Invalid ASAR inventory');
  return {header,payload:bytes.subarray(start),start};
}

function fileBytes(archive,name){
  const record=archive.header.files[name];
  assert(record&&typeof record==='object'&&!record.unpacked&&!record.link&&
    Number.isSafeInteger(record.size)&&record.size>=0&&record.size<=MAX_BLOB&&
    typeof record.offset==='string'&&/^(0|[1-9]\d*)$/.test(record.offset),
    'Missing or unsafe ASAR shell entry: '+name);
  const offset=Number(record.offset);
  assert(Number.isSafeInteger(offset)&&offset+record.size<=archive.payload.length,
    'Out-of-bounds ASAR entry: '+name);
  const data=archive.payload.subarray(offset,offset+record.size);
  const integrity=record.integrity;
  assert(integrity?.algorithm==='SHA256'&&integrity.hash===digest(data),
    'Existing ASAR integrity failed: '+name);
  return data;
}

function git(repo,args,{encoding='utf8'}={}){
  return execFileSync('git',['-C',repo,...args],{
    encoding,timeout:25000,maxBuffer:4*1024*1024,windowsHide:true,
    env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'Never'}});
}
function officialSources(repo){
  const revision=git(repo,['rev-parse','HEAD']).trim();
  const branch=git(repo,['branch','--show-current']).trim();
  const origin=git(repo,['remote','get-url','origin']).trim();
  const remote=git(repo,['ls-remote','--heads','origin','refs/heads/main']).trim().split(/\s+/)[0];
  assert(SHA.test(revision)&&revision===remote&&branch==='main'&&origin===REMOTE,
    'Desktop must be clean, on official main and in sync with origin');
  assert(!git(repo,['status','--porcelain=v1']).trim(),'Desktop source checkout dirty');
  const manifest=JSON.parse(git(repo,['show',revision+':package.json']));
  const files=manifest?.build?.files?.filter(name=>typeof name==='string'&&
    /^[a-z][a-z0-9-]{0,80}\.(?:cjs|mjs)$/.test(name));
  assert(Array.isArray(files)&&files.length>=10&&files.length<=30&&
    files.includes('main.cjs')&&files.includes('window-layout.cjs')&&
    new Set(files).size===files.length,'Invalid canonical Electron file manifest');
  const trusted={};
  for(const name of files){
    const bytes=git(repo,['show',revision+':'+name],{encoding:'buffer'});
    const blob=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
    assert(blob===git(repo,['rev-parse',revision+':'+name]).trim(),
      'Git blob identity mismatch: '+name);
    trusted[name]=bytes;
  }
  return {revision,manifest,files:trusted};
}
function locations({allowMissingLive=false}={}){
  assert(process.platform==='win32','Windows Dev update only');
  const install=path.join(process.env.LOCALAPPDATA,'Programs','OrdaX OS Desktop Dev');
  const profile=path.join(process.env.APPDATA,'OrdaX OS Desktop Dev');
  const repo=path.resolve(__dirname,'..');
  const exe=path.join(install,'OrdaX OS Desktop Dev.exe');
  const live=path.join(install,'resources','app.asar');
  assert(fs.statSync(exe).isFile()&&!fs.lstatSync(exe).isSymbolicLink(),
    'Missing or untrusted Desktop executable');
  try {
    const stat=fs.lstatSync(live);
    assert(stat.isFile()&&!stat.isSymbolicLink(),'Untrusted Desktop ASAR');
  } catch(error) {
    if(!allowMissingLive||error.code!=='ENOENT')throw error;
  }
  return {install,profile,repo,exe,live};
}
function inspectShellArchive(file){
  const stat=fs.lstatSync(file);
  assert(stat.isFile()&&!stat.isSymbolicLink(),'Unsafe interrupted shell file');
  const bytes=fs.readFileSync(file);
  const archive=parseArchive(bytes);
  const pkg=decodeJson(fileBytes(archive,'package.json').toString('utf8'));
  // Recovery may span a legitimate future Dev package version. Check the
  // canonical product identity and a well-formed version, not today's alpha.
  assert(pkg.name==='ordax-os-desktop-dev'&&
    typeof pkg.version==='string'&&
    /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$/.test(pkg.version),
    'Interrupted shell package identity mismatch');
  fileBytes(archive,'main.cjs');
  return digest(bytes);
}
// Interrupted Dev transaction repair. Runs only on an explicit --install,
// never while Desktop is running or in read-only --verify.
function recoverInterrupted(loc,{list=processList}={}){
  const {exe,live,profile}=loc;
  const backup=path.join(path.dirname(live),'app.asar.delta-rollback');
  const ready=path.join(path.dirname(live),'app.asar.delta-ready');
  const recPath=path.join(profile,'desktop-shell-delta-receipt.json');
  const recTmp=recPath+'.tmp';
  if(![backup,ready,recTmp].some(f=>fs.existsSync(f)))return 'CLEAN';
  assert(!list(exe).length,'Desktop running: cannot repair interrupted shell transaction');
  const native=decodeJson(fs.readFileSync(
    path.join(profile,'desktop-dev-update-state.json'),'utf8'));
  assert(!native.pendingSha&&!native.attemptedSha,
    'Native OS update transaction active; interrupted shell recovery blocked');
  const exists=f=>fs.existsSync(f);
  const rec=exists(recPath)?decodeJson(fs.readFileSync(recPath,'utf8')):null;
  if(rec)assert(rec.schema==='ordax.desktop-shell-delta-installed/1'&&
    /^[a-f0-9]{64}$/i.test(rec.installed_asar_sha256),
    'Untrusted previous shell delta receipt');
  const oldHash=exists(backup)?inspectShellArchive(backup):null;
  const liveHash=exists(live)?inspectShellArchive(live):null;
  if(rec&&oldHash&&rec.installed_asar_sha256!==oldHash&&
     rec.installed_asar_sha256!==liveHash){
    throw Error('Neither live nor backup matches trusted shell receipt');
  }
  let status='CLEAN';
  if(oldHash){
    if(rec&&rec.installed_asar_sha256===liveHash){
      // Health receipt was committed before backup removal.
      fs.rmSync(backup);
      status='COMMITTED';
    }else{
      // The prior ASAR is the only known-good shell; do not keep a
      // candidate left behind by a crash between rename and health.
      if(exists(live))fs.rmSync(live);
      fs.renameSync(backup,live);
      status='RESTORED';
    }
  }else{
    assert(liveHash!==null,'No valid Desktop shell or rollback copy');
    if(rec)assert(rec.installed_asar_sha256===liveHash,
      'Live ASAR differs from existing shell delta receipt');
  }
  // Clean non-authoritative staging only after live ASAR was verified.
  if(exists(ready)){
    assert(fs.lstatSync(ready).isFile()&&!fs.lstatSync(ready).isSymbolicLink(),
      'Unsafe staged shell file');
    fs.rmSync(ready);
    if(status==='CLEAN')status='CLEANED';
  }
  if(exists(recTmp)){
    assert(fs.lstatSync(recTmp).isFile()&&!fs.lstatSync(recTmp).isSymbolicLink(),
      'Unsafe pending shell receipt');
    fs.rmSync(recTmp);
    if(status==='CLEAN')status='CLEANED';
  }
  return status;
}

function processList(exe){
  // Fail closed even when another installation has the same executable name.
  assert(path.basename(exe)==='OrdaX OS Desktop Dev.exe','Unexpected Desktop process name');
  const output=execFileSync('tasklist.exe',[
    '/FI','IMAGENAME eq OrdaX OS Desktop Dev.exe','/FO','CSV','/NH'
  ],{encoding:'utf8',timeout:35000,windowsHide:true});
  return output.split(/\r?\n/).filter(line=>
    /^"OrdaX OS Desktop Dev\.exe","[0-9]+",/i.test(line));
}

function validatedRecovery(loc,{readSource=officialSources,recover=recoverInterrupted}={}){
  // A dirty or untrusted source checkout must never repair installation bytes.
  // Reuse the verified Git blobs for delta preparation; avoid double fetches.
  const trusted=readSource(loc.repo);
  return {trusted,recovery:recover(loc)};
}

function inspectInstalledShell({repo,profile,live},approvedSources=officialSources(repo)){
  const {revision,manifest,files}=approvedSources;
  const prior=fs.readFileSync(live),archive=parseArchive(prior);
  const installed=decodeJson(fileBytes(archive,'package.json').toString('utf8'));
  assert(installed.name===manifest.name && installed.version===manifest.version,
    'Installed Desktop identity/version differs from verified source; canonical NSIS required');
  const recPath=path.join(profile,'desktop-shell-delta-receipt.json');
  if(fs.existsSync(recPath)){
    const receipt=decodeJson(fs.readFileSync(recPath,'utf8'));
    assert(receipt.schema==='ordax.desktop-shell-delta-installed/1' &&
      receipt.installed_asar_sha256===digest(prior),
      'Installed Desktop ASAR disagrees with existing health receipt');
  }
  const changed=[];
  for(const [name,expected] of Object.entries(files)){
    if(!archive.header.files[name] || !fileBytes(archive,name).equals(expected))
      changed.push(name);
  }
  return Object.freeze({
    source_commit:revision,
    changed_files:Object.freeze(changed),
    installer_required:changed.length>0,
  });
}

async function cli(){
  const mode=process.argv[2];
  // Do not attempt another direct ASAR swap: the Electron binary embeds the
  // expected header hash. A candidate with changed CJS/MJS integrity hashes
  // will be rejected before main.cjs can write a startup health receipt.
  if(mode==='--install')throw Error(
    'Standalone ASAR installation is incompatible with embedded Electron integrity; '+
    'use the verified canonical Windows NSIS installer for shell changes');
  assert(mode==='--verify'||mode==='--recover',
    'Usage: node ci/dev-shell-delta.cjs --verify | --recover (Windows Dev)');
  const loc=locations({allowMissingLive:mode==='--recover'});
  // Source identity must be proven before any recovery changes installation bytes.
  const gate=officialSources(loc.repo);
  if(mode==='--recover')
    console.log('DESKTOP_SHELL_RECOVERY='+recoverInterrupted(loc));
  const inspected=inspectInstalledShell(loc,gate);
  console.log('SOURCE_SHA='+inspected.source_commit);
  console.log('FILES='+inspected.changed_files.join(','));
  console.log('DESKTOP_SHELL_DELTA='+
    (inspected.installer_required?'INSTALLER_REQUIRED':'CURRENT'));
}
if(require.main===module)cli().catch(error=>{
  console.error('DESKTOP_SHELL_DELTA_BLOCKED='+error.message);
  process.exitCode=1;
});
module.exports={
  parseArchive,fileBytes,digest,decodeJson,inspectInstalledShell,
  recoverInterrupted,validatedRecovery,officialSources,
};
