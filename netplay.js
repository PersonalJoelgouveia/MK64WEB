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
  const FRAME_MS = 1000 / 60, MIN_DELAY = 4, MAX_DELAY = 16, DEFAULT_DELAY = 6, MAXP = 4;
  const HASH_EVERY = 60, REDUNDANCY = 8, MAX_CATCHUP = 3, CATCHUP_BUDGET_MS = 9, NEED_AFTER_MS = 100;
  const U = { INPUT: 1, PING: 2, PONG: 3 };                          // canal "in" (não confiável)
  const C = { ASK: 1, REPORT: 2, GO: 3, HASH: 4, NEED: 5, BULK: 6, JSON: 7, DELAY: 8 }; // canal "ctl" (confiável)
  const ICE = [{ urls: 'stun:stun.l.google.com:19302' }];
  const log = (m, k) => (window.MK64Log || console.log)('[online] ' + m, k);

  const N = {
    get mode() { return mode; },
    state: 'idle',            // idle | connecting | lobby | inroom | playing | closed
    me: null, room: null, peers: [], rooms: [], active: false, mask: 0,
    tick: 0, delay: DEFAULT_DELAY, stalls: 0, desync: null, localReady: false,
    stats: { rtt: 0, jitter: 0, delay: DEFAULT_DELAY, tps: 0, stallsPerSec: 0, lost: 0 },
    onchange: null, onerror: null, onstart: null, ondrop: null, ondesync: null,
  };
  let ws = null, conns = new Map(), inputs, sent, myHash, peerHash, submitted, frameStart = 0, lastNeed = 0, stallSince = 0;
  let lastT = -1, stallBy = [0, 0, 0, 0], lastRaise = 0, lastLower = 0, adaptTimer = null;
  let statTimer = null, ticksWin = 0, stallsWin = 0, reports = new Map(), started = false;
  // mode: 'server' (salas num servidor) | 'host' / 'guest' (sala local, sem servidor: o anfitrião faz o papel do servidor)
  let mode = 'server', hostRoom = null; const pending = new Map();
  const uid = () => Math.random().toString(36).slice(2, 10);
  const changed = () => { if (N.onchange) N.onchange(); };
  const setState = (s) => { N.state = s; changed(); };

  function resetGame() {
    clearInterval(adaptTimer); adaptTimer = null;
    inputs = [new Map(), new Map(), new Map(), new Map()]; sent = new Map(); myHash = new Map(); peerHash = [new Map(), new Map(), new Map(), new Map()];
    submitted = -1; N.tick = 0; N.stalls = 0; N.desync = null; N.active = false; N.mask = 0; stallSince = 0; started = false;
  }
  resetGame();
  const myBit = () => 1 << N.me.slot;
  const remoteSlots = () => { const r = []; for (let s = 0; s < MAXP; s++) if ((N.mask >> s & 1) && s !== N.me.slot) r.push(s); return r; };
  const connBySlot = (s) => { for (const c of conns.values()) if (c.slot === s) return c; return null; };

  // ---------------- servidor de salas ----------------
  const wsSend = (m) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };
  // Mensagens de sala/sinalização: vão ao servidor (modo 'server'), ao anfitrião (convidado) ou são tratadas aqui (anfitrião).
  function out(m) {
    if (mode === 'server') return wsSend(m);
    if (mode === 'guest') { const h = hostConn(); if (h) sendJson(h, m); return; }
    if (mode === 'host') hostHandle(null, m);
  }
  const hostConn = () => { for (const c of conns.values()) if (c.slot === 0 || c.id === 'host') return c; return null; };

  N.connect = function (url, token, nick) {
    return new Promise((resolve, reject) => {
      N.disconnect(); mode = 'server'; setState('connecting');
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
  N.leaveRoom = () => { if (mode === 'server') wsSend({ t: 'leave' }); else { leaveLocal(); mode = 'server'; hostRoom = null; pending.clear(); setState('idle'); } };
  N.setReady = (v) => { N.localReady = !!v; out({ t: 'ready', value: !!v }); };

  function onServer(m) {
    switch (m.t) {
      case 'rooms': N.rooms = m.rooms; changed(); break;
      case 'error': if (N.onerror) N.onerror(m.msg || m.code); break;
      case 'joined':
        N.me = { id: m.you.id, slot: m.you.slot, nick: N.me.nick }; N.room = m.room; N.peers = m.peers;
        resetGame(); N.localReady = false; setState('inroom');
        if (mode === 'guest') {                                       // a conexão com o anfitrião já existe (código manual)
          const hp = m.peers.find((p) => p.slot === 0), hc = conns.get('host');
          if (hp && hc) { conns.delete('host'); hc.id = hp.id; hc.slot = 0; hc.nick = hp.nick; conns.set(hc.id, hc); }
        }
        // quem entra abre conexão com todos que já estavam na sala
        m.peers.forEach((p) => { if (p.id !== N.me.id && !conns.has(p.id)) makeConn(p, true); });
        break;
      case 'peers': if (mode === 'guest') N.me.slot = (m.peers.find((x) => x.id === N.me.id) || N.me).slot; N.peers = m.peers; N.room = m.room; conns.forEach((c) => { const p = m.peers.find((x) => x.id === c.id); if (p) { c.slot = p.slot; c.nick = p.nick; } }); changed(); break;
      case 'left': { const c = conns.get(m.id); if (c) gone(c); break; }
      case 'closed':
        { const was = N.active; leaveLocal(); setState(ws ? 'lobby' : 'idle'); if (was && N.ondrop) N.ondrop(m.reason); else if (N.onerror) N.onerror(m.reason); }
        break;
      case 'signal': onSignal(m.from, m.data); break;
    }
  }
  // Um jogador (ou o anfitrião) deixou de responder.
  function gone(c, why) {
    if (!conns.has(c.id) && !pending.has(c.id)) return;
    const wasHost = mode === 'guest' && (c.slot === 0 || c.id === 'host');
    closeConn(c); pending.delete(c.id);
    if (N.active) return drop(c.nick);
    if (mode === 'host') { hostRoom.members.delete(c.id); broadcastPeers(); }
    else if (wasHost) { leaveLocal(); mode = 'server'; setState('idle'); if (N.onerror) N.onerror('O anfitrião saiu da sala.'); }
    else if (why && N.onerror && mode === 'server') N.onerror(why);
  }
  function leaveLocal() { conns.forEach(closeConn); conns.clear(); clearInterval(statTimer); statTimer = null; N.room = null; N.peers = []; N.active = false; N.localReady = false; resetGame(); if (N.state === 'inroom' || N.state === 'playing') N.state = ws ? 'lobby' : 'idle'; }
  function drop(nick) { N.active = false; log((nick || 'Um jogador') + ' saiu: sincronismo encerrado.', 'err'); if (N.ondrop) N.ondrop((nick || 'Um jogador') + ' saiu da partida.'); }

  // ---------------- sala local (sem servidor): o anfitrião faz o papel do servidor ----------------
  function publishRoom() {
    N.room = { id: hostRoom.id, name: hostRoom.name, max: hostRoom.max, players: hostRoom.members.size, started: hostRoom.started };
    N.peers = [...hostRoom.members.values()].map((m) => ({ id: m.id, slot: m.slot, nick: m.nick, ready: m.ready }));
    changed();
  }
  function broadcastPeers() { publishRoom(); conns.forEach((c) => { if (c.open && c.member) sendJson(c, { t: 'peers', peers: N.peers, room: N.room }); }); }
  N.createLocalRoom = function (nick, max) {
    N.disconnect(); mode = 'host'; pending.clear(); resetGame(); N.localReady = false;
    const id = uid(); N.me = { id, slot: 0, nick };
    hostRoom = { id: uid(), name: 'Sala de ' + nick, max: Math.max(2, Math.min(MAXP, max || 2)), started: false, members: new Map([[id, { id, slot: 0, nick, ready: false }]]) };
    publishRoom(); setState('inroom');
  };
  function freeSlot() {
    const used = new Set([...hostRoom.members.values()].map((m) => m.slot)); pending.forEach((c) => used.add(c.slot));
    for (let s = 0; s < hostRoom.max; s++) if (!used.has(s)) return s; return -1;
  }
  // Anfitrião: gera um convite (código) para o próximo jogador; depois cole a resposta dele em acceptGuest().
  N.invite = async function () {
    if (mode !== 'host' || hostRoom.started) throw new Error('Não é possível convidar agora.');
    const slot = freeSlot(); if (slot < 0) throw new Error('A sala está cheia.');
    const id = uid(), c = makeManualConn({ id, slot, nick: 'Convidado' }, true); pending.set(id, c);
    await c.pc.setLocalDescription(await c.pc.createOffer()); await gathered(c.pc);
    return { id, slot, code: await pack(c.pc.localDescription) };
  };
  N.acceptGuest = async function (id, code) {
    const c = pending.get(id); if (!c) throw new Error('Convite expirado: gere outro.');
    await c.pc.setRemoteDescription(await unpack(code));
  };
  N.cancelInvite = function (id) { const c = pending.get(id); if (c) { pending.delete(id); closeConn(c); } };
  // Convidado: recebe o código do anfitrião e devolve o código de resposta.
  N.joinLocal = async function (offerCode, nick) {
    N.disconnect(); mode = 'guest'; resetGame(); N.localReady = false; N.me = { id: 'me', slot: -1, nick };
    const c = makeManualConn({ id: 'host', slot: 0, nick: 'Anfitrião' }, false);
    await c.pc.setRemoteDescription(await unpack(offerCode));
    await c.pc.setLocalDescription(await c.pc.createAnswer()); await gathered(c.pc);
    return pack(c.pc.localDescription);
  };
  // Anfitrião: trata as mensagens dos convidados (c = conexão do convidado; null = o próprio anfitrião).
  function hostHandle(c, m) {
    if (m.t === 'hello' && c && !c.member) {
      if (hostRoom.started || hostRoom.members.size >= hostRoom.max) { sendJson(c, { t: 'closed', reason: 'A sala não aceita mais jogadores.' }); return; }
      c.member = true; c.nick = String(m.nick || 'Jogador').slice(0, 20); pending.delete(c.id);
      hostRoom.members.set(c.id, { id: c.id, slot: c.slot, nick: c.nick, ready: false });
      publishRoom(); sendJson(c, { t: 'joined', you: { id: c.id, slot: c.slot }, room: N.room, peers: N.peers }); broadcastPeers();
    } else if (m.t === 'ready') {
      const mem = hostRoom.members.get(c ? c.id : N.me.id); if (mem) { mem.ready = !!m.value; broadcastPeers(); }
    } else if (m.t === 'signal' && c) {                       // retransmite a sinalização entre dois convidados
      const to = conns.get(m.to); if (to && to.member) sendJson(to, { t: 'signal', from: c.id, data: m.data });
    }
  }

  // ---------------- conexões WebRTC (malha) ----------------
  function makeConn(p, initiator) {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const c = { id: p.id, slot: p.slot, nick: p.nick, pc, chIn: null, chCtl: null, open: false, rtt: [], pendingIce: [], pingTimer: null, remoteSet: false };
    conns.set(p.id, c);
    pc.onicecandidate = (e) => { if (e.candidate) out({ t: 'signal', to: c.id, data: { ice: e.candidate } }); };
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed'].includes(pc.connectionState)) gone(c, 'Falha na conexão com ' + c.nick + ' (rede restrita? pode ser preciso um servidor TURN).');
    };
    if (initiator) {
      bindChannel(c, pc.createDataChannel('in', { ordered: false, maxRetransmits: 0 }));
      bindChannel(c, pc.createDataChannel('ctl', { ordered: true }));
      pc.createOffer().then((o) => pc.setLocalDescription(o)).then(() => out({ t: 'signal', to: c.id, data: { sdp: pc.localDescription } }));
    } else pc.ondatachannel = (e) => bindChannel(c, e.channel);
    return c;
  }
  // Conexão sem servidor: o código já leva os candidatos ICE (não há "trickle").
  function makeManualConn(p, initiator) {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const c = { id: p.id, slot: p.slot, nick: p.nick, pc, chIn: null, chCtl: null, open: false, rtt: [], pendingIce: [], pingTimer: null, remoteSet: false };
    conns.set(p.id, c);
    pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) gone(c, 'Falha na conexão com ' + c.nick + '.'); };
    if (initiator) { bindChannel(c, pc.createDataChannel('in', { ordered: false, maxRetransmits: 0 })); bindChannel(c, pc.createDataChannel('ctl', { ordered: true })); }
    else pc.ondatachannel = (e) => bindChannel(c, e.channel);
    return c;
  }
  function gathered(p) {
    return new Promise((res) => {
      if (p.iceGatheringState === 'complete') return res();
      const done = () => { p.removeEventListener('icegatheringstatechange', chk); res(); };
      const chk = () => { if (p.iceGatheringState === 'complete') done(); };
      p.addEventListener('icegatheringstatechange', chk); setTimeout(done, 5000);
    });
  }
  // códigos de sinalização (JSON → deflate → base64url)
  async function pack(desc) {
    const raw = new TextEncoder().encode(JSON.stringify({ t: desc.type, s: desc.sdp }));
    const cs = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const buf = new Uint8Array(await new Response(cs).arrayBuffer()); let b = ''; buf.forEach((x) => (b += String.fromCharCode(x)));
    return btoa(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  async function unpack(code) {
    const b = atob(code.trim().replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')), buf = Uint8Array.from(b, (x) => x.charCodeAt(0));
    const ds = new Blob([buf]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const o = JSON.parse(new TextDecoder().decode(await new Response(ds).arrayBuffer())); return { type: o.t, sdp: o.s };
  }
  function bindChannel(c, ch) {
    ch.binaryType = 'arraybuffer';
    if (ch.label === 'in') { c.chIn = ch; ch.onmessage = (e) => onUnreliable(c, new DataView(e.data)); }
    else { c.chCtl = ch; ch.onmessage = (e) => onControl(c, new DataView(e.data)); }
    ch.onopen = () => checkOpen(c);
    ch.onclose = () => { if (c.open) gone(c); };
    checkOpen(c);
  }
  function checkOpen(c) {
    if (c.open || !c.chIn || !c.chCtl || c.chIn.readyState !== 'open' || c.chCtl.readyState !== 'open') return;
    c.open = true; log('Conectado a ' + c.nick + '.');
    if (mode === 'guest' && c.id === 'host') sendJson(c, { t: 'hello', nick: N.me.nick });
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
        out({ t: 'signal', to: from, data: { sdp: c.pc.localDescription } });
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
  function sendJson(c, obj) {
    if (!c.chCtl || c.chCtl.readyState !== 'open') return;
    const bytes = new TextEncoder().encode(JSON.stringify(obj)), m = new Uint8Array(4 + bytes.length);
    new DataView(m.buffer).setUint32(0, C.JSON); m.set(bytes, 4); c.chCtl.send(m.buffer);
  }
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
    if (mode === 'host') { hostRoom.started = true; broadcastPeers(); } else wsSend({ t: 'start' });
    eachConn((c) => sendC(c, C.GO, d, mask));
    begin(d, mask);
  };
  function begin(d, mask) {
    if (started) return; started = true;
    N.delay = N.stats.delay = d; N.mask = mask;
    for (let s = 0; s < MAXP; s++) if (mask >> s & 1) for (let t = 0; t < d; t++) inputs[s].set(t, 0);
    for (let t = 0; t < d; t++) sent.set(t, 0);
    lastT = d - 1; stallBy = [0, 0, 0, 0]; lastRaise = lastLower = performance.now();
    clearInterval(adaptTimer); adaptTimer = setInterval(adapt, 1000);
    N.tick = 0; submitted = -1; N.stalls = 0; N.desync = null; N.active = true; ticksWin = stallsWin = 0;
    updateRtt(); setState('playing');
    log('Partida online: ' + (remoteSlots().length + 1) + ' jogadores, ping máx. ' + N.stats.rtt + ' ms (±' + N.stats.jitter + '), atraso de entrada ' + d + ' quadros.');
    if (N.onstart) N.onstart();
  }

  // ---------------- lockstep (chamado pelo jogo) ----------------
  // Adaptação durante a partida: quem fica esperando um jogador pede a ele mais atraso; sem pedidos por um tempo, o atraso desce devagar.
  function adapt() {
    if (!N.active) return;
    const now = performance.now();
    remoteSlots().forEach((s) => {
      const n = stallBy[s]; stallBy[s] = 0;
      if (n >= 2) { const c = connBySlot(s); if (c) sendC(c, C.DELAY, n >= 20 ? 3 : n >= 8 ? 2 : 1, 0); }
    });
    if (N.delay > MIN_DELAY && now - lastRaise > 10000 && now - lastLower > 8000) { N.delay--; lastLower = now; }
  }
  N.beginFrame = function () { frameStart = performance.now(); };
  const haveAll = () => { for (const s of remoteSlots()) if (!inputs[s].has(N.tick)) return false; return true; };
  N.canTick = function () {
    if (!N.active) return 1;
    if (haveAll()) { stallSince = 0; return 1; }
    N.stalls++; stallsWin++;
    for (const s of remoteSlots()) if (!inputs[s].has(N.tick)) stallBy[s]++;
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
    const want = N.tick + N.delay, me = N.me.slot;
    // O atraso é só deste jogador: ele pode subir (preenche os quadros que faltam) ou descer (pula um envio) a qualquer momento.
    if (want > lastT) {
      const prev = lastT;
      for (let t = prev + 1; t <= want; t++) { inputs[me].set(t, value); sent.set(t, value); }
      lastT = want;
      const first = Math.max(0, Math.min(prev + 1, want - REDUNDANCY + 1)), count = Math.min(250, want - first + 1), m = new DataView(new ArrayBuffer(6 + 4 * count));
      m.setUint8(0, U.INPUT); m.setUint8(1, count); m.setUint32(2, first);
      for (let i = 0; i < count; i++) m.setUint32(6 + 4 * i, sent.get(first + i) >>> 0);
      eachConn((c) => sendU(c, m.buffer));
    } else {                                                           // atraso diminuiu: reenvia só a redundância
      const first = Math.max(0, lastT - REDUNDANCY + 1), count = lastT - first + 1, m = new DataView(new ArrayBuffer(6 + 4 * count));
      m.setUint8(0, U.INPUT); m.setUint8(1, count); m.setUint32(2, first);
      for (let i = 0; i < count; i++) m.setUint32(6 + 4 * i, sent.get(first + i) >>> 0);
      eachConn((c) => sendU(c, m.buffer));
    }
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
    const type = m.getUint32(0);
    if (type === C.JSON) {
      let o; try { o = JSON.parse(new TextDecoder().decode(new Uint8Array(m.buffer, m.byteOffset + 4, m.byteLength - 4))); } catch (e) { return; }
      return mode === 'host' ? hostHandle(c, o) : onServer(o);
    }
    const a = m.getUint32(4), b = m.getUint32(8);
    if (type === C.ASK) { const w = worstLocal(); sendC(c, C.REPORT, Math.round(w.rtt * 10), Math.round(w.jit * 10)); }
    else if (type === C.REPORT) reports.set(c.id, { rtt: a / 10, jit: b / 10 });
    else if (type === C.GO) begin(a, b);
    else if (type === C.HASH) { if (c.slot >= 0) { peerHash[c.slot].set(a, b); compareAll(a); } }
    else if (type === C.DELAY) { if (N.active) { N.delay = Math.min(MAX_DELAY, N.delay + a); lastRaise = performance.now(); log('Atraso de entrada ajustado para ' + N.delay + ' quadros.'); } }
    else if (type === C.NEED) { const vals = []; for (let t = a; t < a + 60 && sent.has(t); t++) vals.push(sent.get(t)); if (vals.length) sendC(c, C.BULK, a, vals.length, vals); }
    else if (type === C.BULK) { for (let i = 0; i < b; i++) putRemote(c.slot, a + i, m.getUint32(12 + 4 * i)); }
  }

  window.MK64Net = N;
})();
