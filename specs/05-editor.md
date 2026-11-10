# 5. Editor screen

One set, all its entries. Edits are local until the user saves.

## Working copy

- EDT-1. Opening a set loads its name, description and entries into a working copy. Entries come
  ordered by target entity type, then programmatic name.
- EDT-2. Nothing is persisted until Save. There is no auto-save.
- EDT-3. The set is **dirty** when the name, the description, or the cleaned form (MOD-9, MOD-7) of
  any entry differs from the last saved state, or an entry was added or removed. Snapshots are not
  part of the comparison.
- EDT-4. A status near the title shows one of: saving, unsaved changes, saved.
- EDT-5. Leaving the screen while dirty asks whether to discard. Confirming leaves; cancelling stays
  with the working copy intact. Deleting the set skips this prompt.
- EDT-6. A user without edit rights (if the persistence layer has such a notion) sees everything
  disabled and no action buttons.

## Header actions

- EDT-7. **Back** to the list.
- EDT-8. **Delete set**: confirmation as SET-22, then back to the list.
- EDT-9. **Duplicate**: copies the whole working copy, unsaved edits included, into a new set named
  with a "copy" suffix, same description and origin, snapshots kept. If rows are selected, only those
  are copied and the button says so with the count. The new set opens in a new tab so the current
  work is untouched; if the tab is blocked it opens in place. Disabled when there are no entries, or
  any entry is incomplete or duplicated.
- EDT-10. **Install**: opens the install screen (file 08). If rows are selected, only those are
  offered and the button says so with the count. Disabled, with the reason shown on hover, when: the
  set is dirty; there are no entries; no site is connected; an entry is incomplete; entries are
  duplicated. Reasons are checked in that order and the first one shows.
- EDT-11. **Save**: enabled only when dirty, valid and not already saving. When disabled, hovering
  gives the reason, first match of: nothing to save; set name missing; N fields missing required
  values; two or more fields share an entity type and programmatic name.

## Validity

- EDT-12. The set is valid when its name is non-blank, no entry is incomplete (MOD-6), and no two
  entries share (target entity type, programmatic name) after trimming (MOD-5). Entries missing either
  half of that pair are not counted as duplicates.
- EDT-13. Incomplete and duplicated entries are marked on their rows. Every entry in a duplicated
  pair is marked, not only the later one.
- EDT-14. Problems against the live site (file 06) never block saving.

## Set details

- EDT-15. Name (required) and description (optional, multi-line) are edited at the top.

## Entry list

- EDT-16. Entries are grouped by target entity type. Groups are sorted alphabetically by the type's
  stored name. Entries with no type form one "unassigned" group.
- EDT-17. A group header shows the type's display name from the site when known, otherwise the
  stored name; and a count. When a search or filter hides some, the count reads "shown of total".
- EDT-18. Each group has an "add field" action that appends a blank entry already assigned to that
  type. A blank entry is text type, everything else empty, and opens expanded.
- EDT-19. An "add entity type" action adds an empty group so fields can be assigned into it. With a
  site connected the type is chosen from the site's list; without, typed. Empty groups added this way
  are not persisted; they vanish on reload unless they received entries.
- EDT-20. Each entry is a collapsible row. Collapsed, it shows display name (or a "new field"
  placeholder), programmatic name, data type label, markers (mirror, incomplete, duplicate, and the
  site status of file 06) and a delete action. Saved entries start collapsed; new ones start open.
- EDT-21. With a site connected, each group offers a collapsed reference panel listing the fields
  that already exist on that type, split into custom and standard, each sorted by display name,
  showing display name, programmatic name and data type. The split follows the corpus rule for
  custom versus stock (`findings/056_stock_vs_custom_field.md`), not the name prefix. (Baseline used
  the prefix; see B6.)
- EDT-22. With no entries, no added groups and no add in progress, an empty message invites the user
  to add an entity type or import a spreadsheet. An empty added group shows its own hint.

## Editing one entry

- EDT-23. Target entity type: chosen from the site's types when connected, typed otherwise.
- EDT-24. Display name: text.
- EDT-25. Programmatic name: by default it is derived live from the display name (MOD-17) and is
  read-only. A toggle switches it to manual editing and back. Entries loaded from storage start in
  manual mode so their names never change under the user. Switching back to derived takes effect at
  the next display name edit.
- EDT-26. Data type: chosen from the creatable types (MOD-13). For a mirror entry it shows the live
  type as read-only text with an explanation that the field is computed on the site, cannot be edited
  or installed, and can be kept for reference or removed.
- EDT-27. Valid types (link types only): one type for multi-entity; one or several for entity per
  MOD-11. Chosen from the site's types when connected; typed as a comma-separated list otherwise.
- EDT-28. Valid values (list types only): one per line; lines trimmed, blanks dropped. For a status
  list the values are status short codes.
- EDT-29. Default value (MOD-9 types only): per MOD-10.
- EDT-30. Unique per project (text and number only): a checkbox, with a note that it is fixed at
  creation and cannot be changed through the API later.
- EDT-31. Description: text. There is no aliases input in v1. (Decided, Q7.)
- EDT-32. Every input of a mirror entry is locked. Only delete works.
- EDT-33. Deleting a row removes it from the working copy at once, without confirmation. It is
  persisted on Save.

## Search, filter, sort

- EDT-34. Search matches display name, programmatic name or target entity type; case-insensitive
  substring.
- EDT-35. Status filter: all, on site, new, needs attention (categories of CMP-8), each with its
  count. The needs-attention filter is highlighted when its count is above zero.
- EDT-36. A toggle floats on-site entries to the top of each group, then new, then needs attention.
  Order within a category is unchanged.
- EDT-37. Groups with no visible entries are hidden, except: with no search, an added empty group
  always shows; and with no search and no filter, every group shows.
- EDT-38. The toolbar appears only when the set has entries.

## Selection and bulk actions

- EDT-39. Each row has a checkbox. A plain click toggles it and makes it the anchor. A shift-click
  selects every visible row between the anchor and the clicked row, inclusive, in on-screen order,
  whichever is first. If either end is not visible, the shift-click acts as a plain click.
- EDT-40. Each group header has a checkbox that selects or clears all of that group's visible rows
  and shows a mixed state when only some are selected.
- EDT-41. With a selection, a bulk bar shows the count and these actions:

| action | effect |
|---|---|
| assign to entity type | Sets the target type of every selected entry, then clears the selection. |
| change data type | Sets the data type of every selected entry except mirror entries, which are skipped. Selection is kept. |
| re-sync from site | See EDT-42. Shown only with a site connected. |
| delete | Removes every selected entry from the working copy, clears the selection and the anchor. |
| clear | Clears the selection. |

- EDT-42. Re-sync: for each selected entry whose programmatic name matches a live field on its
  target type, overwrite display name, data type, valid types, valid values, unique flag, description
  and default value with the live values. Entries with no live match are left as they are. Afterwards
  clear the selection and report how many were re-synced, or warn that none exist on the site. The
  result is unsaved until Save.
- EDT-43. Moving an entry onto a type that already has the same programmatic name makes both
  duplicates (EDT-13) and blocks Save until resolved.

## Save

- EDT-44. Save applies, in this order: set name and description if changed; removals; changes to
  existing entries; additions. Removals come first so that deleting an entry and adding one with the
  same pair in a single save does not trip MOD-5.
- EDT-45. Only entries whose cleaned form changed are written.
- EDT-46. After a successful save the set is reloaded from storage, the status reads saved, the set
  is no longer dirty, and a confirmation shows.
- EDT-47. If any step fails: the status reads error, the message shows, the working copy is kept, and
  the user can save again. A retry must not create an entry twice: once an addition is stored it is
  treated as existing from then on, even if the reload that followed failed.
- EDT-48. If a save fails part-way, the steps already applied stay applied. (Baseline behaviour.
  With local persistence the whole save can be atomic instead; preferred. See D1.)
