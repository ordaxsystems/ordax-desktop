'use strict';
// Development-only, source-pinned Electron shell update without a 600+ MB NSIS.
// Never updates Native OS, Surface, product Runtime, model bytes or signed Stable.
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {execFileSync,spawn}=require('node:child_process');
const {setTimeout:delay}=require('node:timers/promises');
const SCHEMA='ordax.desktop-shell-delta/1';
const REMOTE='https://github.com/ordaxsystems/ordax-desktop.git';
const SHA=/^[0-9a-f]{40}$/;
const MAX_HEADER=12*1024*1024,MAX_BLOB=2*1024*1024,MAX_ARCHIVE=250*1024*1024;
const BLOCK=4*1024*1024;
const digest=b=>createHash('sha256').update(b).digest('hex');
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
function encodeArchive(header,payload,extra=[]){
  const json=Buffer.from(JSON.stringify(header),'utf8');
  assert(json.length>0&&json.length<=MAX_HEADER,'Delta ASAR header too large');
  const padding=(4-json.length%4)%4;
  const pickle=4+json.length+padding;
  const prefix=Buffer.alloc(8+4+pickle);
  prefix.writeUInt32LE(4,0);
  prefix.writeUInt32LE(4+pickle,4);
  prefix.writeUInt32LE(pickle,8);
  prefix.writeUInt32LE(json.length,12);
  json.copy(prefix,16);
  const output=Buffer.concat([prefix,payload,...extra]);
  assert(output.length<=MAX_ARCHIVE,'Delta ASAR exceeds development limit');
  return output;
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
function integrity(bytes){
  const blocks=[];
  for(let i=0;i<bytes.length;i+=BLOCK)blocks.push(digest(bytes.subarray(i,i+BLOCK)));
  return {algorithm:'SHA256',hash:digest(bytes),blockSize:BLOCK,blocks};
}
function buildDelta(archive,approvedFiles){
  const source=parseArchive(archive);
  const expected=Object.entries(approvedFiles);
  assert(expected.length>0&&expected.length<=30,'Unexpected shell source set');
  const header=structuredClone(source.header),changes=[],extra=[];
  let offset=source.payload.length;
  for(const [name,bytes] of expected){
    assert(/^[a-z][a-z0-9-]{0,80}\.(?:cjs|mjs)$/.test(name)&&
      Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=MAX_BLOB,
      'Unsafe trusted shell source');
    const old=source.header.files[name];
    assert(!old||(!old.unpacked&&!old.link&&Number.isSafeInteger(old.size)),
      'Shell update would alter an unpacked or linked module');
    if(old&&fileBytes(source,name).equals(bytes))continue;
    header.files[name]={...(old??{}),size:bytes.length,offset:String(offset),
      integrity:integrity(bytes)};
    offset+=bytes.length;
    extra.push(bytes);
    changes.push(name);
  }
  if(!changes.length)return {changed:false,archive,changes};
  const next=encodeArchive(header,source.payload,extra);
  const checked=parseArchive(next);
  for(const [name,bytes] of expected)assert(fileBytes(checked,name).equals(bytes),
    'Delta self-verification failed: '+name);
  assert(Object.keys(checked.header.files).length>=Object.keys(source.header.files).length,
    'Delta unexpectedly removed archive entries');
  return {changed:true,archive:next,changes};
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
function locations(){
  assert(process.platform==='win32','Windows Dev update only');
  const install=path.join(process.env.LOCALAPPDATA,'Programs','OrdaX OS Desktop Dev');
  const profile=path.join(process.env.APPDATA,'OrdaX OS Desktop Dev');
  const repo=path.resolve(__dirname,'..');
  const exe=path.join(install,'OrdaX OS Desktop Dev.exe');
  const live=path.join(install,'resources','app.asar');
  for(const file of [exe,live]){
    assert(fs.statSync(file).isFile()&&!fs.lstatSync(file).isSymbolicLink(),
      'Missing or untrusted Desktop installation');
  }
  return {install,profile,repo,exe,live};
}
function prepare({repo,profile,live}){
  const {revision,manifest,files}=officialSources(repo);
  const previous=fs.readFileSync(live),archive=parseArchive(previous);
  const installed=JSON.parse(fileBytes(archive,'package.json').toString('utf8'));
  assert(installed.name===manifest.name&&installed.version===manifest.version,
    'Installed Desktop identity differs from source');
  const previousReceipt=path.join(profile,'desktop-shell-delta-receipt.json');
  if(fs.existsSync(previousReceipt)){
    const rec=decodeJson(fs.readFileSync(previousReceipt,'utf8'));
    assert(rec.installed_asar_sha256===digest(previous),
      'Installed ASAR does not match previous developer delta receipt');
  }
  const result=buildDelta(previous,files);
  const receipt={schema:SCHEMA,source_commit:revision,old_asar_sha256:digest(previous),
    new_asar_sha256:digest(result.archive),changed_files:result.changes,
    bytes:result.archive.length};
  if(!result.changed)return {changed:false,receipt};
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-desktop-shell-delta-'));
  const candidate=path.join(dir,'app.asar');
  fs.writeFileSync(candidate,result.archive,{flag:'wx',mode:0o600});
  fs.writeFileSync(path.join(dir,'receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
  assert(digest(fs.readFileSync(candidate))===receipt.new_asar_sha256,
    'Staged Desktop delta hash mismatch');
  return {changed:true,dir,candidate,receipt};
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
async function startAndConfirm(loc,logSize){
  const child=spawn(loc.exe,[],{cwd:loc.install,detached:true,stdio:'ignore',windowsHide:false});
  child.unref();
  const alive=()=>{try{process.kill(child.pid,0);return true}catch{return false}};
  const logfile=path.join(loc.profile,'desktop.log');
  for(let i=0;i<27;i++){
    await delay(1500);
    if(!alive())return false;
    if(fs.existsSync(logfile)){
      const stats=fs.statSync(logfile);
      if(stats.size>=logSize&&stats.size-logSize<=3*1024*1024){
        const fd=fs.openSync(logfile,'r');
        try{
          const b=Buffer.alloc(stats.size-logSize);
          fs.readSync(fd,b,0,b.length,logSize);
          if(b.toString('utf8').includes('Native Surface ready:'))return true;
        } finally{fs.closeSync(fd)}
      }
    }
  }
  return false;
}
async function install(loc,prepared,drivers={}){
  if(!prepared.changed)return 'CURRENT';
  // Injectable only for offline transaction proofs; CLI always uses native guards.
  const list=drivers.list||processList, boot=drivers.boot||startAndConfirm;
  const restart=drivers.restart||((exe,installation)=>{
    const child=spawn(exe,[],{cwd:installation,detached:true,stdio:'ignore'});
    child.on('error',()=>{});child.unref();
  });
  const {live,exe,install:installation,profile}=loc;
  const nativeIdle=()=>{
    const state=decodeJson(fs.readFileSync(
      path.join(profile,'desktop-dev-update-state.json'),'utf8'));
    assert(!state.pendingSha&&!state.attemptedSha,
      'Native OS update transaction active; cannot swap Desktop shell');
  };
  assert(!list(exe).length,
    'Desktop is running. Close the window normally before applying a shell delta');
  nativeIdle();
  const backup=path.join(installation,'resources','app.asar.delta-rollback');
  const temporary=path.join(installation,'resources','app.asar.delta-ready');
  const recFile=path.join(profile,'desktop-shell-delta-receipt.json');
  assert(!fs.existsSync(backup)&&!fs.existsSync(temporary)&&
    !fs.existsSync(recFile+'.tmp'),
    'Unresolved previous Desktop delta; preserve for manual recovery');
  assert(digest(fs.readFileSync(live))===prepared.receipt.old_asar_sha256,
    'Installed Desktop changed after delta preparation');
  let backedUp=false,swapped=false;
  try{
    // Copy and hash verification belong inside the cleanup transaction.
    fs.copyFileSync(prepared.candidate,temporary,fs.constants.COPYFILE_EXCL);
    assert(digest(fs.readFileSync(temporary))===prepared.receipt.new_asar_sha256,
      'Copied Desktop delta verification failed');
    assert(!list(exe).length,'Desktop reopened before shell swap');
    nativeIdle();
    fs.renameSync(live,backup);backedUp=true;
    fs.renameSync(temporary,live);swapped=true;
    const log=path.join(profile,'desktop.log');
    const offset=fs.existsSync(log)?fs.statSync(log).size:0;
    assert(await boot(loc,offset),'Native Surface did not become healthy after shell update');
    assert(digest(fs.readFileSync(live))===prepared.receipt.new_asar_sha256,
      'Desktop changed during startup');
    const record={schema:'ordax.desktop-shell-delta-installed/1',
      desktop_source_sha:prepared.receipt.source_commit,
      installed_asar_sha256:prepared.receipt.new_asar_sha256,
      applied_utc:new Date().toISOString(),boot_smoke:'Native Surface ready',
      release_channel:'development-unsigned-source-delta'};
    fs.writeFileSync(recFile+'.tmp',JSON.stringify(record,null,2)+'\n',{flag:'wx'});
    fs.renameSync(recFile+'.tmp',recFile);
    fs.rmSync(backup);
    return 'INSTALLED';
  }catch(error){
    if(backedUp){
      // Never overwrite a shell in use; retain backup for manual recovery.
      if(list(exe).length){
        throw Error(error.message+'; Desktop still running; backup retained: '+backup);
      }
      if(swapped)fs.rmSync(live,{force:true});
      fs.renameSync(backup,live);
      restart(exe,installation);
    }
    throw error;
  }finally{
    if(fs.existsSync(temporary))fs.rmSync(temporary,{force:true});
  }
}
async function cli(){
  const arg=process.argv[2];
  assert(['--verify','--install'].includes(arg),
    'Usage: node ci/dev-shell-delta.cjs --verify | --install (Dev only)');
  const loc=locations();
  const state=prepare(loc);
  if(!state.changed){console.log('DESKTOP_SHELL_DELTA=CURRENT');return}
  try{
    console.log('STAGED='+state.candidate);
    console.log('BYTES='+state.receipt.bytes);
    console.log('SOURCE_SHA='+state.receipt.source_commit);
    console.log('FILES='+state.receipt.changed_files.join(','));
    if(arg==='--install')console.log('DESKTOP_SHELL_DELTA='+await install(loc,state));
    else console.log('DESKTOP_SHELL_DELTA=VERIFIED_ONLY');
  }finally{
    // The staging area is temporary. Never preserve another executable copy.
    fs.rmSync(state.dir,{recursive:true,force:true});
  }
}
if(require.main===module)cli().catch(err=>{console.error('DESKTOP_SHELL_DELTA_BLOCKED='+err.message);process.exitCode=1});
module.exports={parseArchive,encodeArchive,fileBytes,integrity,buildDelta,digest,decodeJson,prepare,processList,install};
