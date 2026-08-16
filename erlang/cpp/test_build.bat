@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul

:: Initialize all flags to undefined to prevent environment leaks
set "CLEAN_ONLY="
set "NO_CLEAN="
set "RUN_AFTER_BUILD="
set "BUILD_ONLY="
set "VERBOSE_BUILD="
set "RELEASE_BUILD="
set "DEBUG_BUILD="
set "CLEAN_BUILD_CACHE="
set "INSTALL_AFTER_BUILD="
set "RUN_TESTS="
set "GENERATE_COMPILE_COMMANDS="
set "LIST_GENERATORS="

:: Project configuration
set "BUILD_DIR=build"
set "TARGET=helpy_plan_nif"
set "CMAKE_GENERATOR=MinGW Makefiles"
set "SCRIPT_DIR=%~dp0"
:: Remove trailing backslash to avoid path issues
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
:: Default build type
set "CMAKE_BUILD_TYPE=Release"
:: Additional CMake flags
set "CMAKE_EXTRA_FLAGS="

:: Enable VT100 escape sequence processing for Windows 10+ to ensure ANSI colors work
reg add HKCU\Console /v VirtualTerminalLevel /t REG_DWORD /d 1 /f >nul 2>&1

:: ANSI color codes for better output visibility
set "GREEN=[32m"
set "RED=[31m"
set "YELLOW=[33m"
set "CYAN=[36m"
set "RESET=[0m"

:: Show help message
if /i "%~1"=="--help" (
    echo Usage: %~nx0 [OPTIONS]
    echo.
    echo Build script for helpy_plan_nif test program
    echo.
    echo Options:
    echo   --clean-only    Only clean the build directory, do not build
    echo   --no-clean      Skip cleaning the build directory before building
    echo   --clean-cache   Clean CMake cache before configuration
    echo   -G GENERATOR    Specify CMake generator (default: MinGW Makefiles)
    echo   --list-generators List available CMake generators and exit
    echo   --help          Show this help message and exit
    echo   --run           Run the target executable after successful build
    echo   --install       Install the project after successful build
    echo   --test          Run CTest after successful build
    echo   --build-only    Only build, skip configuration step (for incremental builds)
    echo   --verbose       Enable verbose build output
    echo   --debug         Build in debug mode (default: Release)
    echo   --release       Build in release mode (default: Enabled)
    echo   --compiler-commands Generate compile_commands.json for IDE integration
    echo   -D VAR=VALUE    Pass additional definitions to CMake
    exit /b 0
)

:: Parse command line arguments
:arg_loop
if "%~1"=="" goto arg_end
if /i "%~1"=="--clean-only" (
    set "CLEAN_ONLY=1"
    shift
    goto arg_loop
)
if /i "%~1"=="--no-clean" (
    set "NO_CLEAN=1"
    shift
    goto arg_loop
)
if /i "%~1"=="--clean-cache" (
    set "CLEAN_BUILD_CACHE=1"
    shift
    goto arg_loop
)
if /i "%~1"=="--list-generators" (
    set "LIST_GENERATORS=1"
    shift
    goto arg_loop
)
if /i "%~1"=="--run" (
    set "RUN_AFTER_BUILD=1"
    shift
    goto arg_loop
)
if /i "%~1"=="--install" (
    set "INSTALL_AFTER_BUILD=1"
    shift
    goto arg_loop
)
if /i "%~1"=="--test" (
    set "RUN_TESTS=1"
    shift
    goto arg_loop
)
if /i "%~1"=="--build-only" (
    set "BUILD_ONLY=1"
    shift
    goto arg_loop
)
if /i "%~1"=="--verbose" (
    set "VERBOSE_BUILD=1"
    shift
    goto arg_loop
)
if /i "%~1"=="--debug" (
    set "DEBUG_BUILD=1"
    set "CMAKE_BUILD_TYPE=Debug"
    shift
    goto arg_loop
)
if /i "%~1"=="--release" (
    set "RELEASE_BUILD=1"
    set "CMAKE_BUILD_TYPE=Release"
    shift
    goto arg_loop
)
if /i "%~1"=="--compiler-commands" (
    set "GENERATE_COMPILE_COMMANDS=1"
    shift
    goto arg_loop
)
if /i "%~1"=="-G" (
    if "%~2"=="" (
        echo %RED%ERROR:%RESET% Missing argument for -G option
        exit /b 1
    )
    set "CMAKE_GENERATOR=%~2"
    shift
    shift
    goto arg_loop
)
if /i "%~1"=="-D" (
    if "%~2"=="" (
        echo %RED%ERROR:%RESET% Missing argument for -D option
        exit /b 1
    )
    set "CMAKE_EXTRA_FLAGS=!CMAKE_EXTRA_FLAGS! -D%~2"
    shift
    shift
    goto arg_loop
)
:: Handle unknown arguments
echo %RED%ERROR:%RESET% Unknown argument: %~1
exit /b 1
:arg_end

:: Validate mutually exclusive flags
set "FLAG_CONFLICT=0"
if defined CLEAN_ONLY if defined NO_CLEAN set "FLAG_CONFLICT=1"
if defined CLEAN_ONLY if defined BUILD_ONLY set "FLAG_CONFLICT=1"
if defined DEBUG_BUILD if defined RELEASE_BUILD set "FLAG_CONFLICT=1"
if %FLAG_CONFLICT% equ 1 (
    echo %RED%ERROR:%RESET% Invalid combination of flags provided
    exit /b 1
)

:: Validate build directory path
set "FULL_BUILD_PATH=%SCRIPT_DIR%\%BUILD_DIR%"

:: Check CMake availability first
where cmake >nul 2>&1
if errorlevel 1 (
    echo %RED%ERROR:%RESET% CMake executable not found in PATH. Please install CMake and add it to your system PATH.
    exit /b 1
)

:: List generators if requested
if defined LIST_GENERATORS (
    echo %CYAN%Available CMake generators:%RESET%
    cmake --help
    exit /b 0
)

:: Print build configuration
echo %CYAN%Building helpy_plan_nif test program...%RESET%
echo.
echo Configuration:
echo   Build directory: %FULL_BUILD_PATH%
echo   CMake generator: %CMAKE_GENERATOR%
echo   Build type: %CMAKE_BUILD_TYPE%
if defined CLEAN_ONLY echo   Mode: Clean only
if defined NO_CLEAN echo   Mode: Incremental build (no clean)
if defined CLEAN_BUILD_CACHE echo   Mode: Clean CMake cache enabled
if defined BUILD_ONLY echo   Mode: Build only (skip CMake configure)
if defined RUN_AFTER_BUILD echo   Mode: Run after build
if defined INSTALL_AFTER_BUILD echo   Mode: Install after build
if defined RUN_TESTS echo   Mode: Run tests after build
if defined VERBOSE_BUILD echo   Mode: Verbose output enabled
if defined GENERATE_COMPILE_COMMANDS echo   Mode: Generate compile_commands.json enabled
if defined CMAKE_EXTRA_FLAGS echo   Extra CMake flags: %CMAKE_EXTRA_FLAGS%
echo.

:: Clean and recreate build directory if not skipped
if not defined NO_CLEAN (
    echo %YELLOW%Cleaning %BUILD_DIR% directory...%RESET%
    if exist "%FULL_BUILD_PATH%" (
        rmdir /s /q "%FULL_BUILD_PATH%"
        if errorlevel 1 (
            echo %RED%ERROR:%RESET% Failed to remove existing %BUILD_DIR% directory at %FULL_BUILD_PATH%
            exit /b 1
        )
    )
    if defined CLEAN_ONLY (
        echo.
        echo %GREEN%Clean completed successfully! %BUILD_DIR% directory removed.%RESET%
        exit /b 0
    )
    mkdir "%FULL_BUILD_PATH%"
    if errorlevel 1 (
        echo %RED%ERROR:%RESET% Failed to create %BUILD_DIR% directory at %FULL_BUILD_PATH%
        exit /b 1
    )
) else (
    if not exist "%FULL_BUILD_PATH%" (
        echo Build directory not found, creating it...
        mkdir "%FULL_BUILD_PATH%"
        if errorlevel 1 (
            echo %RED%ERROR:%RESET% Failed to create %BUILD_DIR% directory at %FULL_BUILD_PATH%
            exit /b 1
        )
    ) else (
        if defined CLEAN_BUILD_CACHE (
            echo %YELLOW%Cleaning CMake cache...%RESET%
            del /f /q "%FULL_BUILD_PATH%\CMakeCache.txt" >nul 2>&1
            rmdir /s /q "%FULL_BUILD_PATH%\CMakeFiles" >nul 2>&1
            if errorlevel 0 (
                echo %GREEN%CMake cache cleaned successfully%RESET%
            ) else (
                echo %YELLOW%WARNING:%RESET% No CMake cache found to clean%RESET%
            )
        )
    )
)

:: Enter build directory
cd /d "%FULL_BUILD_PATH%" || (
    echo %RED%ERROR:%RESET% Failed to enter %BUILD_DIR% directory at %FULL_BUILD_PATH%
    exit /b 1
)

:: Configure CMake if not skipped
if not defined BUILD_ONLY (
    :: Add compile_commands flag if requested
    if defined GENERATE_COMPILE_COMMANDS (
        set "CMAKE_EXTRA_FLAGS=!CMAKE_EXTRA_FLAGS! -DCMAKE_EXPORT_COMPILE_COMMANDS=ON"
    )
    
    echo.
    echo %YELLOW%Configuring CMake...%RESET%
    cmake "%SCRIPT_DIR%" -G "%CMAKE_GENERATOR%" -DCMAKE_COLOR_MAKEFILE=ON -DCMAKE_BUILD_TYPE="%CMAKE_BUILD_TYPE%" %CMAKE_EXTRA_FLAGS%
    if errorlevel 1 (
        echo %RED%ERROR:%RESET% CMake configuration failed
        cd /d "%SCRIPT_DIR%"
        exit /b 1
    )
    
    :: Copy compile_commands.json to project root for IDE access
    if defined GENERATE_COMPILE_COMMANDS if exist "%FULL_BUILD_PATH%\compile_commands.json" (
        copy /y "%FULL_BUILD_PATH%\compile_commands.json" "%SCRIPT_DIR%" >nul
        echo %GREEN%compile_commands.json copied to project root%RESET%
    ) else if defined GENERATE_COMPILE_COMMANDS (
        echo %YELLOW%WARNING:%RESET% compile_commands.json was requested but not generated%RESET%
    )
)

:: Build target with verbose support
set "BUILD_FLAGS="
if defined VERBOSE_BUILD set "BUILD_FLAGS=--verbose"

echo.
echo %YELLOW%Building %TARGET%...%RESET%
cmake --build . --config %CMAKE_BUILD_TYPE% --target %TARGET% %BUILD_FLAGS%
if errorlevel 1 (
    echo %RED%ERROR:%RESET% Build process failed for %TARGET%
    cd /d "%SCRIPT_DIR%"
    exit /b 1
)

:: Install target if requested
if defined INSTALL_AFTER_BUILD (
    echo.
    echo %YELLOW%Installing %TARGET%...%RESET%
    cmake --install . --config %CMAKE_BUILD_TYPE%
    if errorlevel 1 (
        echo %RED%ERROR:%RESET% Installation process failed for %TARGET%
        cd /d "%SCRIPT_DIR%"
        exit /b 1
    )
)

:: Run tests if requested
if defined RUN_TESTS (
    echo.
    echo %YELLOW%Running tests...%RESET%
    ctest -C %CMAKE_BUILD_TYPE% --verbose
    if errorlevel 1 (
        echo %RED%ERROR:%RESET% Test execution failed
        cd /d "%SCRIPT_DIR%"
        exit /b 1
    )
)

:: Success message
echo.
echo %GREEN%Build completed successfully! Output can be found in %FULL_BUILD_PATH%\%CMAKE_BUILD_TYPE%%RESET%

:: Run the target if requested
if defined RUN_AFTER_BUILD (
    echo.
    echo %YELLOW%Starting %TARGET%...%RESET%
    :: Handle both MinGW (root of build dir) and Visual Studio (subdir) output locations
    set "TARGET_EXE="
    if exist "%FULL_BUILD_PATH%\%CMAKE_BUILD_TYPE%\%TARGET%.exe" (
        set "TARGET_EXE=%FULL_BUILD_PATH%\%CMAKE_BUILD_TYPE%\%TARGET%.exe"
    ) else if exist "%FULL_BUILD_PATH%\%TARGET%.exe" (
        set "TARGET_EXE=%FULL_BUILD_PATH%\%TARGET%.exe"
    ) else (
        :: Fallback search for executable
        for /f "delims=" %%f in ('dir /s /b "%FULL_BUILD_PATH%\%TARGET%.exe" 2^>nul') do (
            set "TARGET_EXE=%%f"
            goto found_exe
        )
    )
    :found_exe
    
    if defined TARGET_EXE if exist "!TARGET_EXE!" (
        echo %GREEN%Found executable at: !TARGET_EXE!%RESET%
        start "" /WAIT "!TARGET_EXE!"
        set "EXIT_CODE=!errorlevel!"
        if !EXIT_CODE! neq 0 (
            echo %RED%ERROR:%RESET% Program exited with error code !EXIT_CODE!
            cd /d "%SCRIPT_DIR%"
            exit /b !EXIT_CODE!
        )
        echo %GREEN%Successfully ran %TARGET%%RESET%
    ) else (
        echo %RED%ERROR:%RESET% Could not find %TARGET% executable in any expected output directory
        cd /d "%SCRIPT_DIR%"
        exit /b 1
    )
)

:: Return to original directory
cd /d "%SCRIPT_DIR%"

