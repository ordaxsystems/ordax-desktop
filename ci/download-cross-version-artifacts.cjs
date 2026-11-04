'use strict';
// Read-only CI witness: download exact, independently attested NSIS artifacts.
// Does not install on any user's computer. GITHUB_TOKEN is not forwarded to a
// signed storage URL or to the executable installer smoke stage.
const fs=require('node:fs');
const {join}=require('node:path');
const {spawnSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const {Readable}=require('node:stream');
const {pipeline}=require('node:stream/promises');
const config=[
  {role:'baseline',repo:'ordaxsystems/ordax-os'},
  {role:'candidate',repo:'ordaxsystems/ordax-desktop'},
];
function required(name,format){
  const value=process.env[name]||'';
  if(!format.test(value))throw Error('Invalid CI proof input '+name);
  return value;
}
async function download(entry,dir,token) {
  const role=entry.role.toUpperCase(),id=required(role+'_ARTIFACT_ID',/^[1-9][0-9]{5,18}$/);
  const source=required(role+'_SOURCE_SHA',/^[0-9a-f]{40}$/);
  const expected=required(role+'_EXE_SHA256',/^[0-9a-f]{64}$/);
  const api='https://api.github.com/repos/'+entry.repo+'/actions/artifacts/'+id;
  const headers={
    Authorization:'Bearer '+token,
    Accept:'application/vnd.github+json',
    'X-GitHub-Api-Version':'2022-11-28',
    'User-Agent':'OrdaX-Windows-cross-version-read-only-proof',
  };
  const metadataResponse=await fetch(api,{headers,redirect:'error'});
  if(!metadataResponse.ok)throw Error(role+' artifact metadata failed HTTP '+metadataResponse.status);
  const metadata=await metadataResponse.json();
  if(String(metadata.id)!==id||metadata.expired||
    metadata.name!=='ordax-desktop-dev-alpha-windows'||
    metadata.size_in_bytes<300e6||metadata.size_in_bytes>800e6||
    metadata.workflow_run?.head_sha!==source)
    throw Error(role+' artifact is not the pinned successful GitHub Actions source');
  const response=await fetch(api+'/zip',{headers,redirect:'manual'});
  if(response.status!==302)throw Error(role+' signed artifact redirect failed: '+response.status);
  const redirect=response.headers.get('location');
  if(!redirect)throw Error('Missing signed GitHub artifact location');
  const url=new URL(redirect);
  if(url.protocol!=='https:'||
    !(url.hostname.endsWith('.blob.core.windows.net')||
      url.hostname.endsWith('.githubusercontent.com')||
      url.hostname.endsWith('.actions.githubusercontent.com')))
    throw Error('Unexpected signed GitHub artifact transport host');
  // No bearer credential at the redirected storage endpoint.
  const downloadResponse=await fetch(url.href,{redirect:'follow'});
  if(!downloadResponse.ok||!downloadResponse.body)
    throw Error(role+' archive fetch failed '+downloadResponse.status);
  const zip=join(dir,entry.role+'.zip');
  await pipeline(Readable.fromWeb(downloadResponse.body),
    fs.createWriteStream(zip,{flags:'wx'}));
  if(fs.statSync(zip).size!==metadata.size_in_bytes)
    throw Error(role+' archive length differs from GitHub Actions receipt');
  const names=spawnSync('tar',['-tf',zip],{encoding:'utf8',windowsHide:true,timeout:20000});
  if(names.status!==0)throw Error(role+' ZIP entries cannot be audited');
  const entries=names.stdout.split(/\r?\n/).filter(Boolean);
  if(entries.length!==1||!/^OrdaX-OS-Desktop-Dev-[A-Za-z0-9._-]+-x64\.exe$/.test(entries[0]))
    throw Error(role+' contains an unexpected installer or unsafe entry');
  const stage=join(dir,entry.role+'-extract');
  fs.mkdirSync(stage);
  const extraction=spawnSync('tar',['-xf',zip,'-C',stage],
    {encoding:'utf8',windowsHide:true,timeout:180000});
  if(extraction.status!==0)throw Error(role+' archive extraction failed');
  const original=join(stage,entries[0]),stat=fs.lstatSync(original);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size<300e6||stat.size>800e6)
    throw Error(role+' installer is not an expected regular file');
  const hash=createHash('sha256');
  for await(const chunk of fs.createReadStream(original))hash.update(chunk);
  if(hash.digest('hex')!==expected)
    throw Error(role+' installer SHA256 mismatch; refusing execution');
  fs.renameSync(original,join(dir,entry.role+'.exe'));
  fs.rmSync(stage,{recursive:true,force:true});
  fs.rmSync(zip);
  console.log('PINNED_NSIS_ARTIFACT_VERIFIED='+entry.role+' source='+source);
}
async function main(){
  const token=required('GH_TOKEN',/^\S{20,}$/);
  const root=required('RUNNER_TEMP',/^[A-Za-z]:\\/);
  const dir=join(root,'ordax-desktop-cross-version-proof');
  if(fs.existsSync(dir))throw Error('CI proof directory already exists');
  fs.mkdirSync(dir);
  for(const entry of config)await download(entry,dir,token);
  console.log('TWO_EXACT_NSIS_INSTALLERS_READY=YES');
}
main().catch(e=>{console.error('CROSS_VERSION_ARTIFACT_BLOCKED: '+e.message);process.exitCode=1;});
