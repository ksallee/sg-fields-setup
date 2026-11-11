# 9. FPT operations, corpus gaps, widgets

Corpus paths are relative to `~/dev/sg-groundtruth/corpus`, tag `corpus/2026-09-25`. Read
`INDEX.md` there first. Every entry below was opened when this file was written.

## Operations the tool performs

| operation | used by | corpus entry | rule the tool rests on |
|---|---|---|---|
| List entity types and display names | type choosers, IMP-21, CMP-10, PLN-14 | `endpoints/get_schema.md`, `findings/002_schema.md`, `findings/008_custom_entities.md` | Presence in the listing is the enabled test. Slot numbers are site-specific. Display names are free text and may have trailing spaces: match trimmed. |
| Read all fields of one type | SET-25, IMP-15, IMP-29, CMP-2, EDT-21, EDT-42 | `endpoints/get_schema_type_fields.md`, `findings/002_schema.md` | About 48 KB and 330 ms per type. Only for types in use, never looped over all types. Values are wrapped. |
| Read one field | PLN-3, RUN-8, RUN-10, RUN-15 | `endpoints/get_schema_type_fields_field.md` | Small. "Does not exist" names type and field, and does not tell retired from never existed. |
| Create a field | RUN-11 | `endpoints/post_schema_type_fields.md`, `findings/019_create_fields.md`, `reports/006_duplicate_field_name_is_201.md` | Send a display name; the server derives the programmatic name; it is only in the self link. A duplicate display name succeeds with a silent numeric suffix. Checkbox needs a default. Link types need valid types. |
| Revive a retired field | RUN-9 | `endpoints/post_schema_type_fields_field.md`, `findings/040_field_revive.md` | Undocumented call, measured working. The field returns at its original data type. |
| Update a field's settings | RUN-7, RUN-10 | `endpoints/put_schema_type_fields_field.md`, `findings/040_field_revive.md` | Editable on a custom field: name, description, custom metadata, visible. A data type change returns success and does nothing. Read back. |
| Delete (retire) a field | RUN-10, RUN-12 | `endpoints/delete_schema_type_fields_field.md`, `findings/019_create_fields.md` | Retires the field and spends its programmatic name for good. |
| Stock versus custom field | EDT-21 | `findings/056_stock_vs_custom_field.md` | Whether "visible" is editable marks a field the site can hide. The name prefix decides nothing. |
| List projects | VIS-2, VIS-3, picker | `findings/018_project_listing.md` | Status is not a liveness filter. Template, demo and archived flags are the discriminators. |
| Sign in as a person | connection | `findings/052_app_session_launcher.md`, `recipes/012_sign_in_as_a_person.md` | What the sibling tool uses. |
| Trusting responses | RUN-15 | `findings/028_loud_and_silent.md` | A refusal is trustworthy. A success proves nothing. |
| Field type behaviour | MOD-13, EDT-27 to EDT-29 | `doors/field_types.md`, `findings/field_types/` | Per data type cards. |

## Corpus gaps

**G1 and G2 were re-probed on 2026-11-10** (sg-groundtruth `corpus/findings/114_schema_admin_recheck.md`).

| gap | answer |
|---|---|
| G1 | The site's own API description now names calls to enable, disable and configure a custom entity slot (three endpoint cards under `corpus/endpoints/`, `*_preferences_custom_entity_*`). The probed site refuses all of them as not available. v1 keeps "enable in the admin interface, then re-check". Enabling from the tool stays conditional on a site where the call answers. |
| G2 | Revive still works. Retired fields still cannot be listed. No call deletes one for good; the name is freed only from the trash page in the web interface. The revive-first sequence stands. |

Also measured there: a status field's per-project hidden values cannot be written through the API.
~~The other gaps below are still open.~~ See the next table.

**Answered by probes 115 to 121, 2026-11-10.** Findings are under `corpus/findings/`. The gaps
table below is kept as it was written. Only G7 is still open.

| gap | finding | answer |
|---|---|---|
| G3 | 116, 117 | `status_list` is created with its valid values. `currency`, `timecode` and `footage` are created with a name alone. `color` and `image` stay refused. |
| G4 | 116 | An entity link takes several valid types at creation. A multi-entity link takes exactly one. |
| G5 | 116, 121 | Changeable: display name, description, a list's and a status list's valid values, the default, an entity link's valid types. Never: unique, a multi-entity link's valid types. No value can be emptied. One request is applied whole or not at all. A status list's values must include its default. Two hazards on valid types: see `10-open-questions.md`, "Found while building". |
| G6 | 115 | `visible` is per project. Read and written with a project id, never without one. A new field is visible in every project. |
| G7 | | Open. |
| G8 | 116 | A create takes description, unique, valid values, default and valid types in one request. Each reads back where PLN-6 says. |
| G9 | 118 | Create, update, visibility, retire and revive answer on a custom entity and on Tag as on Version. |
| G10 | 120 | The trash page for fields is a Page row named "Trash - Fields". Its id is per site, so the tool searches for it. |
| G11 | 117 | One non-ASCII character and the field is named `sg_<data_type>`. ASCII names are lowercased, every other character becomes `_`, nothing is trimmed or cut. |

Also measured: an absent, a retired and a live field told apart by the revive call (119).

Each is a question to probe, not a fact. They can go into one sg-groundtruth issue. G1 and G2 are
**re-probes**: "is this still as last measured?" Autodesk said it would look at the public reports
and may have changed things since.

| id | question | last state in corpus | spec items waiting | fallback |
|---|---|---|---|---|
| G1 | Can a custom entity slot be enabled, renamed or disabled through the API today? Which call, which permission, does the display name stick, is it idempotent, does it work for project and non-project slots, and what does a disabled slot look like in the listing? | `endpoints/put_preferences_update.md`: every body refused as "not available" on the probed site; success path never seen. `findings/008_custom_entities.md` quotes the docs: cannot be enabled over REST. Measured on or before 2026-09-25. | OVR-11 | Tell the user to enable the entity in FPT's admin screens, then re-check (OVR-10, CMP-10, PLN-14). |
| G2 | Retired fields, re-measured: does revive still work as in probe 040? Can retired fields now be listed? Can a retired field be deleted for good through the API, freeing the name? Does creating over a retired name still fail with the same message? | `findings/040_field_revive.md`, `findings/019_create_fields.md`: revive works, retired fields unlistable, no permanent delete, name spent. One cycle measured. | RUN-13, RUN-14, PLN-5 | Sequence of RUN-9 to RUN-12; manual trash-page instruction. |
| G3 | Which data types can be created beyond those measured: currency, status_list, colour (measured refused once), timecode, footage? What must each be sent? | `findings/019_create_fields.md` lists the measured set; colour and image refused; calculated errors. | MOD-13 | Offer only confirmed types. |
| G4 | Valid types at creation: can a single-entity link take more than one type? Can a multi-entity link? | 019: two types refused, "expected Array with one element" (which link type was sent is not stated). Baseline assumed several for entity, one for multi-entity. | MOD-11, EDT-27 | One type for both. |
| G5 | Which settings can be changed on an existing custom field: valid values of a list, valid values of a status list, valid types of an entity link, default value, unique? What does each refusal or silent no-op look like? | 040 lists name, description, custom metadata, visible as editable. Baseline assumed list values, entity valid types and defaults are updatable; unique and multi-entity valid types not. | PLN-8, RUN-15 | Plan as update, verify by read-back, report mismatch as failure. |
| G6 | Per-project field visibility: does reading a field with a project return a project-specific visible value? Does updating visible with a project change it for that project only? What is the default on a new field, and is a missing value "visible"? Can one read per type and project return it for all fields? | `endpoints/get_schema_type_fields.md`: with a project, only hidden values were seen to change. Per-project visible unmeasured. | all VIS, RUN-4 | No picker; fields only. |
| G7 | Which permission do schema writes need, and what does a non-admin get? Is there a check that writes nothing? | `findings/094_permission_preflight.md` covers record writes only. | RUN-27 | Report the refusal per item. |
| G8 | Creation settings: are a list's valid values accepted at creation, and a default for list and status list? Is "unique" accepted at creation and where does it read back? Is a description accepted at creation? | Unmeasured. Baseline sent all of them. | PLN-13, PLN-6 | Create with the confirmed minimum, then update and verify. |
| G9 | Do creation and revive behave the same on a custom entity type and on non-project types as on Version? | All schema writes measured on Version only. | RUN-6 onward | Treat as same; verify by read-back. |
| G10 | What is the address of the site's trash page for fields? | Not in the corpus. Baseline linked to the trash page filtered to field records. | RUN-21 | Describe the menu path in words, no link. |
| G11 | Does the display-name-to-programmatic-name rule hold for accents, non-Latin letters, leading digits and very long names? | 019 measured spaces, parentheses and an existing prefix. | MOD-17, PLN-15 | RUN-12 guard catches a wrong prediction. |

Probing rule from the corpus: every created field name is spent. Probes use the corpus's own
throwaway naming and sandbox.

## sg-widgets: what covers what

Widgets are registry copies from `~/dev/sg-widgets` (`packages/svelte/registry.json`), plus the
client in `packages/core`. Generic UI (dialogs, tabs, tables, toasts, file drop, progress) comes from
shadcn in the host app.

| need | widget |
|---|---|
| Choose one entity type (IMP-14, EDT-19, EDT-23, bulk assign, multi-entity valid type) | entity-type-picker |
| Choose several entity types (entity valid types) | entity-type-multi-picker |
| Choose projects (picker) | project-multi-picker |
| Existing fields of a type (EDT-21) | entity-fields, or field-picker's data source |
| Text, checkbox, list inputs in an entry row | text-editor, checkbox-editor, list-picker |
| Loading, empty and error lines | search-skeleton, state-line |
| Entity type icons in group headers | entity-glyphs |
| Schema reads | core client: entity type list, fields of a type, one field with a project |

## sg-widgets gaps

Per the sibling tool's rule, what the client lacks grows in sg-widgets by issue and PR, not as a
private extension here.

| id | gap | kind |
|---|---|---|
| W1 | Core client has no schema writes: create field, update field settings, retire field, revive field. | FPT-specific, core |
| W2 | Core client has no read of one field without a project, and no documented way to read wrapped raw schema records for snapshots. Check before building. | FPT-specific, core |
| W3 | No pure helper for "display name to programmatic name" (MOD-17). Belongs in core beside the client. | FPT-specific, core |
| W4 | No data-type picker: choose a field data type from the creatable set, with labels. | FPT-specific widget |
| W5 | No valid-values editor for list and status list (ordered values; status codes chosen from the site's statuses). status-multi-picker may cover the status case. | FPT-specific widget |
| W6 | No project eligibility helper matching VIS-2. project-multi-picker's own filter needs checking against it. | FPT-specific, core |
| W7 | Enabling a custom entity slot. Only if G1 succeeds. | FPT-specific, core, conditional |
| W8 | File drop zone, collapsible rows, multi-select with shift-range, streaming progress list. | generic, host app |
