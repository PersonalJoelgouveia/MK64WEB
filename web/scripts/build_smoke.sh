#!/usr/bin/env bash
# Baixa o libultraship (commit fixado pelo SpaghettiKart), aplica o patch Emscripten e compila o teste de fumaça.
# Pré-requisito: web/scripts/build_deps.sh já executado.
# Saída: $WORK/build-smoke/lus_smoke.{html,js,wasm}
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${WORK:-$HERE/.build}"
EMCMAKE="${EMCMAKE:-emcmake}"
PREFIX="$WORK/deps/prefix"; SRC="$WORK/src"
LUS="$WORK/libultraship"
LUS_SHA=60c9bb713ed0850da66559fc17c556d03da649cd   # submódulo libultraship do SpaghettiKart

[ -d "$PREFIX/lib" ] || { echo "rode web/scripts/build_deps.sh primeiro"; exit 1; }
mkdir -p "$SRC"

fetch_sha() { # dir url sha
  if [ ! -d "$1/.git" ]; then git init -q "$1"; git -C "$1" remote add origin "$2"; fi
  git -C "$1" fetch -q --depth 1 origin "$3"
  git -C "$1" checkout -q FETCH_HEAD
}

# libultraship + patch
fetch_sha "$LUS" https://github.com/Kenix3/libultraship.git "$LUS_SHA"
if ! git -C "$LUS" apply --reverse --check "$HERE/patches/libultraship-emscripten.patch" 2>/dev/null; then
  git -C "$LUS" apply "$HERE/patches/libultraship-emscripten.patch"
fi

# Dependências que o FetchContent do libultraship baixaria (a rede do build nem sempre permite)
fetch_sha "$SRC/imgui"       https://github.com/ocornut/imgui.git                v1.91.9b-docking
git -C "$SRC/imgui" apply "$LUS/cmake/dependencies/patches/imgui-fixes-and-config.patch" 2>/dev/null || true
fetch_sha "$SRC/thread-pool" https://github.com/bshoshany/thread-pool.git        v4.1.0
fetch_sha "$SRC/prism"       https://github.com/KiritoDv/prism-processor.git     1de054450e7b3c5f777d2e3dfcb228ad120c329d
fetch_sha "$SRC/monocypher"  https://github.com/LoupVaillant/Monocypher.git      0d85f98c9d9b0227e42cf795cb527dff372b40a4
fetch_sha "$SRC/stb"         https://github.com/nothings/stb.git                 0bc88af4de5fb022db643c2d8e549a0927749354
# O CMake do prism sobrescreve CMAKE_CXX_FLAGS e apagaria -pthread/-fexceptions: preserva as flags.
sed -i 's|set(CMAKE_CXX_FLAGS "-Wno-narrowing")|set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -Wno-narrowing")|' "$SRC/prism/CMakeLists.txt"

# FMT_CONSTEVAL= desliga o consteval do fmt 10.2.1 (quebra com Clang recente; mesmo contorno do SpaghettiKart no macOS)
export LUS_DIR="$LUS"
rm -rf "$WORK/build-smoke"
"$EMCMAKE" cmake -S "$HERE/smoke" -B "$WORK/build-smoke" -G Ninja -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_PREFIX_PATH="$PREFIX" -DCMAKE_FIND_ROOT_PATH="$PREFIX" \
  -DCMAKE_C_FLAGS="-pthread -fexceptions -O2" -DCMAKE_CXX_FLAGS="-pthread -fexceptions -O2 -DFMT_CONSTEVAL=" \
  -DUSE_OPENGLES=ON -DLUS_STB_IMAGE_H="$SRC/stb/stb_image.h" -DFETCHCONTENT_FULLY_DISCONNECTED=ON \
  -DFETCHCONTENT_SOURCE_DIR_IMGUI="$SRC/imgui" -DFETCHCONTENT_SOURCE_DIR_THREADPOOL="$SRC/thread-pool" \
  -DFETCHCONTENT_SOURCE_DIR_PRISM="$SRC/prism" -DFETCHCONTENT_SOURCE_DIR_MONOCYPHER="$SRC/monocypher"
cmake --build "$WORK/build-smoke" -j"$(nproc)"
ls -la "$WORK"/build-smoke/lus_smoke.*
echo "== pronto. Teste:  node web/scripts/run_smoke.js $WORK/build-smoke lus_smoke.html"
