# The pipeline runs on Modal

Status: accepted

Training a splat at full resolution took 3 h 8 min for 30k steps on an M4 Pro, and a 6 GB RTX 2060 cannot hold full-resolution photos with millions of splats.
SAM 3.1 and gsplat also expect CUDA.
Each pipeline stage runs as a Modal function on a data-centre GPU, caches its output by input hash, and the pack server is a Modal web endpoint.

**Pros**
- Full-resolution training in minutes, not hours; reruns skip finished stages.
- The same GPU code as the research tools, with no porting to Metal.

**Cons**
- Needs an account and network to build packs (not to use them).
- Pay per use, and cold starts of tens of seconds on the pack server.
