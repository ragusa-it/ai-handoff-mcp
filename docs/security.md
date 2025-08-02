# Security

Guidance on permissions, data handling, secrets management, and known limitations for AI Handoff MCP Server.

Principles
- Least privilege: only required permissions to DB and cache
- Defense in depth: validation, structured logging, and circuit breakers
- Observability: correlate security events with request identifiers
- Privacy by default: avoid logging sensitive payloads

Data Handling
- Session data
  - Context entries may contain user content; treat as sensitive
  - Redact known secrets patterns before logging
- Logs
  - Use structured logs JSON; include requestId, sessionKey hash, and errorCode
  - Avoid logging raw context content; log lengths, types, and hashes
- Metrics
  - Prefer aggregate counters and histograms; avoid high-cardinality labels with user data

Secrets Management
- Environment variables are the default mechanism for secrets
- In production, inject via container orchestrator secrets managers rather than committing to repo
- Rotate secrets regularly and after incidents

Authentication and Authorization
- MCP stdio usage typically local; if exposing over network transports, add:
  - API key verification at proxy or app layer
  - TLS termination at ingress or sidecar
  - Optional IP allowlists at firewall or gateway
- Resource access controls
  - If running multi-tenant, consider session namespace segregation

Input Validation
- All tool arguments validated by runtime schemas and TypeScript types
- Size limits enforced for content payloads
- Unknown fields are rejected or ignored based on schema policies

Transport Security
- Stdio is local IPC; for remote or HTTP variants:
  - Require TLS 1.2+ with modern ciphers
  - Enforce HSTS at the edge
  - Disable legacy protocols and weak ciphers
  - Keep dependencies up to date

Audit and Compliance
- Structured logging with timestamps and correlation ids
- Audit trails for configuration changes manage_configuration_backup and manage_configuration_backup
- Retention policies configured via env; align with compliance requirements

Known Limitations
- Beta stability: API contracts may evolve with limited breaking changes between minor versions; see release notes
- No built-in multi-tenant policy enforcement beyond sessionKey isolation
- Stdio transport security depends on host process boundaries; use OS-level permissions and container isolation

Hardening Checklist
- Run as non-root user in containers
- Read-only root filesystem where possible
- Seccomp and AppArmor profiles enabled
- Minimal base images and regular CVE scans
- Pin DB user to least privileges DML on app schema
- Restrict outbound egress if not required

Incident Response
- Triage with /metrics error rates and application logs
- Rotate secrets and invalidate tokens if compromise suspected
- Restore configuration via manage_configuration_backup if misconfiguration caused outage

Related
- Deployment: ./deployment.md
- Configuration: ./configuration.md
- Troubleshooting: ./troubleshooting.md