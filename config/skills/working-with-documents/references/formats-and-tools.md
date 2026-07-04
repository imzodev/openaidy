# Formats and tools

Pick the right parser/generator for the format, and know each one's traps.

## PDF

- Digital PDF → text/table extraction works directly.
- Scanned PDF (image pages) → needs OCR; flag lower confidence on figures.
- Preserve page numbers so quoted values can be traced.
- Forms: fill named fields; don't flatten a form you were asked to edit.

## Spreadsheets (CSV / Excel / Sheets)

- Keep cell types: number, date, text, boolean — don't stringify numbers.
- Preserve or write real formulas; don't bake in computed constants.
- CSV: quote values containing commas/newlines; write UTF-8; keep a header.
- Excel/Sheets: edit the target sheet only; leave other sheets untouched.
- IDs and codes stay text — never let them round or lose leading zeros.

## Slides / decks

- Edit the requested slides; keep the template, master, and other slides.
- Match existing fonts, colors, and layout rather than restyling.

## Verification (every format)

- [ ] Re-open or re-parse the output file.
- [ ] Key values and totals match the intended result.
- [ ] Structure intact — tables, sheets, pages, formatting.
- [ ] Original source left unmodified (worked on a copy).
