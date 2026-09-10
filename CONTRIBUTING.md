# Contributing

## Development setup

1. Clone the repo and follow the [README](README.md) Quickstart.
2. Ensure you have the prerequisites: Node (LTS), pnpm, Go 1.22+, Docker and Docker Compose.
3. Run `make bootstrap` (or `scripts/bootstrap.sh`) then `make up` to start local services.

## Workflow

- Create a branch from `main` for your change.
- Make changes; run `make test` and `pnpm -r lint` (or equivalent) before pushing.
- Open a pull request; fill in the PR template. Link any related issues.
- After review, maintainers will merge. Prefer squash merge for a clean history.

## Code style

- **TypeScript/Next (control-plane, web):** ESLint + Prettier. Run `pnpm lint` and `pnpm format` in each package.
- **Go (agent):** `gofmt`; optionally `golangci-lint`. Follow existing patterns in the repo.
- **Docs:** Markdown in `docs/`; keep commands copy-pasteable and accurate.

## Commits

- Use clear, imperative messages. Prefix with area when helpful: `fix(control-plane): ...`, `docs: ...`.
- Do not commit `.env` or real secrets. Use `.env.example` as a template.

## Questions

- Open a [GitHub Discussion](https://github.com/248Tech/Mastermind-Minecraft-Server-Manager/discussions) or an issue for questions and ideas.
