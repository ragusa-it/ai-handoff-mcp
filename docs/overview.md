# Overview

AI Handoff MCP Server enables reliable session and context handoff between AI agents over the Model Context Protocol MCP. It provides persistence, monitoring, analytics, and structured logging designed for production readiness.

Assumptions
- Project name: AI Handoff MCP Server
- Scope: Provide reliable session and context handoff with persistence, monitoring, analytics, structured logging
- Primary use cases: Register sessions, add context, request handoff, retrieve context and resources; optional codebase analysis
- Supported platforms: Node.js LTS >=18, macOS/Linux; Docker provided; Postgres and Redis required for production usage
- Personas: AI integrator/developers primary, operators/SREs secondary, contributors
- Stability: Beta; semantic versioning; limited breaking changes documented in release notes
- Support: Best-effort via repository issues

Key Features
- Session lifecycle management active, dormant, expired, archived
- Context storage with sequencing, retrieval, and summarization
- Handoff requests with types context_transfer, full_handoff, collaboration
- Monitoring, metrics, and distributed tracing
- Configuration tools with backup and restore
- Resilience: graceful degradation, retries, circuit breakers

System Requirements
- Node.js LTS >= 18
- PostgreSQL 13+ and Redis 6+ recommended 7+
- macOS or Linux
- Docker optional for infra

Quick Links
- Quick Start: ./quick-start.md
- Core Concepts: ./core-concepts.md
- Usage Guides: ./usage/sessions.md
- API Reference: ./api-reference.md
- Configuration: ./configuration.md
- Deployment: ./deployment.md
- Security: ./security.md
- Troubleshooting: ./troubleshooting.md
- Performance: ./performance.md
- Contributing: ./contributing.md
- Release Notes: ./release-notes.md
- License: ./license.md
- FAQ: ./faq.md