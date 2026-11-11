# Design

sg-widgets' default theme (`src/app.css`) and its `docs/design-rules.md` bind everything below:
tokens only, its spacing and size ladders, no new palette, no new font. Layout, hierarchy and copy
are this app's. It reads as sg-task-templates' sibling. Every screen is held to this file.

Written with the set list (#15), extended with the editor (#17). The import dialog and the install
screen follow it.

## Routes

`$lib/pure/routes.ts` builds every path. No screen spells one by hand.

| path | screen |
|---|---|
| `/` | The set list. The spreadsheet import is a dialog on it (`app/import-dialog.svelte`), not a route. |
| `/sets/<id>` | The editor. `setPath(id)`. |
| `/sets/<id>/install` | The install of the whole set. `installPath(id)`. |
| `/sets/<id>/install?selection=1` | The install of the editor's selection. `installPath(id, { selection: true })`. The editor first calls `writeInstallSelection(id, entryIds)` from `$lib/io/install-selection`; the install screen calls `readInstallSelection(id)`. When it answers null the screen plans nothing and says the selection was lost (`installEntries` in `$lib/pure/install-entries`): it never takes the whole set in its place. |
| `/connect` | The site and the sign-in. |

Under `vite dev` only, `?fake` on the install path swaps the site for one held in memory
(`docs/development.md`). A production build has no such flag.

A set that is gone is a `PageState`: "Set not found", one line, a button back to the list.

## Shell and page

- **Shell.** Header `h-12`: wordmark, the connected site and who, the scheme switch. The page owns
  the rest and scrolls on its own; the shell never scrolls.
- **Page header.** `PageHeader` on every screen: title `text-lg font-semibold`, one context line,
  actions on the right with the primary last. A screen under the list passes
  `back={{ href: '/', label: 'Sets' }}`. A toolbar goes in its children, under the title.
- **Grid.** Lists and workbenches are full width, `px-4` around rows, `px-6` in headers. Forms and
  summaries sit in one column, `max-w-3xl`. Text is left aligned. Only a `PageState` is centred.
- **Narrow.** Every screen works at 390 px. Columns fold into a second line; a tertiary header
  action keeps its icon and drops its label.

## Type, spacing, density

- **Type.** Page title `text-lg font-semibold`. Section title `text-sm font-semibold`. Row title
  `text-sm font-medium`. Body `text-sm`. Meta `text-xs text-muted-foreground`. A placeholder for
  a missing value is `text-muted-foreground/70`, in words ("No description"). API names and codes
  `font-mono text-xs`. Counts `tabular-nums`.
- **Spacing.** Page sections `gap-6`, inside a section `gap-3`, form fields `gap-4`, label to
  control `gap-1.5`, items in a row `gap-2`.
- **Density.** Compact. A list row is `py-2`, two lines at most, one line each, truncated with the
  full text in `title`. Air goes between sections, not inside rows.
- **Lists.** Rows, not cards: a bottom border, `hover:bg-muted`, no column headings when each cell
  names itself. The row's title is a link whose hit area covers the row; row actions sit above it.
- **Badges.** `Badge variant="outline"`, no fill of their own.
- **Motion.** Only what a component brings when it opens or closes. Nothing animates on load.

## Actions

- **Buttons.** One primary (`default`) per screen, top right. Secondary `outline`. Tertiary
  `ghost`. Default size `h-8`. A button with text names what it does: "Create set", never "OK".
- **Row actions.** `IconButton` (`app/icon-button.svelte`): ghost, `icon-sm`, muted, always
  visible, with its name as tooltip and label. At most three; more go in a `DropdownMenu`. A row
  action in flight disables that row's actions.
- **Destructive actions.** `variant="destructive"` on the confirm button only. A destructive row
  action is muted like the others and turns destructive on hover. Deleting asks first, through
  `ConfirmDialog`, unless the person ticked "do not ask again". Nothing else needs a confirmation.

## Dialogs

- `Dialog` for a form or a flow. `ConfirmDialog` (`app/confirm-dialog.svelte`, an `AlertDialog`)
  before an action that cannot be taken back.
- Title: the thing or the question ("New set", "Delete this set?"). One line under it. Footer:
  Cancel as `ghost`, then the action.
- The action is disabled while a required field is blank or a save is in flight. While saving,
  the dialog cannot be dismissed: no close button, Escape and outside clicks ignored.
- A failure shows inside the dialog as a `Notice tone="destructive"` and the input stays. Success
  closes the dialog, then a toast.
- Labels over controls. An optional field says "optional" beside its label. Enter in a one-line
  field submits.

## Toasts

`notify` from `app/toast.ts`; the `<Toaster>` is in the root layout, bottom right.

- `notify.success('Created "Lens".')` after an action that worked: past tense, the same verb as
  the button, the thing by name, a full stop.
- `notify.error(error, 'Could not import lens.json')` for a failure with no dialog open: the title
  says what failed, the message why. It stays 10 s. Pass the thrown error as it is:
  `errorMessage` turns a `SetStoreError` into its plain sentence and anything else into a
  fallback. A raw error text never shows.
- `notify.warning('None of the selected fields exist on the site.')` for an action that ran and
  found nothing, or only part of what was asked. It stays 10 s.
- A failure while a dialog is open shows in the dialog, not as a toast.
- No toast for something the screen already shows.

Two kinds of error, two readers, nothing else:

- **Store errors** (the sets in the browser) go through `errorMessage` in `app/toast.ts`, on every
  screen, the install screen included. A `SetStoreError` shows its own plain sentence. Anything
  else is logged and shows the fallback.
- **Site errors** (a read, a write or the sign-in that Flow PT refused or that never arrived) go
  through `siteErrorMessage` in `$lib/pure/site-error.ts`: the site's own words, the first error's
  detail, else its title, else the error's message, else a fallback.
- A raw error text never shows. No screen reads `error.message` itself.

## States

- **Whole pane.** `PageState`: an icon in a muted circle, one title, one line, the actions. Loading
  shows after 150 ms. Empty names the ways to start and carries their buttons. No match offers to
  clear the search and the filter. An error says what failed and offers "Try again" or the way
  back.
- **In place.** A reload keeps the rows on screen at `opacity-60` with `aria-busy`; the loading
  state shows only when there is nothing to keep. A next page shows a muted "Loading more…" line
  under the rows.
- **Inline.** `Notice`: bordered, tinted `bg-<tone>/10`, an icon, one sentence, an optional action.
  Tones: warning, destructive, info. Never raw colour classes.

## Workbench

The editor is the first workbench: one long list edited in place. The install screen follows.

- **Status.** The page header's context line starts with the state of the work: "Saving…",
  "Unsaved changes", "Saved", "Not saved". A dot or a glyph in its tone, then the words.
- **Disabled with a reason.** A header action that cannot run says why on hover and on focus:
  `HeaderAction` (`app/editor/header-action.svelte`). The reason is one sentence from a pure
  module, first match wins.
- **Groups.** A group header is `text-sm font-semibold`, sticks to the top of the scrolling pane,
  and carries the group's checkbox, glyph, count and its one action. `gap-4` between groups.
- **Rows.** One line, `py-1`: checkbox, chevron, title, API name in mono, type, markers on the
  right, one row action. Under 640 px the API name, type and markers fold into a second line and
  a marker keeps its dot and drops its label. A row opens in place; its form sits under it on
  `bg-muted/40`, one column of `max-w-3xl`, two fields a row from 640 px.
- **Markers.** `Badge variant="outline"` with a dot in the marker's tone: success for fine,
  warning for what the site will object to, destructive for what blocks a save, muted for a
  fact. The words explaining a marker are a `Notice` at the top of the open row.
- **Long lists.** A row in a list that can reach hundreds names its action with `title`, not a
  `Tooltip`: 500 tooltips cost more to mount than the rows. Forms mount only while a row is open.
- **Bulk bar.** Shows while rows are selected, stuck to the bottom of the pane: the count first,
  the actions, "Clear selection" on the right. A pick in it is an action, so its controls go back
  to their placeholder.
- **Scroll pane.** `relative overflow-y-auto`, so screen-reader-only text inside it cannot
  stretch the page.
- **Typed fallbacks.** A picker that needs the site gives way to a text box when no site is
  connected. A text box that would move the row under the caret reports on blur or Enter.

## Copy

Kevin's voice: short sentences, plain words, terse. No dashes, no metaphors, no "not X, Y", no
filler. Sentence case everywhere, no capitals for labels.

- The app says **set** and **field**. "Entry" is the code's word.
- Counts read "1 field", "12 fields", "No fields" (`countText`, `fieldCount` in
  `$lib/pure/set-text.ts`). Times read "3 hours ago" (`RelativeTime`), the exact time on hover.
- An action keeps one name from button to dialog to toast: New set, Create set, Created.
- Errors say what happened and what to do. They do not apologise.
- Quote a set's name: `"Lens"`.
- Words that a screen shows live in a pure module with tests, not in markup, once they take an
  argument.

## Names across the seams

One thing goes by a different name in each layer. Each is a port, so the names stay; this is the
map.

| what | editor (`working-copy.ts`, `editor-view.ts`) | store and plan input (`model.ts`, `set-plan.ts`, `PlanEntry`) | plan items, run and views (`plan.ts`, `run.ts`, `install-view.ts`) |
|---|---|---|---|
| an entry | `key` (a row; the entry's id once stored, `entryId` beside it) | `id` | `entryId` |
| its type | `targetEntityType` | `targetEntityType` | `entityType` |

Two rows and two visibilities that read alike are not the same thing: `EditorRow` and
`EditorGroup` are the editor list's; `InstallRow` and `InstallGroup` the install plan's.
`VisibilityForecast` is what a row's visibility will be before a run (`visibility-analysis.ts`);
`RunVisibility` is its progress during one (`run.ts`). A site's entity type is `LiveEntityType`
everywhere, or a `Pick` of its `name` and `displayName` where a module reads only those.

## Comparing names

Names are folded before they are compared, and the rule differs on purpose by what is compared.
Tests pin each difference.

| folding | rule | where |
|---|---|---|
| `trimFold` (`$lib/pure/fold`) | trim, lowercase | the planner's label check (`labelKey` in `plan.ts`, CMP-6, PLN-16), the type meant by a valid type, the editor search (EDT-34), the import's entity type match (IMP-21) |
| `setNameKey` (`copy-name.ts`) | trim, NFC, lowercase | set names: the clash check and copy names (MOD-2) |
| `fold` (`set-query.ts`) | NFC, lowercase; the search is trimmed first | the set list search (SET-2) |
| `normaliseName` (`import-normalise.ts`) | NFC, trim, lowercase, one space per run of other characters | the import's field match (IMP-27, IMP-28): "Shot-Code" matches "Shot Code" there, and is no label clash in the plan |
| none | exact, case included | API names: entity types, field names, valid types (finding 121) |

## The install screen

`app/install/`, held to everything above, with these rules of its own.

- **Thin.** `install-screen.svelte` and its components render what `session.svelte.ts` holds.
  The session calls `$lib/pure` and decides nothing. The site comes from
  `$lib/io/install-site` alone.
- **Footer bar.** The one screen with a footer: its actions change with the run and sit beside
  the run's counter, in reach while the plan scrolls. Progress on the left, actions on the
  right, the primary last. One primary at a time: Install, then Resume, Retry or Close.
  `$lib/pure/install-footer` says which.
- **Toasts.** Top right on this screen, so they never cover the footer's actions.
- **Order.** Summary, then "Visible on", then the plan. The first two keep the one column,
  `max-w-3xl`. The plan is full width.
- **Groups.** A bordered block per group, the header a row that folds it: chevron, title, count.
  A group with no row is not shown.
- **Rows.** The two lines of a list row, then one line per difference (`text-xs`, values in
  mono, an empty value as `∅`), then the reason or the run's note. A create has one line per
  property its request writes, "setting: value". A value over 8 list items or 160 characters is
  cut, with the whole of it in `title` and behind "Show all". A failure is
  `text-destructive`. A visibility warning carries the warning icon and its retry, `outline`,
  `xs`. No row is a link.
- **State.** A `Badge variant="outline"` with an icon, on the right: Pending, In progress, Done,
  Skipped, Failed, Not selected. Colour is on the icon and the word, never a fill.
- **Counters.** Small dotted-underline words on the right of a row, each a tooltip trigger.
- **First write.** Install asks first, in a dialog that names the site, what is created and
  updated, that a name is taken for good, and the visibility scope. Leaving while a run is in
  progress asks too. The session starts a run only on the proof it handed out when the dialog
  opened (`$lib/pure/install-confirm`): a refresh, a tick or a pick in between spends it, and
  the screen says the plan changed.
- **No HTML.** Reasons and errors are rendered from parts, text and links. Never `{@html}`.

## Shared pieces

`src/lib/app/`: `app-shell`, `page-header`, `page-state`, `notice`, `confirm-dialog`,
`icon-button`, `relative-time`, `toast.ts`, `create-set-dialog`, `import-dialog`, `file-drop`,
`set-list/`, `editor/` (toolbar, group, row, entry form, bulk bar, reference panel, the fields of
the form), `install/` (screen, session, plan group, plan row, summary, picker panel, footer,
confirm).

`src/lib/components/ui/` (shadcn-svelte, added with its CLI): alert-dialog, badge, button,
checkbox, collapsible, dialog, dropdown-menu, input, label, progress, scroll-area, select,
separator, skeleton, sonner, tabs, textarea, tooltip. `sonner` is edited to follow `$lib/theme`
in place of mode-watcher. `Tooltip.Provider` is in the root layout.

`src/lib/components/` (sg-widgets registry copies, added with the same CLI from
`https://sg-widgets.vercel.app/r/svelte/<name>.json`, never edited here): entity-type-picker,
entity-type-multi-picker, entity-glyphs, state-line, data-type-picker, valid-values-editor, and
what they install with them. The editor's data type and valid values are those two widgets. The
registry's `checkbox` replaces shadcn's: it draws the mixed state.
