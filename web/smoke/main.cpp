// Teste de fumaça: sobe um Ship::Context real do libultraship (Fast3D + SDL2 + WebGL2) no navegador.
#include <cstdio>
#include <emscripten.h>
#include <emscripten/html5.h>
#include <GLES3/gl3.h>
#include "ship/Context.h"
#include "ship/window/Window.h"
#include "ship/controller/controldeck/ControlDeck.h"
#include "fast/Fast3dWindow.h"

struct SmokeDeck final : public Ship::ControlDeck {
    SmokeDeck() : Ship::ControlDeck({}, nullptr, {}) {}
    void WriteToPad(void*) override {}
};

static void frame() {
    static int n = 0;
    float t = (n++ % 120) / 120.0f;
    glViewport(0, 0, 640, 480);
    glClearColor(0.05f, 0.35f + 0.3f * t, 0.15f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT);
}

#define STEP(expr) do { std::printf("[smoke] >> %s\n", #expr); std::fflush(stdout); \
    try { bool ok_ = (expr); std::printf("[smoke] << %s => %s\n", #expr, ok_ ? "ok" : "FALHOU"); } \
    catch (const std::exception& e_) { std::printf("[smoke] !! %s lançou: %s\n", #expr, e_.what()); } \
    std::fflush(stdout); } while (0)

int main() {
    std::printf("[smoke] iniciando Ship::Context\n"); std::fflush(stdout);
    if (emscripten_run_script_int("new URLSearchParams(location.search).has('direct') ? 1 : 0")) {
        auto d = std::make_shared<SmokeDeck>();
        auto* c = Ship::Context::CreateInstance("MK64 Web Smoke", "mk64web", "mk64web.cfg.json", {}, {}, 1, {},
                                                std::make_shared<Fast::Fast3dWindow>(), d);
        std::printf("[smoke] CreateInstance => %s\n", c ? "ok" : "NULL");
        std::printf("[smoke] FIM_OK\n"); std::fflush(stdout);
        emscripten_set_main_loop(frame, 0, 0);
        return 0;
    }
    auto* ctx = Ship::Context::CreateUninitializedInstance("MK64 Web Smoke", "mk64web", "mk64web.cfg.json");
    auto deck = std::make_shared<SmokeDeck>();
    STEP(ctx->InitLogging());
    STEP(ctx->InitConfiguration());
    STEP(ctx->InitConsoleVariables());
    STEP(ctx->InitResourceManager({}, {}, 1));
    STEP(ctx->InitControlDeck(deck));
    STEP(ctx->InitCrashHandler());
    STEP(ctx->InitConsole());
    STEP(ctx->InitWindow(std::make_shared<Fast::Fast3dWindow>()));
    STEP(ctx->InitAudio({}));
    STEP(ctx->InitEventSystem());
    STEP(ctx->InitFileDropMgr());

    const char* ver = (const char*)glGetString(GL_VERSION);
    const char* glsl = (const char*)glGetString(GL_SHADING_LANGUAGE_VERSION);
    const char* rend = (const char*)glGetString(GL_RENDERER);
    std::printf("[smoke] GL_VERSION=%s\n[smoke] GLSL=%s\n[smoke] RENDERER=%s\n", ver ? ver : "(null)",
                glsl ? glsl : "(null)", rend ? rend : "(null)");
    std::printf("[smoke] FIM_OK\n");
    emscripten_set_main_loop(frame, 0, 0);
    return 0;
}
