/* game.js — liga a ROM validada ao jogo:  ROM → Torch (WASM) → mk64.o2r → SpaghettiKart (WASM).
 * Nenhum arquivo da Nintendo é enviado: a ROM é lida localmente e o mk64.o2r fica só no navegador (IndexedDB). */
(function () {
  'use strict';
  const GAME_DIR = 'game/';
  const log = (m, k) => (window.MK64Log || console.log)(m, k);
  const setText = (t) => { const e = document.getElementById('loadingText'); if (e) e.textContent = t; };
  const busy = (on, t) => { const e = document.getElementById('loading'); if (e) e.hidden = !on; if (t) setText(t); };
  const setStatus = (t, k) => {
    const s = document.getElementById('statusText'), d = document.getElementById('statusDot');
    if (s) s.textContent = t; if (d) d.className = 'dot dot-' + (k || 'idle');
  };
  const fail = (m) => { busy(false); const e = document.getElementById('loaderError'); if (e) { e.textContent = m; e.hidden = false; } log(m, 'err'); setStatus('Erro', 'err'); };

  // --- cache do mk64.o2r (derivado da ROM; fica apenas neste navegador) ---
  const idb = (mode, fn) => new Promise((res, rej) => {
    try {
      const o = indexedDB.open('mk64web', 1);
      o.onupgradeneeded = () => o.result.createObjectStore('kv');
      o.onerror = () => rej(o.error);
      o.onsuccess = () => { const tx = o.result.transaction('kv', mode); const r = fn(tx.objectStore('kv')); tx.oncomplete = () => res(r && r.result); tx.onerror = () => rej(tx.error); };
    } catch (e) { rej(e); }
  });
  const cacheGet = (k) => idb('readonly', (s) => s.get(k)).catch(() => null);
  const cachePut = (k, v) => idb('readwrite', (s) => s.put(v, k)).catch(() => null);

  // --- extração com Torch ---
  async function extract(rom) {
    setText('Carregando extrator…');
    const createModule = (await import('./' + GAME_DIR + 'torch.js')).default;
    const m = await createModule({ print: () => {}, printErr: () => {} });
    const FS = m.FS;
    const files = await (await fetch(GAME_DIR + 'torch-assets.json')).json();
    for (const p of Object.keys(files)) {
      const parts = ('/sk/' + p).split('/').slice(0, -1); let c = '';
      parts.forEach((s) => { if (!s) return; c += '/' + s; try { FS.mkdir(c); } catch (e) { /* existe */ } });
      FS.writeFile('/sk/' + p, files[p]);
    }
    setText('Extraindo assets da ROM… (primeira vez: pode levar cerca de um minuto)');
    await new Promise((r) => setTimeout(r, 30));
    FS.writeFile('/rom.z64', rom);
    try {
      const t1 = performance.now();
      const c = m.CreateFromFile('/rom.z64', m.ArchiveType.O2R, false, false, '/sk', '/out');
      m.Bind(c);
      c.SetAdditionalFile('meta/mods.toml');
      c.Init(m.ExportType.Binary);
      c.Process();
      log('Torch: Process() em ' + Math.round(performance.now() - t1) + ' ms');
    } catch (e) {
      let msg = ''; try { msg = m.getExceptionMessage(e).join(' ') } catch (x) { msg = String(e && e.message || e); }
      throw new Error('Torch: ' + msg);
    }
    return FS.readFile('/out/mk64.o2r');
  }

  // --- inicia o jogo ---
  function launch(mk64) {
    return fetch(GAME_DIR + 'spaghetti.o2r').then((r) => r.arrayBuffer()).then((sp) => {
      const canvas = document.getElementById('canvas');
      canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); fail('O contexto WebGL foi perdido. Recarregue a página.'); });
      window.Module = {
        mk64Files: [], // os .o2r são gravados abaixo (prerun.js não precisa buscá-los)
        canvas,
        locateFile: (n) => GAME_DIR + n,
        print: (t) => log(t), printErr: (t) => log(t),
        preRun: [() => {
          // Persistência: config e saves em /save (IndexedDB). Carrega antes do main() e grava periodicamente.
          const FS = Module.FS;
          try {
            FS.mkdir('/save');
            FS.mount(FS.filesystems.IDBFS, {}, '/save');
            Module.addRunDependency('idbfs');
            FS.syncfs(true, (err) => {
              if (err) log('IDBFS: ' + err, 'warn');
              // O jogo procura os .o2r no diretório de dados (SHIP_HOME=/save): links para os arquivos em memória.
              ['mk64.o2r', 'spaghetti.o2r'].forEach((n) => { try { FS.unlink('/save/' + n); } catch (e) { /* não existia */ } FS.symlink('/' + n, '/save/' + n); });
              Module.removeRunDependency('idbfs');
            });
            let busy = false;
            const flush = () => { if (busy) return; busy = true; FS.syncfs(false, (e) => { busy = false; if (e) log('IDBFS: ' + e, 'warn'); }); };
            setInterval(flush, 5000);
            document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
            window.addEventListener('pagehide', flush);
          } catch (e) { log('Persistência indisponível: ' + e, 'warn'); }
          Module.FS.writeFile('/mk64.o2r', mk64);
          Module.FS.writeFile('/spaghetti.o2r', new Uint8Array(sp));
        }],
        onAbort: (w) => fail('O jogo parou: ' + w),
      };
      const s = document.createElement('script');
      s.src = GAME_DIR + 'spaghetti_web.js';
      s.onerror = () => fail('Não foi possível carregar o jogo (' + s.src + ').');
      document.body.appendChild(s);
      busy(false); setStatus('Jogando', 'ok');
      document.getElementById('screen').classList.add('playing');
      canvas.focus();
    });
  }

  // Assets prontos: jogar sozinho, ou esperar a conexão online (o jogo começa nos dois ao mesmo tempo).
  function prepared(mk64) {
    const N = window.MK64Net, box = document.getElementById('ready'), txt = document.getElementById('readyText');
    let launched = false;
    const go = (why) => { if (launched) return; launched = true; box.hidden = true; busy(true, 'Iniciando o jogo…'); launch(mk64).catch((e) => fail(String(e))); log(why, 'ok'); };
    const armNet = () => { if (N && N.state === 'connected') { txt.textContent = 'Assets prontos. Aguardando o outro jogador…'; N.setReady(); } };
    box.hidden = false; setStatus('Pronto', 'ok');
    document.getElementById('btnSolo').onclick = () => go('Modo solo.');
    if (N) {
      N.onstart = () => go('Partida online começando.');
      document.addEventListener('mk64:net-state', armNet);
    }
    armNet();
  }

  async function onRom(ev) {
    const rom = ev.detail.rom, sha = ev.detail.sha1 || 'sem-sha';
    if (!window.crossOriginIsolated) return fail('Faltam cabeçalhos COOP/COEP (necessários para threads). Recarregue a página; se persistir, use HTTPS.');
    busy(true, 'Verificando cache…'); setStatus('Preparando', 'idle');
    try {
      let mk64 = null;
      const cached = await cacheGet('mk64.o2r');
      if (cached && cached.sha1 === sha) { mk64 = cached.data; log('mk64.o2r obtido do cache local.', 'ok'); }
      if (!mk64) {
        const t0 = performance.now();
        mk64 = await extract(rom);
        log('Assets extraídos em ' + Math.round(performance.now() - t0) + ' ms (' + (mk64.length / 1048576).toFixed(1) + ' MiB).', 'ok');
        cachePut('mk64.o2r', { sha1: sha, data: mk64 });
      }
      busy(false);
      prepared(mk64);
    } catch (e) { fail('Falha ao preparar o jogo: ' + (e && e.message || e)); }
  }

  window.addEventListener('mk64:rom-ready', onRom);
  window.addEventListener('mk64:rom-reset', () => location.reload());
})();
