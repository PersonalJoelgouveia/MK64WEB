#!/usr/bin/env bash
# Compila e linka o SpaghettiKart (commit fixado) para WebAssembly.
# Pré-requisito: build_deps.sh e build_smoke.sh (reutiliza libultraship, deps e fontes em $WORK).
set -uo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${WORK:-$HERE/.build}"
EMCMAKE="${EMCMAKE:-emcmake}"
SK_SHA=ce0f935
export SK_DIR="$WORK/SpaghettiKart" LUS_DIR="$WORK/libultraship" DEPS_SRC="$WORK/deps/src" DEPS_PREFIX="$WORK/deps/prefix"
S="$WORK/src"
[ -d "$SK_DIR/.git" ] || git clone -q https://github.com/HarbourMasters/SpaghettiKart.git "$SK_DIR"
git -C "$SK_DIR" checkout -q "$SK_SHA"
if ! git -C "$SK_DIR" apply --reverse --check "$HERE/patches/spaghettikart-emscripten.patch" 2>/dev/null; then
  git -C "$SK_DIR" apply "$HERE/patches/spaghettikart-emscripten.patch"
fi
fetch_sha() { [ -d "$1/.git" ] || { git init -q "$1"; git -C "$1" remote add origin "$2"; git -C "$1" fetch -q --depth 1 origin "$3" && git -C "$1" checkout -q FETCH_HEAD; }; }
fetch_sha "$DEPS_SRC/dr_libs"      https://github.com/mackron/dr_libs.git      da35f9d6c7374a95353fd1df1d394d44ab66cf01
fetch_sha "$DEPS_SRC/tomlplusplus" https://github.com/marzer/tomlplusplus.git  v3.4.0
fetch_sha "$DEPS_SRC/semver"       https://github.com/Neargye/semver.git       v1.0.0-rc

rm -rf "$WORK/build-game"
"$EMCMAKE" cmake -S "$HERE/game" -B "$WORK/build-game" -G Ninja -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_PREFIX_PATH="$DEPS_PREFIX" -DCMAKE_FIND_ROOT_PATH="$DEPS_PREFIX" -DUSE_OPENGLES=ON \
  -DLUS_STB_IMAGE_H="$S/stb/stb_image.h" -DFETCHCONTENT_FULLY_DISCONNECTED=ON \
  -DFETCHCONTENT_SOURCE_DIR_IMGUI="$S/imgui" -DFETCHCONTENT_SOURCE_DIR_THREADPOOL="$S/thread-pool" \
  -DFETCHCONTENT_SOURCE_DIR_PRISM="$S/prism" -DFETCHCONTENT_SOURCE_DIR_MONOCYPHER="$S/monocypher" \
  -DCMAKE_C_FLAGS="-pthread -fexceptions" -DCMAKE_CXX_FLAGS="-pthread -fexceptions -DFMT_CONSTEVAL=" >"$WORK/game.cfg.log" 2>&1 \
  || { tail -20 "$WORK/game.cfg.log"; exit 1; }
cmake --build "$WORK/build-game" -j"$(nproc)" -- -k 0 >"$WORK/game.log" 2>&1
grep -E "^FAILED|error:|undefined symbol|wasm-ld" "$WORK/game.log" | sed -E 's#/home/[^ ]*/##' | sort | uniq -c | sort -rn | head -40
ls -la "$WORK"/build-game/spaghetti_web.* 2>/dev/null
