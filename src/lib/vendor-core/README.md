# vendor-core

Verbatim copies of modules from sg-widgets core (`~/dev/sg-widgets/packages/core/src`) that no npm
release carries yet. Issue #21 replaces them with the release and deletes this folder.

Do not edit these files here. A change goes to sg-widgets, then is copied again.

Import them through the local module named below, never from this folder, so the swap to
`sg-widgets-core` is one line.

| file | copied from | at | imported through |
|---|---|---|---|
| `field-name.ts` | `packages/core/src/field-name.ts`, branch `dev` | `1c6ef5f`, 2026-11-10 | `src/lib/pure/field-name.ts` |
