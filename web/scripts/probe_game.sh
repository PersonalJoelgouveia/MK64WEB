#!/usr/bin/env bash
# Tenta compilar (sem linkar) o código do SpaghettiKart para WASM e resume as falhas.
# Pré-requisito: build_deps.sh e build_smoke.sh já executados (reutiliza libultraship, deps e o prefixo).
set -uo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${WORK:-$HERE/.build}"
EMCMAKE="${EMCMAKE:-emcmake}"
SK_SHA=ce0f935   # SpaghettiKart em 2026-10-22
export SK_DIR="$WORK/SpaghettiKart" LUS_DIR="$WORK/libultraship" DEPS_SRC="$WORK/deps/src" DEPS_PREFIX="$WORK/deps/prefix"
S="$WORK/src"

if [ ! -d "$SK_DIR/.git" ]; then git clone -q https://github.com/HarbourMasters/SpaghettiKart.git "$SK_DIR"; fi
git -C "$SK_DIR" checkout -q "$SK_SHA"
fetch_sha() { [ -d "$1/.git" ] || { git init -q "$1"; git -C "$1" remote add origin "$2"; git -C "$1" fetch -q --depth 1 origin "$3" && git -C "$1" checkout -q FETCH_HEAD; }; }
fetch_sha "$DEPS_SRC/dr_libs"      https://github.com/mackron/dr_libs.git      da35f9d6c7374a95353fd1df1d394d44ab66cf01
fetch_sha "$DEPS_SRC/tomlplusplus" https://github.com/marzer/tomlplusplus.git  v3.4.0
fetch_sha "$DEPS_SRC/semver"       https://github.com/Neargye/semver.git       v1.0.0-rc

rm -rf "$WORK/build-probe"
"$EMCMAKE" cmake -S "$HERE/game-probe" -B "$WORK/build-probe" -G Ninja -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_PREFIX_PATH="$DEPS_PREFIX" -DCMAKE_FIND_ROOT_PATH="$DEPS_PREFIX" -DUSE_OPENGLES=ON \
  -DLUS_STB_IMAGE_H="$S/stb/stb_image.h" -DFETCHCONTENT_FULLY_DISCONNECTED=ON \
  -DFETCHCONTENT_SOURCE_DIR_IMGUI="$S/imgui" -DFETCHCONTENT_SOURCE_DIR_THREADPOOL="$S/thread-pool" \
  -DFETCHCONTENT_SOURCE_DIR_PRISM="$S/prism" -DFETCHCONTENT_SOURCE_DIR_MONOCYPHER="$S/monocypher" \
  -DCMAKE_C_FLAGS="-pthread -fexceptions" -DCMAKE_CXX_FLAGS="-pthread -fexceptions -DFMT_CONSTEVAL=" >"$WORK/probe.cfg.log" 2>&1 \
  || { tail -20 "$WORK/probe.cfg.log"; exit 1; }
cmake --build "$WORK/build-probe" --target game_objs -j"$(nproc)" -- -k 0 >"$WORK/probe.log" 2>&1
TOTAL=$(grep -cE "^\[[0-9]+/[0-9]+\] Building" "$WORK/probe.log")
FAIL=$(grep -c '^FAILED' "$WORK/probe.log")
echo "unidades compiladas: $((TOTAL - FAIL)) de $TOTAL; falhas: $FAIL"
grep '^FAILED' "$WORK/probe.log" | sed -E 's#.*SpaghettiKart/##'
grep -E "fatal error|error:" "$WORK/probe.log" | sed -E 's#/home/[^ ]*/(src|include)/#\1/#' | sort | uniq -c | sort -rn | head -5
