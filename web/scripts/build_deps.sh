#!/usr/bin/env bash
# Compila com Emscripten as dependências do libultraship (versões usadas pelo SpaghettiKart).
# Uso:  web/scripts/build_deps.sh            (precisa de emcmake no PATH ou EMCMAKE=/caminho/emcmake)
# Saída: $WORK/deps/prefix  (bibliotecas estáticas .a e headers)
set -euo pipefail

WORK="${WORK:-$(cd "$(dirname "$0")/.." && pwd)/.build}"
EMCMAKE="${EMCMAKE:-emcmake}"
ROOT="$WORK/deps"; SRC="$ROOT/src"; PREFIX="$ROOT/prefix"
mkdir -p "$SRC" "$PREFIX"

# -pthread: o libultraship usa std::thread / mutex.  -fexceptions: o código usa try/catch.
FLAGS="-pthread -fexceptions -O2"
COMMON=(-G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PREFIX"
        -DCMAKE_PREFIX_PATH="$PREFIX" -DCMAKE_C_FLAGS="$FLAGS" -DCMAKE_CXX_FLAGS="$FLAGS"
        -DBUILD_SHARED_LIBS=OFF)

clone() { [ -d "$SRC/$1/.git" ] || git clone -q --depth 1 --branch "$3" "$2" "$SRC/$1"; }

build() {
  local name=$1; shift
  [ -f "$ROOT/.done-$name" ] && { echo "== $name: já compilado"; return; }
  echo "== compilando $name"
  rm -rf "$ROOT/build-$name"
  "$EMCMAKE" cmake -S "$SRC/$name" -B "$ROOT/build-$name" "${COMMON[@]}" "$@" >"$ROOT/log-$name.txt" 2>&1 \
    || { tail -25 "$ROOT/log-$name.txt"; echo "FALHA (configure) $name"; exit 1; }
  cmake --build "$ROOT/build-$name" -j"$(nproc)" >>"$ROOT/log-$name.txt" 2>&1 \
    || { tail -40 "$ROOT/log-$name.txt"; echo "FALHA (build) $name"; exit 1; }
  cmake --install "$ROOT/build-$name" >>"$ROOT/log-$name.txt" 2>&1
  touch "$ROOT/.done-$name"
}

clone zlib     https://github.com/madler/zlib.git          v1.3.2
clone SDL2     https://github.com/libsdl-org/SDL.git       release-2.32.8
clone libzip   https://github.com/nih-at/libzip.git        v1.11.3
clone json     https://github.com/nlohmann/json.git        v3.11.3
clone tinyxml2 https://github.com/leethomason/tinyxml2.git 10.0.0
clone spdlog   https://github.com/gabime/spdlog.git        v1.14.1   # mesma versão fixada pelo SpaghettiKart

build zlib -DZLIB_BUILD_EXAMPLES=OFF -DZLIB_BUILD_SHARED=OFF -DZLIB_BUILD_TESTING=OFF
build json -DJSON_BuildTests=OFF
build tinyxml2 -Dtinyxml2_BUILD_TESTING=OFF
build spdlog -DSPDLOG_BUILD_EXAMPLE=OFF -DSPDLOG_BUILD_TESTS=OFF
build SDL2 -DSDL_SHARED=OFF -DSDL_STATIC=ON -DSDL_TEST=OFF -DSDL_TESTS=OFF
build libzip -DENABLE_BZIP2=OFF -DENABLE_LZMA=OFF -DENABLE_ZSTD=OFF -DENABLE_OPENSSL=OFF \
  -DENABLE_GNUTLS=OFF -DENABLE_MBEDTLS=OFF -DENABLE_COMMONCRYPTO=OFF -DENABLE_WINDOWS_CRYPTO=OFF \
  -DBUILD_TOOLS=OFF -DBUILD_REGRESS=OFF -DBUILD_OSSFUZZ=OFF -DBUILD_EXAMPLES=OFF -DBUILD_DOC=OFF \
  -DZLIB_ROOT="$PREFIX" -DZLIB_LIBRARY="$PREFIX/lib/libz.a" -DZLIB_INCLUDE_DIR="$PREFIX/include"

echo "== dependências ok em $PREFIX"
