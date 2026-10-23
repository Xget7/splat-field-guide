# AR assembly

The V8 tour uses the supplied CC BY-NC 4.0 USDZ, independently of the Gol pack.
Keep its original at `data/ar-assembly/v8-engine/source.usdz` and prepare the final assembled pose from root:

```sh
nice -n 19 python3 scripts/prepare_ar_assembly.py --source data/ar-assembly/v8-engine/source.usdz --output data/ar-assembly/v8-engine/engine.usdz --metadata-output data/ar-assembly/v8-engine/preparation.json
```

The macOS `usdcat` and `usdzip` tools preserve the hierarchy, geometry/materials and source-animation order while sampling time code 3250.
`apps/field-guide/assets/ar/v8-engine.json` pins the source/prepared identities and ordering; revise it deliberately when replacing the equipment.
Xcode validates the prepared bytes before bundling, and absent resources report an unavailable state.
The `react-native-splat` native assembly harness checks the prepared USDZ and receipt through every forward/reverse step, and skips when those local inputs are absent.
Physical anchoring, tracking recovery and visible animation remain separate acceptance checks.
