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

## Controles (teclado)

| N64 | Tecla |
|---|---|
| Analógico | Setas |
| A (acelerar) | X |
| B (frear/ré) | Z |
| Z (item) | Espaço |
| R (pulo/drift) | S |
| L | Q |
| Start | Enter |
| C ▲ ◀ ▼ ▶ | I / J / K / L |

Em dispositivos touch, o site mostra analógico e botões virtuais.

## Arquitetura

| Arquivo | Função |
|---|---|
| `index.html` | Interface: loader da ROM, `<canvas id="canvas">`, painel de controles |
| `styles.css` | Tema escuro responsivo |
| `loader.js` | Leitura/validação da ROM, entrada (`window.MK64Input`), eventos para o módulo WASM |

Interface exposta ao módulo WASM:

- `window.MK64.rom` — `Uint8Array` da ROM normalizada (`.z64`)
- `window.MK64Input` — `{ buttons: {A,B,Z,...}, stick: {x,y} }` (stick de -1 a 1)
- Eventos `mk64:rom-ready` e `mk64:rom-reset` em `window`

## Roadmap

- [ ] Integrar o motor de recompilação compilado com Emscripten
- [ ] Renderização via WebGL no canvas e áudio via Web Audio
- [ ] Multiplayer online (WebRTC peer-to-peer, sincronização de inputs)
- [ ] Workflow de CI para compilar e publicar o `.wasm`
- [ ] Suporte a gamepad (Gamepad API)

## Publicação

GitHub Pages: **Settings → Pages → Deploy from a branch → `main` / `(root)`**.

Observação: o Pages não permite configurar cabeçalhos HTTP. Se o build usar threads (`SharedArrayBuffer`), será necessário um service worker que injete `Cross-Origin-Opener-Policy` e `Cross-Origin-Embedder-Policy` (por exemplo, `coi-serviceworker`).
