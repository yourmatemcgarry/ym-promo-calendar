@echo off
REM Double-click this file to start the Beer Pricing Strategy tool.
cd /d "%~dp0"
set PORT=8642
echo Starting local server on http://localhost:%PORT% ...
start "" http://localhost:%PORT%/index.html
where python >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    python -m http.server %PORT%
) else (
    where python3 >nul 2>nul
    if %ERRORLEVEL% EQU 0 (
        python3 -m http.server %PORT%
    ) else (
        echo Python was not found. Please install Python 3 from python.org, or open index.html via any other local web server.
        pause
    )
)
