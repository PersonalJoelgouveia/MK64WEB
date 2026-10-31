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

## Sonda do código do jogo (`scripts/probe_game.sh`)

Compila (sem linkar) as mesmas fontes e definições do SpaghettiKart (commit `ce0f935`) contra o `libultraship` em WASM:
**278 de 279 unidades compilam**. A única falha é `src/port/Engine.cpp`, que inclui `Companion.h` do **Torch**.

O jogo embute o Torch como biblioteca: `GameExtractor` usa `Companion` para gerar o `mk64.o2r` a partir da ROM na primeira
execução. Portanto portar o jogo e portar o extrator de assets são a mesma tarefa. `GameExtractor.cpp` também usa APIs do
Windows e `portable-file-dialogs`, que precisam ser trocadas por leitura de arquivo no navegador.

## Torch em WebAssembly (`scripts/build_torch.sh`)

O Torch (extrator de assets) já traz suporte a Emscripten no CMake e bindings JavaScript (`src/lib/web.cpp`):
`Companion` aceita os bytes da ROM e gera o `.o2r`. No commit fixado pelo SpaghettiKart (`2d474dd`) o link falhava por
`Companion::Instance` definido duas vezes; `patches/torch-emscripten.patch` corrige com uma linha.

Resultado: `torch.js` + `torch.wasm` (2,1 MB, módulo ES6, sem pthreads). Validado em Chromium: `createModule()` carrega e expõe
`Companion`, `ExportType`, `ArchiveType`, `VectorUInt8` e `FS`.

**Extração validada** (Chromium, ROM `NKTE` do dono, SHA-1 `579C48E2…`): `torch/extract_test.html` + `scripts/run_extract.js` geram
`mk64.o2r` (26,7 MB, 32.447 arquivos) em ~2 s. Requisitos no sistema de arquivos virtual: `yamls/`, `config.yml`,
`include/defines.h` e `meta/mods.toml`. Pontos: o construtor do `Companion` precisa dos 6 argumentos
`(rom, O2R, false, false, '/sk', '/out')`; depois `SetAdditionalFile('meta/mods.toml')` (binding adicionado pelo patch), `Init(Binary)` e `Process()`.
`EXPORT_EXCEPTION_HANDLING_HELPERS` expõe `getExceptionMessage` para ler erros C++.

## Jogo completo em WASM (`scripts/build_game.sh`)

Compila e **linka** o SpaghettiKart (`ce0f935`) com o `libultraship`: `spaghetti_web.{html,js,wasm}` (~7,9 MB), sem avisos.
`patches/spaghettikart-emscripten.patch`:

- `Engine.cpp`: no Emscripten não usa `GameExtractor` (Windows/diálogos); sem `mk64.o2r` apenas registra erro.
- `framebuffer_effects.c`: declara `gfx_create_framebuffer` com o 6º parâmetro (`forceFixedAspect`) que o libultraship tem.
  Em C nativo a diferença passa; em WASM é erro de assinatura (chamada que falha em execução).

- `Game.cpp`: no Emscripten o `while (WindowIsRunning()) push_frame();` vira `emscripten_set_main_loop` (a página não bloqueia).
  `PROXY_TO_PTHREAD` não serve aqui: o EGL do Emscripten cria o contexto GL na thread principal.

`scripts/pack_spaghetti.py` gera o `spaghetti.o2r` (zip de `assets/`, igual ao `torch pack`); `game/prerun.js` o carrega no
sistema de arquivos virtual antes do `main()`. Validado em Chromium: com `mk64.o2r` + `spaghetti.o2r` o jogo carrega bancos/sequências de áudio e **renderiza a corrida (demo do Mario Raceway)** em WebGL2.

**Não validado:** entrada (teclado/gamepad), áudio audível, desempenho e netplay. Há avisos `ImportTexture: null texture address` a investigar.

## Página completa (`game.js`, `coi.js`, `scripts/package_site.sh`)

Fluxo validado em Chromium com a ROM do dono: arrastar a ROM → `loader.js` valida (só `NKTE` + SHA-1) → `game.js` extrai o
`mk64.o2r` com o Torch (WASM, `CreateFromFile`; ~100 s no sandbox, só na primeira vez) → guarda em IndexedDB (cache local,
nunca enviado) → carrega `game/spaghetti_web.js` com `Module.canvas = #canvas` → o jogo renderiza no canvas da página.
`coi.js` + `coi-sw.js` ativam COOP/COEP (necessário para threads) no GitHub Pages. `package_site.sh` copia os artefatos do
build para `game/` (sem ROM e sem `mk64.o2r`).
Entrada: `input.js` (teclado, gamepad, toque) é somada à do SDL em `read_controllers()` (patch em `main.c`).

**Persistência (validada):** `/save` é montado como IDBFS no `game.js` (carrega antes do `main()`, grava a cada 5 s e ao
esconder/fechar a página). O jogo recebe `SHIP_HOME=/save` (`Game.cpp`); no libultraship o patch faz `Context.cpp` honrar
`SHIP_HOME` também no Emscripten. Config (`spaghettify.cfg.json`), logs e saves ficam em `/save`; os `.o2r` ficam fora (memória).
Testado: reabrir o navegador mantém `/save` e o `mk64.o2r` em cache (sem reextrair).

**Pendente:** teste de entrada real, FPS em aparelho real, netplay.

## Licença (não confirmada)

O SpaghettiKart **não tem arquivo `LICENSE`** e traz código com copyright da SGI/Nintendo (cabeçalhos do libultra).
A licença MIT encontrada em `HarbourMasters/harbourmasters-hub` é do repositório do site, não do SpaghettiKart.
`libultraship` e `Torch` são MIT. Não publique um build WASM do jogo antes de confirmar com os mantenedores.

## Próximos passos

1. Testar a extração (Torch web) com a ROM, no navegador, gerando o `mk64.o2r`.
2. Substituir `GameExtractor.cpp` (APIs do Windows e diálogos) por leitura do `.o2r` já gerado no sistema de arquivos virtual.
3. Linkar o jogo, ligar o `input.js` ao `mk64_input.h` e ajustar o laço principal (`emscripten_set_main_loop`).
4. Netplay por WebRTC.
5. Licença do SpaghettiKart: sem resposta dos mantenedores; uso próprio, com a ROM do dono.
