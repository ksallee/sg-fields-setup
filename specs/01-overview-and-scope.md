# 1. Overview and scope

## What it is

A studio needs custom fields on its FPT site, often thirty or more at once, typically to hold on-set
data that arrives as spreadsheets. Creating them by hand in FPT's admin screens is slow and easy to
get wrong. This tool lets an admin:

1. Keep **sets**: named, reusable lists of field definitions.
2. Fill a set from CSV or XLSX column headers, or by hand.
3. See, per entry, whether the field already exists on the connected site and whether it matches.
4. Preview an **install plan** that says exactly what will be created, updated, left alone or refused.
5. Run the install, field by field, with live progress, cancel and retry.
6. Control on which projects the installed fields are visible.

Nothing is written to the site from a screen that has not shown the plan.

## Words

| word | meaning |
|---|---|
| set | A named list of entries. The unit a user saves, duplicates and installs. |
| entry | One field definition: target entity type, programmatic name, display name, data type, and type-specific settings. |
| programmatic name | The field's API name on the site, as opposed to its display name. |
| live field | A field that exists now on the connected site. |
| retired field | A field that was deleted on the site and sits in its trash. Not listable through the API. |
| snapshot | A verbatim copy of a live field's schema record, stored on an entry at capture time. |
| mirror entry | An entry whose data type cannot be created through the API (computed types). Kept for reference, read-only, never installed. |
| plan | The classified list of what an install would do, computed from the entries and the live schema. |
| picker | The project selection on the install screen. Empty means "all eligible projects". |

## v1 scope

- OVR-1. Sets and entries: create, read, update, delete, duplicate. (Files 02, 03, 05.)
- OVR-2. Import from one or more CSV and XLSX files into a new set. (File 04.)
- OVR-3. Editor with grouping by entity type, search, status filter, multi-select and bulk actions,
  one explicit save. (File 05.)
- OVR-4. Advisory comparison with the live schema in the editor. (File 06.)
- OVR-5. Install plan and install run for **fields on entity types that already exist on the site**.
  (Files 07, 08.)
- OVR-6. Per-project visibility of installed fields. Conditional, see VIS requirements in file 08.
- OVR-7. One connected site at a time.

## Entity types: what v1 does and does not do

- OVR-8. The tool installs fields only onto entity types that are present in the site's schema
  listing. Enabled custom entity slots count, and are shown by their studio-chosen display name.
- OVR-9. Baseline behaviour: the tool never enabled, renamed or disabled an entity type. Users were
  told to enable a custom entity in FPT's admin screens first, then return. Enabling through the API
  was not possible when the baseline was built.
- OVR-10. v1 keeps that behaviour. When an entry targets a type that is not on the site, the tool
  says so, tells the user to enable it in FPT's admin screens, and offers a re-check that re-reads the
  type listing. (Details: CMP-9, PLN-14.)
- OVR-11. Conditional, not v1: enabling a custom entity slot from the tool. Only after the re-probe
  in file 09 (gap G1) shows a working, measured call. Until then no requirement may rest on it.

## Out of scope for v1

| item | why |
|---|---|
| Creating computed fields (calculated, query, summary) | The API refuses them. They are mirrored read-only. |
| Changing a field's data type | The API cannot do it. The plan reports a conflict instead. |
| Deleting fields from the site as a user action | Deletion spends the programmatic name for good. The tool deletes only its own mistakes, see RUN-9, RUN-12. |
| Emptying the site trash | No API for it in the corpus. The user is sent to the trash page. |
| Removing visibility from an existing field | Baseline never did. Kept as a rule, VIS-6. |
| A shared, curated vocabulary of standard field names with alias matching | Baseline stored aliases but matched against the live schema only. Aliases are dropped from v1 (Q7). |
| "Site capture": building a set by analysing an existing project | Baseline declared the origin but shipped no screen for it. Left out of v1 (Q6). |
| Organisations, roles, billing, activity logging | Belonged to the host product, not to this tool. |
| Standard dashboard data sources seeded on first site connection | A separate feature of the host product. Not part of this tool. |

## What v1 must not need

- OVR-12. No LLM. Deterministic throughout.
- OVR-13. No server-held site credentials, if the persistence decision (D1) allows it. Sign-in as a
  person, as the sibling tool does.
