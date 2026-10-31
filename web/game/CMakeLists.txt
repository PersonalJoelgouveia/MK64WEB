# Jogo (SpaghettiKart) para WebAssembly: mesmas fontes/definições do CMake original, linkado com o libultraship.
# Variáveis de ambiente: SK_DIR (SpaghettiKart), LUS_DIR (libultraship com patch), DEPS_SRC (clones de deps), DEPS_PREFIX
cmake_minimum_required(VERSION 3.24)
project(spaghetti_web_game LANGUAGES C CXX)
set(USE_OPENGLES ON CACHE BOOL "" FORCE)
add_subdirectory($ENV{LUS_DIR} lus)
set(SK $ENV{SK_DIR})
set(S $ENV{DEPS_SRC})

file(GLOB ROOT_FILES CONFIGURE_DEPENDS "${SK}/src/*.c" "${SK}/src/os/guLookAtF.c" "${SK}/src/os/guPerspectiveF.c"
  "${SK}/src/os/guMtxF2L.c" "${SK}/src/os/guRotateF.c" "${SK}/src/os/guOrthoF.c" "${SK}/src/os/guScaleF.c"
  "${SK}/src/os/guTranslateF.c" "${SK}/src/os/guMtxCatF.c" "${SK}/src/os/guMtxCatL.c" "${SK}/src/os/guNormalize.c")
file(GLOB_RECURSE FILES CONFIGURE_DEPENDS
  "${SK}/src/buffers/*.c" "${SK}/src/data/*.c" "${SK}/src/debug/*.c" "${SK}/src/ending/*.c" "${SK}/src/racing/*.c"
  "${SK}/src/audio/*.c" "${SK}/src/port/*.c" "${SK}/src/port/*.cpp" "${SK}/src/mods/*.c" "${SK}/src/mods/*.cpp"
  "${SK}/courses/*.c" "${SK}/src/engine/*.cpp" "${SK}/src/engine/*.c" "${SK}/src/enhancements/*.c" "${SK}/src/enhancements/*.cpp")
list(APPEND FILES ${ROOT_FILES})
list(FILTER FILES EXCLUDE REGEX ".*\\.inc\\.c")
list(FILTER FILES EXCLUDE REGEX "crash_screen_enhancement.c")
# GameExtractor.cpp (Windows/Torch) fica de fora; o Engine.cpp é adaptado por patches/spaghettikart-emscripten.patch.
list(FILTER FILES EXCLUDE REGEX "GameExtractor.cpp")

include($ENV{LUS_DIR}/cmake/cvars.cmake)   # macros CVAR_* usadas pelo jogo
add_executable(spaghetti_web ${FILES})
set_property(TARGET spaghetti_web PROPERTY CXX_STANDARD 20)
set_property(TARGET spaghetti_web PROPERTY C_STANDARD 11)
target_include_directories(spaghetti_web PRIVATE ${SK} ${SK}/include ${SK}/include/assets ${SK}/src
  $ENV{LUS_DIR}/include $ENV{LUS_DIR}/include/libultraship $ENV{LUS_DIR}/include/ship
  ${S}/dr_libs ${S}/tomlplusplus/include ${S}/semver/include
  ${S}/../src/thread-pool/include ${S}/../src/imgui ${S}/../src/imgui/backends ${S}/../src/stb
  $ENV{DEPS_PREFIX}/include)
target_compile_definitions(spaghetti_web PRIVATE NDEBUG VERSION_US=1 USE_OPENGLES ENABLE_RUMBLE=1 F3DEX_GBI=1 _LANGUAGE_C
  _USE_MATH_DEFINES CIMGUI_DEFINE_ENUMS_AND_STRUCTS NON_MATCHING=1 NON_EQUIVALENT=1 AVOID_UB=1
  SPAGHETTI_VERSION="1.0.0" EXCLUDE_MPQ_SUPPORT)
target_compile_options(spaghetti_web PRIVATE -O1 -w -ffast-math -pthread -fexceptions
  "$<$<COMPILE_LANGUAGE:C>:-Wno-incompatible-pointer-types;-Wno-int-conversion>"
  "$<$<COMPILE_LANGUAGE:CXX>:-fpermissive;-Wno-c++11-narrowing;-DFMT_CONSTEVAL=>")
target_link_libraries(spaghetti_web PRIVATE libultraship)

set_target_properties(spaghetti_web PROPERTIES SUFFIX ".html")
target_link_options(spaghetti_web PRIVATE
  -pthread -fexceptions -sUSE_WEBGL2=1 -sFULL_ES3=1 -sMAX_WEBGL_VERSION=2 -sMIN_WEBGL_VERSION=2
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=536870912 -sMAXIMUM_MEMORY=2147483648 -sPTHREAD_POOL_SIZE=8
  -sPROXY_TO_PTHREAD=1 -sOFFSCREENCANVAS_SUPPORT=1 "-sOFFSCREENCANVASES_TO_PTHREAD=#canvas" -sASSERTIONS=1 -sEXIT_RUNTIME=0 -sFORCE_FILESYSTEM=1 -sSTACK_SIZE=2097152
  -sEXPORTED_RUNTIME_METHODS=FS,callMain -lidbfs.js)
