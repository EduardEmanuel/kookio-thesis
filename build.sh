#!/bin/bash
# From [LANGUAGE] folder use: ../build.sh
# LaTeX build script (Unix). Supports: --draft, --delete, --help

set -euo pipefail

source ../build.config.sh

MODE="full"
case "${1:-}" in
  --draft) MODE="draft" ;;
  --delete) MODE="delete" ;;
  --help)
    echo "Usage: ../build.sh [--delete|--draft|--full|--help]"
    echo ""
    echo "Options:"
    echo "  --delete  Delete auxiliary files only"
    echo "  --draft   Compile without bibliography (faster)"
    echo "  --full    Compile with bibliography (default)"
    echo "  --help    Show this help message"
    exit 0 ;;
  ""|--full) ;;
  *) echo "Error: unknown option '$1'"; exit 1 ;;
esac

if [ ! -f "$TEX_FILE" ]; then
  echo "Error: '$TEX_FILE' not found."; exit 1
fi

command -v lualatex >/dev/null || { echo "Error: lualatex not found"; exit 1; }
if [[ "$MODE" == "full" ]]; then
  command -v biber >/dev/null || { echo "Error: biber not found"; exit 1; }
fi

echo "Deleting generated files..."
rm -f *.pdf *.aux *.log *.out *.toc *.run.xml *.nav *.snm *.fls *.fdb_latexmk
[[ "$MODE" == "full" || "$MODE" == "delete" ]] && rm -f *.bcf *.blg *.bbl
[[ "$MODE" == "delete" ]] && echo "Done deleting. Exiting." && exit 0

echo "Compiling (mode: $MODE)..."
lualatex "$TEX_FILE"
[[ "$MODE" == "full" ]] && biber "$TEX_NAME" && lualatex "$TEX_FILE"

CURR_DIR_NAME=$(basename "$(pwd)")
mkdir -p "$DIST_DIR"
[[ -f "$DIST_DIR/${TEX_NAME}_${CURR_DIR_NAME}.pdf" ]] && cp "$DIST_DIR/${TEX_NAME}_${CURR_DIR_NAME}.pdf" "$DIST_DIR/${TEX_NAME}_${CURR_DIR_NAME}_backup_$(date +%s).pdf"
mv -f "${TEX_NAME}.pdf" "$DIST_DIR/${TEX_NAME}_${CURR_DIR_NAME}.pdf"
echo "DONE. PDF saved as: $DIST_DIR/${TEX_NAME}_${CURR_DIR_NAME}.pdf"