#!/usr/bin/env bash
# Build docs/SSS-Documentation.docx from the Markdown docs using pandoc.
set -euo pipefail
cd "$(dirname "$0")/.."

OUT="docs/SSS-Documentation.docx"
COMBINED="$(mktemp -t sss-docs).md"
REFERENCE="scripts/reference.docx"

# Sections in order. README first, then the docs/ set.
SECTIONS=(
  "README.md"
  "docs/ARCHITECTURE.md"
  "docs/DATA_MODEL.md"
  "docs/API.md"
  "docs/DEPLOYMENT.md"
  "docs/CARD_READER.md"
  "docs/CONGRESSUS.md"
  "docs/ADMIN_GUIDE.md"
  "docs/PPP.md"
  "docs/DIMENSIE.md"
  "docs/SECURITY.md"
)

# YAML metadata → title page.
cat > "$COMBINED" <<'YAML'
---
title: "SSS — Stress Snack System"
subtitle: "System Documentation"
author: "Stress Snack System"
date: "Self-service snack kiosk · Next.js · PostgreSQL · Prisma · Railway · Congressus"
lang: en
---

YAML

# Concatenate sections with a page break between each.
first=1
for f in "${SECTIONS[@]}"; do
  if [ "$first" -eq 0 ]; then
    printf '\n\n```{=openxml}\n<w:p><w:r><w:br w:type="page"/></w:r></w:p>\n```\n\n' >> "$COMBINED"
  fi
  if [ "$f" = "README.md" ]; then
    # The YAML title page already shows the project name; retitle the README
    # section so it reads "Overview" in the table of contents instead of
    # duplicating the title.
    sed '1s|^# .*|# Overview|' "$f" >> "$COMBINED"
  else
    cat "$f" >> "$COMBINED"
  fi
  first=0
  printf '\n\n' >> "$COMBINED"
done

# Generate a reference doc once (then it can be hand-tweaked and kept).
if [ ! -f "$REFERENCE" ]; then
  pandoc --print-default-data-file reference.docx > "$REFERENCE"
fi

pandoc "$COMBINED" \
  --from=gfm+raw_attribute \
  --to=docx \
  --reference-doc="$REFERENCE" \
  --toc \
  --toc-depth=2 \
  --syntax-highlighting=tango \
  --metadata=lang:en \
  -o "$OUT"

rm -f "$COMBINED"
echo "Wrote $OUT ($(du -h "$OUT" | cut -f1))"
