# Contributing

Read [AGENTS.md](AGENTS.md) first. Its architectural rules and change
discipline apply to human and automated contributors alike.

## Setup

Requires Node.js ≥ 22.12 and pnpm 10 (`corepack enable` installs the pinned
version).

```bash
pnpm install
pnpm check     # lint + typecheck + tests with coverage + build
```

Individual commands: `pnpm lint`, `pnpm typecheck`, `pnpm test`,
`pnpm test:coverage`, `pnpm build`.

## Expectations

1. Scope each pull request to one GitHub issue.
2. Add or update tests with every behavior change. Coverage thresholds
   (90% lines/functions/statements, 85% branches) are enforced in CI.
3. Commit `pnpm-lock.yaml` whenever dependencies change; CI installs with
   `--frozen-lockfile`.
4. Record contract or boundary changes in `docs/decisions/` and
   `docs/IMPLEMENTATION_STATUS.md`.
5. Pin third-party GitHub Actions to a commit SHA.

## Adding a package

Create `packages/<name>/` with `package.json`, `tsconfig.json` (type-check,
includes tests), `tsconfig.build.json` (emit, `src` only), `src/index.ts`, and
`test/`. Copy the layout of `packages/events`. Workspace packages depend on
each other with `"workspace:*"`.
