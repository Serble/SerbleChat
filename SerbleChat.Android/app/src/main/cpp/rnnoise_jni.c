// JNI bridge to RNNoise for the voice capture path. Audio arrives as 32-bit floats on the int16
// scale (what WebRTC's audio processing hands to external processors, and what RNNoise expects),
// 10 ms at a time. RNNoise works on 480-sample (10 ms at 48 kHz) frames.
#include <jni.h>
#include <stdlib.h>
#include <string.h>
#include "rnnoise.h"

#define FRAME 480

typedef struct {
    DenoiseState *st;
    float in[FRAME];
    float out[FRAME];
} Denoiser;

JNIEXPORT jlong JNICALL
Java_net_serble_chat_voice_RnNoise_nativeCreate(JNIEnv *env, jclass cls) {
    Denoiser *d = calloc(1, sizeof(Denoiser));
    if (!d) return 0;
    d->st = rnnoise_create(NULL);
    if (!d->st) { free(d); return 0; }
    return (jlong) (intptr_t) d;
}

JNIEXPORT void JNICALL
Java_net_serble_chat_voice_RnNoise_nativeDestroy(JNIEnv *env, jclass cls, jlong handle) {
    Denoiser *d = (Denoiser *) (intptr_t) handle;
    if (!d) return;
    rnnoise_destroy(d->st);
    free(d);
}

/**
 * Denoises `frames` samples in place, starting at `offset` floats into the direct buffer.
 * `frames` must be a multiple of 480. Returns the voice probability of the last frame.
 */
JNIEXPORT jfloat JNICALL
Java_net_serble_chat_voice_RnNoise_nativeProcess(JNIEnv *env, jclass cls, jlong handle, jobject buffer, jint offset, jint frames) {
    Denoiser *d = (Denoiser *) (intptr_t) handle;
    float *data = (float *) (*env)->GetDirectBufferAddress(env, buffer);
    if (!d || !data) return 0;
    data += offset;
    float vad = 0;
    for (int i = 0; i + FRAME <= frames; i += FRAME) {
        memcpy(d->in, data + i, sizeof(d->in));
        vad = rnnoise_process_frame(d->st, d->out, d->in);
        memcpy(data + i, d->out, sizeof(d->out));
    }
    return vad;
}
