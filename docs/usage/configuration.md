# Usage: Configuration Tools

This guide shows how to read and update configuration via MCP tools and manage backups. Values and defaults map to env schema in src/config/env.ts.

Read Configuration getConfiguration
```ts
// Retrieve specific keys or full configuration
const res = await client.callTool({
  name: 'getConfiguration',
  arguments: {
    keys: ['LOG_LEVEL', 'PORT', 'MONITORING_ENABLE_PROMETHEUS_EXPORT'] // optional
  }
});
const payload = JSON.parse(res.content[0].text);
console.log('Configuration:', payload.configuration);
```

Update Configuration updateConfiguration
```ts
// Update one or more config values; validateOnly to dry-run
const res = await client.callTool({
  name: 'updateConfiguration',
  arguments: {
    updates: {
      LOG_LEVEL: 'debug',
      MONITORING_ENABLE_PROMETHEUS_EXPORT: true
    },
    options: {
      validateOnly: false,
      restartRequired: false
    }
  }
});
const payload = JSON.parse(res.content[0].text);
if (!payload.success) {
  console.error('Validation errors:', payload.validationErrors);
}
```

Configuration Backups manageConfigurationBackup
```ts
// Create backup
const created = await client.callTool({
  name: 'manageConfigurationBackup',
  arguments: {
    action: 'create',
    options: { description: 'Pre-deployment change' }
  }
});
console.log('Backup created:', JSON.parse(created.content[0].text).backupId);

// List backups
const list = await client.callTool({
  name: 'manageConfigurationBackup',
  arguments: { action: 'list' }
});
console.log('Backups:', JSON.parse(list.content[0].text).backups);

// Restore backup
await client.callTool({
  name: 'manageConfigurationBackup',
  arguments: { action: 'restore', backupId: 'backup-id' }
});
```

Common Keys reference
- PORT: server port default 3000
- LOG_LEVEL: error, warn, info, debug default info
- DATABASE_URL: PostgreSQL connection string
- REDIS_URL: Redis connection string
- MONITORING_ENABLE_PROMETHEUS_EXPORT: enable Prometheus metrics default true
- RETENTION_*: retention and cleanup schedules see docs/configuration.md

Notes
- Updates are validated against runtime schema see src/config/env.ts
- Some changes may require restart depending on options
- Use backups before major changes

Related
- Configuration details and env vars: ../configuration.md
- Monitoring and metrics: ../deployment.md
- API reference: ../api-reference.md