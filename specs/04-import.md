# 4. Import from CSV and XLSX

Import reads **column headers**. Each header becomes one entry. Data rows are looked at only to guess
a data type. No row data is stored or sent to the site.

## Dialog flow

- IMP-1. The user drops or browses for one or more files. More files can be added while the dialog
  is open.
- IMP-2. Accepted: names ending in .csv or .xlsx, case-insensitive. Anything else is refused with a
  message; other files in the same drop still load.
- IMP-3. A file over the size cap (default 15 MB) is refused before it is read, with a message
  naming the file and the cap.
- IMP-4. A file that cannot be parsed is refused with a message naming it.
- IMP-5. A file with no readable header row is refused with a message naming it.
- IMP-6. Each CSV becomes one **bucket**. Each worksheet of an XLSX that has a header row becomes
  one bucket, labelled with file name and sheet name, in workbook order. Sheets without a header row
  are dropped silently.
- IMP-7. Buckets appear as soon as their file is parsed. Schema lookups come after and may never
  delay or block a bucket from showing.
- IMP-8. Each bucket row shows its label, its column count, a **fallback entity type** chooser and a
  remove action.
- IMP-9. The set name defaults to the first accepted file's name without extension, once, and only
  if the name box is still empty. The user can change it.
- IMP-10. A footer line shows total columns and total buckets with correct plurals.
- IMP-11. The confirm action is enabled only when: nothing is saving, the set name is non-blank,
  there is at least one bucket, and every bucket has a fallback entity type.
- IMP-12. Only the most recent problem message is shown at a time. Adding files clears it first.
- IMP-13. The dialog cannot be dismissed while saving. Closing it otherwise discards all buckets.

## Fallback entity type per bucket

- IMP-14. With a site connected, the chooser lists the site's entity types. Without one, it is a
  free text box.
- IMP-15. With a site connected, the tool pre-fills each new bucket's fallback by inference: among
  the common entity types (SET-25 list, in that order), pick the one whose live fields match the most
  of the bucket's headers (matching rule IMP-27). Ties go to the earlier type. Zero matches leaves it
  empty.
- IMP-16. Inference never overwrites a fallback the user already set. If the schema read fails or is
  slow, buckets stay with an empty fallback for the user to pick.

## Which entity type a column belongs to

Three signals: a prefix in the header, the worksheet name, the bucket's fallback.

- IMP-17. A mode switch applies to the whole import: **automatic** (default), **worksheet**,
  **header prefix**.
- IMP-18. A header is split at the **last** occurrence of the delimiter. Left part, trimmed, is the
  type hint (blank means none). Right part, trimmed, is the field name. No delimiter: no hint, the
  whole header is the field name.
- IMP-19. Delimiter default: two colons, as database exports write "Table, two colons, Field". The
  user can change it. The delimiter box is hidden in worksheet mode.
- IMP-20. The field name always has the prefix removed, in every mode, even when the prefix is
  ignored for choosing the type.
- IMP-21. A hint or worksheet name is resolved against the site's entity types: case-insensitive,
  against both the API name and the display name, tolerating a trailing "s" or "es" on either side.
  So a "Lenses" sheet resolves to the custom entity whose display name is "Lens", and the result is
  that type's API name. No match resolves to nothing.
- IMP-22. Automatic mode: header prefix, else worksheet name, else fallback.
- IMP-23. Worksheet mode: worksheet name, else fallback. The prefix is ignored for the type.
- IMP-24. Header prefix mode: header prefix, else fallback. The worksheet name is ignored.
- IMP-25. If nothing resolves and there is no fallback, the entry's target type is empty and the
  entry is incomplete in the editor.
- IMP-26. A one-line hint under the switch says, in plain words, what the current mode does.

## Matching a column to a live field

- IMP-27. Normalise both sides: trim, lowercase, replace every run of non-alphanumeric characters
  with one space, trim again. "Tk Lens Height (Start)" and "tk_lens_height_start" are equal.
- IMP-28. Compare the field name with each live field of the resolved type: first against display
  names, and only if none match, against programmatic names. Exact equality after normalising. No
  fuzzy matching. A blank name matches nothing.
- IMP-29. Live fields are read only for the entity types the import actually resolved to.
- IMP-30. **On a match**, the entry mirrors the live field: its programmatic name, its data type
  exactly as read (MOD-14, MOD-16), valid types and valid values when non-empty, the unique flag,
  description when non-blank, default value when present, plus the snapshot and the snapshot site.
  The entry's display name is the site's display name, not the header's text, so an import never
  plans a rename. The user may edit it afterwards to rename on purpose. (Decided, Q8. Baseline used
  the header's text.)
- IMP-31. **On no match**, the entry gets: the predicted programmatic name (MOD-17), a guessed data
  type (IMP-33), and nothing else. No snapshot, no valid types.
- IMP-32. A blank header produces no entry. A header that is only a prefix produces no entry.

## Guessing a data type

- IMP-33. Take the column's values, trim, drop blanks, keep the first 20. Then, in this order:

| if every kept value is | the guess is |
|---|---|
| (there are none) | text |
| true, false, yes or no, any case | checkbox |
| a year-month-day date followed by a time (hours and minutes, optional seconds; space or "T" between) | date and time |
| a year-month-day date | date |
| an optionally negative whole or decimal number | number |
| anything else, or a mix | text |

- IMP-34. A column of 0 and 1 is number, never checkbox.
- IMP-35. One value that does not fit drops the guess to text. A wrong guess costs more than a plain
  text field.
- IMP-36. A column of whole numbers guesses number. A column holding any decimal value guesses
  float. (Decided, Q10. Baseline guessed number for both.)

## CSV parsing

- IMP-37. Comma separated. Double-quoted values may contain commas and line breaks. A doubled quote
  inside a quoted value is one quote. Both line-ending styles are accepted. A byte-order mark at the
  start is ignored.
- IMP-38. Fully blank lines are dropped. A file without a final line break parses the same.
- IMP-39. The first non-blank line is the header row. Headers are trimmed.
- IMP-40. Rows shorter or longer than the header are kept as they are; a missing cell reads as blank.
- IMP-41. Semicolon and tab separators are detected from the header line, and the file is then
  parsed by the same rules as a comma separated one. (Decided, Q11. Baseline read commas only.)

## XLSX parsing

- IMP-42. Read-only. Sheets are returned in workbook order with their names.
- IMP-43. Shared and inline text cells resolve to their text. Boolean cells read as true or false.
  Formula cells read as their stored result.
- IMP-44. Cells are placed by their column reference, so a row with gaps still lines up. Data rows
  are padded or cut to the header's width.
- IMP-45. At most the header row plus a sample of data rows (default 50) is read per sheet.
- IMP-46. Known limit, kept: date cells are stored as serial numbers, so a date column may guess as
  number. Headers are unaffected.
- IMP-47. Bytes that are not a workbook raise the IMP-4 message.

## Creating the set

- IMP-48. Entries from all buckets are concatenated in bucket order, then de-duplicated on (target
  entity type, programmatic name). The first occurrence wins. The number dropped is counted.
- IMP-49. The set and all its entries are created in one all-or-nothing step (MOD-4), with origin
  import, and origin details as in the set table of file 02.
- IMP-50. On success: a confirmation states how many fields were imported and, if any, how many
  duplicate columns were skipped. The dialog closes and the editor opens on the new set with a
  dismissible banner stating how many fields were imported and asking the user to review each one's
  entity type and data type.
- IMP-51. On failure the message shows in the dialog, nothing is created, the buckets stay.
- IMP-52. Without a connected site, import still works: no matching, no inference, all types
  guessed, fallback typed by hand.
