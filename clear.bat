@echo off
chcp 65001 > nul
cd /d "%~dp0"

echo ============================================================
echo  EP4 Clear - mobile build temporary files cleanup
echo ============================================================
echo.

REM 1. mobile\build\ - Flutter build artifacts
if exist "mobile\build" (
    echo [1/8] Removing mobile\build\ ...
    rmdir /s /q "mobile\build"
    echo   Done.
) else (
    echo [1/8] mobile\build\ not found, skipping.
)

REM 2. mobile\.dart_tool\ - Dart toolchain cache
if exist "mobile\.dart_tool" (
    echo [2/8] Removing mobile\.dart_tool\ ...
    rmdir /s /q "mobile\.dart_tool"
    echo   Done.
) else (
    echo [2/8] mobile\.dart_tool\ not found, skipping.
)

REM 3. mobile\android\.gradle\ - Gradle build cache
if exist "mobile\android\.gradle" (
    echo [3/8] Removing mobile\android\.gradle\ ...
    rmdir /s /q "mobile\android\.gradle"
    echo   Done.
) else (
    echo [3/8] mobile\android\.gradle\ not found, skipping.
)

REM 4. mobile\android\.kotlin\ - Kotlin compile cache
if exist "mobile\android\.kotlin" (
    echo [4/8] Removing mobile\android\.kotlin\ ...
    rmdir /s /q "mobile\android\.kotlin"
    echo   Done.
) else (
    echo [4/8] mobile\android\.kotlin\ not found, skipping.
)

REM 5. mobile\windows\flutter\ephemeral\ - Flutter Windows DLLs/headers
if exist "mobile\windows\flutter\ephemeral" (
    echo [5/8] Removing mobile\windows\flutter\ephemeral\ ...
    rmdir /s /q "mobile\windows\flutter\ephemeral"
    echo   Done.
) else (
    echo [5/8] mobile\windows\flutter\ephemeral\ not found, skipping.
)

REM 6. mobile\windows\flutter\generated_plugin_registrant.cc
if exist "mobile\windows\flutter\generated_plugin_registrant.cc" (
    echo [6/8] Removing generated_plugin_registrant.cc ...
    del /q "mobile\windows\flutter\generated_plugin_registrant.cc"
    echo   Done.
) else (
    echo [6/8] generated_plugin_registrant.cc not found, skipping.
)

REM 7. mobile\windows\flutter\generated_plugin_registrant.h + generated_plugins.cmake
if exist "mobile\windows\flutter\generated_plugin_registrant.h" (
    echo [7/8] Removing generated_plugin_registrant.h + generated_plugins.cmake ...
    del /q "mobile\windows\flutter\generated_plugin_registrant.h"
    del /q "mobile\windows\flutter\generated_plugins.cmake" 2>nul
    echo   Done.
) else (
    echo [7/8] generated_plugin_registrant.h not found, skipping.
)

REM 8. mobile\.flutter-plugins-dependencies - plugin dependency cache
if exist "mobile\.flutter-plugins-dependencies" (
    echo [8/8] Removing .flutter-plugins-dependencies ...
    del /q "mobile\.flutter-plugins-dependencies"
    echo   Done.
) else (
    echo [8/8] .flutter-plugins-dependencies not found, skipping.
)

echo.
echo ============================================================
echo  Cleanup complete.
echo  (pubspec.yaml / pubspec.lock / android/local.properties
echo   and all source files are preserved.)
echo ============================================================
pause
