// Abre o servidor de salas + o túnel (serveo) com um único comando:  node start.js [chave]
// Mostra o endereço wss:// para colar no painel Online. Precisa de Node 18+ e do comando "ssh".
const { spawn } = require('child_process');
const PORT = process.env.PORT || '8080';
const TOKEN = process.argv[2] || process.env.SERVER_TOKEN || '';
const env = { ...process.env, PORT, SERVER_TOKEN: TOKEN };
const srv = spawn(process.execPath, [require('path').join(__dirname, 'server.js')], { env, stdio: 'inherit' });
let stopping = false;

function tunnel() {
  const t = spawn('ssh', ['-o', 'StrictHostKeyChecking=accept-new', '-o', 'ServerAliveInterval=30', '-o', 'ExitOnForwardFailure=yes', '-R', `80:localhost:${PORT}`, 'serveo.net'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const onData = (d) => {
    const m = /https:\/\/([a-z0-9.-]+\.serveo\.net|[a-z0-9.-]+\.serveousercontent\.com)/i.exec(String(d));
    if (m) console.log(`\n=========================================\n Servidor:  wss://${m[1]}\n Chave:     ${TOKEN || '(nenhuma)'}\n Cole isso no painel Online e clique em Conectar.\n=========================================\n`);
  };
  t.stdout.on('data', onData); t.stderr.on('data', onData);
  t.on('error', () => console.log('Não achei o comando "ssh". No Windows 10/11 ele vem instalado (ative "Cliente OpenSSH").'));
  t.on('exit', () => { if (!stopping) { console.log('Túnel caiu; reconectando em 3 s (o endereço pode mudar)…'); setTimeout(tunnel, 3000); } });
  return t;
}
const tun = tunnel();
const stop = () => { stopping = true; tun.kill(); srv.kill(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop); srv.on('exit', stop);
