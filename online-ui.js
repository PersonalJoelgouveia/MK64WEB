/* online-ui.js — painel "Online": servidor de salas, lista de salas (senha opcional), sala/lobby de 2 a 4 jogadores. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const N = window.MK64Net;
  if (!N || !window.RTCPeerConnection || !window.WebSocket) { const s = $('netStatus'); if (s) s.textContent = 'Este navegador não suporta WebRTC.'; return; }
  const store = { get: (k) => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ok */ } } };
  const status = (t) => { $('netStatus').textContent = t; };
  const show = (id, on) => { $(id).hidden = !on; };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nick = () => ($('nick').value.trim() || 'Jogador').slice(0, 20);

  $('srvUrl').value = store.get('mk64.server') || (window.MK64_CONFIG && window.MK64_CONFIG.signalUrl) || '';
  $('srvToken').value = store.get('mk64.token');
  $('nick').value = store.get('mk64.nick');

  $('btnConnect').addEventListener('click', async () => {
    const url = $('srvUrl').value.trim(); if (!url) return status('Informe o endereço do servidor (wss://…).');
    store.set('mk64.server', url); store.set('mk64.token', $('srvToken').value); store.set('mk64.nick', nick());
    status('Conectando ao servidor…'); $('btnConnect').disabled = true;
    try { await N.connect(url, $('srvToken').value, nick()); status('Escolha uma sala ou crie a sua.'); }
    catch (e) { status('Erro: ' + e.message); }
    $('btnConnect').disabled = false;
  });
  $('btnDisconnect').addEventListener('click', () => { N.disconnect(); status('Desconectado.'); });
  $('btnRefresh').addEventListener('click', () => N.refresh());
  $('btnCreate').addEventListener('click', () => {
    const name = $('rmName').value.trim(); if (!name) return status('Dê um nome à sala.');
    N.createRoom(name, $('rmPass').value, +$('rmMax').value, nick());
  });
  $('btnLeave').addEventListener('click', () => { N.leaveRoom(); status('Você saiu da sala.'); });
  $('btnStart').addEventListener('click', () => { $('btnStart').disabled = true; N.start(); });
  $('roomList').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-id]'); if (!b) return;
    const pass = b.dataset.locked === '1' ? (window.prompt('Senha da sala:') || '') : '';
    if (b.dataset.locked === '1' && !pass) return;
    N.joinRoom(b.dataset.id, pass, nick());
  });

  function render() {
    const inServer = N.state !== 'idle' && N.state !== 'connecting', inRoom = N.state === 'inroom' || N.state === 'playing';
    show('viewServer', !inServer); show('viewLobby', inServer && !inRoom); show('viewRoom', inRoom);
    if (inServer && !inRoom) {
      const l = $('roomList');
      l.innerHTML = N.rooms.length ? N.rooms.map((r) =>
        '<li><span>' + (r.locked ? '🔒 ' : '') + esc(r.name) + '<br><span class="meta">' + r.players + '/' + r.max + ' jogadores</span></span>' +
        '<button class="btn" type="button" data-id="' + esc(r.id) + '" data-locked="' + (r.locked ? 1 : 0) + '"' + (r.players >= r.max ? ' disabled' : '') + '>Entrar</button></li>'
      ).join('') : '<li class="empty">Nenhuma sala aberta. Crie a sua!</li>';
    }
    if (inRoom) {
      $('roomTitle').textContent = N.room ? N.room.name + ' · ' + N.peers.length + '/' + N.room.max + ' jogadores' : '';
      $('playerList').innerHTML = N.peers.map((p) => {
        const c = p.id === (N.me && N.me.id);
        return '<li><span>J' + (p.slot + 1) + ' · ' + esc(p.nick) + (c ? ' (você)' : '') + (p.slot === 0 ? ' · anfitrião' : '') + '</span>' +
               '<span class="' + (p.ready ? 'ok' : 'meta') + '">' + (p.ready ? '✔ pronto' : 'carregando…') + '</span></li>';
      }).join('');
      const host = N.me && N.me.slot === 0;
      show('btnStart', host && N.state === 'inroom');
      $('btnStart').disabled = !N.canStart();
      if (N.state === 'inroom') {
        status(host ? (N.canStart() ? 'Todos prontos: clique em "Iniciar partida".' : 'Aguardando todos ficarem prontos (carregue sua ROM e espere os assets).')
                    : 'Aguardando o anfitrião iniciar a partida.');
      } else status('Partida em andamento.');
    }
  }
  N.onchange = render;
  N.onerror = (m) => { status(m); render(); };
  N.ondesync = (t) => status('⚠ Os jogos dessincronizaram (quadro ' + t + '). Recarregue e crie a sala de novo.');
  N.ondrop = (m) => status('⚠ ' + m + ' A partida online terminou; recarregue a página para jogar de novo.');

  setInterval(() => {
    const e = $('netStats'); if (!e) return;
    if (!N.active) { e.textContent = ''; return; }
    const t = N.stats;
    e.textContent = 'Ping ' + t.rtt + ' ms (±' + t.jitter + ') · atraso ' + t.delay + ' quadros · ' + t.tps + ' quadros/s · ' + t.stallsPerSec + ' esperas/s';
  }, 1000);
  render();
})();
