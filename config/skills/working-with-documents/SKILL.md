---
name: Working with Documents
description: Use when reading, extracting from, or generating real-world document files — PDFs, spreadsheets (CSV/Excel/Sheets), and slide decks — with available tools; preserve the source and verify the output.
version: 1.0.0
---

# Working with Documents

Documents are where real data lives: an invoice PDF, a budget spreadsheet,
a deck to update. The job is extracting exactly what's there and producing
files that open cleanly — with no silent data loss.

## Reading and extracting

- Confirm you have a tool that can actually parse the format — PDF text,
  spreadsheet cells, slide contents. A scanned PDF needs OCR, not a text
  parser; say so if that's the case.
- Pull structure, not just text: tables as rows and columns, not a
  flattened blob. Preserve headers and units.
- Quote figures exactly as they appear, and note the page, sheet, or cell
  so the user can check.
- Never fill gaps with invented numbers. If a value is unreadable, mark it
  unreadable.

## Generating and editing

- Work on a copy. Don't overwrite the user's original unless they ask.
- Match the format's conventions: real formulas in spreadsheets rather than
  pre-computed constants, consistent number and date formatting, sensible
  column widths.
- For an edit, change only what was requested and keep the rest intact —
  other sheets, other pages, existing styles.
- After writing, verify: reopen or re-parse the output and confirm the key
  values and structure survived.

## Handling tabular data

- Keep types honest — a number stays a number, a date stays a date. Don't
  turn IDs into rounded decimals.
- Watch encoding and delimiters on CSV: commas inside values, quoting, and
  UTF-8.

See `references/formats-and-tools.md`.

## Anti-patterns

- Overwriting the source file in place with no backup.
- Reporting numbers you couldn't actually read from the document.
- Flattening a table into prose and losing the columns.
- Writing constants where the spreadsheet should hold formulas.
