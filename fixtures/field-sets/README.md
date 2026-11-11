# Hand-built sets

Four sets built by hand on 2026-11-10 from two real spreadsheets and checked against one probed site.
Each set file here (`camera-report-*.json`, `weekly-status-report.json`) is in the format of
`src/lib/pure/set-file.ts`: the app imports it, and tests use it. The import time in each stands for
the day they were built.

A set file holds only what a set stores. What the review found is in `review-notes.json`, keyed by
set file:

- `source`: the spreadsheet, and where in it the columns came from.
- `entries`, one per entry by `programmaticName`:
  - `sourceHeader`: the column header in the spreadsheet.
  - `onProbedSite`: `exists` if the field was already on the probed site, `new` if it would be created.
  - `mappedFromNearDuplicate`: true when the column was mapped to a site field with a close but
    different name.
  - `review`: the reviewer's note.
- `skippedColumns`: columns left out of the set, and why.
