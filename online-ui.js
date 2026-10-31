/* online-ui.js — painel "Online": criar sala / entrar com códigos copiar-e-colar. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const N = window.MK64Net;
  if (!N || !window.RTCPeerConnection) { const s = $('netStatus'); if (s) s.textContent = 'Este navegador não suporta WebRTC.'; return; }
  const status = (t) => { $('netStatus').textContent = t; };
  const show = (id, on) => { $(id).hidden = !on; };
  const guard = (fn) => async () => { try { await fn(); } catch (e) { status('Erro: ' + (e && e.message || e)); } };

  $('btnHost').addEventListener('click', guard(async () => {
    status('Gerando código…'); show('fieldTheirs', false);
    $('lblMine').textContent = '1) Envie este código ao outro jogador';
    $('codeMine').value = await N.host(); show('fieldMine', true);
    $('lblTheirs').textContent = '2) Cole aqui o código que ele devolver'; $('btnApply').textContent = 'Conectar';
    $('btnApply').dataset.mode = 'host'; $('codeTheirs').value = ''; show('fieldTheirs', true);
    status('Aguardando o código de resposta.');
  }));
  $('btnJoin').addEventListener('click', () => {
    show('fieldMine', false);
    $('lblTheirs').textContent = '1) Cole aqui o código do anfitrião'; $('btnApply').textContent = 'Gerar resposta';
    $('btnApply').dataset.mode = 'guest'; $('codeTheirs').value = ''; show('fieldTheirs', true);
    status('Cole o código recebido do anfitrião.');
  });
  $('btnApply').addEventListener('click', guard(async () => {
    const code = $('codeTheirs').value.trim(); if (!code) return status('Cole o código primeiro.');
    if ($('btnApply').dataset.mode === 'host') { await N.acceptAnswer(code); status('Conectando…'); }
    else {
      status('Gerando resposta…');
      $('codeMine').value = await N.join(code); $('lblMine').textContent = '2) Envie este código de volta ao anfitrião';
      show('fieldMine', true); show('fieldTheirs', false); status('Aguardando o anfitrião conectar.');
    }
  }));
  $('btnCopy').addEventListener('click', () => {
    const t = $('codeMine'); t.select();
    (navigator.clipboard ? navigator.clipboard.writeText(t.value) : Promise.reject()).catch(() => document.execCommand('copy'));
    $('btnCopy').textContent = 'Copiado!'; setTimeout(() => ($('btnCopy').textContent = 'Copiar código'), 1500);
  });

  N.onstate = (s, note) => {
    if (s === 'connected') { status('Conectado! ' + (N.role === 'host' ? 'Você é o jogador 1.' : 'Você é o jogador 2.') + ' O jogo começa quando os dois estiverem com os assets prontos.'); show('fieldMine', false); show('fieldTheirs', false); }
    else if (s === 'closed') status('Conexão encerrada.');
    else if (s === 'desync') status('⚠ Os jogos dessincronizaram (' + note + '). Recarregue e reconecte.');
    document.dispatchEvent(new CustomEvent('mk64:net-state', { detail: s }));
  };
})();
