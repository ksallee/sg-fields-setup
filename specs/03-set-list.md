# 3. Set list screen

The entry point. Lists the user's sets and starts every flow.

## Layout

- SET-1. Header with two actions: start an import, create an empty set.
- SET-2. A search box, an origin filter (all, import, site capture, manual) and a sort choice
  (recently changed, recently created, name A to Z).
- SET-3. One row or card per set showing: name (opens the editor), description or a muted "none"
  placeholder, origin, entry count with correct singular and plural, and relative time since last
  change. Two row actions: duplicate, delete.

## Listing

- SET-4. Default sort: recently changed, newest first. Recently created: newest first. Name:
  ascending. No other directions are offered.
- SET-5. Search matches the set name or description, case-insensitive, substring. Wildcard and
  query-syntax characters typed by the user are treated as plain text.
- SET-6. Search is debounced (default 300 ms) and reloads from the first page.
- SET-7. Changing the filter or sort reloads from the first page.
- SET-8. Sets load a page at a time (default 20) and more load as the user scrolls to the end.
  A "loading more" line shows during that.
- SET-9. An empty search or an unset filter sends no constraint.

## States

- SET-10. Loading: a loading line in place of the list.
- SET-11. Empty with no search and no filter: a message that there are no sets yet and a hint
  naming the ways to start (import a spreadsheet, build by hand).
- SET-12. Empty with a search or filter: a message that nothing matches.
- SET-13. A failed load shows the error as a notification; the screen stays usable.

## Create an empty set

- SET-14. A small dialog asks for a name (required) and a description (optional).
- SET-15. The confirm action is disabled while the name is blank or a save is in flight. The dialog
  cannot be dismissed while saving.
- SET-16. On success: origin is manual, a confirmation shows, the dialog closes and the editor opens
  on the new set.
- SET-17. On failure, including a duplicate name (MOD-2), the message shows inside the dialog and
  the dialog stays open with the user's input intact.

## Duplicate from the list

- SET-18. One click, no dialog. The copy's name is the original's name plus a "copy" suffix.
- SET-19. The copy has the same description, origin and origin details, and every entry with every
  attribute, snapshots included. Identities and timestamps are new.
- SET-20. If the suffixed name is taken, the copy takes the next free number in its name, so a
  duplicate always succeeds. (Decided, Q9. Baseline refused instead.)
- SET-21. On success a confirmation shows and the list reloads.

## Delete from the list

- SET-22. Delete asks for confirmation, naming the set. The user may choose not to be asked again
  for this kind of deletion; that preference is remembered per user.
- SET-23. On success the row leaves the list without a full reload and a confirmation shows.
- SET-24. On failure the row stays and the error shows.

## On entering

- SET-25. When a site is connected, entering this screen starts a background read of the schema of
  the common entity types (Shot, Asset, Sequence, Task, Version, Note, Project) so that import and the
  editor do not wait for it. Best effort: a failure is silent and blocks nothing.
- SET-26. That warm-up must respect the corpus cost note: a type's field listing is the expensive
  call (`findings/002_schema.md`). Warm the fixed common list only, never every type.
