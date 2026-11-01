# Servidor de salas do MK64 Web

Organiza as salas (lista, senha opcional, 2 a 4 jogadores) e encaminha a sinalização WebRTC. **Não trafega dados do jogo**:
os comandos dos controles vão direto entre os navegadores. Consome quase nada de CPU/banda.

```bash
cd server && npm install
PORT=8080 SERVER_TOKEN=minha-chave ALLOWED_ORIGINS=https://personaljoelgouveia.github.io node server.js
```

- `SERVER_TOKEN`: se definida, só entra quem informar essa chave no painel Online (**servidor fechado**).
- `ALLOWED_ORIGINS`: restringe quais sites podem usar o servidor.
- `GET /health` responde `ok` (para health checks).

O site é HTTPS, então o navegador exige **`wss://`** (TLS). Opções:
- **Hospedagem com TLS pronto** (Render, Fly.io, Railway, etc.): suba o `Dockerfile` desta pasta e use o endereço `wss://…` que a plataforma der.
- **No seu PC**: rode o servidor e exponha com um túnel (`cloudflared tunnel --url http://localhost:8080` dá um `https://…` → use `wss://…`).
  Para testar só no próprio PC, `ws://localhost:8080` funciona mesmo no site HTTPS.

Coloque o endereço em `config.js` (`signalUrl`) para os jogadores não precisarem digitar.
Se a rede de algum jogador bloquear conexões diretas (NAT restritivo/4G), é preciso um servidor TURN (não incluído).

## Um comando só (servidor + túnel)

```
cd server
npm install        # só na primeira vez
node start.js minhachave
```
Mostra `wss://….serveo.net`: cole no painel Online (com a chave) e clique em Conectar. Ctrl+C encerra tudo.
