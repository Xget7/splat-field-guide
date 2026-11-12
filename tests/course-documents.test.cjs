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
      pageOffset: 0,
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
  assert.throws(
    () =>
      copyDocuments(
        [{ ...catalog[0], pageOffset: undefined }],
        source,
        destination,
        ['miris-pilot/1'],
      ),
    /page offset/,
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

test('the full manual text ships only with matching verified source PDFs and a valid preparation receipt', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'miris-manual-index-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const knowledge = path.join(root, 'knowledge');
  const destination = path.join(root, 'bundle');
  fs.mkdirSync(source);
  fs.mkdirSync(knowledge);
  const pdf = Buffer.from('%PDF-1.4\nsynthetic manual');
  const catalog = [
    {
      id: 'manual',
      pages: 1,
      file: 'manual.pdf',
      sha256: createHash('sha256').update(pdf).digest('hex'),
      copyright: 'Synthetic notice',
    },
  ];
  fs.writeFileSync(path.join(source, 'manual.pdf'), pdf);
  const payload = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      documents: [
        {
          ...catalog[0],
          pages: [{ number: 1, text: 'Synthetic manual text' }],
        },
      ],
    }),
  );
  fs.writeFileSync(path.join(knowledge, 'manuals.json'), payload);
  const receipt = {
    schemaVersion: 1,
    index: {
      path: 'manuals.json',
      bytes: payload.length,
      sha256: createHash('sha256').update(payload).digest('hex'),
    },
    sources: [{ id: 'manual', pages: 1, sha256: catalog[0].sha256 }],
  };
  fs.writeFileSync(
    path.join(knowledge, 'receipt.json'),
    JSON.stringify(receipt),
  );
  copyDocuments(catalog, source, destination, ['miris-pilot/1'], knowledge);
  assert.deepEqual(
    fs.readFileSync(path.join(destination, 'manuals.json')),
    payload,
  );
  assert.equal(
    JSON.parse(
      fs.readFileSync(path.join(destination, 'knowledge-receipt.json')),
    ).index.sha256,
    receipt.index.sha256,
  );
  fs.writeFileSync(path.join(knowledge, 'manuals.json'), 'corrupted');
  assert.throws(
    () =>
      copyDocuments(catalog, source, destination, ['miris-pilot/1'], knowledge),
    /digest/,
  );
  assert.deepEqual(
    fs.readFileSync(path.join(destination, 'manuals.json')),
    payload,
  );
});
