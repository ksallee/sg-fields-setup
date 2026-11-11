# 6. Advisory comparison with the live site

In the editor, each entry is compared with the connected site's schema so the user sees trouble
before installing. This is a heads-up. It never blocks saving. The install plan (file 07) is the
authority.

## Reads

- CMP-1. The site's entity type list is read once per editor session.
- CMP-2. For each distinct target entity type among the entries, that type's fields are read once
  and cached for the session. A type that cannot be read counts as having no fields; no error shows.
- CMP-3. Without a connected site there is no comparison: no markers, and every complete, unique
  entry counts as new.
- CMP-4. Per the corpus (`findings/002_schema.md`), field listings are read only for types in use.

## What is detected per entry

- CMP-5. **Name exists**: a live field on the target type has exactly the entry's programmatic name
  (trimmed, case-sensitive). Record its live data type and whether it equals the entry's.
- CMP-6. **Label taken**: a live field with a *different* programmatic name has the same display
  name, compared trimmed and case-insensitive. Shown as a note naming that field. This matters
  because the server answers a duplicate display name by silently creating a suffixed field
  (`findings/019_create_fields.md`).
- CMP-7. **Blocked change**: the name exists with the same data type, and the entry differs from the
  live field in a setting the API cannot change: the unique flag (any type), or valid types on a
  multi-entity link. Valid types are compared as ordered lists.

*Note, 2026-11-10:* CMP-6 and CMP-7 were written before probes 116 and 121 widened PLN-8 and before
PLN-14 to PLN-16. The comparison no longer has rules of its own: it asks the planner (file 07) about
each row, with the field as the cached listing holds it, and shows the planner's verdict. So a label
taken is checked for a field that would be created (PLN-16), and a blocked change is whatever PLN-8
blocks. A type whose fields are not cached yet is not judged (CMP-2).

## Category per entry

- CMP-8. Each entry falls in exactly one category, first match wins:

| category | when |
|---|---|
| needs attention | incomplete; or duplicated within the set; or name exists with a different data type; or blocked change |
| on site | name exists with the same data type |
| new | otherwise |

*Note, 2026-11-10:* in the plan's words: needs attention is incomplete, duplicated, type not on the
site, or a class of type conflict, blocked or refused; on site is update or already matches; new is
create. A mirror entry is never planned: it is on site or new by its name.

## What the row shows

- CMP-9. A marker for: on site; type mismatch; cannot update. Plus, when relevant, a short
  explanation in the expanded row:

| case | explanation must say |
|---|---|
| on site, same type | The field already exists; install will leave it or update it. |
| different type | Which type the live field has; that a field's type cannot be changed; that install will skip it. |
| unique flag differs | That the API cannot change it; the steps to change it by hand in FPT (open a page of that entity type, configure the field's column, toggle the option); and which way to toggle. |
| multi-entity valid types differ | That the API cannot change them; that install will skip the field; that to reinstall, the field must be deleted on the site and then removed from the site's trash for good. |

*Note, 2026-11-10:* a marker more, cannot create, for a create the plan would refuse. The four
explanations above keep their words. Every other reason shows in the planner's own words, the same
as on the install screen (RUN-21).

- CMP-10. Target type not on the site: when a site is connected and an entry's target type is absent
  from the type list, the group is marked "not on this site", with the instruction to enable the
  entity in FPT's admin screens and a re-check action that re-reads the type list. (Baseline showed
  the raw stored name and nothing more; this marker is an addition. See OVR-10.)
- CMP-11. The comparison updates as the user types. It uses cached reads only.
