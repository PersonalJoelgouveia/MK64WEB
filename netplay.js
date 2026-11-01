/* netplay.js — multiplayer P2P (2 a 4 jogadores) por WebRTC com sincronização "lockstep" (versão 3).
 *
 * Salas: um servidor leve (server/server.js) mantém a lista de salas (com senha opcional) e só encaminha a sinalização.
 * O jogo em si NÃO passa pelo servidor: cada jogador abre uma conexão WebRTC direta com cada um dos outros (malha).
 * Cada navegador roda o jogo inteiro e só os comandos dos controles trafegam. Slot 0 = quem criou a sala.
 *
 * Contra o lag:
 *  - comandos num canal não confiável/sem ordem ("in"), cada pacote repete os últimos REDUNDANCY comandos
 *    (perda de pacote não trava o jogo); se faltar um comando por >100 ms, pede reenvio pelo canal confiável ("ctl");
 *  - atraso de entrada adaptativo: o anfitrião mede RTT/jitter de todos e escolhe o atraso (em quadros) ao iniciar;
 *  - catch-up: se os outros já enviaram comandos adiantados, roda até MAX_CATCHUP quadros por quadro de tela;
 *  - telemetria em N.stats.
 * Se um jogador sai durante a partida o sincronismo é encerrado (não há como continuar de forma determinística).
 *
 * API usada pelo jogo (game/webnet.c): active, beginFrame(), canTick(), canExtra(), submit(valor, hash), get(slot), tickDone().
 * Valor empacotado como no input.js: botões (16 bits) | stick_x << 16 | stick_y << 24.
 */
(function () {
  'use strict';
  const FRAME_MS = 1000 / 60, MIN_DELAY = 4, MAX_DELAY = 12, DEFAULT_DELAY = 6, MAXP = 4;
  const HASH_EVERY = 60, REDUNDANCY = 8, MAX_CATCHUP = 3, CATCHUP_BUDGET_MS = 9, NEED_AFTER_MS = 100;
  const U = { INPUT: 1, PING: 2, PONG: 3 };                          // canal "in" (não confiável)
  const C = { ASK: 1, REPORT: 2, GO: 3, HASH: 4, NEED: 5, BULK: 6 }; // canal "ctl" (confiável)
  const ICE = [{ urls: 'stun:stun.l.google.com:19302' }];
  const log = (m, k) => (window.MK64Log || console.log)('[online] ' + m, k);

  const N = {
    state: 'idle',            // idle | connecting | lobby | inroom | playing | closed
    me: null, room: null, peers: [], rooms: [], active: false, mask: 0,
    tick: 0, delay: DEFAULT_DELAY, stalls: 0, desync: null, localReady: false,
    stats: { rtt: 0, jitter: 0, delay: DEFAULT_DELAY, tps: 0, stallsPerSec: 0, lost: 0 },
    onchange: null, onerror: null, onstart: null, ondrop: null, ondesync: null,
  };
  let ws = null, conns = new Map(), inputs, sent, myHash, peerHash, submitted, frameStart = 0, lastNeed = 0, stallSince = 0;
  let statTimer = null, ticksWin = 0, stallsWin = 0, reports = new Map(), started = false;
  const changed = () => { if (N.onchange) N.onchange(); };
  const setState = (s) => { N.state = s; changed(); };

  function resetGame() {
    inputs = [new Map(), new Map(), new Map(), new Map()]; sent = new Map(); myHash = new Map(); peerHash = [new Map(), new Map(), new Map(), new Map()];
    submitted = -1; N.tick = 0; N.stalls = 0; N.desync = null; N.active = false; N.mask = 0; stallSince = 0; started = false;
  }
  resetGame();
  const myBit = () => 1 << N.me.slot;
  const remoteSlots = () => { const r = []; for (let s = 0; s < MAXP; s++) if ((N.mask >> s & 1) && s !== N.me.slot) r.push(s); return r; };
  const connBySlot = (s) => { for (const c of conns.values()) if (c.slot === s) return c; return null; };

  // ---------------- servidor de salas ----------------
  const wsSend = (m) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };

  N.connect = function (url, token, nick) {
    return new Promise((resolve, reject) => {
      N.disconnect(); setState('connecting');
      let done = false;
      try { ws = new WebSocket(url); } catch (e) { setState('idle'); return reject(new Error('Endereço do servidor inválido.')); }
      const t = setTimeout(() => { if (!done) { done = true; try { ws.close(); } catch (e) { /* ok */ } setState('idle'); reject(new Error('O servidor não respondeu.')); } }, 8000);
      ws.onopen = () => wsSend({ t: 'hello', token: token || '', nick });
      ws.onerror = () => { if (!done) { done = true; clearTimeout(t); setState('idle'); reject(new Error('Não foi possível conectar ao servidor.')); } };
      ws.onclose = () => { clearTimeout(t); if (!done) { done = true; setState('idle'); return reject(new Error('Conexão recusada (chave de acesso inválida?).')); } if (N.state !== 'idle') { leaveLocal(); N.me = null; setState('idle'); if (N.onerror) N.onerror('Desconectado do servidor.'); } };
      ws.onmessage = (e) => {
        let m; try { m = JSON.parse(e.data); } catch (x) { return; }
        if (m.t === 'hello' && !done) { done = true; clearTimeout(t); N.me = { id: m.id, slot: -1, nick }; N.rooms = m.rooms; setState('lobby'); resolve(m); }
        else onServer(m);
      };
    });
  };
  N.disconnect = function () { leaveLocal(); const w = ws; ws = null; if (w) { w.onclose = null; try { w.close(); } catch (e) { /* ok */ } } N.rooms = []; if (N.state !== 'idle') setState('idle'); };
  N.refresh = () => wsSend({ t: 'list' });
  N.createRoom = (name, password, max, nick) => wsSend({ t: 'create', name, password, max, nick });
  N.joinRoom = (id, password, nick) => wsSend({ t: 'join', id, password, nick });
  N.leaveRoom = () => { wsSend({ t: 'leave' }); };
  N.setReady = (v) => { N.localReady = !!v; wsSend({ t: 'ready', value: !!v }); };

  function onServer(m) {
    switch (m.t) {
      case 'rooms': N.rooms = m.rooms; changed(); break;
      case 'error': if (N.onerror) N.onerror(m.msg || m.code); break;
      case 'joined':
        N.me = { id: m.you.id, slot: m.you.slot, nick: N.me.nick }; N.room = m.room; N.peers = m.peers;
        resetGame(); N.localReady = false; setState('inroom');
        // quem entra abre conexão com todos que já estavam na sala
        m.peers.forEach((p) => { if (p.id !== N.me.id) makeConn(p, true); });
        break;
      case 'peers': N.peers = m.peers; N.room = m.room; conns.forEach((c) => { const p = m.peers.find((x) => x.id === c.id); if (p) { c.slot = p.slot; c.nick = p.nick; } }); changed(); break;
      case 'left': { const c = conns.get(m.id); if (c) { closeConn(c); if (N.active) drop(c.nick); } break; }
      case 'closed':
        { const was = N.active; leaveLocal(); setState(ws ? 'lobby' : 'idle'); if (was && N.ondrop) N.ondrop(m.reason); else if (N.onerror) N.onerror(m.reason); }
        break;
      case 'signal': onSignal(m.from, m.data); break;
    }
  }
  function leaveLocal() { conns.forEach(closeConn); conns.clear(); clearInterval(statTimer); statTimer = null; N.room = null; N.peers = []; N.active = false; N.localReady = false; resetGame(); if (N.state === 'inroom' || N.state === 'playing') N.state = ws ? 'lobby' : 'idle'; }
  function drop(nick) { N.active = false; log((nick || 'Um jogador') + ' saiu: sincronismo encerrado.', 'err'); if (N.ondrop) N.ondrop((nick || 'Um jogador') + ' saiu da partida.'); }

  // ---------------- conexões WebRTC (malha) ----------------
  function makeConn(p, initiator) {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const c = { id: p.id, slot: p.slot, nick: p.nick, pc, chIn: null, chCtl: null, open: false, rtt: [], pendingIce: [], pingTimer: null, remoteSet: false };
    conns.set(p.id, c);
    pc.onicecandidate = (e) => { if (e.candidate) wsSend({ t: 'signal', to: c.id, data: { ice: e.candidate } }); };
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed'].includes(pc.connectionState) && conns.get(c.id) === c) { closeConn(c); if (N.active) drop(c.nick); else if (N.onerror) N.onerror('Falha na conexão com ' + c.nick + ' (rede restrita? pode ser preciso um servidor TURN).'); }
    };
    if (initiator) {
      bindChannel(c, pc.createDataChannel('in', { ordered: false, maxRetransmits: 0 }));
      bindChannel(c, pc.createDataChannel('ctl', { ordered: true }));
      pc.createOffer().then((o) => pc.setLocalDescription(o)).then(() => wsSend({ t: 'signal', to: c.id, data: { sdp: pc.localDescription } }));
    } else pc.ondatachannel = (e) => bindChannel(c, e.channel);
    return c;
  }
  function bindChannel(c, ch) {
    ch.binaryType = 'arraybuffer';
    if (ch.label === 'in') { c.chIn = ch; ch.onmessage = (e) => onUnreliable(c, new DataView(e.data)); }
    else { c.chCtl = ch; ch.onmessage = (e) => onControl(c, new DataView(e.data)); }
    ch.onopen = () => checkOpen(c);
    ch.onclose = () => { if (conns.get(c.id) === c && c.open) { closeConn(c); if (N.active) drop(c.nick); } };
    checkOpen(c);
  }
  function checkOpen(c) {
    if (c.open || !c.chIn || !c.chCtl || c.chIn.readyState !== 'open' || c.chCtl.readyState !== 'open') return;
    c.open = true; log('Conectado a ' + c.nick + '.');
    c.pingTimer = setInterval(() => { const m = new DataView(new ArrayBuffer(9)); m.setUint8(0, U.PING); m.setFloat64(1, performance.now()); sendU(c, m.buffer); }, 250);
    if (!statTimer) statTimer = setInterval(() => { const s = N.stats; s.tps = ticksWin; s.stallsPerSec = stallsWin; s.delay = N.delay; ticksWin = stallsWin = 0; updateRtt(); }, 1000);
    changed();
  }
  function closeConn(c) { clearInterval(c.pingTimer); try { c.chIn && c.chIn.close(); c.chCtl && c.chCtl.close(); c.pc.close(); } catch (e) { /* ok */ } conns.delete(c.id); changed(); }
  async function onSignal(from, data) {
    let c = conns.get(from);
    if (data.sdp) {
      if (data.sdp.type === 'offer') {
        const p = N.peers.find((x) => x.id === from) || { id: from, slot: -1, nick: 'Jogador' };
        c = makeConn(p, false);
        await c.pc.setRemoteDescription(data.sdp); c.remoteSet = true;
        await c.pc.setLocalDescription(await c.pc.createAnswer());
        wsSend({ t: 'signal', to: from, data: { sdp: c.pc.localDescription } });
      } else if (c) { await c.pc.setRemoteDescription(data.sdp); c.remoteSet = true; }
      if (c) { c.pendingIce.splice(0).forEach((i) => c.pc.addIceCandidate(i).catch(() => {})); }
    } else if (data.ice) {
      if (!c) return;
      if (c.remoteSet) c.pc.addIceCandidate(data.ice).catch(() => {}); else c.pendingIce.push(data.ice);
    }
  }
  N.meshReady = () => N.peers.every((p) => p.id === N.me.id || (conns.get(p.id) && conns.get(p.id).open));

  // ---------------- envio ----------------
  function sendU(c, buf) { if (c.chIn && c.chIn.readyState === 'open') c.chIn.send(buf); }
  function sendC(c, type, a, b, extra) {
    if (!c.chCtl || c.chCtl.readyState !== 'open') return;
    const n = extra ? extra.length : 0, m = new DataView(new ArrayBuffer(12 + 4 * n));
    m.setUint32(0, type); m.setUint32(4, a >>> 0); m.setUint32(8, b >>> 0);
    for (let i = 0; i < n; i++) m.setUint32(12 + 4 * i, extra[i] >>> 0);
    c.chCtl.send(m.buffer);
  }
  const eachConn = (fn) => conns.forEach((c) => { if (c.open) fn(c); });

  // ---------------- RTT / atraso ----------------
  function connStats(c) {
    if (!c.rtt.length) return { rtt: 0, jit: 0 };
    const avg = c.rtt.reduce((a, b) => a + b, 0) / c.rtt.length;
    return { rtt: avg, jit: c.rtt.reduce((a, b) => a + Math.abs(b - avg), 0) / c.rtt.length };
  }
  function worstLocal() {
    let r = 0, j = 0; conns.forEach((c) => { const s = connStats(c); if (s.rtt > r) r = s.rtt; if (s.jit > j) j = s.jit; }); return { rtt: r, jit: j };
  }
  function updateRtt() { const w = worstLocal(); N.stats.rtt = Math.round(w.rtt); N.stats.jitter = Math.round(w.jit); }
  function chooseDelay(rtt, jit) {
    if (!rtt) return DEFAULT_DELAY;
    return Math.max(MIN_DELAY, Math.min(MAX_DELAY, Math.ceil((rtt / 2 + 2 * jit) / FRAME_MS) + 2));
  }

  // ---------------- início da partida (só o anfitrião, slot 0) ----------------
  N.canStart = () => N.state === 'inroom' && N.me.slot === 0 && N.peers.length >= 2 && N.peers.every((p) => p.ready) && N.meshReady();
  N.start = async function () {
    if (!N.canStart()) return;
    reports = new Map(); const w = worstLocal(); reports.set(N.me.id, w);
    eachConn((c) => sendC(c, C.ASK, 0, 0));
    await new Promise((r) => setTimeout(r, 500));                    // espera os relatórios de RTT dos outros
    let rtt = w.rtt, jit = w.jit; reports.forEach((v) => { rtt = Math.max(rtt, v.rtt); jit = Math.max(jit, v.jit); });
    const d = chooseDelay(rtt, jit); let mask = 0; N.peers.forEach((p) => { mask |= 1 << p.slot; });
    wsSend({ t: 'start' });
    eachConn((c) => sendC(c, C.GO, d, mask));
    begin(d, mask);
  };
  function begin(d, mask) {
    if (started) return; started = true;
    N.delay = N.stats.delay = d; N.mask = mask;
    for (let s = 0; s < MAXP; s++) if (mask >> s & 1) for (let t = 0; t < d; t++) inputs[s].set(t, 0);
    for (let t = 0; t < d; t++) sent.set(t, 0);
    N.tick = 0; submitted = -1; N.stalls = 0; N.desync = null; N.active = true; ticksWin = stallsWin = 0;
    updateRtt(); setState('playing');
    log('Partida online: ' + (remoteSlots().length + 1) + ' jogadores, ping máx. ' + N.stats.rtt + ' ms (±' + N.stats.jitter + '), atraso de entrada ' + d + ' quadros.');
    if (N.onstart) N.onstart();
  }

  // ---------------- lockstep (chamado pelo jogo) ----------------
  N.beginFrame = function () { frameStart = performance.now(); };
  const haveAll = () => { for (const s of remoteSlots()) if (!inputs[s].has(N.tick)) return false; return true; };
  N.canTick = function () {
    if (!N.active) return 1;
    if (haveAll()) { stallSince = 0; return 1; }
    N.stalls++; stallsWin++;
    const now = performance.now(); if (!stallSince) stallSince = now;
    if (now - stallSince > NEED_AFTER_MS && now - lastNeed > NEED_AFTER_MS) {
      lastNeed = now; N.stats.lost++;
      remoteSlots().forEach((s) => { if (!inputs[s].has(N.tick)) { const c = connBySlot(s); if (c) sendC(c, C.NEED, N.tick, 0); } });
    }
    return 0;
  };
  N.canExtra = function () { return N.active && (performance.now() - frameStart) < CATCHUP_BUDGET_MS && haveAll() ? 1 : 0; };
  N.submit = function (value, hash) {
    if (!N.active || submitted >= N.tick) return;
    submitted = N.tick;
    const t = N.tick + N.delay, me = N.me.slot;
    inputs[me].set(t, value); sent.set(t, value);
    const first = Math.max(0, t - REDUNDANCY + 1), count = t - first + 1, m = new DataView(new ArrayBuffer(6 + 4 * count));
    m.setUint8(0, U.INPUT); m.setUint8(1, count); m.setUint32(2, first);
    for (let i = 0; i < count; i++) m.setUint32(6 + 4 * i, sent.get(first + i) >>> 0);
    eachConn((c) => sendU(c, m.buffer));
    if (N.tick % HASH_EVERY === 0) { myHash.set(N.tick, hash); eachConn((c) => sendC(c, C.HASH, N.tick, hash)); compareAll(N.tick); }
  };
  N.get = function (slot) { return slot < MAXP ? (inputs[slot].get(N.tick) || 0) : 0; };
  N.tickDone = function () {
    if (!N.active) return;
    for (let s = 0; s < MAXP; s++) inputs[s].delete(N.tick - 2);
    sent.delete(N.tick - 240); N.tick++; ticksWin++;
  };
  function compareAll(t) {
    if (!myHash.has(t)) return;
    const rs = remoteSlots(); if (!rs.every((s) => peerHash[s].has(t))) return;
    const mine = myHash.get(t);
    rs.forEach((s) => { if (peerHash[s].get(t) !== mine && !N.desync) { N.desync = t; log('DESSINCRONIZAÇÃO no quadro ' + t + ' (jogador ' + (s + 1) + ').', 'err'); if (N.ondesync) N.ondesync(t); } peerHash[s].delete(t); });
    myHash.delete(t);
  }

  // ---------------- recepção ----------------
  function putRemote(slot, tick, value) {
    if (slot < 0 || slot >= MAXP || tick < N.tick - 1) return;
    const m = inputs[slot]; if (!m.has(tick)) m.set(tick, value);
  }
  function onUnreliable(c, m) {
    const type = m.getUint8(0);
    if (type === U.INPUT) { const count = m.getUint8(1), first = m.getUint32(2); for (let i = 0; i < count; i++) putRemote(c.slot, first + i, m.getUint32(6 + 4 * i)); }
    else if (type === U.PING) { const r = new DataView(new ArrayBuffer(9)); r.setUint8(0, U.PONG); r.setFloat64(1, m.getFloat64(1)); sendU(c, r.buffer); }
    else if (type === U.PONG) { c.rtt.push(performance.now() - m.getFloat64(1)); if (c.rtt.length > 40) c.rtt.shift(); }
  }
  function onControl(c, m) {
    const type = m.getUint32(0), a = m.getUint32(4), b = m.getUint32(8);
    if (type === C.ASK) { const w = worstLocal(); sendC(c, C.REPORT, Math.round(w.rtt * 10), Math.round(w.jit * 10)); }
    else if (type === C.REPORT) reports.set(c.id, { rtt: a / 10, jit: b / 10 });
    else if (type === C.GO) begin(a, b);
    else if (type === C.HASH) { if (c.slot >= 0) { peerHash[c.slot].set(a, b); compareAll(a); } }
    else if (type === C.NEED) { const vals = []; for (let t = a; t < a + 60 && sent.has(t); t++) vals.push(sent.get(t)); if (vals.length) sendC(c, C.BULK, a, vals.length, vals); }
    else if (type === C.BULK) { for (let i = 0; i < b; i++) putRemote(c.slot, a + i, m.getUint32(12 + 4 * i)); }
  }

  window.MK64Net = N;
})();
