/* netplay.js — multiplayer P2P por WebRTC com sincronização "lockstep".
 *
 * Cada navegador roda o jogo inteiro; só os comandos dos controles trafegam (DataChannel).
 * Anfitrião = jogador 1 (porta 0), convidado = jogador 2 (porta 1). Cada quadro lógico só avança quando o
 * comando do outro jogador para aquele quadro chegou; o comando local é aplicado com atraso fixo (DELAY quadros).
 * Sinalização sem servidor: os dois trocam códigos (oferta/resposta) copiando e colando.
 * A cada HASH_EVERY quadros trocam um hash do estado do jogo para detectar dessincronização.
 *
 * API usada pelo jogo (src/web/webnet.c): active, canTick(), submit(valor, hash), get(slot), tickDone().
 * Valor empacotado igual ao input.js: botões (16 bits) | stick_x << 16 | stick_y << 24.
 */
(function () {
  'use strict';
  const DELAY = 4, HASH_EVERY = 60;
  const MSG = { INPUT: 1, HASH: 2, READY: 3 };
  const ICE = [{ urls: 'stun:stun.l.google.com:19302' }];
  const log = (m, k) => (window.MK64Log || console.log)('[online] ' + m, k);

  const N = {
    state: 'idle',      // idle | waiting | connecting | connected | closed
    role: null,         // 'host' | 'guest'
    active: false,      // lockstep em andamento (jogo iniciado em modo online)
    tick: 0, stalls: 0, desync: null,
    onstate: null, onstart: null,
  };
  let pc = null, dc = null, localReady = false, peerReady = false, started = false;
  let inputs = [new Map(), new Map()], myHash = new Map(), peerHash = new Map(), submitted = -1;
  const slotLocal = () => (N.role === 'host' ? 0 : 1);

  function setState(s, note) { N.state = s; if (note) log(note); if (N.onstate) N.onstate(s, note); }

  // --- códigos de sinalização (JSON → deflate → base64url) ---
  async function pack(desc) {
    const raw = new TextEncoder().encode(JSON.stringify({ t: desc.type, s: desc.sdp }));
    const cs = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const buf = new Uint8Array(await new Response(cs).arrayBuffer());
    let b = ''; buf.forEach((c) => (b += String.fromCharCode(c)));
    return btoa(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  async function unpack(code) {
    const b = atob(code.trim().replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/'));
    const buf = Uint8Array.from(b, (c) => c.charCodeAt(0));
    const ds = new Blob([buf]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const o = JSON.parse(new TextDecoder().decode(await new Response(ds).arrayBuffer()));
    return { type: o.t, sdp: o.s };
  }
  function gathered(p) {
    return new Promise((res) => {
      if (p.iceGatheringState === 'complete') return res();
      const done = () => { p.removeEventListener('icegatheringstatechange', chk); res(); };
      const chk = () => { if (p.iceGatheringState === 'complete') done(); };
      p.addEventListener('icegatheringstatechange', chk);
      setTimeout(done, 5000);
    });
  }

  function newPeer() {
    close();
    pc = new RTCPeerConnection({ iceServers: ICE });
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
        if (N.state !== 'closed') { N.active = false; setState('closed', 'Conexão encerrada (' + pc.connectionState + ').'); }
      }
    };
  }
  function bindChannel(ch) {
    dc = ch; dc.binaryType = 'arraybuffer';
    dc.onopen = () => setState('connected', 'Conectado ao outro jogador (' + (N.role === 'host' ? 'você é o jogador 1' : 'você é o jogador 2') + ').');
    dc.onclose = () => { N.active = false; if (N.state !== 'closed') setState('closed', 'Canal fechado.'); };
    dc.onmessage = (e) => onMessage(new DataView(e.data));
  }

  // --- API de conexão ---
  N.host = async function () {
    newPeer(); N.role = 'host';
    bindChannel(pc.createDataChannel('mk64', { ordered: true }));
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc); setState('waiting', 'Sala criada: envie o código ao outro jogador.');
    return pack(pc.localDescription);
  };
  N.acceptAnswer = async function (code) {
    await pc.setRemoteDescription(await unpack(code)); setState('connecting', 'Conectando…');
  };
  N.join = async function (offerCode) {
    newPeer(); N.role = 'guest';
    pc.ondatachannel = (e) => bindChannel(e.channel);
    await pc.setRemoteDescription(await unpack(offerCode));
    await pc.setLocalDescription(await pc.createAnswer());
    await gathered(pc); setState('connecting', 'Resposta gerada: envie ao anfitrião e aguarde.');
    return pack(pc.localDescription);
  };
  function close() { try { dc && dc.close(); pc && pc.close(); } catch (e) { /* ok */ } dc = pc = null; }
  N.close = function () { N.active = false; close(); setState('closed'); };

  // --- sincronismo de partida: os dois precisam estar com os assets prontos ---
  function send(type, a, b) {
    if (!dc || dc.readyState !== 'open') return;
    const m = new DataView(new ArrayBuffer(12));
    m.setUint32(0, type); m.setUint32(4, a >>> 0); m.setUint32(8, b >>> 0);
    dc.send(m.buffer);
  }
  N.setReady = function () { localReady = true; send(MSG.READY, 0, 0); maybeStart(); };
  function maybeStart() {
    if (started || !localReady || !peerReady) return;
    started = true; N.begin(); if (N.onstart) N.onstart();
  }

  // --- lockstep ---
  N.begin = function () {
    inputs = [new Map(), new Map()]; myHash.clear(); peerHash.clear();
    for (let t = 0; t < DELAY; t++) { inputs[0].set(t, 0); inputs[1].set(t, 0); }
    N.tick = 0; submitted = -1; N.stalls = 0; N.desync = null; N.active = true;
    log('Partida online iniciada (atraso de ' + DELAY + ' quadros).');
  };
  N.canTick = function () {
    if (!N.active) return 1;
    if (inputs[1 - slotLocal()].has(N.tick)) return 1;
    N.stalls++; return 0;
  };
  N.submit = function (value, hash) {
    if (!N.active || submitted >= N.tick) return;
    submitted = N.tick;
    const t = N.tick + DELAY;
    inputs[slotLocal()].set(t, value);
    send(MSG.INPUT, t, value);
    if (N.tick % HASH_EVERY === 0) {
      myHash.set(N.tick, hash); send(MSG.HASH, N.tick, hash); compare(N.tick);
    }
  };
  N.get = function (slot) { return slot < 2 ? (inputs[slot].get(N.tick) || 0) : 0; };
  N.tickDone = function () {
    if (!N.active) return;
    inputs[0].delete(N.tick - 2); inputs[1].delete(N.tick - 2);
    N.tick++;
  };
  function compare(t) {
    if (!myHash.has(t) || !peerHash.has(t)) return;
    if (myHash.get(t) !== peerHash.get(t) && !N.desync) {
      N.desync = t; log('DESSINCRONIZAÇÃO no quadro ' + t + ' (hash local ' + myHash.get(t).toString(16) + ' ≠ remoto ' + peerHash.get(t).toString(16) + ').', 'err');
      if (N.onstate) N.onstate('desync', 'Dessincronizado no quadro ' + t);
    }
    myHash.delete(t); peerHash.delete(t);
  }
  function onMessage(m) {
    const type = m.getUint32(0), a = m.getUint32(4), b = m.getUint32(8);
    if (type === MSG.INPUT) inputs[1 - slotLocal()].set(a, b);
    else if (type === MSG.HASH) { peerHash.set(a, b); compare(a); }
    else if (type === MSG.READY) { peerReady = true; maybeStart(); }
  }

  window.MK64Net = N;
})();
