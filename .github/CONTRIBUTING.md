# Contributing to Karute

## Branch Workflow

This project uses an integration branch workflow:

```
feature/task-name → integration → main
```

- **Never commit directly to `main` or `integration`**
- Create a feature branch per task: `git checkout -b feature/01-03-auth`
- Open a PR targeting `integration` when the task is complete
- `integration` is merged to `main` at milestone boundaries (end of phase)

### Branch Naming

| Type | Pattern | Example |
|------|---------|---------|
| Feature / task | `feature/{phase}-{plan}-{description}` | `feature/01-03-supabase-auth` |
| Bug fix | `fix/{description}` | `fix/login-redirect` |
| Hotfix to main | `hotfix/{description}` | `hotfix/env-var-missing` |

## @claude Tag Convention

To request Claude to make code changes via a PR comment:

1. Open a PR or issue
2. Add a comment starting with `@claude` followed by your request:

```
@claude Please add error handling to the login form for network timeouts
```

Claude will:
- Read the PR diff and related files
- Implement the requested change
- Push a commit to the PR branch

**Use @claude for:** bug fixes, enhancements to existing PRs, code review follow-ups.
**Don't use @claude for:** large features (use `/gsd:execute-phase` instead), architecture changes.

## CI

CI runs automatically on all PRs targeting `integration` or `main`:
- **Lint**: ESLint via `npm run lint`
- **Type-check**: TypeScript via `npm run type-check`
- **Test**: Jest via `npm test`

All checks must pass before merging. CI uses `--passWithNoTests` until integration tests are added in Phase 8.

## Environment Setup

1. Copy `.env.local.example` to `.env.local`
2. Fill in Supabase dev project credentials (see `.env.local.example` for where to find them)
3. Run `npm run dev` — app starts at localhost:3000
