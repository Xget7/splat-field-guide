# Recover poses with COLMAP

Status: accepted.

Polycam exported photos/depth with unusable poses; COLMAP registered all 124 photos at about 1.3 px reprojection error.

Use COLMAP poses for training, mask tracking and lifting.

- Export levels with Apple photo acceleration metadata.
- Scale comes from an approximate 0.242 m battery dimension, not captured LiDAR depth.
- Other cameras need a levelling substitute; physical metric scale remains unverified.
