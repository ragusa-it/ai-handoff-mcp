# Contributing

Contributions are welcome. This guide outlines local setup, coding standards, testing, and the PR process.

Local Development
```bash
# Clone and install
git clone <repository-url>
cd ai-handoff-mcp
npm install

# Copy environment
cp .env.example .env

# Start infra for local testing
docker-compose up -d postgres redis

# Initialize DB if scripts are provided
npm run db:setup

# Compile and run
npm run build
npm run dev
```

Coding Standards
- Language: TypeScript strict
- Linting: ESLint config at .eslintrc.json
- Formatting: align with ESLint rules and editor settings
- Error handling: prefer structured error helpers and centralized logging
- Observability: include correlation identifiers and durations in logs where practical
- Commit messages: Conventional Commits
  - feat: add session TTL config
  - fix: handle null sessionKey in updateContext
  - docs: add quick-start
  - chore: bump dependencies
  - refactor: split metrics collector

Branching Model
- main: stable, protected, CI required
- feature/*: feature branches
- fix/*: hotfix branches

Testing
- Framework: Jest
- Unit tests under src/**/__tests__
- Integration tests under test/integration
- Commands
```bash
npm test
npm run test:watch
npm run test:coverage
```
- Type checks
```bash
npx tsc --noEmit
```

PR Process
1. Fork and branch from main
2. Ensure lint, type checks, and tests pass
3. Add or update documentation when changing public behavior
4. Open a PR with:
   - Description of changes and motivation
   - Screenshots or logs where applicable
   - Checklist of tests added or updated
5. Reviews require at least one approval
6. CI must pass before merge

Docs Contributions
- Documentation lives under ./docs with Docusaurus-compatible structure
- Keep runnable code examples minimal and verified against tests where possible
- Use Mermaid for diagrams to remain portable
- Update cross-links and ToC consistently
- When moving content, leave a short note in the old location pointing to the canonical page

Issue Reporting
- Include environment details Node.js version, OS, database versions
- Repro steps and minimal examples
- Logs or error messages with timestamps and request correlation ids where available

Security
- Do not include secrets in issues or PRs
- Report vulnerabilities via private channels if provided or via security advisories

Release Workflow overview
- Versioning: Semantic Versioning
- Changelog entry required for user-visible changes
- Breaking changes must include migration notes and docs updates

License
- By contributing, you agree your contributions are licensed under the repository license