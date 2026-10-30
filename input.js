/* MK64 Web — input.js
 *
 * Une teclado, Gamepad API e controles de toque em UM controle de N64.
 *
 * Formato (idêntico ao OSContPad do libultra):
 *   buttons : uint16  (bits em BTN abaixo)
 *   stick_x : int8    -80..80  (direita = +)
 *   stick_y : int8    -80..80  (cima    = +)
 *
 * Leitura pelo C/WASM (ver src/web/mk64_input.h):
 *   MK64Input.poll(port)                      -> uint32 empacotado:
 *        bits 0-15 = buttons | bits 16-23 = stick_x | bits 24-31 = stick_y
 *   MK64Input.writeToMemory(HEAPU8, ptr, port) -> escreve 4 bytes em ptr:
 *        u16 buttons (little-endian), s8 stick_x, s8 stick_y
 *
 * Porta 0 = teclado + toque + 1º gamepad. Portas 1-3 = demais gamepads.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constantes
  // ---------------------------------------------------------------------------
  const BTN = Object.freeze({
    A: 0x8000, B: 0x4000, Z: 0x2000, START: 0x1000,
    D_UP: 0x0800, D_DOWN: 0x0400, D_LEFT: 0x0200, D_RIGHT: 0x0100,
    L: 0x0020, R: 0x0010,
    C_UP: 0x0008, C_DOWN: 0x0004, C_LEFT: 0x0002, C_RIGHT: 0x0001,
  });
  const DPAD_MASK = BTN.D_UP | BTN.D_DOWN | BTN.D_LEFT | BTN.D_RIGHT;
  const PORTS = 4;
  const STICK_MAX = 80;       // alcance típico do analógico do N64
  const DEADZONE = 0.15;      // zona morta radial do gamepad
  const C_THRESHOLD = 0.5;    // analógico direito -> botões C
  const HAPTICS = true;       // vibração curta ao tocar (Android)

  // Teclado (KeyboardEvent.code -> botão). Edite aqui para remapear.
  const KEYMAP = {
    KeyX: 'A',
    KeyZ: 'B',
    ShiftLeft: 'Z', ShiftRight: 'Z',
    Space: 'R',
    KeyQ: 'L',
    Enter: 'START', NumpadEnter: 'START',
    KeyI: 'C_UP', KeyJ: 'C_LEFT', KeyK: 'C_DOWN', KeyL: 'C_RIGHT',
    KeyT: 'D_UP', KeyF: 'D_LEFT', KeyG: 'D_DOWN', KeyH: 'D_RIGHT',
  };
  const STICK_KEYS = {
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'up', KeyW: 'up',
    ArrowDown: 'down', KeyS: 'down',
  };

  const log = (msg, kind) => {
    if (typeof window.MK64Log === 'function') window.MK64Log(msg, kind);
    else console.log('[MK64]', msg);
  };

  // ---------------------------------------------------------------------------
  // Fonte 1: teclado
  // ---------------------------------------------------------------------------
  const keysDown = new Set();

  function keyboardState() {
    let buttons = 0, l = 0, r = 0, u = 0, d = 0;
    keysDown.forEach((code) => {
      const name = KEYMAP[code];
      if (name) buttons |= BTN[name];
      switch (STICK_KEYS[code]) {
        case 'left': l = 1; break;
        case 'right': r = 1; break;
        case 'up': u = 1; break;
        case 'down': d = 1; break;
      }
    });
    return { buttons, x: r - l, y: u - d };
  }

  function isTyping(t) {
    const tag = t && t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!(t && t.isContentEditable);
  }

  window.addEventListener('keydown', (e) => {
    if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (KEYMAP[e.code] || STICK_KEYS[e.code]) {
      keysDown.add(e.code);
      e.preventDefault(); // evita rolar a página (Espaço/setas) e "clicar" botões focados
    }
  });
  window.addEventListener('keyup', (e) => {
    if (KEYMAP[e.code] || STICK_KEYS[e.code]) {
      keysDown.delete(e.code);
      e.preventDefault();
    }
  });

  // ---------------------------------------------------------------------------
  // Fonte 2: Gamepad API (layout "standard": Xbox / PlayStation)
  // ---------------------------------------------------------------------------
  let pads = [];

  function refreshPads() {
    pads = [];
    const list = (typeof navigator !== 'undefined' && navigator.getGamepads) ? navigator.getGamepads() : [];
    for (let i = 0; i < list.length; i++) {
      if (list[i] && list[i].connected) pads.push(list[i]);
    }
  }

  function radialDeadzone(x, y) {
    const m = Math.hypot(x, y);
    if (m < DEADZONE) return [0, 0];
    const s = (Math.min(m, 1) - DEADZONE) / (1 - DEADZONE) / m;
    return [x * s, y * s];
  }

  function padState(p) {
    const down = (i) => !!(p.buttons[i] && p.buttons[i].pressed);
    let buttons = 0;
    if (down(0)) buttons |= BTN.A;                      // A / ✕
    if (down(1) || down(2)) buttons |= BTN.B;           // B / ○  e  X / □
    if (down(3)) buttons |= BTN.C_UP;                   // Y / △
    if (down(4) || down(6)) buttons |= BTN.Z;           // LB/LT (L1/L2) -> item
    if (down(5) || down(7)) buttons |= BTN.R;           // RB/RT (R1/R2) -> pulo/drift
    if (down(8)) buttons |= BTN.L;                      // Back / Select
    if (down(9)) buttons |= BTN.START;
    if (down(12)) buttons |= BTN.D_UP;
    if (down(13)) buttons |= BTN.D_DOWN;
    if (down(14)) buttons |= BTN.D_LEFT;
    if (down(15)) buttons |= BTN.D_RIGHT;

    const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
    let [x, y] = radialDeadzone(ax, -ay);               // eixo Y do pad: cima = negativo

    // D-Pad também conduz o analógico quando ele está parado (conforto no Xbox/PS)
    if (!x && !y) {
      x = ((buttons & BTN.D_RIGHT) ? 1 : 0) - ((buttons & BTN.D_LEFT) ? 1 : 0);
      y = ((buttons & BTN.D_UP) ? 1 : 0) - ((buttons & BTN.D_DOWN) ? 1 : 0);
    }

    // Analógico direito -> botões C
    const rx = p.axes[2] || 0, ry = p.axes[3] || 0;
    if (ry < -C_THRESHOLD) buttons |= BTN.C_UP;
    if (ry > C_THRESHOLD) buttons |= BTN.C_DOWN;
    if (rx < -C_THRESHOLD) buttons |= BTN.C_LEFT;
    if (rx > C_THRESHOLD) buttons |= BTN.C_RIGHT;

    return { buttons, x, y };
  }

  window.addEventListener('gamepadconnected', (e) => {
    const std = e.gamepad.mapping === 'standard';
    log('Controle conectado: ' + e.gamepad.id + (std ? '' : ' (mapeamento não padrão; botões podem variar)'), std ? 'ok' : 'warn');
  });
  window.addEventListener('gamepaddisconnected', (e) => {
    log('Controle desconectado: ' + e.gamepad.id, 'warn');
  });

  // ---------------------------------------------------------------------------
  // Fonte 3: toque (estado escrito pelos controles na tela, ver buildTouch)
  // ---------------------------------------------------------------------------
  const touch = { buttons: 0, x: 0, y: 0 };

  // ---------------------------------------------------------------------------
  // Combinação -> buffer único do N64
  // ---------------------------------------------------------------------------
  function combine(port) {
    const sources = [];
    if (port === 0) { sources.push(keyboardState()); sources.push(touch); }
    if (pads[port]) sources.push(padState(pads[port]));

    let buttons = 0, sx = 0, sy = 0;
    for (const s of sources) {
      buttons |= s.buttons;
      if (Math.hypot(s.x, s.y) > Math.hypot(sx, sy)) { sx = s.x; sy = s.y; } // vence o maior desvio
    }
    const m = Math.hypot(sx, sy);
    if (m > 1) { sx /= m; sy /= m; }                    // limita ao círculo
    return { buttons, stickX: Math.round(sx * STICK_MAX), stickY: Math.round(sy * STICK_MAX) };
  }

  function sample(port) {
    port = port | 0;
    if (port < 0 || port >= PORTS) return { buttons: 0, stickX: 0, stickY: 0 };
    refreshPads();
    return combine(port);
  }

  const api = {
    BTN,
    STICK_MAX,
    PORTS,

    /** Estado legível: { buttons, stickX, stickY }. */
    getState(port) { return sample(port || 0); },

    /** true se o botão (nome de BTN) está pressionado. */
    isPressed(name, port) { return (sample(port || 0).buttons & BTN[name]) !== 0; },

    /** uint32 empacotado: buttons | stick_x << 16 | stick_y << 24. Use no C como uint32_t. */
    poll(port) {
      const s = sample(port || 0);
      return ((s.buttons & 0xFFFF) | ((s.stickX & 0xFF) << 16) | ((s.stickY & 0xFF) << 24)) >>> 0;
    },

    /** Escreve 4 bytes em heap[ptr..ptr+3]: u16 buttons (LE), s8 stick_x, s8 stick_y. */
    writeToMemory(heap, ptr, port) {
      const s = sample(port || 0);
      ptr = ptr >>> 0;
      heap[ptr] = s.buttons & 0xFF;
      heap[ptr + 1] = (s.buttons >> 8) & 0xFF;
      heap[ptr + 2] = s.stickX & 0xFF;
      heap[ptr + 3] = s.stickY & 0xFF;
    },

    /** Solta tudo (ex.: ao perder o foco). */
    reset() {
      keysDown.clear();
      touch.buttons = 0; touch.x = 0; touch.y = 0;
      if (touchUI) touchUI.reset();
    },
  };
  window.MK64Input = api;

  // ---------------------------------------------------------------------------
  // Controles de toque (sobrepostos ao jogo, estilo nfsu2.xyz)
  // ---------------------------------------------------------------------------
  let touchUI = null;

  function buzz() {
    if (HAPTICS && navigator.vibrate) navigator.vibrate(8);
  }

  function buildTouch() {
    const host = document.getElementById('screen');
    if (!host) return null;

    const btn = (name, cls, label, sub) =>
      '<button type="button" class="mk-btn ' + cls + '" data-btn="' + name + '" aria-label="' + name + '">' +
      '<b>' + label + '</b>' + (sub ? '<i>' + sub + '</i>' : '') + '</button>';

    const root = document.createElement('div');
    root.className = 'mk-touch';
    root.setAttribute('aria-label', 'Controles de toque');
    root.innerHTML =
      '<div class="mk-stickzone"><div class="mk-stickbase"><div class="mk-stickknob"></div></div></div>' +
      btn('L', 'mk-l', 'L') +
      btn('START', 'mk-start', 'START') +
      btn('R', 'mk-r', 'R', 'drift') +
      '<div class="mk-cpad">' +
        btn('C_UP', 'mk-cu', '▲') + btn('C_LEFT', 'mk-cl', '◀') +
        btn('C_RIGHT', 'mk-cr', '▶') + btn('C_DOWN', 'mk-cd', '▼') +
      '</div>' +
      btn('Z', 'mk-z', 'Z', 'item') +
      btn('B', 'mk-b', 'B', 'freio') +
      btn('A', 'mk-a', 'A', 'acelerar');
    host.appendChild(root);

    // ----- botões (multitoque: cada dedo = um pointerId) -----
    const active = new Map(); // pointerId -> nome do botão
    function recompute() {
      let b = 0;
      active.forEach((n) => { b |= BTN[n]; });
      touch.buttons = b;
    }
    root.querySelectorAll('.mk-btn').forEach((el) => {
      const name = el.dataset.btn;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        try { el.setPointerCapture(e.pointerId); } catch (_) { /* ignora */ }
        active.set(e.pointerId, name);
        el.classList.add('pressed');
        recompute();
        buzz();
      });
      const release = (e) => {
        if (!active.has(e.pointerId)) return;
        active.delete(e.pointerId);
        let still = false;
        active.forEach((n) => { if (n === name) still = true; });
        if (!still) el.classList.remove('pressed');
        recompute();
      };
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
      el.addEventListener('lostpointercapture', release);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    });

    // ----- analógico flutuante: a base aparece onde o dedo toca -----
    const zone = root.querySelector('.mk-stickzone');
    const base = root.querySelector('.mk-stickbase');
    const knob = root.querySelector('.mk-stickknob');
    let stickId = null, cx = 0, cy = 0, radius = 50;

    function moveStick(e) {
      const max = radius * 0.8; // curso total antes de chegar à borda
      let dx = e.clientX - cx, dy = e.clientY - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > max) { dx = (dx / dist) * max; dy = (dy / dist) * max; }
      knob.style.transform = 'translate(calc(-50% + ' + dx + 'px), calc(-50% + ' + dy + 'px))';
      let nx = dx / max, ny = -dy / max;
      if (Math.hypot(nx, ny) < 0.1) { nx = 0; ny = 0; }
      touch.x = nx; touch.y = ny;
    }
    function endStick() {
      stickId = null;
      touch.x = 0; touch.y = 0;
      knob.style.transform = '';
      base.style.left = ''; base.style.top = '';
      base.classList.remove('active');
    }
    zone.addEventListener('pointerdown', (e) => {
      if (stickId !== null) return;
      e.preventDefault();
      stickId = e.pointerId;
      try { zone.setPointerCapture(e.pointerId); } catch (_) { /* ignora */ }
      const zr = zone.getBoundingClientRect();
      radius = base.offsetWidth / 2 || 50;
      cx = Math.min(Math.max(e.clientX, zr.left + radius), zr.right - radius);
      cy = Math.min(Math.max(e.clientY, zr.top + radius), zr.bottom - radius);
      base.style.left = (cx - zr.left) + 'px';
      base.style.top = (cy - zr.top) + 'px';
      base.classList.add('active');
      moveStick(e);
    });
    zone.addEventListener('pointermove', (e) => { if (e.pointerId === stickId) moveStick(e); });
    const stickUp = (e) => { if (e.pointerId === stickId) endStick(); };
    zone.addEventListener('pointerup', stickUp);
    zone.addEventListener('pointercancel', stickUp);
    zone.addEventListener('lostpointercapture', stickUp);
    zone.addEventListener('contextmenu', (e) => e.preventDefault());

    return {
      reset() {
        active.clear();
        root.querySelectorAll('.mk-btn.pressed').forEach((el) => el.classList.remove('pressed'));
        recompute();
        endStick();
      },
    };
  }

  // Mostra os controles em aparelhos de toque (ou no 1º toque detectado)
  function enableTouchMode() { document.documentElement.classList.add('has-touch'); }

  // ---------------------------------------------------------------------------
  // Realce do painel de teclas (só atualiza quando algo muda)
  // ---------------------------------------------------------------------------
  const rows = [];
  let lastKey = '';

  function updatePanel() {
    refreshPads();
    const s = combine(0);
    const key = s.buttons + ',' + s.stickX + ',' + s.stickY;
    if (key === lastKey) return;
    lastKey = key;
    rows.forEach((r) => {
      let on;
      if (r.name === 'STICK') on = s.stickX !== 0 || s.stickY !== 0;
      else if (r.name === 'DPAD') on = (s.buttons & DPAD_MASK) !== 0;
      else on = (s.buttons & BTN[r.name]) !== 0;
      r.el.classList.toggle('active', on);
    });
  }

  function frame() {
    updatePanel();
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  touchUI = buildTouch();

  document.querySelectorAll('.keymap tr[data-btn]').forEach((el) => rows.push({ el, name: el.dataset.btn }));

  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) enableTouchMode();
  window.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') enableTouchMode(); }, { capture: true, passive: true });

  window.addEventListener('blur', api.reset);
  document.addEventListener('visibilitychange', () => { if (document.hidden) api.reset(); });

  // Tela cheia em celular: tenta travar em paisagem
  document.addEventListener('fullscreenchange', () => {
    const o = window.screen && window.screen.orientation;
    if (!o) return;
    if (document.fullscreenElement) { if (o.lock) o.lock('landscape').catch(() => {}); }
    else if (o.unlock) { try { o.unlock(); } catch (_) { /* ignora */ } }
  });

  requestAnimationFrame(frame);
  log('Entrada pronta: teclado, gamepad e toque.');
})();
