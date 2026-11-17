'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {classify,parseGitNameOnlyZ,installerJob,FAST_SHELL_FILES} = require('./desktop-build-impact.cjs');
const files=['main.cjs','browser-host.cjs','host.cjs','native-build.cjs','package.json'];
const assess=(event,changed,other={})=>classify({event,changed,files,...other});

test('only exact, versioned Electron source uses the PR fast lane',()=>{
  assert.deepEqual(assess('pull_request',['main.cjs','main.test.cjs','README.md']),
    {required:true,prNsisRequired:false});
  assert.deepEqual(assess('pull_request',['browser-host.cjs','host.cjs']),
    {required:true,prNsisRequired:false});
  assert.equal(FAST_SHELL_FILES.has('native-build.cjs'),false);
});
test('the final main revision always builds and smoke-tests NSIS',()=>{
  assert.deepEqual(assess('push',['main.cjs','main.test.cjs']),
    {required:true,prNsisRequired:true});
  assert.deepEqual(assess('workflow_dispatch',['main.cjs']),
    {required:true,prNsisRequired:true});
});
test('packaging, ownership, native build and mixed source changes build NSIS in the PR',()=>{
  for(const path of ['installer.nsh','package.json','package-lock.json','native-build.cjs',
    'standalone-stage.cjs','ci/desktop-build-impact.cjs','docs/contracts/pin.json',
    '.github/workflows/windows-desktop-dev.yml','some-new.cjs']) {
    const result=assess('pull_request',['main.cjs',path]);
    assert.deepEqual(result,{required:true,prNsisRequired:true},path);
  }
});
test('test and documentation-only changes cannot produce new binary bytes',()=>{
  assert.deepEqual(assess('pull_request',['browser-host.test.cjs','README.md',
    'ci/dev-shell-delta.test.cjs']),{required:false,prNsisRequired:false});
  assert.deepEqual(assess('push',['ci/resolve-test-os.cjs','host-startup.test.cjs']),
    {required:false,prNsisRequired:false});
});
test('workflow-only changes skip NSIS only if the entire installer job is byte-equivalent',()=>{
  const old='name: Old\n  windows-installer:\n    if: stable\n';
  const same='name: New\r\n  windows-installer:\r\n    if: stable\r\n';
  const changed='name: New\n  windows-installer:\n    if: different\n';
  assert.equal(installerJob(old),installerJob(same));
  assert.deepEqual(assess('pull_request',['.github/workflows/desktop-source.yml'],
    {oldWorkflow:old,newWorkflow:same}),{required:false,prNsisRequired:false});
  assert.deepEqual(assess('pull_request',['.github/workflows/desktop-source.yml'],
    {oldWorkflow:old,newWorkflow:changed}),{required:true,prNsisRequired:true});
});
test('missing history, unsafe paths and malformed changes fail closed',()=>{
  for(const [event,changed] of [['pull_request',[]],['push',[]],['pull_request',['../package.json']],
    ['pull_request',['.\\main.cjs']],['pull_request',['']],['unknown',['main.cjs']]]) {
    assert.deepEqual(assess(event,changed),{required:true,prNsisRequired:true});
  }
  assert.equal(parseGitNameOnlyZ(Buffer.from('main.cjs')),null);
  assert.equal(parseGitNameOnlyZ(Buffer.from('main.cjs\0../bad\0')),null);
  assert.deepEqual(parseGitNameOnlyZ(Buffer.from('main.cjs\0host.cjs\0')),
    ['main.cjs','host.cjs']);
});
