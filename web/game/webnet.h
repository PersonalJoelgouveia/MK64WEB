#ifndef MK64_WEBNET_H
#define MK64_WEBNET_H
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
int mk64_net_active(void);
int mk64_net_can_tick(void);
void mk64_net_submit(uint32_t packed_input, uint32_t state_hash);
uint32_t mk64_net_get(int slot);
void mk64_net_tick_done(void);
#ifdef __cplusplus
}
#endif
#endif
