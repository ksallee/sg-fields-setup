# sg-fields-setup

`specs/` is the plan: what the tool does, requirement by requirement. Read `specs/00-INDEX.md`
first. `specs/10-open-questions.md` holds Kevin's decisions; where another file reads differently,
that table wins.

## Rules

- Requirement IDs (SET-3, RUN-12) are stable. Name the IDs a change covers in its issue, its tests
  and its PR.
- Pure functions in their own modules, no I/O in them: the data model, import parsing and matching,
  the comparison, the planner, the run's state machine. Components only when needed. Pages and
  views as thin as possible, with as little logic as possible.
- Unit tests for every pure module, written first (TDD), fixtures shaped like the corpus
  responses. Integration or E2E tests where a flow needs them.
- API behaviour comes from `~/dev/sg-groundtruth/corpus` (read `INDEX.md` first). Never guess. A
  gap is a probe in sg-groundtruth first: one issue, a PR to `dev`.
- A conditional requirement is built on its fallback first. It moves off the fallback only when
  its probe has answered in the corpus.
- Live only, no mock, as `../sg-task-templates`. `src/lib/live.ts` and the `src/routes/live/`
  endpoints are that app's App Session Launcher sign-in, adapted.
- Sets are stored in the browser (IndexedDB). No server, no accounts.
- Widgets are registry copies from `../sg-widgets`. What the client lacks grows there, issue and
  PR there, never a private extension here.
- Default theme only (`src/app.css`, sg-widgets' default). Light and dark switch in the navbar,
  following the system preference at first.
- No LLM in the app. Deterministic.
- Design passes use Anthropic's frontend-design skill with the sg-widgets theme fixed.
- Every schema write to a site spends a field name for good. Tests and drives that write use the
  sandbox and the corpus's throwaway naming.

## Copy

Kevin's voice, in the app and in the docs: short sentences, plain words, terse. No dashes, no
metaphors, no "not X, Y", no filler.

## Layout

- Pure modules in `src/lib/pure/`, each with its test beside it as `<module>.test.ts`.
- I/O (storage, site calls) in `src/lib/io/`.
- Test support code (the fake site, fixture builders) in `src/lib/testing/`, imported only by tests and the dev-only fake.
- `fixtures/`: the source spreadsheet and hand-built sets used by tests.
- `docs/development.md`: running the app, the ports, the sandbox and the deploy.

## Process

- Issue: one paragraph, edited in place when scope changes. No issue comments.
- Branch from `dev` (`feat/<issue>-slug` or `fix/slug`). PR onto `dev`, squash-merged.
- `main` is promoted by a PR from `dev`, merge commit, after Kevin QAs `dev`.
- Merging to `dev` or `main` needs Kevin's say in the session.
- Worktrees for parallel work go in `../sg-fields-setup-wt/<slug>`.

## Commands

    pnpm install / pnpm dev / pnpm check / pnpm lint / pnpm test / pnpm build
