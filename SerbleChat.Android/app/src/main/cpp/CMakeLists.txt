cmake_minimum_required(VERSION 3.22.1)
project(serblechat_audio C)

# RNNoise, vendored unmodified. NEON is picked up automatically on arm64 (vec_neon.h).
set(RNNOISE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/rnnoise)
add_library(rnnoise STATIC
    ${RNNOISE_DIR}/src/denoise.c
    ${RNNOISE_DIR}/src/rnn.c
    ${RNNOISE_DIR}/src/pitch.c
    ${RNNOISE_DIR}/src/kiss_fft.c
    ${RNNOISE_DIR}/src/celt_lpc.c
    ${RNNOISE_DIR}/src/nnet.c
    ${RNNOISE_DIR}/src/nnet_default.c
    ${RNNOISE_DIR}/src/parse_lpcnet_weights.c
    ${RNNOISE_DIR}/src/rnnoise_data.c
    ${RNNOISE_DIR}/src/rnnoise_tables.c)
target_include_directories(rnnoise PUBLIC ${RNNOISE_DIR}/include PRIVATE ${RNNOISE_DIR}/src)
target_compile_options(rnnoise PRIVATE -O3 -fvisibility=hidden -Wno-everything)

add_library(serblechat_audio SHARED rnnoise_jni.c)
target_link_libraries(serblechat_audio rnnoise m log)
target_link_options(serblechat_audio PRIVATE -Wl,--gc-sections -Wl,-z,max-page-size=16384)
