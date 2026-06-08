# Contributing to Neutree Agent Platform

Thanks for your interest in contributing! This document covers how to propose changes, the local development setup, and the conventions we follow.

By participating you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

- **Report bugs** and **request features** via [GitHub Issues](../../issues) using the provided templates.
- **Improve docs** — fixes to READMEs and inline docs are always welcome.
- **Submit code** via pull requests (see below).

For security vulnerabilities, **do not** open a public issue — follow [SECURITY.md](SECURITY.md).

## Development workflow

This project uses a **pull-request workflow**. Direct pushes to `main` are not accepted; all changes land through review.

1. **Fork** the repository (or create a branch if you have write access).
2. Create a topic branch: `git checkout -b feat/short-description`.
3. Make your change, with tests where it makes sense.
4. Run the relevant checks locally (see below).
5. Open a pull request against `main`. Fill out the PR template — describe the change, how you tested it, and link any related issue.
6. CI runs on the PR. Address review feedback by pushing follow-up commits.

Keep PRs focused: one logical change per PR is much easier to review than a large mixed bag.

## Local development

The repo is a polyglot monorepo. Toolchain by component:

- **`control-plane/` and `web/`** use **npm**.
- Most other services (channel-gateway, scheduler, sandbox-service, browser-service, …) use **[Bun](https://bun.sh)**.
- Linting/formatting is **[Biome](https://biomejs.dev)**; dead-code/dependency checks use **knip**. Both run in the pre-commit hook.

Typical inner loop for a single component:

```bash
cd control-plane          # or web, channel-gateway, …
npm install               # or: bun install
npm run dev               # or: bun run dev
```

Before opening a PR, from the component you changed:

```bash
npx tsc --noEmit          # type-check
npx biome check .         # lint + format
# run the component's test command if it has one (npm test / bun test)
```

A PostgreSQL instance is required to run the control plane. The simplest path for an end-to-end environment is the [self-host installer](self-host/README.md).

### Database migrations

Control-plane schema changes are plain `.sql` files applied at startup. If you add one, **start numbering at `115_`** — lower numbers are reserved by the pre-squash history and reusing them silently diverges existing databases. See [`control-plane/migrations/README.md`](control-plane/migrations/README.md) for the runner's rules and the reasoning.

## Commit and PR conventions

- Write commit messages in **English**, present tense, with a concise summary line. We loosely follow [Conventional Commits](https://www.conventionalcommits.org/) prefixes (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`) — not enforced, but appreciated.
- Keep the history readable: squash noisy fix-up commits before requesting review when practical.
- Reference issues with `Fixes #123` / `Closes #123` so they auto-close on merge.

## License of contributions

This project is licensed under the [Apache License 2.0](LICENSE). By submitting a contribution, you agree that it is licensed under the same terms, and you certify that you have the right to submit it (per the Apache-2.0 inbound=outbound convention).

## Questions

Not sure where something belongs, or whether a change would be welcome? Open a [discussion or issue](../../issues) before investing a lot of work — we're happy to help you scope it.
