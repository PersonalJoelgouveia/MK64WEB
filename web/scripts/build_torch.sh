#!/usr/bin/env bash
# Compila o Torch (extrator de assets do SpaghettiKart) como módulo WebAssembly (ES6 + embind).
# Saída: $WORK/build-torch/torch.js e torch.wasm. Não precisa de pthreads nem do libultraship.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${WORK:-$HERE/.build}"
EMCMAKE="${EMCMAKE:-emcmake}"
TORCH="$WORK/Torch"
TORCH_SHA=2d474ddb8da8b213fbdbb49d0273ce31fa955f35   # submódulo torch do SpaghettiKart

if [ ! -d "$TORCH/.git" ]; then git init -q "$TORCH"; git -C "$TORCH" remote add origin https://github.com/HarbourMasters/Torch.git; fi
git -C "$TORCH" fetch -q --depth 1 origin "$TORCH_SHA"
git -C "$TORCH" checkout -q FETCH_HEAD
git -C "$TORCH" apply --reverse --check "$HERE/patches/torch-emscripten.patch" 2>/dev/null \
  || git -C "$TORCH" apply "$HERE/patches/torch-emscripten.patch"

rm -rf "$WORK/build-torch"
# fixes.cmake adiciona -fexceptions (o CMakeLists do Torch sobrescreve CMAKE_CXX_FLAGS).
"$EMCMAKE" cmake -S "$TORCH" -B "$WORK/build-torch" -G Ninja -DCMAKE_BUILD_TYPE=Release \
  -DUSE_STANDALONE=ON -DBUILD_STORMLIB=OFF -DBUILD_SM64=OFF -DBUILD_SF64=OFF -DBUILD_FZERO=OFF -DBUILD_MARIO_ARTIST=OFF \
  -DBUILD_MK64=ON -DBUILD_NAUDIO=ON -DCMAKE_PROJECT_INCLUDE="$HERE/torch/fixes.cmake"
cmake --build "$WORK/build-torch" -j"$(nproc)"
cp "$HERE/torch/torch_test.html" "$WORK/build-torch/"
ls -la "$WORK"/build-torch/torch.js "$WORK"/build-torch/torch.wasm
echo "== pronto. Teste: node web/scripts/run_smoke.js $WORK/build-torch torch_test.html"
