/* eslint-env node, es2022 */
// Local source documents are opt-in; bundling them does not grant redistribution rights.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const DEMO_PACK = 'miris-pilot/1';

function copyDocuments(catalog, source, destination, packs) {
  if (!source || !packs.includes(DEMO_PACK)) {
    fs.rmSync(destination, { recursive: true, force: true });
    return;
  }
  const files = catalog.map(document => {
    if (!/^[A-Za-z0-9_+.-]+\.pdf$/.test(document.file)) {
      throw new Error('Invalid document resource name');
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
