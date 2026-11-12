/* eslint-env node, es2022 */
// Local source documents are opt-in; bundling them does not grant redistribution rights.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const DEMO_PACK = 'miris-pilot/1';

function copyDocuments(catalog, source, destination, packs, knowledgeSource = process.env.FIELD_GUIDE_MANUAL_INDEX_DIR || '') {
  if (!source || !packs.includes(DEMO_PACK)) {
    fs.rmSync(destination, { recursive: true, force: true });
    return;
  }
  const files = catalog.map(document => {
    if (!/^[A-Za-z0-9_+.-]+\.pdf$/.test(document.file)) {
      throw new Error('Invalid document resource name');
    }
    // Cited pages are printed numbers; the viewer adds this to reach the PDF page.
    if (!Number.isInteger(document.pageOffset)) {
      throw new Error(`Document page offset is not an integer: ${document.id}`);
    }
    const file = path.join(source, document.file);
    if (fs.lstatSync(file).isSymbolicLink() || !fs.statSync(file).isFile()) {
      throw new Error(
        `Document is not a regular source file: ${document.file}`,
      );
    }
    const bytes = fs.readFileSync(file);
    if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new Error(`Document is not a PDF: ${document.file}`);
    }
    if (createHash('sha256').update(bytes).digest('hex') !== document.sha256) {
      throw new Error(
        `Document digest differs from the retained source: ${document.file}`,
      );
    }
    return { file: document.file, bytes };
  });
  let knowledge;
  if (knowledgeSource) {
    const receipt = JSON.parse(fs.readFileSync(path.join(knowledgeSource, 'receipt.json'), 'utf8'));
    if (receipt.schemaVersion !== 1 || receipt.index?.path !== 'manuals.json' || !Array.isArray(receipt.sources) || receipt.sources.length !== catalog.length || catalog.some(document => !receipt.sources.some(item => item.id === document.id && item.sha256 === document.sha256 && item.pages === document.pages))) throw new Error('Manual index source identity differs from the retained catalog');
    const payload = fs.readFileSync(path.join(knowledgeSource, receipt.index.path));
    if (payload.length !== receipt.index.bytes || createHash('sha256').update(payload).digest('hex') !== receipt.index.sha256) throw new Error('Manual index digest differs from preparation');
    const prepared = JSON.parse(payload.toString('utf8'));
    if (prepared.schemaVersion !== 1 || !Array.isArray(prepared.documents) || prepared.documents.length !== catalog.length || catalog.some(document => !prepared.documents.some(item => item.id === document.id && item.sha256 === document.sha256 && Array.isArray(item.pages) && item.pages.length === document.pages && item.pages.every((page, index) => page.number === index + 1 && typeof page.text === 'string')))) throw new Error('Invalid manual page inventory');
    knowledge = { receipt, payload };
  }
  // Verify every source before replacing this build's previously accepted resources.
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const staged = fs.mkdtempSync(destination + '-');
  try {
    for (const { file, bytes } of files) {
      fs.writeFileSync(path.join(staged, file), bytes);
    }
    fs.writeFileSync(
      path.join(staged, 'index.json'),
      JSON.stringify(catalog, null, 2) + '\n',
    );
    if (knowledge) {
      fs.writeFileSync(path.join(staged, 'manuals.json'), knowledge.payload);
      fs.writeFileSync(path.join(staged, 'knowledge-receipt.json'), JSON.stringify(knowledge.receipt) + '\n');
    }
    fs.writeFileSync(
      path.join(staged, 'NOTICE.txt'),
      catalog
        .map(
          document =>
            `${document.edition || document.id}\n${document.copyright}`,
        )
        .join('\n\n') + '\n',
    );
    fs.rmSync(destination, { recursive: true, force: true });
    fs.renameSync(staged, destination);
  } finally {
    fs.rmSync(staged, { recursive: true, force: true });
  }
}

module.exports = { copyDocuments };
if (require.main === module) {
  try {
    const [catalog, source, destination, ...packs] = process.argv.slice(2);
    if (!catalog || !destination)
      throw new Error(
        'Usage: copy_course_documents.cjs <catalog> <local-source-dir> <destination> <pack/version>...',
      );
    copyDocuments(
      JSON.parse(fs.readFileSync(catalog, 'utf8')),
      source,
      destination,
      packs,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
