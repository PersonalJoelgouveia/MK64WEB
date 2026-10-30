# MK64 Web

Port experimental de **Mario Kart 64** para o navegador, baseado em recompilação estática (MIPS → C → WebAssembly via Emscripten), com o objetivo de permitir partidas online (WebRTC) no futuro.

> **Status:** fase inicial. Já existem a interface, a validação da ROM e o mapeamento de entrada. O motor WASM e o multiplayer ainda **não** foram implementados.

## Aviso legal

- Este repositório **não contém nem distribui** a ROM, texturas, áudio, modelos ou qualquer outro asset de Mario Kart 64.
- O usuário precisa fornecer **sua própria ROM**, obtida legalmente a partir de um cartucho que possui. A ROM é lida localmente no navegador e **nunca é enviada** a nenhum servidor.
- Projeto de fã, sem fins lucrativos e sem afiliação com a Nintendo. *Mario Kart 64* e *Nintendo 64* são marcas registradas da Nintendo.
- Nunca faça commit de ROMs ou assets extraídos. O `.gitignore` já bloqueia as extensões mais comuns.

## Como usar

1. Acesse o site (GitHub Pages) ou sirva a pasta localmente:
   ```bash
   python3 -m http.server 8080
   # abra http://localhost:8080
   ```
2. Arraste sua ROM (`.z64`, `.v64` ou `.n64`) para a área de carregamento.
3. O `loader.js` valida o ID do cabeçalho (`NKTE`, `NKTP` ou `NKTJ`), converte para big-endian (`.z64`) se necessário e dispara o evento `mk64:rom-ready`.

## Controles

| N64 | Teclado | Gamepad (Xbox / PlayStation) |
|---|---|---|
| Analógico | W A S D ou setas | Analógico esquerdo (ou D-Pad) |
| A (acelerar) | X | A / ✕ |
| B (frear/ré) | Z | B / ○ ou X / □ |
| Z (item) | Shift | LB/LT (L1/L2) |
| R (pulo/drift) | Espaço | RB/RT (R1/R2) |
| L | Q | Back / Select |
| Start | Enter | Start |
| C ▲ ◀ ▼ ▶ | I / J / K / L | Analógico direito (▲ também no Y / △) |
| D-Pad | T / F / G / H | D-Pad |

Em telas touch, os controles aparecem sobre o jogo (analógico flutuante à esquerda; A, B, Z, R, L, C e Start à direita). Em celular em pé, ficam abaixo da imagem; em tela cheia, o site tenta travar a orientação em paisagem. Para remapear o teclado, edite `KEYMAP` no topo do `input.js`.

## Entrada para o WASM

O `input.js` combina teclado, gamepad e toque em um único controle de N64 (mesmo formato do `OSContPad` do libultra): `buttons` (uint16), `stick_x` e `stick_y` (int8, de -80 a 80). A porta 0 recebe teclado + toque + o 1º gamepad; as portas 1 a 3 recebem os demais gamepads.

- `MK64Input.poll(port)` retorna um `uint32` empacotado: `buttons | stick_x << 16 | stick_y << 24`.
- `MK64Input.writeToMemory(HEAPU8, ptr, port)` escreve 4 bytes (u16 LE, s8, s8) em um ponteiro do WASM.
- `MK64Input.getState(port)` e `MK64Input.isPressed('A')` servem para depuração.

No lado C, inclua `src/web/mk64_input.h` em **um** arquivo `.c` (ele usa `EM_JS`) e chame `mk64_read_pad(port, &buttons, &x, &y)` uma vez por frame. Os nomes dos botões em C seguem `MK64_BTN_*`.

## Arquitetura

| Arquivo | Função |
|---|---|
| `index.html` | Interface: loader da ROM, `<canvas id="canvas">`, painel de controles |
| `styles.css` | Tema escuro responsivo e controles de toque |
| `loader.js` | Leitura/validação da ROM e eventos para o módulo WASM |
| `input.js` | Teclado + Gamepad API + toque -> buffer único do controle N64 |
| `src/web/mk64_input.h` | Ponte C -> JS (`EM_JS`) para ler a entrada de dentro do WASM |

Interface exposta ao módulo WASM:

- `window.MK64.rom` — `Uint8Array` da ROM normalizada (`.z64`)
- `window.MK64Input` — API de entrada descrita acima
- Eventos `mk64:rom-ready` e `mk64:rom-reset` em `window`

## Roadmap

- [ ] Integrar o motor de recompilação compilado com Emscripten
- [ ] Renderização via WebGL no canvas e áudio via Web Audio
- [ ] Multiplayer online (WebRTC peer-to-peer, sincronização de inputs)
- [ ] Workflow de CI para compilar e publicar o `.wasm`
- [x] Entrada: teclado, gamepad (Gamepad API) e controles de toque

## Publicação

GitHub Pages: **Settings → Pages → Deploy from a branch → `main` / `(root)`**.

Observação: o Pages não permite configurar cabeçalhos HTTP. Se o build usar threads (`SharedArrayBuffer`), será necessário um service worker que injete `Cross-Origin-Opener-Policy` e `Cross-Origin-Embedder-Policy` (por exemplo, `coi-serviceworker`).
