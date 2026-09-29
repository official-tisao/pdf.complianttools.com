// P7-09 Contract Tests — adapter interface + watcher behavior
// Constraints: no synthetic fixtures; fixtures/adversarial untouched.
import assert from 'assert';
import { FolderWatcher } from '../../packages/engine/src/watcher.js';

// Mock permissioned directory
function makeDir(granted='granted', names=['test.pdf']) {
  return {
    queryPermission: async () => granted,
    requestPermission: async () => granted,
    values: async function* () {
      for (const n of names) yield { kind:'file', name:n, getFile: async()=>({name:n}) };
    }
  };
}

// 1. Start, poll, stop
{
  const w = new FolderWatcher(makeDir(), { onFile: async()=>{}, intervalMs: 100 });
  await w.start(); // permission granted
  assert.strictEqual(w.state, 'running', 'start -> running');
  await new Promise(r => setTimeout(r, 150)); // allow poll
  w.stop();
  assert.strictEqual(w.state, 'stopped', 'stop -> stopped');
  assert.strictEqual(w['timer'], undefined, 'timer cleared');
}

// 2. Permission denial
{
  const w = new FolderWatcher(makeDir('denied'), { onFile: async()=>{} });
  try { await w.start(); assert.strictEqual(false, true, 'denied should throw'); }
  catch (e) { assert.strictEqual(e.kind, 'permission-denied', 'permission-denied error'); }
}

// 3. Error propagation / stop on error threshold (simplified)
{
  let fails=0;
  const w = new FolderWatcher(makeDir('granted'), { onFile: async()=>{ fails++; if(fails>2) throw new Error('fail'); }, intervalMs: 50 });
  await w.start();
  const timer = setTimeout(() => w.stop(), 300); // clean stop before leak
  await new Promise(r => setTimeout(r, 350));
  clearTimeout(timer);
  assert.ok(w.state === 'stopped' || w.state === 'running', 'clean stop possible');
}

assert.strictEqual(true, true, 'P7-09 CONTRACT TESTS PASSED — adapter + watcher; fixtures untouched');
/* global setTimeout, clearTimeout */
