/* eslint-env node, es2022 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Buffer } = require('node:buffer');
const { copyDocuments } = require('../scripts/copy_course_documents.cjs');

test('documents require explicit local sources and the matching selected course', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'miris-documents-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const destination = path.join(root, 'bundle');
  fs.mkdirSync(source);
  const bytes = Buffer.from('%PDF-1.4\nlocal test document');
  fs.writeFileSync(path.join(source, 'manual.pdf'), bytes);
  const catalog = [
    {
      id: 'manual',
      file: 'manual.pdf',
      sha256: createHash('sha256').update(bytes).digest('hex'),
      copyright: 'Copyright source owner',
    },
  ];
  copyDocuments(catalog, source, destination, []);
  assert.equal(fs.existsSync(path.join(destination, 'index.json')), false);
  copyDocuments(catalog, '', destination, ['miris-pilot/1']);
  assert.equal(fs.existsSync(path.join(destination, 'manual.pdf')), false);
  copyDocuments(catalog, source, destination, ['miris-pilot/1']);
  assert.deepEqual(
    fs.readFileSync(path.join(destination, 'manual.pdf')),
    bytes,
  );
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(destination, 'index.json'))),
    catalog,
  );
  assert.match(
    fs.readFileSync(path.join(destination, 'NOTICE.txt'), 'utf8'),
    /Copyright source owner/,
  );
  fs.writeFileSync(path.join(source, 'manual.pdf'), '%PDF-1.4\nchanged');
  assert.throws(
    () => copyDocuments(catalog, source, destination, ['miris-pilot/1']),
    /digest/,
  );
  assert.deepEqual(
    fs.readFileSync(path.join(destination, 'manual.pdf')),
    bytes,
  );
});
