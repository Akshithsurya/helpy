cmake_minimum_required(VERSION 3.16)
project(helpy_plan_nif LANGUAGES C CXX)

# Generate compile_commands.json for IDE integration and static analysis tools
set(CMAKE_EXPORT_COMPILE_COMMANDS ON CACHE INTERNAL "")

# Configure C++ standard globally - applied to all targets
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# Prevent in-source builds to avoid polluting source tree
if(CMAKE_SOURCE_DIR STREQUAL CMAKE_BINARY_DIR)
    message(FATAL_ERROR "In-source builds are not supported. Please create a build directory and run CMake from there.")
endif()

# Find Erlang headers - use built-in CMake support if available, fallback to manual detection
if(CMAKE_VERSION VERSION_GREATER_EQUAL 3.18)
    find_package(Erlang REQUIRED)
    list(GET Erlang_INCLUDE_DIRS 0 ERLANG_INCLUDE_DIR)
else()
    find_program(ERL_EXECUTABLE erl REQUIRED)
    execute_process(
        COMMAND ${ERL_EXECUTABLE} -noshell -eval "io:format(\"~s~n\", [filename:join([code:root_dir(), \"usr\", \"include\"])])." -s init stop
        OUTPUT_VARIABLE ERLANG_INCLUDE_DIR
        OUTPUT_STRIP_TRAILING_WHITESPACE
        COMMAND_ERROR_IS_FATAL ANY
    )
endif()

# Verify we found valid Erlang headers
if(NOT EXISTS ${ERLANG_INCLUDE_DIR}/erl_nif.h)
    message(FATAL_ERROR "erl_nif.h not found in derived path: ${ERLANG_INCLUDE_DIR}")
endif()
message(STATUS "Found Erlang headers in: ${ERLANG_INCLUDE_DIR}")

# Source files
set(SOURCES
    src/helpy_plan_nif.cpp
    src/plan_processor.cpp
    src/plan_template_engine.cpp
    src/smart_time_planner.cpp
    src/plan_validator_enhanced.cpp
)

# Validate all source files exist before building
foreach(SOURCE_FILE ${SOURCES})
    if(NOT EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/${SOURCE_FILE})
        message(FATAL_ERROR "Source file not found: ${SOURCE_FILE}")
    endif()
endforeach()

# Create shared library
add_library(helpy_plan_nif SHARED ${SOURCES})

# Configure output paths and naming (always remove lib prefix, output to priv directory)
set(PRIV_DIR ${CMAKE_CURRENT_SOURCE_DIR}/priv)
file(MAKE_DIRECTORY ${PRIV_DIR})

# Use generator expressions to handle all generators (single and multi-config) in one place
set_target_properties(helpy_plan_nif PROPERTIES
    LIBRARY_OUTPUT_DIRECTORY ${PRIV_DIR}
    RUNTIME_OUTPUT_DIRECTORY ${PRIV_DIR}
    ARCHIVE_OUTPUT_DIRECTORY ${PRIV_DIR}
    PREFIX ""
    OUTPUT_NAME "helpy_plan_nif"
    $<$<CONFIG:Debug>:OUTPUT_NAME "helpy_plan_nif_d">
)

# Platform-specific linker and properties configuration
if(APPLE)
    set_target_properties(helpy_plan_nif PROPERTIES
        SUFFIX ".so"
        MACOSX_RPATH ON
        INSTALL_RPATH "@loader_path"
    )
    target_link_options(helpy_plan_nif PRIVATE -undefined dynamic_lookup)
elseif(UNIX)
    set_target_properties(helpy_plan_nif PROPERTIES
        INSTALL_RPATH "$ORIGIN"
    )
    target_link_options(helpy_plan_nif PRIVATE -Wl,--no-undefined)
elseif(WIN32)
    set_target_properties(helpy_plan_nif PROPERTIES
        SUFFIX ".dll"
    )
endif()

# Include directories with system header marking for Erlang
target_include_directories(helpy_plan_nif
    PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/include
    SYSTEM PRIVATE
        ${ERLANG_INCLUDE_DIR}
)

# NIF-specific compiler definitions
target_compile_definitions(helpy_plan_nif
    PRIVATE
        ERL_NIF_THREAD_SAFE
        $<$<PLATFORM_ID:Windows>:_WIN32_WINNT=0x0A00> # Windows 10 minimum
)

# Validate C++ standard compliance at configure time
target_compile_features(helpy_plan_nif PRIVATE cxx_std_17)

# Compiler warning flags for better code quality
target_compile_options(helpy_plan_nif
    PRIVATE
        $<$<OR:$<CXX_COMPILER_ID:GNU>,$<CXX_COMPILER_ID:Clang>>:-Wall -Wextra -Wpedantic -Werror -fvisibility=hidden>
        $<$<CXX_COMPILER_ID:MSVC>:/W4 /WX /permissive- /EHsc>
)

# Security hardening flags for GCC/Clang
if(CMAKE_CXX_COMPILER_ID STREQUAL "GNU" OR (CMAKE_CXX_COMPILER_ID STREQUAL "Clang" AND NOT MSVC))
    target_compile_options(helpy_plan_nif PRIVATE -fstack-protector-strong)
    target_link_options(helpy_plan_nif PRIVATE -Wl,-z,relro,-z,now)
endif()

# Optional LTO for release builds
include(CheckIPOSupported)
check_ipo_supported(RESULT IPO_SUPPORTED OUTPUT IPO_ERROR)
if(IPO_SUPPORTED)
    # Enable LTO for all release-like configurations using generator expressions
    set_target_properties(helpy_plan_nif PROPERTIES
        INTERPROCEDURAL_OPTIMIZATION $<OR:$<CONFIG:Release>,$<CONFIG:RelWithDebInfo>,$<CONFIG:MinSizeRel>>
    )
    message(STATUS "IPO/LTO enabled for release builds")
endif()

# Optional sanitizers for debug builds
option(ENABLE_ASAN "Enable AddressSanitizer for debug builds" OFF)
option(ENABLE_TSAN "Enable ThreadSanitizer for debug builds" OFF)
option(ENABLE_UBSAN "Enable UndefinedBehaviorSanitizer for debug builds" OFF)

# Mutually exclusive sanitizer check
set(ENABLED_SANITIZERS "")
if(ENABLE_ASAN)
    list(APPEND ENABLED_SANITIZERS "ASAN")
endif()
if(ENABLE_TSAN)
    list(APPEND ENABLED_SANITIZERS "TSAN")
endif()
if(ENABLE_UBSAN)
    list(APPEND ENABLED_SANITIZERS "UBSAN")
endif()
list(LENGTH ENABLED_SANITIZERS NUM_ENABLED_SANITIZERS)
if(${NUM_ENABLED_SANITIZERS} GREATER 1)
    message(FATAL_ERROR "Only one sanitizer (ASAN/TSAN/UBSAN) can be enabled at the same time. Conflicting: ${ENABLED_SANITIZERS}")
endif()

# Apply selected sanitizer configuration - use generator expressions to only apply to Debug builds
if(ENABLE_ASAN OR ENABLE_TSAN OR ENABLE_UBSAN)
    # Check compiler support first
    if(NOT (CMAKE_CXX_COMPILER_ID STREQUAL "GNU" OR CMAKE_CXX_COMPILER_ID STREQUAL "Clang"))
        message(WARNING "Sanitizers are not supported for current compiler, ignoring all sanitizer options")
    else()
        # Apply sanitizer flags only to Debug configuration using generator expressions
        if(ENABLE_ASAN)
            target_compile_options(helpy_plan_nif PRIVATE $<$<CONFIG:Debug>:-fsanitize=address -fno-omit-frame-pointer -g>)
            target_link_options(helpy_plan_nif PRIVATE $<$<CONFIG:Debug>:-fsanitize=address>)
            message(STATUS "AddressSanitizer enabled for debug builds")
        elseif(ENABLE_TSAN)
            target_compile_options(helpy_plan_nif PRIVATE $<$<CONFIG:Debug>:-fsanitize=thread -fno-omit-frame-pointer -g>)
            target_link_options(helpy_plan_nif PRIVATE $<$<CONFIG:Debug>:-fsanitize=thread>)
            message(STATUS "ThreadSanitizer enabled for debug builds")
        elseif(ENABLE_UBSAN)
            target_compile_options(helpy_plan_nif PRIVATE $<$<CONFIG:Debug>:-fsanitize=undefined -fno-omit-frame-pointer -g>)
            target_link_options(helpy_plan_nif PRIVATE $<$<CONFIG:Debug>:-fsanitize=undefined>)
            message(STATUS "UndefinedBehaviorSanitizer enabled for debug builds")
        endif()
    endif()
endif()

# Add install rule for the NIF library to support proper distribution
install(TARGETS helpy_plan_nif
    LIBRARY DESTINATION ${PRIV_DIR}
    RUNTIME DESTINATION ${PRIV_DIR}
)
