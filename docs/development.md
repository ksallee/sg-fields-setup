# Working on sg-fields-setup

## Run it

    pnpm install
    pnpm dev

Open the URL Vite prints. Name the site on the connect page and sign in through the App Session
Launcher. One site at a time. The navbar shows it; click it to change site or sign out.

    pnpm check
    pnpm lint
    pnpm test
    pnpm build

`pnpm lint` is oxlint (`.oxlintrc.json`). Beside its default rules it holds the layers: `pure`
imports no `io`, `app`, `$lib/live`, `$app`, `$env`, svelte, node or `$lib/testing`, and uses no
node global; `io` imports no `app`, node or `$lib/testing`; nothing outside tests and the dev-only
fake imports `$lib/testing`.

`.github/workflows/gates.yml` runs those four on every pull request and on pushes to `dev` and
`main`, then `pnpm check:build`: it fails when the built output holds dev-only code (the dev token
route, the script key's variable names, the fake site). Run it after a `pnpm build`.

## Ports

`pnpm dev` takes Vite's default, 5173. Anything else that runs beside it (a second worktree, an
agent's headless drive) takes its own port from 5211 up, one each:

    pnpm dev --port 5211 --strictPort

`--strictPort` makes Vite stop when the port is taken, so a drive never lands on another checkout's
server.

## The dev token

`.env.local` at the repo root is gitignored. It takes the three `FPT_API_*` lines of the sandbox
site (see `.env.example`):

    grep '^FPT_API_' ../sg-groundtruth/.env.local > .env.local

Under `vite dev`, `POST /live/dev-token` then mints a 600 s bearer from that script key. The app
connects to that site with no sign-in, and the navbar reads "Dev key". Signing in over it writes as
yourself. A production build answers that route 404 and always signs in.

`pnpm dev --host` puts the dev server on the network, and the dev token route has no caller check:
anyone on the LAN could then mint a bearer from the script key. Never use `--host` with a script
key in `.env.local`.

Every schema write spends a field name for good. Write to the sandbox only, with the corpus's
throwaway naming.

The browser calls the site itself, writes included. The site answers the preflight for `POST`,
`PUT` and `DELETE` on `/api/v1/schema/...` with the page's origin and
`authorization,content-type`. Measured from `localhost` in the drive below. No server route sits
between the page and the site.

## What a set file carries

An exported set file (`src/lib/pure/set-file.ts`) holds the set and its fields, and with them: the
address of the site each field was captured from (`snapshotSite`), each captured field's schema
record as the site sent it (`snapshot`: every property, valid values and status values included),
and the names of the spreadsheets it was imported from (`originDetails.sourceFiles`). No token, no
person. The export toast says so when the set has captured fields.

An imported set file is refused over 20 MB, before it is read, and when a snapshot nests more than
32 deep.

## Which sites are accepted

A site is an https address with no user name, no password and no port, on a host ending
`.shotgrid.autodesk.com` or `.shotgunstudio.com`. `src/lib/pure/site-host.ts` is the rule. The
`/live/` endpoints refuse anything else with a 400, follow no redirect, wait ten seconds, and answer
only the fields the page reads. The dev token route holds `FPT_API_SITE_URL` to the same rule.

A site on another domain needs `FPT_EXTRA_SITE_SUFFIXES`: comma-separated host names, such as
`flow.example.com`. Each is allowed with its subdomains. An entry that is no plain host name of two
labels or more is dropped. The variable is server only and never reaches the page's code.

## Security headers

`src/lib/pure/security-headers.ts` holds them. `src/lib/pure/security-headers.test.ts` pins them.

- Pages carry a Content Security Policy from SvelteKit's `csp` option (`vite.config.ts`), with a
  nonce per response on every script. The theme script in `src/app.html` carries the nonce. Scripts
  come from the app alone. Styles allow `'unsafe-inline'`: bits-ui, sonner and the widgets set
  `style` attributes. Images allow `https:`, for the site's thumbnails.
- `connect-src` is the app itself and the hosts of "Which sites are accepted". It reads
  `FPT_EXTRA_SITE_SUFFIXES` when the app is built, so set the variable for the build and for the
  functions, and redeploy after changing it. The hosts named there show in the policy.
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and `X-Frame-Options: DENY` go
  on every path through `vercel.json`, and on everything the server answers through
  `src/hooks.server.ts`. The `/live/` endpoints also answer
  `default-src 'none'; frame-ancestors 'none'`.
- `vite dev` serves the same policy, so a blocked call shows while developing.

## The fake site

The install screen is the only one that writes to a site. To drive its run with no network and
nothing written anywhere, under `vite dev` only:

1. On the list, "Import set file": `fixtures/install-drive/install-drive.fieldset.json`.
2. Open its install screen and add `?fake` to the address.

The screen then works on a site held in memory (`src/lib/testing/install-site-fake.ts`, on
`src/lib/testing/fake-site.ts`), seeded for that set: every class of the plan, a revive, a
retired field of another type, a create refused once, a visibility write that fails once. The
header of `install-site-fake.ts` lists them. `?fake&delay=400` slows each call so a cancel can
land mid-run. `?fake&faults=0` turns the two faults off. `window.__installFake` is the fake.

A production build cannot reach it: the flag is read behind `import.meta.env.DEV`, and the
build drops the branch and the module. `src/lib/io/install-site.test.ts` holds the source to
that. To check a build: `pnpm build`, then `pnpm check:build`.

Code that exists for tests and the fake site lives in `src/lib/testing/`: the fake site, the
install screen's fake provider, `makeLiveField`. Only tests and the dev-only branch of
`src/lib/io/install-site.ts` import it (`pnpm lint` holds that). JSON samples shaped like the
corpus stay in `src/lib/pure/fixtures/`.

## Refreshing registry copies

`src/lib/components/` holds copies of sg-widgets' registry widgets, and `src/lib/components/ui/`
the shadcn-svelte components. Neither is edited here. Refresh them on every `sg-widgets-core`
bump, so the widgets match the core they run on.

The items the app adds (each brings what it needs with it):

    R=https://sg-widgets.vercel.app/r/svelte
    pnpm exec shadcn-svelte add $R/data-type-picker.json $R/entity-glyphs.json \
      $R/entity-type-multi-picker.json $R/entity-type-picker.json $R/project-multi-picker.json \
      $R/state-line.json $R/valid-values-editor.json -o -y --no-deps-install

and the shadcn ones:

    pnpm exec shadcn-svelte add alert-dialog badge button collapsible dialog dropdown-menu \
      hover-card input label progress scroll-area select separator skeleton switch tabs \
      textarea tooltip -o -y --no-deps-install

The CLI asks before it overwrites unless given `-o -y`, and wants a terminal. From an agent, run
it in a scratch copy of the repo and bring the changed files over.

- Never re-add `sonner`: `ui/sonner/` follows `$lib/theme` in place of mode-watcher, by hand
  (`docs/design.md`). sg-widgets has no sonner item.
- `ui/checkbox/` is sg-widgets' checkbox, which draws the mixed state. A shadcn `checkbox` would
  replace it; the registry widgets bring theirs back.
- Leave `package.json` as it is unless a widget needs a newer dependency than the one installed.

`src/lib/registry-copies.test.ts` checks every copy against sg-widgets at the tag of the installed
core (`v0.4.0`): the same file with `$lib/registry/components/` read as `$lib/components/`. It
runs where `../sg-widgets` (or `../../sg-widgets`, from a worktree) is checked out with its tags,
and is skipped elsewhere, as in CI.

## The sandbox

The sandbox is the site `.env.local` names. It is the one sg-groundtruth probes
(`../sg-groundtruth/.env.local`). `FPT_PROBE_SANDBOX_PROJECT` there names the one project a drive
may pick for visibility. Fields are site-wide all the same: a created field exists for every
project.

Rules for anything that writes:

- Name new fields `zzprobe <n> ...`, so they derive `sg_zzprobe_<n>_...`. `<n>` is the next number
  free in `../sg-groundtruth/probes`. The prefix tells whoever empties the trash what is litter.
- Reuse before you spend. A retired `sg_zzprobe_*` field is revived by an entry of the same name
  and type, and that costs no name.
- No link fields. An entity or multi-entity link also makes a field on each valid type, and each
  of those names is spent too (corpus finding 121).
- Never name `sg_zzprobe_116_entity` or `sg_currency` in a set. Both sit in the trash in a state
  the owner has to clear.
- Retire what you made when you finish, and check each with a read.

## A live write drive

Unit tests and the fake site cover the run. A live drive is for what they cannot: real requests
from a real browser. It costs names, so it is done once per need, planned before the first write.

The drive of issue #22, 2026-11-10, as a recipe:

1. Preflight by script, reads only. Each name to create answers 404. Each retired field to revive
   answers 404. List the eligible projects. Save the type's field listing and each eligible
   project's `visible` values. Check the preflight `OPTIONS` for the write methods.
2. Write the plan of writes down: names spent, names revived, visibility writes per project.
3. Build the set through the app: a CSV through the import dialog, edits in the editor, save.
4. Install screen. Pick the sandbox project. Read the plan and the confirmation against the plan
   of writes. Install.
5. Read the site by script and compare: settings, the trash, visibility on the sandbox and on two
   other projects, and the listing against the one saved.
6. Retry, download the report, open the trash link, Refresh.
7. Retire by script every field made or revived. Read each: 404. Compare the listing again.

What it cost and did:

| entry | what the run did | names spent |
|---|---|---|
| three new fields (text, list, checkbox) | revive 404, create 201, read back, 13 hides each | 3 |
| a retired text field, same type | revive 204, one update, read back, 13 hides | 0 |
| a retired checkbox field, wanted as text | revive 204, read, retire 204, row failed with the trash link | 0 |
| a live field that matches | nothing: already visible on the picked project | 0 |

Spent: `Version.sg_zzprobe_122_fs_text`, `sg_zzprobe_122_fs_list`, `sg_zzprobe_122_fs_checkbox`.
All three are retired and can be revived by a later drive at no cost.

Cancel, resume and "Retry visibility" were driven on the same fields with no new name: Refresh,
clear the picker, install the four matching fields for all eligible projects, cancel during the
first field's visibility. That run writes `visible` only.

A retired field comes back as it was. `sg_zzprobe_116_text` was created unique, so its entry must
be unique too. With unique off the run retires it again and fails the row: unique cannot be
changed.

Not driven live: link fields, a blocked update, a type conflict on a live field, a visibility
write that fails, a write as a person below Admin (G7), and the trash page itself, which needs a
web session. The fake site covers the first four.

## Deploy

From `main` alone. `vercel.json` names SvelteKit as the framework, enables `main` under
`git.deploymentEnabled`, and skips every other ref in `ignoreCommand` off `VERCEL_GIT_COMMIT_REF`.
A feature branch never builds a preview. `src/lib/deploy.test.ts` holds it to that. The build is
`@sveltejs/adapter-vercel`: the page is a client-rendered shell (`ssr = false`) and the routes under
`/live/` are serverless functions.

Set in the Vercel project, value never in the repo:

| var | what it does deployed |
|---|---|
| `PUBLIC_FPT_SITE_URL` | fills the site field on the connect page. It never connects by itself. |
| `FPT_EXTRA_SITE_SUFFIXES` | optional. Extra site hosts the `/live/` endpoints accept. See "Which sites are accepted". |

`FPT_API_SITE_URL`, `FPT_API_SCRIPT_NAME` and `FPT_API_API_KEY` are dev only, in `.env.local`. Never
set them on Vercel.
