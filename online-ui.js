/* online-ui.js — painel "Online": salas sem servidor (convite por código, 2 a 4 jogadores) + servidor de salas opcional. */
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
  const copy = (id, btn) => { const t = $(id); t.select(); try { navigator.clipboard.writeText(t.value); } catch (e) { document.execCommand('copy'); } btn.textContent = 'Copiado ✔'; setTimeout(() => { btn.textContent = 'Copiar'; }, 1500); };
  const busy = async (btn, fn) => { btn.disabled = true; try { await fn(); } catch (e) { status('Erro: ' + (e && e.message || e)); } btn.disabled = false; };
  let inviteId = null;
  $('btnHost').addEventListener('click', () => { store.set('mk64.nick', nick()); $('joinBox').hidden = true; N.createLocalRoom(nick(), +$('rmMax').value); });
  $('btnJoin').addEventListener('click', () => { $('joinBox').hidden = !$('joinBox').hidden; });
  $('btnJoinGo').addEventListener('click', () => busy($('btnJoinGo'), async () => {
    const code = $('joinOffer').value.trim(); if (!code) return status('Cole o código do anfitrião.');
    store.set('mk64.nick', nick()); status('Gerando resposta…');
    $('joinAnswer').value = await N.joinLocal(code, nick()); show('joinAnswerBox', true);
    status('Envie sua resposta ao anfitrião e aguarde.');
  }));
  $('btnCopyAnswer').addEventListener('click', (e) => copy('joinAnswer', e.target));
  $('btnCopyInvite').addEventListener('click', (e) => copy('inviteCode', e.target));
  $('btnInvite').addEventListener('click', () => busy($('btnInvite'), async () => {
    if (inviteId) N.cancelInvite(inviteId);
    status('Gerando convite…'); const r = await N.invite(); inviteId = r.id;
    $('inviteCode').value = r.code; $('inviteAnswer').value = ''; show('inviteStep', true);
    status('Envie o código ao amigo e cole a resposta dele abaixo.');
  }));
  $('btnAccept').addEventListener('click', () => busy($('btnAccept'), async () => {
    const code = $('inviteAnswer').value.trim(); if (!code || !inviteId) return status('Cole a resposta do amigo.');
    await N.acceptGuest(inviteId, code); status('Conectando…');
  }));
  $('btnDisconnect').addEventListener('click', () => { N.disconnect(); status('Desconectado.'); });
  $('btnRefresh').addEventListener('click', () => N.refresh());
  $('btnCreate').addEventListener('click', () => {
    const name = $('rmName').value.trim(); if (!name) return status('Dê um nome à sala.');
    N.createRoom(name, $('rmPass').value, +$('rmMax').value, nick());
  });
  $('btnLeave').addEventListener('click', () => { N.leaveRoom(); inviteId = null; show('inviteStep', false); show('joinAnswerBox', false); status('Você saiu da sala.'); });
  $('btnStart').addEventListener('click', () => { $('btnStart').disabled = true; N.start(); });
  $('roomList').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-id]'); if (!b) return;
    const pass = b.dataset.locked === '1' ? (window.prompt('Senha da sala:') || '') : '';
    if (b.dataset.locked === '1' && !pass) return;
    N.joinRoom(b.dataset.id, pass, nick());
  });

  function render() {
    const inRoom = N.state === 'inroom' || N.state === 'playing', inServer = N.state === 'lobby';
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
      const full = N.room && N.peers.length >= N.room.max;
      show('inviteBox', host && N.state === 'inroom' && !full);
      if (inviteId && N.peers.length && !host === false && N.peers.some((p) => p.id === inviteId)) { inviteId = null; show('inviteStep', false); }
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
