@echo off
setlocal enabledelayedexpansion
:: Configuration - Centralized and easily configurable
set "CXX_STD=c++17"
set "OUTPUT=test.exe"
set "SOURCES=src/plan_processor.cpp src/plan_template_engine.cpp src/smart_time_planner.cpp src/plan_validator_enhanced.cpp test/test_main.cpp"
set "INCLUDE_FLAGS=-Iinclude"
set "COMPILERS=g++ clang++ cl"
:: GCC/Clang common warnings - Extended with modern C++ best practices
set "COMMON_GCC_FLAGS=-Wall -Wextra -pedantic -Wformat -Werror=format-security -Wshadow -Wnon-virtual-dtor -Wcast-align -Wunused -Wconversion -Wsign-conversion -Wnull-dereference -Wdouble-promotion -Wformat-truncation -fno-common"
set "DEBUG_FLAGS=-g -O0 -fno-omit-frame-pointer -DDEBUG -fstack-protector-strong"
set "RELEASE_FLAGS=-O2 -DNDEBUG -march=native -flto=auto -ffunction-sections -fdata-sections -fstack-protector-strong"
set "GCC_LINK_FLAGS=-lm -Wl,--gc-sections,-z,relro,-z,now"
:: MSVC linker flags - Updated with modern security features
set "MSVC_LINK_FLAGS=/INCREMENTAL:NO /DEBUG:FASTLINK /NXCOMPAT /DYNAMICBASE"
set "CLEAN=0"
set "RUN_TESTS=1"
set "VERBOSE=0"
set "REBUILD=0"
set "BUILD_DIR=build"
set "INTERMEDIATES=test_std.cpp test_std.o *.o *.obj *.d *.a *.lib *.pdb *.ilk *.exp *.map *.lib *.dll"
set "STATIC_BUILD=0"
set "BUILD_TYPE=debug"
set "ASAN_ENABLED=0"
set "UBSAN_ENABLED=0"
set "TEST_ARGS="
set "COVERAGE_ENABLED=0"
set "CPPCHECK_ENABLED=0"
set "CLANG_TIDY_ENABLED=0"
set "PASS_THROUGH=0"

:: Helper function to set ANSI escape codes properly for Windows 10+ terminals (fixed VT100 enablement)
:check_ansi_colors
:: Enable VT100 processing for current console session (works even if registry not set)
reg add HKCU\Console /v VirtualTerminalLevel /t REG_DWORD /d 1 /f >nul 2>&1
for /f %%a in ('echo prompt $E ^| cmd') do set "ESC=%%a"
set "RED=!ESC![91m"
set "GREEN=!ESC![92m"
set "YELLOW=!ESC![93m"
set "BLUE=!ESC![94m"
set "MAGENTA=!ESC![95m"
set "CYAN=!ESC![96m"
set "WHITE=!ESC![97m"
set "RESET=!ESC![0m"
set "BOLD=!ESC![1m"
set "DIM=!ESC![2m"
set "UNDERLINE=!ESC![4m"
exit /b 0

:: Display help menu - Updated with new options
:show_help
echo !BOLD!Usage: build.bat [options] [-- test_args]!RESET!
echo.
echo !BOLD!Options:!RESET!
echo   !CYAN!debug!RESET!       Build in debug mode (default)
echo   !CYAN!release!RESET!     Build in release mode
echo   !CYAN!clean!RESET!       Remove previous build artifacts
echo   !CYAN!notest!RESET!      Skip running tests after successful build
echo   !CYAN!rebuild!RESET!     Clean and then perform a full rebuild
echo   !CYAN!verbose!RESET!     Enable detailed compiler output
echo   !CYAN!static!RESET!      Enable static linking
echo   !CYAN!asan!RESET!        Enable AddressSanitizer (debug only)
echo   !CYAN!ubsan!RESET!       Enable UndefinedBehaviorSanitizer (debug only)
echo   !CYAN!help!RESET!        Show this help message
exit /b 0

:: Argument parsing loop
:argloop
if "%~1"=="" goto end_args
if "%~1"=="--" (
    set "PASS_THROUGH=1"
    shift
    goto argloop
)
if !PASS_THROUGH! EQU 1 (
    set "TEST_ARGS=!TEST_ARGS! %~1"
    shift
    goto argloop
)
if /i "%~1"=="release" (
    set "BUILD_TYPE=release"
) else if /i "%~1"=="debug" (
    set "BUILD_TYPE=debug"
) else if /i "%~1"=="clean" (
    set "CLEAN=1"
) else if /i "%~1"=="notest" (
    set "RUN_TESTS=0"
) else if /i "%~1"=="verbose" (
    set "VERBOSE=1"
) else if /i "%~1"=="rebuild" (
    set "REBUILD=1"
    set "CLEAN=1"
) else if /i "%~1"=="static" (
    set "STATIC_BUILD=1"
) else if /i "%~1"=="asan" (
    set "ASAN_ENABLED=1"
) else if /i "%~1"=="ubsan" (
    set "UBSAN_ENABLED=1"
) else if /i "%~1"=="help" (
    call :check_ansi_colors
    call :show_help
    exit /b 0
) else (
    call :check_ansi_colors
    echo !YELLOW!Warning: Unrecognized argument "%~1", ignoring...!RESET!
    echo Use "build.bat help" for available options.
)
shift
goto argloop
:end_args

:: Initialize ANSI colors
call :check_ansi_colors

:: Validate build type
if not "!BUILD_TYPE!"=="debug" if not "!BUILD_TYPE!"=="release" (
    echo !RED!Error: Invalid build type "!BUILD_TYPE!", must be debug or release!RESET!
    exit /b 1
)

:: Validate sanitizer compatibility with build type
if !ASAN_ENABLED! EQU 1 if not "!BUILD_TYPE!"=="debug" (
    echo !YELLOW!Warning: AddressSanitizer is only supported in debug mode, disabling...!RESET!
    set "ASAN_ENABLED=0"
)
if !UBSAN_ENABLED! EQU 1 if not "!BUILD_TYPE!"=="debug" (
    echo !YELLOW!Warning: UndefinedBehaviorSanitizer is only supported in debug mode, disabling...!RESET!
    set "UBSAN_ENABLED=0"
)

:: Create build directory if missing
if not exist "!BUILD_DIR!" (
    if !VERBOSE! EQU 1 echo !BLUE!Creating build directory: !BUILD_DIR!!RESET!
    mkdir "!BUILD_DIR!"
    if !ERRORLEVEL! NEQ 0 (
        echo !RED!Error: Failed to create build directory !BUILD_DIR!!RESET!
        exit /b 1
    )
)

:: Clean build if requested
if !CLEAN! EQU 1 (
    set "CLEANED=0"
    if exist "!OUTPUT!" (
        echo !BLUE!Cleaning previous build: !OUTPUT!!RESET!
        del "!OUTPUT!"
        set "CLEANED=1"
    )
    if exist "!BUILD_DIR!" (
        echo !BLUE!Cleaning build directory: !BUILD_DIR!!RESET!
        rmdir /s /q "!BUILD_DIR!"
        set "CLEANED=1"
    )
    for %%f in (%INTERMEDIATES%) do (
        if exist %%f (
            del %%f
            set "CLEANED=1"
        )
    )
    if !CLEANED! EQU 0 (
        echo No build files to clean.
    ) else (
        echo !GREEN!Clean completed successfully.!RESET!
    )
    if !REBUILD! EQU 0 (
        exit /b 0
    ) else (
        :: Recreate build directory after clean for rebuild
        mkdir "!BUILD_DIR!"
        if !ERRORLEVEL! NEQ 0 (
            echo !RED!Error: Failed to recreate build directory !BUILD_DIR! for rebuild!RESET!
            exit /b 1
        )
    )
    echo.
)

:: Set build flags based on type
if "!BUILD_TYPE!"=="debug" (
    set "BUILD_FLAGS=%DEBUG_FLAGS%"
    :: Add sanitizer flags if enabled
    if !ASAN_ENABLED! EQU 1 set "BUILD_FLAGS=!BUILD_FLAGS! -fsanitize=address"
    if !UBSAN_ENABLED! EQU 1 set "BUILD_FLAGS=!BUILD_FLAGS! -fsanitize=undefined"
) else (
    set "BUILD_FLAGS=%RELEASE_FLAGS%"
    :: Disable sanitizers in release mode
    set "ASAN_ENABLED=0"
    set "UBSAN_ENABLED=0"
)

:: Apply static linking flags if requested
if !STATIC_BUILD! EQU 1 (
    set "LINK_FLAGS=%GCC_LINK_FLAGS% -static-libgcc -static-libstdc++ -static"
)

echo !BOLD!!CYAN!==============================================!RESET!
echo !BOLD!!CYAN!          C++ Project Build Utility!RESET!
echo !BOLD!!CYAN!==============================================!RESET!
echo Compiling test program...
echo Build type: !BOLD!!BUILD_TYPE!!RESET!
if !ASAN_ENABLED! EQU 1 echo AddressSanitizer: enabled
if !UBSAN_ENABLED! EQU 1 echo UndefinedBehaviorSanitizer: enabled
echo Verbose mode: !VERBOSE!
if !STATIC_BUILD! EQU 1 echo Static linking: enabled
if not "!TEST_ARGS!"=="" echo Test arguments:!TEST_ARGS!
echo.

:: Track if any compiler succeeded
set "COMPILER_SUCCEEDED=0"

:: Check if source files exist before attempting build
echo Checking source files...
set "MISSING_COUNT=0"
set "SOURCE_COUNT=0"
for %%f in (%SOURCES%) do (
    set /a SOURCE_COUNT+=1
    if not exist "%%f" (
        echo   !RED!ERROR: Source file "%%f" not found!!RESET!
        set /a MISSING_COUNT+=1
    ) else (
        if !VERBOSE! EQU 1 echo   !GREEN!Verified: %%f!RESET!
    )
)
if !MISSING_COUNT! GTR 0 (
    echo.
    echo !RED!Error: !MISSING_COUNT! source file(s) missing. Cannot proceed with build.!RESET!
    exit /b 1
)
echo !GREEN!All !SOURCE_COUNT! source files verified successfully.!RESET!
echo.

:: Get total source file size
set "TOTAL_SOURCE_SIZE=0"
for %%f in (%SOURCES%) do (
    for %%s in ("%%f") do set /a TOTAL_SOURCE_SIZE+=%%~zs
)
:: Convert bytes to human-readable format
if !TOTAL_SOURCE_SIZE! GEQ 1048576 (
    set /a HR_SIZE=!TOTAL_SOURCE_SIZE!/1048576
    echo Total source code size: !TOTAL_SOURCE_SIZE! bytes ^(!HR_SIZE! MB^)
) else if !TOTAL_SOURCE_SIZE! GEQ 1024 (
    set /a HR_SIZE=!TOTAL_SOURCE_SIZE!/1024
    echo Total source code size: !TOTAL_SOURCE_SIZE! bytes ^(!HR_SIZE! KB^)
) else (
    echo Total source code size: !TOTAL_SOURCE_SIZE! bytes
)
echo.

:: Generate object file list for incremental build (fixed paths with spaces)
set "OBJECTS="
for %%f in (%SOURCES%) do (
    set "obj=!BUILD_DIR!\%%~nf.o"
    set "OBJECTS=!OBJECTS! "!obj!""
)

:: Try each compiler in sequence
for %%c in (%COMPILERS%) do (
    where %%c >nul 2>&1
    if !ERRORLEVEL! EQU 0 (
        echo !MAGENTA!--------------------------------------------------!RESET!
        echo !BLUE!Trying compiler: %%c!RESET!
        echo.
        for /f "delims=" %%p in ('where %%c') do set "COMPILER_PATH=%%p"
        echo Compiler found at: !COMPILER_PATH!
        echo.
        
        :: Reset compiler-specific flags for each attempt
        set "IS_MSVC=0"
        set "CXX_STD=c++17"
        set "CURRENT_COMMON_FLAGS=%COMMON_GCC_FLAGS%"
        set "CURRENT_BUILD_FLAGS=!BUILD_FLAGS!"
        set "CURRENT_LINK_FLAGS=%GCC_LINK_FLAGS%"
        if !STATIC_BUILD! EQU 1 set "CURRENT_LINK_FLAGS=!CURRENT_LINK_FLAGS! -static-libgcc -static-libstdc++ -static"
        :: Add sanitizer flags to linker
        if !ASAN_ENABLED! EQU 1 set "CURRENT_LINK_FLAGS=!CURRENT_LINK_FLAGS! -fsanitize=address"
        if !UBSAN_ENABLED! EQU 1 set "CURRENT_LINK_FLAGS=!CURRENT_LINK_FLAGS! -fsanitize=undefined"
        
        :: Handle MSVC separately
        if "%%c"=="cl" (
            set "IS_MSVC=1"
            set "CXX_STD=/std:c++17"
            set "CURRENT_COMMON_FLAGS=/W4 /permissive- /Zc:__cplusplus /Zc:lambda"
            set "CURRENT_LINK_FLAGS=%MSVC_LINK_FLAGS%"
            :: MSVC sanitizer support
            if !ASAN_ENABLED! EQU 1 set "CURRENT_BUILD_FLAGS=!CURRENT_BUILD_FLAGS! /fsanitize=address"
            if !UBSAN_ENABLED! EQU 1 echo !YELLOW!Warning: MSVC does not support UBSan in this configuration!RESET!
        )
        
        :: Get compiler version
        set "COMPILER_VERSION="
        %%c --version >nul 2>&1
        if !ERRORLEVEL! EQU 0 (
            for /f "tokens=*" %%v in ('%%c --version ^| findstr /r "^[a-zA-Z]"') do (
                if not defined COMPILER_VERSION set "COMPILER_VERSION=%%v"
            )
            echo Compiler version: !COMPILER_VERSION!
        ) else (
            :: MSVC version detection
            if !IS_MSVC! EQU 1 (
                for /f "tokens=3 delims= " %%v in ('%%c 2^>^&1 ^| findstr /r "^Microsoft.*Version"') do (
                    if not defined COMPILER_VERSION set "COMPILER_VERSION=MSVC %%v"
                )
                echo Compiler version: !COMPILER_VERSION!
            )
        )
        echo.
        
        :: Validate compiler supports C++ standard
        echo Validating CXX_STD !CXX_STD! support...
        set "CXX_TEMP_SRC=!BUILD_DIR!\test_std.cpp"
        set "CXX_TEMP_OBJ=!BUILD_DIR!\test_std.obj"
        echo // Test C++ standard > "!CXX_TEMP_SRC!"
        echo int main() { return 0; } >> "!CXX_TEMP_SRC!"
        if !IS_MSVC! EQU 0 (
            %%c -std=%CXX_STD% -c "!CXX_TEMP_SRC!" -o "!CXX_TEMP_OBJ!" >nul 2>&1
            if !ERRORLEVEL! NEQ 0 (
                echo   !YELLOW!Warning: Compiler does not support %CXX_STD%, falling back to c++11!RESET!
                set "CXX_STD=c++11"
            ) else (
                echo   !GREEN!Compiler supports %CXX_STD%!RESET!
            )
        ) else (
            %%c !CXX_STD! -c "!CXX_TEMP_SRC!" -Fo"!CXX_TEMP_OBJ!" >nul 2>&1
            if !ERRORLEVEL! NEQ 0 (
                echo   !YELLOW!Warning: Compiler does not support !CXX_STD!, falling back to /std:c++11!RESET!
                set "CXX_STD=/std:c++11"
            ) else (
                echo   !GREEN!Compiler supports !CXX_STD!!RESET!
            )
        )
        :: Clean up temporary test files
        if exist "!CXX_TEMP_SRC!" del "!CXX_TEMP_SRC!"
        if exist "!CXX_TEMP_OBJ!" del "!CXX_TEMP_OBJ!"
        echo.

        :: Incremental build: compile only modified source files (fixed timestamp comparison)
        echo Running incremental build...
        set "BUILD_ERROR=0"
        set "START_TIME=!time!"
        for %%f in (%SOURCES%) do (
            set "src=%%f"
            set "obj=!BUILD_DIR!\%%~nf.o"
            set "compile=0"
            if not exist "!obj!" set "compile=1"
            if exist "!obj!" (
                for /f %%t in ("!src!") do set "src_time=%%~ft"
                for /f %%t in ("!obj!") do set "obj_time=%%~ft"
                if "!src_time!" gtr "!obj_time!" set "compile=1"
            )
            if !compile! EQU 1 (
                echo   !BLUE!Compiling: %%f!RESET!
                if !VERBOSE! EQU 1 (
                    if !IS_MSVC! EQU 0 (
                        %%c -std=%CXX_STD% %INCLUDE_FLAGS% !CURRENT_COMMON_FLAGS! !CURRENT_BUILD_FLAGS! -c "!src!" -o "!obj!"
                    ) else (
                        %%c !CXX_STD! %INCLUDE_FLAGS% !CURRENT_COMMON_FLAGS! !CURRENT_BUILD_FLAGS! -c "!src!" -Fo"!obj!"
                    )
                ) else (
                    if !IS_MSVC! EQU 0 (
                        %%c -std=%CXX_STD% %INCLUDE_FLAGS% !CURRENT_COMMON_FLAGS! !CURRENT_BUILD_FLAGS! -c "!src!" -o "!obj!" >nul 2>&1
                    ) else (
                        %%c !CXX_STD! %INCLUDE_FLAGS% !CURRENT_COMMON_FLAGS! !CURRENT_BUILD_FLAGS! -c "!src!" -Fo"!obj!" >nul 2>&1
                    )
                )
                if !ERRORLEVEL! NEQ 0 (
                    set "BUILD_ERROR=!ERRORLEVEL!"
                    echo   !RED!Failed to compile: %%f!RESET!
                    goto :link_stage
                )
            ) else (
                if !VERBOSE! EQU 1 echo   !GREEN!Skipping unmodified: %%f!RESET!
            )
        )

        :link_stage
        set "END_TIME=!time!"
        if !BUILD_ERROR! EQU 0 (
            echo.
            echo !BLUE!Linking object files...!RESET!
            if !VERBOSE! EQU 1 (
                if !IS_MSVC! EQU 0 (
                    %%c !OBJECTS! -o "!OUTPUT!" !CURRENT_LINK_FLAGS!
                ) else (
                    %%c !OBJECTS! -out:"!OUTPUT!" !CURRENT_LINK_FLAGS!
                )
            ) else (
                if !IS_MSVC! EQU 0 (
                    %%c !OBJECTS! -o "!OUTPUT!" !CURRENT_LINK_FLAGS! >nul 2>&1
                ) else (
                    %%c !OBJECTS! -out:"!OUTPUT!" !CURRENT_LINK_FLAGS! >nul 2>&1
                )
            )
            set "BUILD_ERROR=!ERRORLEVEL!"
        )

        :: Calculate build duration (fixed midnight rollover handling)
        for /f "tokens=1-4 delims=:.," %%a in ("!START_TIME!") do (
            set /a START=(((%%a*60)+%%b)*60+%%c)*100+%%d
        )
        for /f "tokens=1-4 delims=:.," %%a in ("!END_TIME!") do (
            set /a END=(((%%a*60)+%%b)*60+%%c)*100+%%d
        )
        set /a BUILD_TIME=END-START
        if !BUILD_TIME! LSS 0 set /a BUILD_TIME+=8640000
        if !BUILD_TIME! GEQ 1000 (
            set /a BUILD_SEC=!BUILD_TIME!/1000
            set /a BUILD_MS=!BUILD_TIME!%%1000
            echo Build completed in !BUILD_SEC!.!BUILD_MS!s
        ) else (
            echo Build completed in !BUILD_TIME!ms
        )
        
        if !BUILD_ERROR! EQU 0 (
            echo.
            echo !GREEN!✅ Build successful with %%c!!RESET!
            if exist "!OUTPUT!" (
                for %%f in ("!OUTPUT!") do set "OUTPUT_SIZE=%%~zf"
                if !OUTPUT_SIZE! GEQ 1048576 (
                    set /a OUTPUT_MB=!OUTPUT_SIZE!/1048576
                    echo Output file created: !OUTPUT! ^(!OUTPUT_MB! MB^)
                ) else if !OUTPUT_SIZE! GEQ 1024 (
                    set /a OUTPUT_KB=!OUTPUT_SIZE!/1024
                    echo Output file created: !OUTPUT! ^(!OUTPUT_KB! KB^)
                ) else (
                    echo Output file created: !OUTPUT! ^(!OUTPUT_SIZE! bytes^)
                )
                set "COMPILER_SUCCEEDED=1"
                
                :: Run tests if enabled
                if !RUN_TESTS! EQU 1 (
                    echo.
                    echo !BOLD!!CYAN!==============================================!RESET!
                    echo !BOLD!!CYAN!                  Running Tests!RESET!
                    echo !BOLD!!CYAN!==============================================!RESET!
                    echo.
                    call "!OUTPUT!" !TEST_ARGS!
                    set "TEST_ERROR=!ERRORLEVEL!"
                    if !TEST_ERROR! EQU 0 (
                        echo.
                        echo !GREEN!✅ All tests passed!!RESET!
                    ) else (
                        echo.
                        echo !RED!❌ Tests failed with error code !TEST_ERROR!!RESET!
                    )
                    exit /b !TEST_ERROR!
                ) else (
                    echo.
                    echo Tests skipped (notest flag specified)
                    exit /b 0
                )
            ) else (
                echo !RED!❌ Error: Build reported success but output file !OUTPUT! not found!!RESET!
                exit /b 1
            )
        ) else (
            set "LAST_ERROR=!BUILD_ERROR!"
            echo.
            echo !RED!❌ Build failed with %%c, error code !LAST_ERROR!!RESET!
            echo.
            :: Clean up any partial output
            if exist "!OUTPUT!" del "!OUTPUT!"
            :: Clean up MSVC temporary files
            if !IS_MSVC! EQU 1 (
                if exist "*.pdb" del "*.pdb"
                if exist "*.ilk" del "*.ilk"
                if exist "*.exp" del "*.exp"
            )
        )
    ) else (
        echo !YELLOW!⚠️  Compiler %%c not found in PATH, skipping...!RESET!
    )
)

:: If all compilers fail
if !COMPILER_SUCCEEDED! EQU 0 (
    echo.
    echo !BOLD!!RED!==============================================!RESET!
    echo !BOLD!!RED!                 BUILD FAILED!RESET!
    echo !BOLD!!RED!==============================================!RESET!
    echo Error: No working compiler found.
    echo Please install g++, clang++ or MSVC and add them to your system PATH.
    echo.
    echo Common installation locations:
    echo   - MinGW-w64: C:\mingw64\bin
    echo   - LLVM/Clang: C:\Program Files\LLVM\bin
    echo   - MSYS2: C:\msys64\mingw64\bin
    echo   - MSVC: Comes with Visual Studio, use x64 Native Tools Command Prompt
    exit /b 1
)
