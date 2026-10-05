const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const page = fs.readFileSync(require('node:path').resolve(__dirname, '../../pipeline/mark.html'), 'utf8');

test('clearing a prompt discards a late mask response', async () => {
  const code = page.match(/async function segment\(f\) \{[\s\S]*?\n\/\/ --- photos/)[0].split('// --- photos')[0];
  let finish;
  let prompt = { clicks: [{ positive: true }], box: null };
  const context = vm.createContext({
    masks: {}, latest: {}, requestId: 0,
    sam: { pending: 0 },
    capture: 'capture',
    marksFor: () => prompt,
    hasPrompt: m => m.clicks.some(c => c.positive),
    markThumb() {}, frame: () => 0, redraw() {}, refreshStatus() {}, console,
    api: () => new Promise(resolve => { finish = resolve; }),
    loadImage: async () => ({ mask: true }),
  });
  vm.runInContext(code, context);
  const pending = context.segment(0);
  prompt = { clicks: [], box: null };
  await context.segment(0);
  finish({ mask: 'late', score: 1 });
  await pending;
  assert.equal(context.masks[0].img, null);
});
