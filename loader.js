/* MK64 Web — loader.js
 * 1) Lê a ROM escolhida pelo usuário (100% local, nada é enviado).
 * 2) Detecta o formato (z64 / v64 / n64) e normaliza para big-endian (.z64).
 * 3) Valida o Game ID do cabeçalho (NKTE, NKTP, NKTJ).
 * 4) Expõe a ROM normalizada para o módulo WASM via evento "mk64:rom-ready".
 * 5) Gerencia entrada (teclado + controles virtuais) em window.MK64Input.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constantes
  // ---------------------------------------------------------------------------
  const VALID_IDS = {
    NKTE: 'América do Norte (NTSC-U)',
    NKTP: 'Europa (PAL)',
    NKTJ: 'Japão (NTSC-J)',
  };
  const ROM_SIZE = 12 * 1024 * 1024; // Mario Kart 64 = 12 MiB (96 Mbit)
  const HEADER_SIZE = 0x40;
  const ID_OFFSET = 0x3B;            // 'N' + 'KT' + região (4 bytes)

  // Primeiros 4 bytes definem a ordem dos bytes
  const MAGIC = {
    z64: [0x80, 0x37, 0x12, 0x40], // big-endian (nativo)
    v64: [0x37, 0x80, 0x40, 0x12], // byte-swapped (pares trocados)
    n64: [0x40, 0x12, 0x37, 0x80], // little-endian (words invertidas)
  };

  // ---------------------------------------------------------------------------
  // Utilidades de UI
  // ---------------------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const el = {
    input: $('romInput'),
    dropzone: $('dropzone'),
    loader: $('loader'),
    loading: $('loading'),
    loadingText: $('loadingText'),
    error: $('loaderError'),
    statusDot: $('statusDot'),
    statusText: $('statusText'),
    romInfo: $('romInfo'),
    log: $('log'),
    canvas: $('canvas'),
    screen: $('screen'),
    btnReset: $('btnReset'),
    btnFullscreen: $('btnFullscreen'),
  };

  function log(msg, kind) {
    const line = document.createElement('div');
    if (kind) line.className = kind;
    line.textContent = '> ' + msg;
    el.log.appendChild(line);
    el.log.scrollTop = el.log.scrollHeight;
    const fn = kind === 'err' ? console.error : kind === 'warn' ? console.warn : console.log;
    fn('[MK64]', msg);
  }

  function setStatus(text, state) {
    el.statusText.textContent = text;
    el.statusDot.className = 'dot dot-' + (state || 'idle');
  }

  function showError(msg) {
    el.error.textContent = msg;
    el.error.hidden = false;
    setStatus('ROM inválida', 'err');
    log(msg, 'err');
  }

  function clearError() {
    el.error.hidden = true;
    el.error.textContent = '';
  }

  function setBusy(busy, text) {
    el.loading.hidden = !busy;
    if (text) el.loadingText.textContent = text;
  }

  // ---------------------------------------------------------------------------
  // Parsing / validação da ROM
  // ---------------------------------------------------------------------------
  function detectFormat(bytes) {
    for (const [fmt, sig] of Object.entries(MAGIC)) {
      if (sig.every((b, i) => bytes[i] === b)) return fmt;
    }
    return null;
  }

  /** Converte in-place qualquer formato para big-endian (.z64). */
  function normalizeToZ64(bytes, fmt) {
    const len = bytes.length - (bytes.length % 4);
    if (fmt === 'v64') {
      for (let i = 0; i < len; i += 2) {
        const t = bytes[i]; bytes[i] = bytes[i + 1]; bytes[i + 1] = t;
      }
    } else if (fmt === 'n64') {
      for (let i = 0; i < len; i += 4) {
        let t = bytes[i]; bytes[i] = bytes[i + 3]; bytes[i + 3] = t;
        t = bytes[i + 1]; bytes[i + 1] = bytes[i + 2]; bytes[i + 2] = t;
      }
    }
    return bytes;
  }

  function readAscii(bytes, offset, length) {
    let s = '';
    for (let i = 0; i < length; i++) s += String.fromCharCode(bytes[offset + i]);
    return s;
  }

  async function sha1Hex(buffer) {
    if (!(window.crypto && crypto.subtle)) return null;
    const hash = await crypto.subtle.digest('SHA-1', buffer);
    return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function formatBytes(n) {
    return (n / 1024 / 1024).toFixed(2) + ' MiB';
  }

  /**
   * Valida e normaliza uma ROM.
   * @returns {Promise<{ok:true, rom:Uint8Array, id:string, region:string, title:string, format:string, sha1:string|null}>}
   *          ou {ok:false, error:string}
   */
  async function validateRom(file) {
    if (!file) return { ok: false, error: 'Nenhum arquivo selecionado.' };
    if (file.size < HEADER_SIZE) return { ok: false, error: 'Arquivo pequeno demais para ser uma ROM de N64.' };
    if (file.size !== ROM_SIZE) {
      log('Tamanho incomum: ' + formatBytes(file.size) + ' (esperado ' + formatBytes(ROM_SIZE) + ').', 'warn');
    }

    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    const format = detectFormat(bytes);
    if (!format) {
      return { ok: false, error: 'Formato não reconhecido. Use uma ROM de N64 nos formatos .z64, .v64 ou .n64.' };
    }
    if (format !== 'z64') log('Formato ' + format + ' detectado; convertendo para .z64 (big-endian).');

    normalizeToZ64(bytes, format);

    const id = readAscii(bytes, ID_OFFSET, 4);
    const title = readAscii(bytes, 0x20, 20).replace(/[\0\s]+$/, '');

    if (!Object.prototype.hasOwnProperty.call(VALID_IDS, id)) {
      return {
        ok: false,
        error: 'Esta ROM não é Mario Kart 64 (ID "' + id.replace(/[^\x20-\x7E]/g, '?') +
               '"). IDs aceitos: ' + Object.keys(VALID_IDS).join(', ') + '.',
      };
    }

    const sha1 = await sha1Hex(bytes.buffer);
    return { ok: true, rom: bytes, id, region: VALID_IDS[id], title, format, sha1 };
  }

  // ---------------------------------------------------------------------------
  // Fluxo de carregamento
  // ---------------------------------------------------------------------------
  const state = { romInfo: null };

  async function handleFile(file) {
    clearError();
    setBusy(true, 'Validando ROM…');
    setStatus('Validando…', 'idle');
    log('Arquivo: ' + file.name + ' (' + formatBytes(file.size) + ')');

    let result;
    try {
      result = await validateRom(file);
    } catch (e) {
      result = { ok: false, error: 'Falha ao ler o arquivo: ' + (e && e.message ? e.message : e) };
    }
    setBusy(false);

    if (!result.ok) {
      showError(result.error);
      el.input.value = '';
      return;
    }

    state.romInfo = result;
    console.log('✅ ROM válida de Mario Kart 64 carregada com sucesso!', {
      id: result.id, regiao: result.region, titulo: result.title, formatoOriginal: result.format, sha1: result.sha1,
    });
    log('ROM válida de Mario Kart 64 (' + result.id + ' — ' + result.region + ').', 'ok');
    if (result.sha1) log('SHA-1 (.z64): ' + result.sha1);

    setStatus('ROM carregada · ' + result.id, 'ok');
    el.romInfo.textContent = result.id + ' · ' + result.region;
    el.loader.hidden = true;
    el.btnReset.disabled = false;

    // Entrega a ROM ao módulo WASM (a ser implementado na próxima etapa).
    // O módulo Emscripten pode escutar este evento ou ler window.MK64.rom.
    window.MK64 = Object.assign(window.MK64 || {}, {
      rom: result.rom, romId: result.id, romRegion: result.region, romSha1: result.sha1,
    });
    window.dispatchEvent(new CustomEvent('mk64:rom-ready', { detail: result }));
    log('Aguardando módulo WASM (ainda não implementado).', 'warn');
  }

  function resetRom() {
    state.romInfo = null;
    if (window.MK64) { delete window.MK64.rom; }
    el.input.value = '';
    el.loader.hidden = false;
    el.btnReset.disabled = true;
    el.romInfo.textContent = '';
    clearError();
    setStatus('Aguardando ROM', 'idle');
    log('ROM descartada da memória.');
    window.dispatchEvent(new CustomEvent('mk64:rom-reset'));
  }

  // Eventos de seleção / drag & drop
  el.input.addEventListener('change', () => {
    if (el.input.files && el.input.files[0]) handleFile(el.input.files[0]);
  });

  ['dragenter', 'dragover'].forEach((ev) =>
    el.dropzone.addEventListener(ev, (e) => { e.preventDefault(); el.dropzone.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) =>
    el.dropzone.addEventListener(ev, (e) => { e.preventDefault(); el.dropzone.classList.remove('drag'); }));
  el.dropzone.addEventListener('drop', (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleFile(f);
  });
  // Evita que soltar fora da dropzone abra o arquivo no navegador
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  el.btnReset.addEventListener('click', resetRom);
  el.btnFullscreen.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (el.screen.requestFullscreen) el.screen.requestFullscreen();
  });

  // ---------------------------------------------------------------------------
  // Entrada: teclado + controles virtuais -> window.MK64Input
  // ---------------------------------------------------------------------------
  const KEYMAP = {
    KeyX: 'A', KeyZ: 'B', Space: 'Z', KeyS: 'R', KeyQ: 'L', Enter: 'START',
    KeyI: 'C_UP', KeyJ: 'C_LEFT', KeyK: 'C_DOWN', KeyL: 'C_RIGHT',
  };
  const STICK_KEYS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

  const input = {
    buttons: {},          // { A:true, B:false, ... }
    stick: { x: 0, y: 0 } // -1..1 (x: direita+, y: cima+)
  };
  window.MK64Input = input;

  const dirs = { left: false, right: false, up: false, down: false };
  let virtualStick = { x: 0, y: 0 };

  function updateStick() {
    const kx = (dirs.right ? 1 : 0) - (dirs.left ? 1 : 0);
    const ky = (dirs.up ? 1 : 0) - (dirs.down ? 1 : 0);
    input.stick.x = kx || virtualStick.x;
    input.stick.y = ky || virtualStick.y;
    const row = document.querySelector('.keymap tr[data-btn="STICK"]');
    if (row) row.classList.toggle('active', !!(input.stick.x || input.stick.y));
  }

  function setButton(name, pressed) {
    input.buttons[name] = pressed;
    const row = document.querySelector('.keymap tr[data-btn="' + name + '"]');
    if (row) row.classList.toggle('active', pressed);
    const vb = document.querySelector('.vbtn[data-btn="' + name + '"]');
    if (vb) vb.classList.toggle('pressed', pressed);
  }

  function onKey(e, pressed) {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (STICK_KEYS[e.code]) {
      dirs[STICK_KEYS[e.code]] = pressed;
      updateStick();
      e.preventDefault();
    } else if (KEYMAP[e.code]) {
      setButton(KEYMAP[e.code], pressed);
      e.preventDefault();
    }
  }
  window.addEventListener('keydown', (e) => { if (!e.repeat) onKey(e, true); });
  window.addEventListener('keyup', (e) => onKey(e, false));
  window.addEventListener('blur', () => {
    Object.keys(dirs).forEach((k) => (dirs[k] = false));
    Object.keys(input.buttons).forEach((k) => setButton(k, false));
    virtualStick = { x: 0, y: 0 };
    updateStick();
  });

  // Botões virtuais (Pointer Events: multi-toque funciona por botão)
  document.querySelectorAll('.vbtn[data-btn]').forEach((btn) => {
    const name = btn.dataset.btn;
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); btn.setPointerCapture(e.pointerId); setButton(name, true); });
    const up = (e) => { e.preventDefault(); setButton(name, false); };
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  });

  // Analógico virtual
  const stick = $('stick');
  const knob = $('stickKnob');
  if (stick && knob) {
    let activeId = null;
    const move = (e) => {
      const r = stick.getBoundingClientRect();
      const max = r.width / 2 - 10;
      let dx = e.clientX - (r.left + r.width / 2);
      let dy = e.clientY - (r.top + r.height / 2);
      const dist = Math.hypot(dx, dy);
      if (dist > max) { dx = (dx / dist) * max; dy = (dy / dist) * max; }
      knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
      virtualStick = { x: +(dx / max).toFixed(3), y: +(-dy / max).toFixed(3) };
      updateStick();
    };
    const end = (e) => {
      if (e.pointerId !== activeId) return;
      activeId = null;
      knob.style.transform = '';
      virtualStick = { x: 0, y: 0 };
      updateStick();
    };
    stick.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      activeId = e.pointerId;
      stick.setPointerCapture(e.pointerId);
      move(e);
    });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === activeId) move(e); });
    stick.addEventListener('pointerup', end);
    stick.addEventListener('pointercancel', end);
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  log('MK64 Web iniciado. Selecione sua ROM (NKTE, NKTP ou NKTJ).');

  // Exposto para testes/depuração e para o módulo WASM
  window.MK64Loader = { validateRom, normalizeToZ64, detectFormat, VALID_IDS };
})();
