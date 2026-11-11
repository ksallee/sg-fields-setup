# 7. Install plan

The plan classifies each entry against the live site. It is computed fresh from the site every time:
when the install screen opens, on refresh, and again at the start of every run.

## Inputs

- PLN-1. The entries to consider: the whole set, or the subset the user selected in the editor.
- PLN-2. Install is offered only for a saved, valid set (EDT-10), so every entry considered is
  complete and stored.
- PLN-3. For each entry the tool reads that one field from the site by target type and programmatic
  name. "Does not exist" means absent. Any other read failure aborts planning with the error; it is
  never treated as absent.
- PLN-4. A read that returns no usable data type is treated as absent.
- PLN-5. Note from the corpus (`findings/040_field_revive.md`): "does not exist" cannot tell a
  retired field from one that never existed. The plan therefore cannot foresee a retired name; the
  run handles it (RUN-7).

## What is read from a live field

- PLN-6. Data type, display name, description, default value, valid values, valid types, unique
  flag. Schema values come wrapped (value plus editable flag, `endpoints/get_schema_type_fields.md`);
  the tool reads the value. A missing unique flag means off. Description and unique sit beside the
  data type; default value, valid values and valid types sit among the properties. (Baseline's
  reading; confirm the positions against the corpus sample when building.)

## Classes

- PLN-7. Each entry gets exactly one class, first match wins:

| class | when | what a run does |
|---|---|---|
| create | the field is absent | creates it (RUN-6 onward) |
| type conflict | present, live data type differs from the entry's | nothing; skipped with a reason |
| already matches | present, same type, no differences | no schema write; visibility only |
| blocked | present, same type, at least one difference is in a setting the API cannot change | nothing; skipped with a reason |
| update | present, same type, differences, none blocked | writes the differences |

- PLN-8. Blocked settings: the unique flag on any type; valid types on a multi-entity link. Valid
  types on a single-entity link are updatable in the baseline; the corpus lists only name,
  description, custom metadata and visible as editable (`findings/040_field_revive.md`). Until probe
  G5 answers, treat valid types, valid values and default value as **conditionally updatable**: plan
  them as updates, verify by read-back (RUN-15), and report a failed verification as a failure.
  *Note, 2026-11-10:* probes 116 and 121 settled it (`findings/116_field_settings_create_update.md`,
  `findings/121_field_settings_edges.md`). Valid values of a list and a status list, an entity
  link's valid types and the default are plain updates. Unique and a multi-entity link's valid
  types stay blocked. Emptying a value is blocked, since no value can be emptied. Removing an
  entity link's valid type is blocked, since it retires a reverse field. Read-back stays (RUN-15).
- PLN-9. A blocked entry keeps two lists: the blocked differences and the differences that would
  have been fine. Nothing is written for it, not even the fine ones: a partial update would leave the
  field half-matching.
- PLN-10. A mirror entry (MOD-15) is never planned. If the selection contains only mirror entries
  the plan is empty and says why. (Baseline let them through to a doomed create; see B4.)

## Differences and equality

Differences are listed in this fixed order: display name, description, default value, valid values,
valid types, unique. Each carries the live value and the wanted value.

| setting | equal when |
|---|---|
| display name | equal after trimming both |
| description | equal after trimming both; none and blank are the same |
| default value | compared only for types that carry one (MOD-9). None, missing and blank are the same. Otherwise same kind and same value; structured values compared by content. |
| valid values, list | same values in the same order. Order matters: it is the order of the drop-down. |
| valid values, status list | same set of values. Order does not matter. Different sizes differ even with overlap. |
| valid values, any other type | always equal, whatever either side holds |
| valid types | same types in the same order. Order matters because it decides the reverse field's target. |
| unique | same boolean; missing is off |

- PLN-11. For both valid values and valid types, an empty list and "none" are the same.
- PLN-12. A stray default on a type that cannot carry one never produces a difference.

## What a create sends

- PLN-13. Data type, and these settings:

| setting | sent when |
|---|---|
| display name | always |
| description | non-blank |
| default value | checkbox: always, true only if the entry's default is exactly true, else false (creation fails without one, `findings/019_create_fields.md`). List and status list: when set and non-blank. Other types: never. |
| valid values | present |
| valid types | non-empty |
| unique | only when on |

What an update sends: one item per difference, with the wanted value.
*Note, 2026-11-10:* an update is one request carrying every difference, applied whole or not at
all (`findings/116_field_settings_create_update.md`, `findings/121_field_settings_edges.md`).

## Checks added to the plan (changes from baseline)

These stop writes the corpus says will go wrong. Baseline discovered them only after writing.

- PLN-14. **Type not on site**: the entry's target entity type is absent from the site's type list.
  Class "type conflict"-like refusal with its own reason: enable the entity in FPT's admin screens,
  then refresh. No write is attempted.
- PLN-15. **Unreachable name**: the entry would be a create, but the server would not give it the
  entry's programmatic name, because the name the server derives from the display name (MOD-17)
  differs from the entry's programmatic name. Refused at plan time with both names shown. No write.
- PLN-16. **Label would be suffixed**: the entry would be a create, and a live field on the same
  type already has the same display name (CMP-6 rule). The server would create a suffixed field
  (`reports/006_duplicate_field_name_is_201.md`). Refused at plan time, naming the live field. No write.

## Counts and scope

- PLN-17. The plan carries a count per class, the list of projects in scope with names, and whether
  the scope is "chosen projects" or "all eligible projects" (VIS-2).
- PLN-18. Blocked entries carry a ready-to-show reason, built with the site's address so it can link
  to the site's trash page where relevant (RUN-21).

## Idempotency

- PLN-19. Planning writes nothing.
- PLN-20. Running an install and planning again must classify every successfully installed entry as
  "already matches".
