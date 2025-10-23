# From [LANGUAGE] folder use: ..\build.ps1
# PowerShell build script. Supports --draft, --delete, --help

. ..\build.config.ps1

param (
    [string]$Mode = "full"
)

if ($args.Length -gt 0) {
    switch ($args[0]) {
        "--draft"  { $Mode = "draft" }
        "--delete" { $Mode = "delete" }
        "--help" {
            Write-Host "Usage: ..\build.ps1 [--delete | --draft | --full | --help]"
            Write-Host "`nOptions:"
            Write-Host "  --delete   Delete all generated files"
            Write-Host "  --draft    Compile without bibliography (faster)"
            Write-Host "  --full     Compile with bibliography (default)"
            Write-Host "  --help     Show this help message"
            exit 0
        }
        default {
            Write-Error "Unknown option '$($args[0])'"
            exit 1
        }
    }
}

if (-not (Test-Path $TEX_FILE)) {
    Write-Error "'$TEX_FILE' not found."
    exit 1
}

Get-Command lualatex -ErrorAction Stop | Out-Null
if ($Mode -eq "full") {
    Get-Command biber -ErrorAction Stop | Out-Null
}

Write-Host "Deleting generated files..."
Remove-Item *.pdf, *.aux, *.log, *.out, *.toc, *.run.xml, *.nav, *.snm, *.fls, *.fdb_latexmk -ErrorAction SilentlyContinue
if ($Mode -eq "full" -or $Mode -eq "delete") {
    Remove-Item *.bcf, *.blg, *.bbl -ErrorAction SilentlyContinue
}
if ($Mode -eq "delete") {
    Write-Host "Done deleting. Exiting."
    exit 0
}

Write-Host "Compiling (mode: $Mode)..."
lualatex $TEX_FILE | Out-Null
if ($Mode -eq "full") {
    biber $TEX_NAME | Out-Null
    lualatex $TEX_FILE | Out-Null
}

$CurrDirName = Split-Path -Leaf (Get-Location)
$PdfName = "${TEX_NAME}_${CurrDirName}.pdf"

if (-not (Test-Path $DIST_DIR)) {
    New-Item -ItemType Directory -Path $DIST_DIR | Out-Null
}

if (Test-Path "$DIST_DIR\$PdfName") {
    $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
    Copy-Item "$DIST_DIR\$PdfName" "$DIST_DIR\${TEX_NAME}_${CurrDirName}_backup_$timestamp.pdf"
}

Move-Item -Force "$TEX_NAME.pdf" "$DIST_DIR\$PdfName"
Write-Host "DONE. PDF saved as: $DIST_DIR\$PdfName"