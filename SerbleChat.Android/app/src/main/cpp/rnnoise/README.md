Vendored [RNNoise](https://github.com/xiph/rnnoise) v0.2 (release tarball, which includes the
generated model in `src/rnnoise_data.c`). BSD-3-Clause, see `COPYING`. Unmodified apart from:

- dropping the two training tools (`dump_features.c`, `write_weights.c`)
- adding `src/os_support.h`, a shim the release is missing that the ARM NEON path includes
