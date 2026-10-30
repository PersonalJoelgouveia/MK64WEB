# Build WebAssembly (Emscripten)

Prova de conceito do **passo 2**: compilar o `libultraship` (renderizador Fast3D do SpaghettiKart) para o navegador com WebGL2.

## O que já foi validado

Em Chromium sem interface, com cabeçalhos COOP/COEP, um `Ship::Context` real do `libultraship` sobe por completo:
logging, config, CVars, resource manager, control deck, console, **janela Fast3D (SDL2 + WebGL2 + ImGui)**, áudio (WebAudio) e eventos.
O contexto retorna `OpenGL ES 3.0 (WebGL 2.0)` / `GLSL ES 3.00`, e o canvas desenha (verificado por captura de tela).

**Ainda não validado:** o jogo em si (SpaghettiKart), a extração de assets (Torch), o desempenho e o uso em celular.

## Como compilar

Requer Emscripten ≥ 4.0 (via `emsdk`), CMake ≥ 3.24, Ninja e git.

```bash
source /caminho/emsdk/emsdk_env.sh          # coloca emcmake no PATH
web/scripts/build_deps.sh                   # zlib, SDL2, libzip, json, tinyxml2, spdlog
web/scripts/build_smoke.sh                  # libultraship + teste de fumaça
node web/scripts/run_smoke.js web/.build/build-smoke lus_smoke.html   # requer playwright
```

Saída em `web/.build/` (ignorada pelo git). Para abrir no navegador, sirva `web/.build/build-smoke/` com os cabeçalhos
`Cross-Origin-Opener-Policy: same-origin` e `Cross-Origin-Embedder-Policy: require-corp` (necessários para threads).
No GitHub Pages use `coi-serviceworker`, pois o Pages não permite configurar cabeçalhos.

## Patch no libultraship (`patches/libultraship-emscripten.patch`)

Aplicado sobre o commit `60c9bb7`, o mesmo submódulo fixado pelo SpaghettiKart (usa **SDL2**, não SDL3):

- `cmake/dependencies/emscripten.cmake` (novo): liga SDL2 ao ImGui e exige `USE_OPENGLES=ON` (WebGL2).
- `src/CMakeLists.txt`: não procura `GLESv2` no Emscripten (o `emcc` fornece o WebGL).
- `gfx_opengl.cpp`: não chama `glewInit()` no Emscripten.
- `common.cmake`: aceita `LUS_STB_IMAGE_H` em vez de baixar o stb por `file(DOWNLOAD)`.

## Pontos de atenção

- **Flags:** todo o código precisa de `-pthread -fexceptions`. O CMake do `prism` sobrescreve `CMAKE_CXX_FLAGS`; o `build_smoke.sh` corrige isso.
- **fmt:** `-DFMT_CONSTEVAL=` desliga o `consteval` do fmt 10.2.1, que quebra com Clang recente.
- **Ordem de criação:** crie o `Fast::Fast3dWindow` **depois** do `Ship::Context` (o construtor consulta o contexto). O `ControlDeck` é abstrato (`WriteToPad`) e a aplicação precisa fornecer o seu.
- **Ports do Emscripten** (`-sUSE_SDL=2` etc.) baixam de um servidor que pode ser bloqueado; por isso as dependências são compiladas do código-fonte.
- **Só a ROM americana (`NKTE`) é suportada** pelo SpaghettiKart (SHA-1 `579C48E211AE952530FFC8738709F078D5DD215E`).

## Próximos passos

1. Confirmar a licença do SpaghettiKart com os mantenedores (não há `LICENSE` no repositório).
2. Compilar o jogo (`src/`, `port/`) contra esse `libultraship` e ligar o `input.js` ao `mk64_input.h`.
3. Portar o `Torch` para gerar o `mk64.o2r` a partir da ROM no navegador.
4. Netplay por WebRTC.
