# Field installer: rebuild spec

Requirements for a standalone tool that keeps named lists of Flow Production Tracking (FPT) field
definitions, fills them from spreadsheets or by hand, compares them with a live site, and installs
them. Behaviour only. No code, no stack mandate.

Written 2026-11-10. API facts cite `~/dev/sg-groundtruth/corpus` at tag `corpus/2026-09-25`.

## Read in this order

| file | what it holds |
|---|---|
| `01-overview-and-scope.md` | What the tool is, the words used, v1 scope, what is left out |
| `02-data-model.md` | Sets, entries, attributes, uniqueness, data types |
| `03-set-list.md` | List screen: browse, search, create, duplicate, delete |
| `04-import.md` | CSV and XLSX import: parsing, type resolution, matching, type guessing |
| `05-editor.md` | Editor screen: working copy, validation, bulk actions, save |
| `06-site-comparison.md` | Advisory comparison of entries with the live schema |
| `07-install-plan.md` | How the plan is computed: classes, diffs, equality rules |
| `08-install-run.md` | Install screen and run: order, create, revive, update, visibility, cancel, retry |
| `09-api-and-widgets.md` | Each FPT operation mapped to the corpus; corpus gaps; sg-widgets map and gaps |
| `10-open-questions.md` | Decisions for Kevin; baseline behaviour that should not be copied |

## Conventions

- Requirement IDs are stable: an area prefix and a number (SET-3, RUN-12). Do not renumber; retire
  an ID instead.
- "Must" is a requirement. "Default" is a starting value that may be tuned.
- **Baseline** means the behaviour this spec was written from. Where the corpus contradicts the
  baseline, the requirement follows the corpus and the difference is listed in file 10.
- **Conditional** requirements depend on an API behaviour that the corpus has not confirmed. Each
  names its probe question (file 09) and its fallback. Build the fallback first.
- FPT's own words are used as FPT uses them: entity type, display name, data type, valid types,
  valid values, default value.
