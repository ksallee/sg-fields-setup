# 8. Install screen and run

## Screen

- RUN-1. Opening it computes the plan (file 07) for all eligible projects and shows a "checking the
  live schema" state meanwhile. A planning failure shows the error in place of the plan.
- RUN-2. The plan is shown in collapsible groups, in this order: type conflicts, blocked, create,
  update, already matches. "Already matches" starts collapsed; the rest start open. Each header
  shows its count. The refusals of PLN-14 to PLN-16 show with the conflicts, each with its reason.
- RUN-3. Each row shows entity type, display name, programmatic name and data type. Update rows
  list each difference as "setting: live value, arrow, wanted value"; an empty value shows as an
  empty-set sign; a list shows in brackets. Blocked rows list the blocked differences and the reason.
  Conflict rows show both data types.
- RUN-4. Rows in create, update and already-matches have a checkbox, on by default. Conflict and
  blocked rows have none and are marked as skipped. A select-all control shows "N of M selected" and
  a mixed state. An already-matches row with nothing left to do (no visibility to add, VIS-9) is
  unticked and disabled.
- RUN-5. A summary shows counts of selected creates, updates and already-matching rows, counts of
  conflicts and blocked rows, the visibility scope (all eligible projects with their number, or the
  number chosen), and the number of visibility changes (VIS-10).

Footer actions:

| action | when | effect |
|---|---|---|
| refresh | not loading, not running | Discards run state, re-plans from the site, bypassing any cache. |
| apply | plan loaded, not running, not finished, at least one row selected | Starts the run for the selected rows. |
| cancel | running | Stops after the current step (RUN-18). |
| close | not running | Closes the screen. |
| retry | finished with failures | Re-runs only the failed rows (RUN-19). |

## Run

- RUN-6. A run re-plans the selected entries from the site first, then applies the items **one at a
  time, in plan order** (the order of the entries as stored). No two schema writes run at once.
- RUN-7. Per item, by class:

| class | steps | outcome |
|---|---|---|
| type conflict, blocked, PLN-14 to PLN-16 refusals | none | skipped, with the reason |
| already matches | visibility only (VIS-5) | skipped, reason: nothing to change |
| update | re-read the field. Gone: fail. A blocked difference now: fail with the reason. Otherwise write the differences, verify (RUN-15), then visibility (VIS-5). | done |
| create | see RUN-8 to RUN-12, then visibility (VIS-4) | done, skipped or failed |

### Create, step by step

- RUN-8. Re-read the field. If it is now live with the wanted type: skip as "already exists" and
  apply visibility as for an existing field. If live with another type: skip as a type conflict.
- RUN-9. Otherwise try to **revive** a retired field of that name
  (`endpoints/post_schema_type_fields_field.md`). "Nothing to revive" leads to RUN-11.
- RUN-10. If the revive succeeded, read the revived field:
  - Not readable: fail.
  - Its data type differs from the wanted one: delete it again (back to the trash) and fail. The
    message says the name is held by a retired field of that other type, that it cannot be reused
    through the API, and that the user must delete it for good from the site's trash page, with a link.
  - It has a blocked difference (PLN-8): delete it again and fail with the same kind of message,
    naming the setting.
  - It has other differences: write them, verify, done.
  - No differences: done.
- RUN-11. Plain creation (`endpoints/post_schema_type_fields.md`). Read the programmatic name the
  server assigned from the response's self link, its last segment. It is not in the body.
- RUN-12. If the assigned name differs from the wanted one, delete the just-created field and fail,
  stating both names. PLN-15 and PLN-16 exist so this never happens; it stays as a last guard,
  because the deletion spends a name for good (`endpoints/delete_schema_type_fields_field.md`).

### Retired fields: baseline, and what is conditional

- RUN-13. Baseline behaviour, stated as fact: the tool always attempted a revive before a create;
  re-trashed a revived field it could not use; never emptied the trash; and for every dead end told
  the user to remove the field for good on the site's trash page and run again. Kevin's note: this
  path was clunky in use.
- RUN-14. The v1 requirement is that same sequence, which is also the corpus's
  (`findings/040_field_revive.md`, six steps). It rests on behaviour last measured before
  2026-09-25. It is **conditional on re-probe G2**. If the re-probe finds a cleaner path (a way to
  list retired fields, or to free a name), the plan should then foresee retired names and offer the
  choice up front. Fallback, if revive no longer works as measured: do not revive; on the server's
  "retired field with the same name" refusal, fail the item with the trash-page instruction.

### Verification and errors

- RUN-15. After every update, read the field back and compare the written settings. A success
  status proves nothing on these endpoints (`findings/028_loud_and_silent.md`,
  `endpoints/put_schema_type_fields_field.md`). A mismatch is a failure naming the setting.
- RUN-16. One item's failure never stops the run. The next item proceeds.
- RUN-17. A failure outside any item (the run cannot start, planning fails, the connection drops)
  shows one run-level error and ends the run as finished.

### Cancel and retry

- RUN-18. Cancel is honoured between items and between per-project visibility steps. The step in
  flight completes. Remaining items stay pending. The run ends as cancelled and says so. Cancelling
  before the first item writes nothing.
- RUN-19. Retry re-runs only the failed items. Rows that already completed keep their result on
  screen. Each retried row returns to pending first. If a retried item's class has changed, its row
  updates to the new class.
- RUN-20. There is no undo. A created field is not removed by the tool afterwards. An interrupted
  or partly failed run can be resumed or retried, and the run's report lists what was created.
  (Decided, Q12.)

### Messages

- RUN-21. Reasons shown for blocked and failed items must be specific: name the field (display and
  programmatic name), the setting, the live value and the wanted value, and the manual fix. For the
  unique flag the fix is on the site's field configuration (CMP-9). For anything that needs the
  trash, link to the site's trash page. Links open in a new tab. Message text may carry simple
  formatting and links and must be sanitised before display.

### Progress

- RUN-22. Each row shows its state: pending, in progress, done, skipped, failed. A failed row shows
  its error beneath it. While a row's visibility is being applied it shows "done of total" projects.
- RUN-23. An overall counter shows finished items (done, skipped or failed) out of the total, and a
  label: applying, done, or cancelled.
- RUN-24. At the end a notification summarises: N applied, N skipped, and N failed if any; or that
  the install was cancelled; or the run-level error.
- RUN-25. Checkboxes are locked while running and after finishing. Refresh unlocks by starting over.
- RUN-26. After a run, the visibility analysis (VIS-8) is recomputed, since new fields now exist.

## Visibility per project

All VIS requirements are **conditional on probe G6**. The corpus records that a field's `visible`
property is editable (`findings/040_field_revive.md`, `findings/056_stock_vs_custom_field.md`) but
has not measured reading or writing it per project. Baseline did both by passing a project with the
schema read and the schema update. Fallback if G6 fails: drop the picker and all VIS behaviour; the
install creates and updates fields only, and says that visibility is managed in FPT.

- VIS-1. Fields are site-wide. The picker only decides on which projects they are visible. The
  screen explains this.
- VIS-2. An empty picker means all eligible projects. Baseline defined eligible as status "Active"
  and not a template. The corpus says status is not a liveness signal and is empty on most projects
  (`findings/018_project_listing.md`). Requirement: eligible means not a template and not archived;
  and not a demo project. Do not filter on status. (Decided, Q4.)
- VIS-3. With chosen projects, their names are resolved from the site. If that lookup fails, the run
  continues with placeholder names built from the ids. If the all-eligible lookup fails, the scope is
  empty and no visibility is applied.
- VIS-4. **New field** (created or revived in this run): made visible on every project in scope.
  If the scope is chosen projects, it is also made hidden on every other eligible project, so a new
  field ends up visible only where chosen. With an empty picker nothing is hidden.
- VIS-5. **Existing field** (update, already matches, or found already live during create): made
  visible on every project in scope. Never hidden anywhere.
- VIS-6. The tool never removes visibility from a field that existed before the run.
- VIS-7. Each per-project step reads the current state first and writes only if it differs. A
  missing visible value means visible. A failed step does not fail the item: the item shows as installed with a warning that names the
  projects where visibility was not set, the error, and a retry for that step alone. (Decided, Q5.
  Baseline logged and skipped silently.)
- VIS-8. Analysis before the run: for the update and already-matching rows, the tool reads, in the
  background, where each field is visible now. One read per (entity type, project) covers all fields
  of that type. Reads run in parallel with a cap (default 10). Only fields that belong to the set may
  be asked about. Results are cached per set and request until refresh.
- VIS-9. Per row, against the current picker: projects already visible, projects to add, projects
  still being analysed, and projects outside the picker where it is visible. A create row has every
  picker project as "to add". Shown as small counters, with a tooltip listing project names (up to
  20, then "and N more") and, for outside projects, the reminder of VIS-6.
- VIS-10. The summary's visibility count is the sum of "to add" over selected rows once analysis is
  loaded; before that, an upper bound (selected rows times projects in scope) marked as such.
- VIS-11. Changing the picker recomputes VIS-9 and VIS-10 without re-reading the site.
- VIS-12. If the analysis fails, rows stay in "analysing" and the run is still allowed.

## Permissions

- RUN-27. Schema writes need rights the signed-in person may not have. The corpus has not measured
  which, or what the refusal looks like (gap G7). Requirement: a refused write is reported per item
  with the server's message, and the run continues. If G7 yields a check that writes nothing, run it
  before enabling apply.
