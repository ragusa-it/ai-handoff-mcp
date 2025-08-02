# Release Notes

Versioning
- The project follows Semantic Versioning major.minor.patch
- Stability: Beta. Limited breaking changes may occur between minor versions, documented with migration notes

Changelog Format
- Added new features
- Changed updates to existing behavior
- Fixed bug fixes
- Deprecated scheduled for removal
- Removed breaking removals
- Security security-related fixes

Unreleased
- Added
  - Initial Docusaurus-compatible documentation structure docs/*
  - Usage guides for sessions, context, handoff, configuration tools, and resources
  - Consolidated API Reference
- Changed
  - README.md updated as newcomer-friendly entry with assumptions and links
  - Deployment docs unified with CI/CD, scaling, monitoring notes
- Fixed
  - N/A
- Deprecated
  - N/A
- Removed
  - N/A
- Security
  - Security guidance added under docs/security.md

Migration Guides
- From 0.x to 0.y
  - Review docs/api-reference.md for any parameter naming alignment with tool implementations
  - Validate env variables against src/config/env.ts using npx tsc --noEmit and boot-time schema validation
  - Re-test MCP client flows registerSession, updateContext, requestHandoff

Upgrade Checklist
- Review release notes for breaking changes and deprecations
- Backup configuration using manageConfigurationBackup tool
- Deploy to staging and validate:
  - Health endpoints /health and /ready
  - Metrics exposure if enabled
  - End-to-end workflow in test/integration
- Roll out to production using your CI/CD strategy

Links
- API Reference: ./api-reference.md
- Deployment: ./deployment.md
- Configuration: ./configuration.md
- Security: ./security.md