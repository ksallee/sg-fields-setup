# Design

sg-widgets' default theme (`src/app.css`) and its `docs/design-rules.md` bind everything below:
tokens only, its spacing and size ladders, no new palette, no new font. Layout, hierarchy and copy
are this app's. It reads as sg-task-templates' sibling. Every screen is held to this file.

Written with the set list (#15). The import dialog, the editor and the install screen follow it.

## Routes

`$lib/pure/routes.ts` builds every path. No screen spells one by hand.

| path | screen |
|---|---|
| `/` | The set list. The spreadsheet import is a dialog on it (`app/import-dialog.svelte`), not a route. |
| `/sets/<id>` | The editor. `setPath(id)`. |
| `/sets/<id>/install` | The install of the whole set. `installPath(id)`. |
| `/sets/<id>/install?selection=1` | The install of the editor's selection. `installPath(id, { selection: true })`. The editor first calls `writeInstallSelection(id, entryIds)` from `$lib/io/install-selection`; the install screen calls `readInstallSelection(id)` and takes the whole set when it answers null. |
| `/connect` | The site and the sign-in. |

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
- A failure while a dialog is open shows in the dialog, not as a toast.
- No toast for something the screen already shows.

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

## Shared pieces

`src/lib/app/`: `app-shell`, `page-header`, `page-state`, `notice`, `confirm-dialog`,
`icon-button`, `relative-time`, `toast.ts`, `create-set-dialog`, `import-dialog`, `set-list/`.

`src/lib/components/ui/` (shadcn-svelte, added with its CLI): alert-dialog, badge, button,
checkbox, collapsible, dialog, dropdown-menu, input, label, progress, scroll-area, select,
separator, skeleton, sonner, tabs, textarea, tooltip. `sonner` is edited to follow `$lib/theme`
in place of mode-watcher. `Tooltip.Provider` is in the root layout.
