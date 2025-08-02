# FAQ

Quick answers to common questions about the AI Handoff MCP Server.

General

What is the AI Handoff MCP Server
- A Model Context Protocol MCP server that enables reliable session and context handoff between AI agents with persistence, monitoring, analytics, and structured logging.

What platforms are supported
- Node.js LTS >= 18 on macOS or Linux. Docker is provided for infra. PostgreSQL and Redis are required for production usage.

What is the project stability
- Beta. Semantic versioning is used. Limited breaking changes can occur and will be documented in release notes with migration notes.

Setup

How do I run it locally
- Follow Quick Start: ./quick-start.md
- Copy .env.example to .env and start Postgres and Redis with docker-compose
- Run npm run dev

Which environment variables are required
- DATABASE_URL, DB_PASSWORD if using discrete DB vars, SESSION_SECRET, JWT_SECRET. See docs/configuration.md and .env.example.

Where do I find a sample docker-compose setup
- docker-compose.yml at the repo root provides Postgres, Redis, and optional pgAdmin profiles.

MCP Tools

How do I register a session
- Use register_session via client.callTool. See ./usage/sessions.md for a full example.

How do I add context to a session
- Use register_session with sessionKey, contextType, content, and optional metadata. See ./usage/context.md.

How do I perform a handoff
- Use register_session with sessionKey, targetAgent, and requestType. See ./usage/handoff.md.

What are the supported handoff types
- context_transfer, full_handoff, collaboration. See ./core-concepts.md for semantics.

Resources

How do I read session history or summaries
- Use accessResource with URIs like handoff://context/{sessionKey} or handoff://summary/{sessionKey}. Examples in ./usage/resources.md.

Operations

Where can I see metrics and health
- Health endpoints /health and /ready. Prometheus metrics if enabled. See ./deployment.md and ./performance.md.

How do I configure logging and retention
- Environment variables in docs/configuration.md and runtime updates via configuration tools in ./usage/configuration.md.

How do I backup and restore configuration
- Use register_session tool. Examples in ./usage/configuration.md.

Troubleshooting

register_session returns Session not found
- The sessionKey is incorrect or expired. Re-register or use the sessionKey exactly as returned from register_session. See ./troubleshooting.md.

register_session returns failed
- Check logs for errorCode and details. Large contexts may be summarized automatically; ensure targetAgent is reachable. See ./troubleshooting.md.

Performance is degrading under load
- Review DB indexes and pool sizes, enable caching, and follow tuning guidance. See ./performance.md.

Security

How should secrets be managed
- Use environment variables in development and secrets managers in production. Do not commit secrets. See ./security.md.

Does the server support TLS
- For remote transports, terminate TLS at ingress or add TLS at the server layer. See ./deployment.md and ./security.md.

Contributing

How do I contribute changes
- See ./contributing.md for coding standards, testing, and PR workflow.

Where are release notes and migration guides
- See ./release-notes.md for versioned changes and migration notes.

Pointers
- Overview: ./overview.md
- Quick Start: ./quick-start.md
- Core Concepts: ./core-concepts.md
- API Reference: ./api-reference.md
- Configuration: ./configuration.md
- Deployment: ./deployment.md
- Troubleshooting: ./troubleshooting.md
- Performance: ./performance.md
- Security: ./security.md
- Usage Guides: ./usage/sessions.md, ./usage/context.md, ./usage/handoff.md, ./usage/configuration.md, ./usage/resources.md