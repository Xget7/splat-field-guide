const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHash } = require('crypto');

const nativeSuite = process.platform === 'darwin' ? describe : describe.skip;
const sources = path.join(__dirname, 'retrieval');

nativeSuite('native part retrieval resource and ranking contract', () => {
  let directory;
  let executable;

  beforeAll(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'part-retrieval-test-'));
    executable = path.join(directory, 'probe');
    execFileSync('swiftc', [
      path.join(sources, 'PartRetrievalTokenizer.swift'),
      path.join(sources, 'PartRetrievalIndex.swift'),
      path.join(sources, 'PartRetrievalEngine.swift'),
      path.join(sources, 'PartRetrievalProbe.swift'),
      '-o',
      executable,
    ]);
  }, 60000);

  afterAll(() => {
    if (directory) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('normalizes queries, ranks deterministically and rejects malformed vectors', () => {
    expect(execFileSync(executable, ['index'], { encoding: 'utf8' })).toContain(
      'index checks passed',
    );
  });

  test('rejects a receipt that does not match its externally supplied digest', () => {
    expect(execFileSync(executable, ['receipt'], { encoding: 'utf8' })).toContain(
      'receipt checks passed',
    );
  });

  const resources = process.env.HOUSE_RETRIEVAL_RESOURCES;
  const benchmark = process.env.HOUSE_RETRIEVAL_BENCHMARK;
  const corpusTest = resources && benchmark ? test : test.skip;
  corpusTest('matches the reference tokenizer and real CPU model rankings', () => {
    const digest = createHash('sha256')
      .update(fs.readFileSync(path.join(resources, 'receipt.json')))
      .digest('hex');
    const actual = JSON.parse(
      execFileSync(
        executable,
        [
          'corpus',
          resources,
          digest,
          path.join(benchmark, 'frozen.json'),
          path.join(benchmark, 'token-ids.json'),
        ],
        { encoding: 'utf8' },
      ),
    );
    const expected = JSON.parse(
      fs.readFileSync(path.join(benchmark, 'mobileclip-results.json'), 'utf8'),
    );
    expect(actual.tokenParity).toBe(expected.rankings.length);
    for (const [index, row] of actual.rows.entries()) {
      const reference = expected.rankings[index];
      expect(row.text).toBe(reference.text);
      expect(row.ranking[0].partId).toBe(reference.part_ranking[0].part);
      expect(row.ranking).toHaveLength(reference.part_ranking.length);
      for (const candidate of row.ranking) {
        const score = reference.part_ranking.find(
          part => part.part === candidate.partId,
        ).cosine;
        expect(Math.abs(score - candidate.score)).toBeLessThan(0.00002);
      }
    }
  }, 60000);
});
