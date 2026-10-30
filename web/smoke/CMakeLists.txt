cmake_minimum_required(VERSION 3.24)
project(lus_smoke LANGUAGES C CXX)
set(USE_OPENGLES ON CACHE BOOL "" FORCE)
add_subdirectory($ENV{LUS_DIR} lus)
add_executable(lus_smoke main.cpp)
set_property(TARGET lus_smoke PROPERTY CXX_STANDARD 20)
target_link_libraries(lus_smoke PRIVATE libultraship)
target_compile_definitions(lus_smoke PRIVATE USE_OPENGLES)
set_target_properties(lus_smoke PROPERTIES SUFFIX ".html")
target_link_options(lus_smoke PRIVATE
  -pthread -sUSE_WEBGL2=1 -sFULL_ES3=1 -sMAX_WEBGL_VERSION=2 -sMIN_WEBGL_VERSION=2
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=268435456 -sPTHREAD_POOL_SIZE=6
  -sASSERTIONS=1 -sEXIT_RUNTIME=0 -sFORCE_FILESYSTEM=1 -sSTACK_SIZE=1048576
  -sPROXY_TO_PTHREAD=0 -fexceptions -lidbfs.js)
