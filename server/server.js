/* Servidor de salas e sinalização do MK64 Web.
 * Só encaminha mensagens de sinalização WebRTC (oferta/resposta/ICE) e mantém a lista de salas.
 * Nenhum dado do jogo passa por aqui: os comandos dos controles vão direto entre os navegadores (P2P).
 *
 * Variáveis de ambiente:
 *   PORT             porta (padrão 8080)
 *   SERVER_TOKEN     se definida, só clientes que enviarem essa chave entram (servidor fechado)
 *   ALLOWED_ORIGINS  origens permitidas, separadas por vírgula (ex.: https://usuario.github.io); vazio = qualquer
 *   MAX_ROOMS        limite de salas simultâneas (padrão 50)
 */
'use strict';
const http = require('http');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');

const PORT = +process.env.PORT || 8080;
const TOKEN = process.env.SERVER_TOKEN || '';
const ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const MAX_ROOMS = +process.env.MAX_ROOMS || 50;
const MAX_PLAYERS = 4;

const rooms = new Map();   // id -> { id, name, password, max, started, members: Map(peerId -> client) }
const clients = new Set();
const uid = () => crypto.randomBytes(6).toString('hex');
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);

function send(c, msg) { if (c.ws.readyState === 1) c.ws.send(JSON.stringify(msg)); }
const roomInfo = (r) => ({ id: r.id, name: r.name, players: r.members.size, max: r.max, locked: !!r.password, started: r.started });
function lobby() { return [...rooms.values()].filter((r) => !r.started).map(roomInfo); }
function broadcastLobby() { clients.forEach((c) => { if (c.authed && !c.room) send(c, { t: 'rooms', rooms: lobby() }); }); }
function peersOf(r) { return [...r.members.values()].map((m) => ({ id: m.id, slot: m.slot, nick: m.nick, ready: m.ready })); }
function broadcastRoom(r, msg) { r.members.forEach((m) => send(m, msg)); }
function pushPeers(r) { broadcastRoom(r, { t: 'peers', peers: peersOf(r), started: r.started, room: roomInfo(r) }); }

function leave(c, reason) {
  const r = c.room; if (!r) return;
  r.members.delete(c.id); c.room = null; c.ready = false;
  if (c.slot === 0 || r.members.size === 0) {            // o anfitrião saiu: a sala fecha
    r.members.forEach((m) => { m.room = null; m.ready = false; send(m, { t: 'closed', reason: reason || 'O anfitrião saiu.' }); });
    rooms.delete(r.id);
  } else { pushPeers(r); broadcastRoom(r, { t: 'left', id: c.id }); }
  broadcastLobby();
}

function freeSlot(r) { for (let s = 0; s < r.max; s++) if (![...r.members.values()].some((m) => m.slot === s)) return s; return -1; }

function joinRoom(c, r) {
  c.room = r; c.slot = freeSlot(r); c.ready = false; r.members.set(c.id, c);
  send(c, { t: 'joined', you: { id: c.id, slot: c.slot }, room: roomInfo(r), peers: peersOf(r) });
  pushPeers(r); broadcastLobby();
}

function handle(c, m) {
  if (!c.authed) {
    if (m.t === 'hello' && (!TOKEN || m.token === TOKEN)) { c.authed = true; c.nick = clean(m.nick, 20) || 'Jogador'; send(c, { t: 'hello', id: c.id, closed: !!TOKEN, rooms: lobby() }); }
    else { send(c, { t: 'error', code: 'auth', msg: 'Chave de acesso inválida.' }); c.ws.close(); }
    return;
  }
  switch (m.t) {
    case 'list': send(c, { t: 'rooms', rooms: lobby() }); break;
    case 'create': {
      if (c.room) return send(c, { t: 'error', code: 'busy', msg: 'Você já está em uma sala.' });
      if (rooms.size >= MAX_ROOMS) return send(c, { t: 'error', code: 'full', msg: 'Limite de salas do servidor atingido.' });
      const name = clean(m.name, 32); if (!name) return send(c, { t: 'error', code: 'name', msg: 'Dê um nome à sala.' });
      const r = { id: uid(), name, password: clean(m.password, 40), max: Math.max(2, Math.min(MAX_PLAYERS, +m.max || 2)), started: false, members: new Map() };
      c.nick = clean(m.nick, 20) || c.nick; rooms.set(r.id, r); joinRoom(c, r); break;
    }
    case 'join': {
      if (c.room) return send(c, { t: 'error', code: 'busy', msg: 'Você já está em uma sala.' });
      const r = rooms.get(m.id);
      if (!r) return send(c, { t: 'error', code: 'gone', msg: 'A sala não existe mais.' });
      if (r.started) return send(c, { t: 'error', code: 'started', msg: 'A partida já começou.' });
      if (r.members.size >= r.max) return send(c, { t: 'error', code: 'full', msg: 'A sala está cheia.' });
      if (r.password && clean(m.password, 40) !== r.password) return send(c, { t: 'error', code: 'password', msg: 'Senha incorreta.' });
      c.nick = clean(m.nick, 20) || c.nick; joinRoom(c, r); break;
    }
    case 'ready': if (c.room) { c.ready = !!m.value; pushPeers(c.room); } break;
    case 'start':
      if (c.room && c.slot === 0 && !c.room.started) { c.room.started = true; pushPeers(c.room); broadcastLobby(); }
      break;
    case 'signal': {                                   // encaminha oferta/resposta/ICE a outro membro da mesma sala
      const r = c.room; const to = r && r.members.get(m.to);
      if (to) send(to, { t: 'signal', from: c.id, data: m.data });
      break;
    }
    case 'leave': leave(c, 'Você saiu da sala.'); send(c, { t: 'rooms', rooms: lobby() }); break;
    case 'pong': c.alive = true; break;
  }
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  res.writeHead(404); res.end();
});
const wss = new WebSocketServer({ server, maxPayload: 64 * 1024, verifyClient: ({ origin }) => !ORIGINS.length || ORIGINS.includes(origin) });
wss.on('connection', (ws) => {
  const c = { ws, id: uid(), authed: false, nick: 'Jogador', room: null, slot: -1, ready: false, alive: true, last: 0, count: 0 };
  clients.add(c);
  ws.on('message', (d) => {
    const now = Date.now(); if (now - c.last > 1000) { c.last = now; c.count = 0; } if (++c.count > 200) return;   // limite simples de taxa
    let m; try { m = JSON.parse(d); } catch (e) { return; } if (m && typeof m === 'object') handle(c, m);
  });
  ws.on('pong', () => { c.alive = true; });
  ws.on('close', () => { leave(c, 'Jogador desconectou.'); clients.delete(c); });
  ws.on('error', () => {});
});
setInterval(() => { clients.forEach((c) => { if (!c.alive) return c.ws.terminate(); c.alive = false; try { c.ws.ping(); } catch (e) { /* ok */ } }); }, 20000);

server.listen(PORT, () => console.log('MK64 Web — sinalização em :' + PORT + (TOKEN ? ' (servidor fechado: exige chave)' : '') + (ORIGINS.length ? ' · origens: ' + ORIGINS.join(', ') : '')));
