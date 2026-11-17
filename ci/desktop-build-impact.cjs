'use strict';
// One fail-closed impact decision for the detached Windows Desktop workflow.
// An exact shell-only PR gets the source/ownership tests before merge; the
// final main SHA still receives the full NSIS installation and health gate.
const { readFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

const SHA40 = /^[a-f0-9]{40}$/;
const SOURCE_WORKFLOW = '.github/workflows/desktop-source.yml';
const FAST_SHELL_FILES = new Set([
  'main.cjs', 'window-layout.cjs', 'host.cjs', 'browser-host.cjs',
  'browser-preload.cjs', 'native-grant-frame.cjs',
]);
const MAX_DIFF_BYTES = 65536;
const FAIL_CLOSED = Object.freeze({ required: true, prNsisRequired: true });

function parseGitNameOnlyZ(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 2 || bytes.length > MAX_DIFF_BYTES ||
      bytes[bytes.length - 1] !== 0) return null;
  const paths = bytes.toString('utf8').slice(0, -1).split('\0');
  if (paths.length > 512 || paths.some(path => !path || path.startsWith('/') ||
      path.includes('\\') || path.includes('..') || path.includes('\uFFFD') ||
      path.includes('\r') || path.includes('\n'))) return null;
  return paths;
}

function isSourceOnly(path, files) {
  if (files.includes(path)) return false;
  return path.endsWith('.md') || /^[a-z0-9-]+\.test\.cjs$/.test(path) ||
    /^ci\/(?:dev-shell-delta(?:\.test)?|resolve-test-os)\.cjs$/.test(path);
}
function installerJob(source) {
  if (typeof source !== 'string') return null;
  const normalized = source.replace(/\r\n/g, '\n');
  const result = normalized.match(/^  windows-installer:\s*\n[\s\S]*$/m);
  return result?.[0]?.trimEnd() ?? null;
}
function classify({ event, changed, files, oldWorkflow, newWorkflow }) {
  if (!['push','pull_request'].includes(event) || !Array.isArray(changed) ||
      !changed.length || changed.length > 512 ||
      !Array.isArray(files) || !files.length ||
      files.some(file => typeof file !== 'string' || /[*?\[\]{}!]/.test(file)) ||
      changed.some(path => typeof path !== 'string' || !path ||
        path.startsWith('/') || path.includes('\\') || path.includes('..'))) {
    return FAIL_CLOSED;
  }
  const product = changed.filter(path => !isSourceOnly(path, files));
  if (product.length === 1 && product[0] === SOURCE_WORKFLOW &&
      installerJob(oldWorkflow) && installerJob(oldWorkflow) === installerJob(newWorkflow)) {
    product.length = 0;
  }
  const required = product.length > 0;
  // The PR fast lane is narrow: package.json, NSIS, stage producer, Native
  // build code, source locks, CI recipes, unknown paths and mixed impacts
  // still require an NSIS gate before merge. Final main builds regardless.
  const prNsisRequired = required &&
    (event !== 'pull_request' ||
      !product.every(path => FAST_SHELL_FILES.has(path) && files.includes(path)));
  return { required, prNsisRequired };
}
function main() {
  const event = process.env.EVENT_NAME;
  const base = process.env.BASE_SHA;
  const head = process.env.HEAD_SHA;
  let result = FAIL_CLOSED;
  try {
    if (SHA40.test(base) && base !== '0'.repeat(40) && SHA40.test(head) && base !== head) {
      const raw = execFileSync('git', ['diff','--no-renames','--name-only','-z',base,head], {
        cwd: join(__dirname, '..'), encoding:'buffer',timeout:20000,maxBuffer:MAX_DIFF_BYTES + 1024,
        env:{...process.env,GIT_TERMINAL_PROMPT:'0'}
      });
      const changed = parseGitNameOnlyZ(raw);
      if (changed) {
        const files = JSON.parse(readFileSync(join(__dirname,'..','package.json'),'utf8')).build.files;
        let oldWorkflow=null, newWorkflow=null;
        if (changed.includes(SOURCE_WORKFLOW)) {
          oldWorkflow=execFileSync('git',['show',base+':'+SOURCE_WORKFLOW],{
            cwd:join(__dirname,'..'),encoding:'utf8',timeout:10000,maxBuffer:1024*1024,
            env:{...process.env,GIT_TERMINAL_PROMPT:'0'}
          });
          newWorkflow=readFileSync(join(__dirname,'..',SOURCE_WORKFLOW),'utf8');
        }
        result=classify({event,changed,files,oldWorkflow,newWorkflow});
      }
    }
  } catch (error) {
    // Unknown history or missing inputs must build, never skip NSIS.
    process.stderr.write('Desktop NSIS impact unknown; requiring full gate: '+error.message+'\n');
  }
  process.stdout.write('required='+String(result.required)+'\n');
  process.stdout.write('pr_nsis_required='+String(result.prNsisRequired)+'\n');
}
if (require.main === module) main();
module.exports={classify,parseGitNameOnlyZ,installerJob,FAST_SHELL_FILES};
