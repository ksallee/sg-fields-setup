# 10. Open decisions and questions

## Decisions (how, not what)

The baseline's stack is not a requirement. Each need is stated with a suggested default taken from
the sibling tool sg-task-templates.

| id | need | suggested default | alternatives |
|---|---|---|---|
| D1 | Sets and entries must persist between sessions. | The sibling keeps nothing on a server. Default: store sets in the browser, with export and import of a set as a file so sets can be shared and backed up. Saves become atomic (EDT-48). | A small database with accounts, if sets must be shared live between people. |
| D2 | A connection to one FPT site, acting as a person. | App Session Launcher sign-in, token in the browser, no script key, no server secrets (`findings/052`, `recipes/012`). | Script key held server-side. |
| D3 | Who may use the tool. | Anyone who can sign in; FPT's own permissions decide what the writes may do (RUN-27, G7). No roles in the tool. | An admin gate in the tool. |
| D4 | Where the install runs. | In the browser, calling the site through the client, one item at a time; progress is local state. | A server process streaming progress events. |
| D5 | App shape. | SvelteKit at the repo root, live only, no mock, deployed like the sibling. sg-widgets default theme. | Qt, later, on sg-widgets-qt. |
| D6 | Schema cache. | Per session, in memory; refresh action bypasses it. | Persisted with an age limit. |
| D7 | Ownership scope for unique set names (MOD-2). | With D1 default: the browser's store. | Per site, or per account. |

## Decided by Kevin, 2026-11-10

Where a requirement elsewhere still reads differently, this table wins.

| id | decision | requirements |
|---|---|---|
| Q1 | Entities are not created or enabled by v1. Entries for an entity type the site lacks show as "not on this site", with the instruction to enable it in the admin interface and a re-check. Enabling from the tool waits for a site where the API call answers (G1). | OVR, CMP, W7 |
| Q2 | Revive silently, as the baseline did. No prompt before reviving a retired field. | RUN-9 to RUN-14 |
| Q3 | Refuse at plan time any create whose name the server would change: a clash with a live field, or a requested programmatic name the server would not derive. A clash with a retired field cannot be seen in advance; it is found from the server's refusal at run time and handled by the revive sequence. | PLN-15, PLN-16 |
| Q4 | Demo projects are not eligible for visibility. | VIS-2 |
| Q5 | A failed visibility step is a warning on the row, with a retry for that step. | VIS-7 |
| Q6 | Site capture is out of v1. | scope |
| Q7 | Aliases are dropped from v1. | MOD, EDT-31 |
| Q8 | A matched import column takes the site's display name. | IMP-30 |
| Q9 | Duplicating auto-numbers the copies. | SET-20 |
| Q10 | Decimal columns guess float. | IMP-36 |
| Q11 | Semicolon and tab separated files are detected. | IMP-41 |
| Q12 | No undo. Resume and retry are kept. | RUN-20 |
| Q13 | The tool is field setup, not automation, and is outside the sibling's "no configurable automations" rule. It has no triggers, no rules that react to events and no scheduled runs. | OVR |
| D1 | Sets are stored in the browser, with export and import of a set as a file. No server, no accounts. | MOD-2, EDT-48, D7 |

D2 to D7 take the suggested defaults above unless Kevin says otherwise.

## Baseline behaviour not to copy

Things that looked like bugs or accidents. The requirements above already avoid them.

- B1. Name prediction disagreed with the server. The baseline collapsed runs of punctuation into one
  underscore and trimmed underscores at the ends; the server replaces each character and trims
  nothing. For a display name with punctuation the create came back under another name, the tool
  deleted it, and the name was spent. MOD-17 follows the server.
- B2. A manually typed programmatic name on a new field could never be honoured, since the server
  derives the name from the display name. The baseline allowed it and failed at run time. PLN-15.
- B3. Valid types were held as display names in the editor, as API names after import, and sent to
  the site unconverted. The editor's help text promised a conversion at install that did not exist.
  MOD-12 stores API names only.
- B4. Mirror entries were read-only in the editor but not excluded from the plan. An absent computed
  field would have been attempted as a create. PLN-10.
- B5. "All active projects" filtered on a status value that most projects do not carry. VIS-2.
- B6. Custom versus standard fields were told apart by name prefix. EDT-21 follows the corpus.
- B7. A save that failed part-way left earlier steps applied with no rollback. EDT-48, D1.
- B8. The list decided "there is more to load" from a full page, so an exact multiple of the page
  size cost one empty request. Harmless; use the total count instead.
- B9. Colour was offered as a creatable type; the corpus measured it refused. MOD-13, G3.
- B10. The first site found was used silently when several were connected. OVR-7 makes one site
  explicit.

## Not verified

- The baseline's reading of where description, unique and default value sit in a field's schema
  record (PLN-6) was taken from its code and tests, not checked against a live response or the
  corpus sample.
- Whether the baseline's assumptions in G3 to G8 were ever true on a real site. Its one live test
  covered creating a text field and re-planning it as "already matches".
- The revive call's exact request form differs between the baseline and the corpus. The corpus form
  is the one to build on.
