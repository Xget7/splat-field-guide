#!/bin/zsh
# Resume the full-res COLMAP run without guided matching, then train with Brush.
set -e
R=$(cd "$(dirname "$0")/.." && pwd)
S=$R/data
C=$S/capture
cd $C
mkdir -p full/sparse
echo "[$(date +%T)] colmap match (no guided, resumes matched pairs)"
colmap exhaustive_matcher --database_path full/db.db --FeatureMatching.use_gpu 0 > full/match2.log 2>&1
echo "[$(date +%T)] colmap map"
colmap mapper --database_path full/db.db --image_path jpg --output_path full/sparse > full/map.log 2>&1
colmap model_analyzer --path full/sparse/0 2>&1 | grep -E "Registered images|Points:|reprojection"
rm -rf $S/dataset-full && mkdir -p $S/dataset-full/sparse $S/splat
ln -sfn $C/jpg $S/dataset-full/images
ln -sfn $C/full/sparse/0 $S/dataset-full/sparse/0
echo "[$(date +%T)] brush train (30k steps, full res)"
cd $S
$R/tools/brush/brush-app-aarch64-apple-darwin/brush_app dataset-full --with-viewer \
  --total-steps 30000 --max-resolution 2832 \
  --export-every 2000 --export-path splat --export-name 'engine_{iter}.ply'
echo "[$(date +%T)] brush exited"
