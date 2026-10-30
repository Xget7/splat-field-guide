# Local retrieval experiment

This test-only Swift experiment reuses the existing MobileCLIP CPU benchmark's image prototypes and matched Core ML text encoder.
It is excluded from the podspec's source files and the package's published file list.
There is no app startup factory, Nitro registration, singleton, database integration or Android runtime in this experiment.
Choosing a production encoder and integrating it into the existing instructor/platform lifecycle are deferred.

Run the resource and ranking checks from `packages/react-native-on-device`:

```sh
nice -n 19 npm test -- --runInBand __tests__/PartRetrieval.test.js
```

For actual model/tokenizer parity, set `HOUSE_RETRIEVAL_RESOURCES` to a prepared resource directory and `HOUSE_RETRIEVAL_BENCHMARK` to the matching frozen benchmark directory before running the same command.
That optional check uses local resources only and compares every query's token IDs, top result and cosine scores to the Python CPU reference.
Without those paths the model check is explicitly skipped.
Temporary Swift executables are deleted by the test harness.

Prepare resources using `pipeline.pack.retrieval_export` in the separate `splat-tools` repository, with explicit `--benchmark` and a fresh `--out` path.
The exporter reuses `pipeline.artifacts.sha256` and the benchmark's installed OpenCLIP version and tokenizer tables.
It refuses existing output directories and does not alter annotations, photo vectors or model weights.
Resource receipts identify evaluation inputs; they are not an application database.

The custom Swift tokenizer is a restricted parity probe for plain ASCII English, not a supported product tokenizer.
It rejects smart punctuation, non-ASCII names, markup and overlong queries instead of silently producing different tokens.
The index returns cosine-ranked candidates, not calibrated confidence, absence detection or verified relationships.
The engine uses CPU-only Core ML to match the reference experiment; Mac results do not establish iPhone, iPad or Android performance.
Model distribution, native bridge builds and app integration are outside this branch's accepted scope.
