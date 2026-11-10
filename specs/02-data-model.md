# 2. Data model

Described in words. How it is stored is decision D1 (file 10).

## Set

| attribute | required | rule |
|---|---|---|
| identity | yes | Stable, opaque, assigned at creation. |
| name | yes | Trimmed. Not empty after trimming. Unique among the sets the user can see (see MOD-2). |
| description | no | Free text. Empty is stored as "none". |
| origin | yes | One of: import, manual, site capture. Set at creation, never edited. Site capture is reserved (Q6). |
| origin details | no | For import: the source file names (distinct, joined into one text) and the import time. Otherwise empty. |
| created / last changed | yes | Timestamps. Who, if the persistence layer knows a user. |

- MOD-1. A set name is trimmed before it is stored. A blank or whitespace-only name is refused.
- MOD-2. Two sets may not share a name within the same ownership scope. The refusal is a plain
  message that names the clashing set and asks for another name. It must never surface as a raw
  storage error.
- MOD-3. Deleting a set deletes all its entries. No orphan entries remain.
- MOD-4. Creating a set together with its first entries is all-or-nothing. If the entries cannot be
  stored, the set is not left behind empty.

## Entry

| attribute | required | rule |
|---|---|---|
| identity | yes | Stable, opaque. |
| set | yes | The set it belongs to. |
| target entity type | yes | The type's API name (for a custom entity, its slot name, not its display name). |
| programmatic name | yes | The field's API name on the target type. |
| display name | yes | The label people see. |
| data type | yes | Any FPT data type. See "Data types" below. |
| valid types | only link types | List of entity types the link may point to. See MOD-11. |
| valid values | only list types | Ordered list of text values. |
| default value | only some types | See MOD-9. |
| description | no | Free text. |
| unique per project | only text and number | Boolean, default off. |
| snapshot | no | Verbatim schema record of the live field this entry was captured from. Not editable. |
| snapshot site | no | Which site the snapshot came from. |
| snapshot time | no | When it was captured. |
| created / last changed | yes | Timestamps. |

- MOD-5. Within one set, the pair (target entity type, programmatic name) is unique. The same pair
  may appear in any number of different sets.
- MOD-6. Target entity type, programmatic name, display name and data type are each required and
  must be non-blank after trimming. An entry missing any of them is **incomplete**.
- MOD-7. Text attributes are trimmed on save. A blank description is stored as "none".
- MOD-8. When an entry with a snapshot is stored without a snapshot time, the time of storing is
  recorded as the snapshot time.

## Type-specific settings

Which settings an entry carries depends on its data type.

| setting | carried by |
|---|---|
| valid types | entity, multi_entity |
| valid values | list, status_list |
| unique per project | text, number |
| default value | list, status_list, checkbox |

- MOD-9. When an entry is saved, every setting its data type does not carry is dropped. Changing a
  link field to text removes its valid types; changing a list to a date removes its valid values and
  its default; and so on. The operation never alters the entry it was given; it produces a cleaned copy.
- MOD-10. Checkbox default: three states in the editor (none, checked, unchecked). List and status
  default: free text, blank means none.
- MOD-11. Valid types cardinality. Baseline: an entity link could hold several types, a multi_entity
  link exactly one. The corpus measured exactly one accepted for both at creation. Requirement: the
  editor allows exactly one for multi_entity; for entity it allows several only if probe G4 confirms
  it, otherwise one.
- MOD-12. Valid types are stored as entity type API names. (Baseline mixed display names and API
  names; see B3 in file 10. Do not copy that.)

## Data types

- MOD-13. **Creatable types**: the set a user may pick for a new entry. Baseline list: text, number,
  float, percent, duration, currency, date, date and time, checkbox, list, status list, entity link,
  multi-entity link, colour, URL. The corpus confirms creation for text, float, number, date,
  date_time, list, url, duration, percent, footage, checkbox, entity, multi_entity; it measured
  **colour refused**; currency and status_list are unmeasured. Requirement: offer only types the
  corpus confirms; add currency, status list and colour only after probe G3.
- MOD-14. **Mirror types**: any data type read from a live field that is not creatable (calculated,
  query, summary and any type not in the creatable set). An entry keeps the live type exactly as read;
  it is never narrowed to a creatable type or replaced by a guess.
- MOD-15. A mirror entry is read-only except for deletion. It is never part of an install. (See EDT-20.)
- MOD-16. A data type read from the site is authoritative even if the tool has never heard of it.
  Only an empty type is treated as "no type".

## Predicted programmatic name

- MOD-17. For a new entry the tool predicts the programmatic name from the display name, using the
  server's own rule so that prediction and creation agree. Corpus rule
  (`findings/019_create_fields.md`): the custom-field prefix, then the display name lowercased with
  every non-alphanumeric character replaced by one underscore each. No collapsing, no trimming of
  underscores.
- MOD-18. A display name that already starts with the prefix yields a doubled prefix on the server.
  The prediction must show that, not hide it.
- MOD-19. If the display name is blank, no name is predicted and the entry is incomplete.
- MOD-20. Baseline predicted differently (it collapsed runs of punctuation and trimmed underscores),
  so its prediction disagreed with the server for names containing punctuation. Do not copy. See B1.

## Limits

- MOD-21. No hard limit on entries per set. The editor must stay usable at 500 entries.
- MOD-22. List page size default 20. Maximum page size accepted by any listing interface: 100.
