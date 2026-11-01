/* Not part of the RNNoise 0.2 release: vec.h and vec_neon.h include Opus's os_support.h, which the
   tarball leaves out, so building the NEON path (any ARM phone) fails without it. This shim maps
   what those headers use onto RNNoise's own helpers in common.h. */
#ifndef OS_SUPPORT_H
#define OS_SUPPORT_H
#include "common.h"
#ifndef OPUS_CLEAR
#define OPUS_CLEAR(dst, n) RNN_CLEAR(dst, n)
#endif
#ifndef OPUS_COPY
#define OPUS_COPY(dst, src, n) RNN_COPY(dst, src, n)
#endif
#endif
