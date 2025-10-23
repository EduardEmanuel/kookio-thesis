@echo off
REM From [LANGUAGE] folder use: ..\build.bat
REM LaTeX build script (Windows CMD). Supports: --draft, --delete, --help

call ../build.config.bat

set MODE=full
if "%~1"=="--draft" (
    set MODE=draft
) else if "%~1"=="--delete" (
    set MODE=delete
) else if "%~1"=="--help" (
    echo Usage: ..\build.bat [--delete ^| --draft ^| --full ^| --help]
    echo.
    echo Options:
    echo   --delete   Delete all generated files
    echo   --draft    Compile without bibliography (faster)
    echo   --full     Compile with bibliography (default)
    echo   --help     Show this help message
    exit /b 0
) else if not "%~1"=="" (
    echo Error: Unknown option %~1
    exit /b 1
)

if not exist %TEX_FILE% (
    echo Error: '%TEX_FILE%' not found.
    exit /b 1
)

where lualatex >nul 2>nul || (echo Error: lualatex not found. & exit /b 1)
if "%MODE%"=="full" (
    where biber >nul 2>nul || (echo Error: biber not found. & exit /b 1)
)

REM Get current folder name
for %%I in (.) do set "CURR=%%~nxI"
set "PDF_NAME=%TEX_NAME%_%CURR%.pdf"

echo Deleting generated files...
del /q *.pdf *.aux *.log *.out *.toc *.run.xml *.nav *.snm *.fls *.fdb_latexmk 2>nul
if "%MODE%"=="full" (
    del /q *.bcf *.blg *.bbl 2>nul
)
if "%MODE%"=="delete" (
    echo Done deleting. Exiting.
    exit /b 0
)

echo Compiling (mode: %MODE%)...
lualatex %TEX_FILE%
if "%MODE%"=="full" (
    biber %TEX_NAME%
    lualatex %TEX_FILE%
)

if exist %DIST_DIR% (
    if not exist %DIST_DIR%\NUL (
        echo Error: '%DIST_DIR%' exists but is not a directory.
        exit /b 1
    )
) else (
    mkdir %DIST_DIR%
)

if exist "%DIST_DIR%\%PDF_NAME%" (
    set TS=%date:~-4%%date:~3,2%%date:~0,2%_%time:~0,2%%time:~3,2%%time:~6,2%
    copy /Y "%DIST_DIR%\%PDF_NAME%" "%DIST_DIR%\%TEX_NAME%_%CURR%_backup_%TS%.pdf" >nul
)

move /Y "%TEX_NAME%.pdf" "%DIST_DIR%\%PDF_NAME%" >nul
echo DONE. PDF saved as: %DIST_DIR%\%PDF_NAME%