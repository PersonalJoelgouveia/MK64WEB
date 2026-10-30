/* mk64_input.h — ponte C -> JavaScript para a entrada do controle.
 *
 * Inclua em UM único arquivo .c (EM_JS define funções). Requer o input.js
 * carregado na página (window.MK64Input) e execução na thread principal.
 * Se o jogo rodar em pthreads/worker, troque `window` por chamadas via
 * MAIN_THREAD_EM_ASM_INT ou proxy para a thread principal.
 *
 * Não existe uma API do Emscripten chamada "emscripten_implement_user_preferences";
 * o mecanismo correto para chamar JS a partir do C é EM_JS / EM_ASM
 * (ou --js-library), usado abaixo.
 */
#ifndef MK64_INPUT_H
#define MK64_INPUT_H

#include <stdint.h>
#include <emscripten.h>

/* Bits idênticos aos de OSContPad.button (libultra). */
#define MK64_BTN_A       0x8000
#define MK64_BTN_B       0x4000
#define MK64_BTN_Z       0x2000
#define MK64_BTN_START   0x1000
#define MK64_BTN_D_UP    0x0800
#define MK64_BTN_D_DOWN  0x0400
#define MK64_BTN_D_LEFT  0x0200
#define MK64_BTN_D_RIGHT 0x0100
#define MK64_BTN_L       0x0020
#define MK64_BTN_R       0x0010
#define MK64_BTN_C_UP    0x0008
#define MK64_BTN_C_DOWN  0x0004
#define MK64_BTN_C_LEFT  0x0002
#define MK64_BTN_C_RIGHT 0x0001

/* uint32 empacotado: buttons | stick_x << 16 | stick_y << 24 */
EM_JS(uint32_t, mk64_js_poll, (int port), {
  return window.MK64Input ? window.MK64Input.poll(port) : 0;
});

/* Escreve 4 bytes em dst: u16 buttons (LE), s8 stick_x, s8 stick_y */
EM_JS(void, mk64_js_write, (void *dst, int port), {
  if (window.MK64Input) window.MK64Input.writeToMemory(HEAPU8, dst, port);
});

static inline void mk64_read_pad(int port, uint16_t *buttons, int8_t *stick_x, int8_t *stick_y) {
  uint32_t v = mk64_js_poll(port);
  *buttons = (uint16_t)(v & 0xFFFF);
  *stick_x = (int8_t)((v >> 16) & 0xFF);
  *stick_y = (int8_t)((v >> 24) & 0xFF);
}

#endif /* MK64_INPUT_H */
