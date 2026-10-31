/* Ponte C -> JavaScript (netplay.js). Ver web/README.md. */
#include <emscripten.h>
#include "webnet.h"

EM_JS(int, mk64_net_active, (void), { return (window.MK64Net && window.MK64Net.active) ? 1 : 0; });
EM_JS(int, mk64_net_can_tick, (void), { return (!window.MK64Net || window.MK64Net.canTick()) ? 1 : 0; });
EM_JS(void, mk64_net_submit, (uint32_t v, uint32_t h), { window.MK64Net.submit(v >>> 0, h >>> 0); });
EM_JS(uint32_t, mk64_net_get, (int slot), { return window.MK64Net.get(slot) >>> 0; });
EM_JS(void, mk64_net_tick_done, (void), { if (window.MK64Net) window.MK64Net.tickDone(); });
