# Working on sg-fields-setup

## Run it

    pnpm install
    pnpm dev

Open the URL Vite prints. Name the site on the connect page and sign in through the App Session
Launcher. One site at a time. The navbar shows it; click it to change site or sign out.

    pnpm check
    pnpm test
    pnpm build

`.github/workflows/gates.yml` runs those three on every pull request and on pushes to `dev` and
`main`.

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

Every schema write spends a field name for good. Write to the sandbox only, with the corpus's
throwaway naming.

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

`FPT_API_SITE_URL`, `FPT_API_SCRIPT_NAME` and `FPT_API_API_KEY` are dev only, in `.env.local`. Never
set them on Vercel.
