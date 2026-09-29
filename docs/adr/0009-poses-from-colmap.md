# Camera poses come from COLMAP, not the capture app

Status: accepted

The Polycam photo-mode export carries images and LiDAR depth but empty camera poses: every translation is zero.
COLMAP recovers the poses from the photos themselves; on the first capture it placed all 124 photos with a 1.3 px mean reprojection error.
Any camera or app that saves sharp photos can feed the pipeline.

**Pros**
- No dependency on one capture app or its paid tiers.
- One pose source for training, masks and lifting, so they agree.

**Cons**
- Poses have no real-world scale until we fit them to the LiDAR depth.
- Matching every photo against every other grows quadratically with the photo count.
