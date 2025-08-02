# Usage: Configuration Tools

This guide documents the configuration MCP tools and backup lifecycle. Values map to the runtime schema in [`src/config/env.ts`](src/config/env.ts:1). Use the following resource URIs to verify state:
- handoff://configuration
- handoff://configuration/backups

See also: [`../api-reference.md`](docs/api-reference.md:1) and [`./resources.md`](docs/usage/resources.md:1) for tool and resource details.

## Configuration Tools

- get_configuration — Retrieve current system configuration
- update_configuration — Update configuration values
- manage_configuration_backup — Backup and restore operations

## Sections

Available sections referenced in implementation:
- retention — data retention and cleanup behavior
- monitoring — metrics, exporters, and health monitoring
- analytics — analytics and anomaly detection toggles and thresholds
- backups — backup metadata and lifecycle state
- all — virtual section representing the full configuration

Subsections commonly referenced in examples may include jobs under retention or analytics where applicable.

## get_configuration

Retrieve the full configuration or a specific section.

Parameters:
- configSection (optional): 'retention' | 'monitoring' | 'analytics' | 'backups' | 'all' (default: 'all')
- includeMetadata (optional): boolean (default: true)
- format (optional): 'json' | 'yaml' (default: 'json')

```ts
// Example: fetch full configuration and verify via resource
const res = await client.callTool({
  name: 'get_configuration',
  arguments: {
    // defaults to { configSection: 'all', includeMetadata: true, format: 'json' }
  }
});
const parsed = JSON.parse(res.content[0].text);
if (!parsed.success) throw new Error(parsed.message);

// Domain-aligned fields:
console.log('Configuration snapshot:', parsed.data.configuration);

// Resource verification (read-only):
const configResource = await client.readResource('handoff://configuration');
console.log('Resource config length:', configResource?.content?.[0]?.text?.length ?? 0);
```

```ts
// Example: fetch a specific section
const res = await client.callTool({
  name: 'get_configuration',
  arguments: { configSection: 'monitoring', includeMetadata: false }
});
const parsed = JSON.parse(res.content[0].text);
if (parsed.success) {
  console.log('Monitoring config:', parsed.data.monitoringConfig);
}
```

## update_configuration

Apply partial or full configuration updates.

Parameters:
- configSection (required): 'retention' | 'monitoring' | 'analytics' | 'all'
- values object by section:
  - retention: retentionPolicy (object; keys optional)
  - monitoring: monitoringConfig (object; keys optional)
  - analytics: analyticsConfig (object; keys optional)
  - all: may include any of retentionPolicy, monitoringConfig, analyticsConfig, plus configuration (record) for top-level merges
- updatedBy (optional): string (defaults to 'mcp-tool')

Notes:
- Partial update: provide only the keys you want to change; others remain unchanged.
- Full update: when configSection='all', you can update multiple areas in one call.
- Response includes restartRequired indicator via domain payload; if true, schedule a restart. Hot-reloadable changes apply immediately.

```ts
// Example: partial update (monitoring) with hot reload vs restart check
const res = await client.callTool({
  name: 'update_configuration',
  arguments: {
    configSection: 'monitoring',
    monitoringConfig: {
      enablePrometheusExport: true,
      logLevel: 'debug',
      alertThresholds: { errorRate: 3 }
    },
    updatedBy: 'ops-bot'
  }
});

const parsed = JSON.parse(res.content[0].text);
if (!parsed.success) {
  console.error('Update failed:', parsed.message);
} else {
  // Domain object returns under parsed.data.monitoringConfig (or data.<section> for others)
  console.log('Applied monitoringConfig:', parsed.data.monitoringConfig);

  // Hot reload vs restart indicator:
  const restartRequired = parsed.data.restartRequired === true || parsed.data.configuration?.restartRequired === true;
  console.log('Restart required:', restartRequired === true);

  // Verify via resource:
  const configRes = await client.readResource('handoff://configuration');
  console.log('Post-update verification length:', configRes?.content?.[0]?.text?.length ?? 0);
}
```

```ts
// Example: multi-area update (all)
const res = await client.callTool({
  name: 'update_configuration',
  arguments: {
    configSection: 'all',
    retentionPolicy: { enableAutoCleanup: true, cleanupScheduleCron: '0 3 * * *' },
    monitoringConfig: { enableStructuredLogging: true, logLevel: 'info' },
    analyticsConfig: { reportingEnabled: true, reportingSchedule: '0 6 * * 1' },
    configuration: { // optional additional top-level merges if supported
      updatedBy: 'release-automation'
    }
  }
});

const parsed = JSON.parse(res.content[0].text);
console.log(parsed.message);
const restartRequired = parsed.data.restartRequired === true || parsed.data.configuration?.restartRequired === true;
console.log('Restart required:', restartRequired);
```

## manage_configuration_backup

Create, list, restore, and delete backups of the current configuration.

Parameters:
- action (required): 'create' | 'list' | 'restore' | 'delete'
- backupName (required for create): string label
- backupId (required for restore/delete): string
- options (optional): object (e.g., description)

Notes:
- Delete may be restricted by implementation and could return an error if not supported.
- Verify backups with the resource URI: handoff://configuration/backups.

### Create backup

```ts
const created = await client.callTool({
  name: 'manage_configuration_backup',
  arguments: {
    action: 'create',
    backupName: 'pre-deploy',
    options: { description: 'Pre-deployment change window' }
  }
});
const parsed = JSON.parse(created.content[0].text);
if (!parsed.success) throw new Error(parsed.message);

// Domain-aligned:
console.log('Backup created:', parsed.data.backupId);

// Verify via resource:
const backupsResource = await client.readResource('handoff://configuration/backups');
console.log('Backups snapshot length:', backupsResource?.content?.[0]?.text?.length ?? 0);
```

### List backups

```ts
const list = await client.callTool({
  name: 'manage_configuration_backup',
  arguments: { action: 'list' }
});
const parsed = JSON.parse(list.content[0].text);
if (parsed.success) {
  console.log('Backups:', parsed.data.backups);
  // Resource verification
  const backupsRes = await client.readResource('handoff://configuration/backups');
  console.log('Backups resource length:', backupsRes?.content?.[0]?.text?.length ?? 0);
}
```

### Restore backup

```ts
const restored = await client.callTool({
  name: 'manage_configuration_backup',
  arguments: {
    action: 'restore',
    backupId: 'config-backup-2025-08-02T10:20:30.123Z'
  }
});
const parsed = JSON.parse(restored.content[0].text);
if (!parsed.success) throw new Error(parsed.message);

// Implementation may hot-reload the restored config; if not, expect to handle restart
const restartRequired = parsed.data.restartRequired === true || parsed.data.configuration?.restartRequired === true;
console.log('Restored. Restart required:', restartRequired);

// Validate state via resource:
const cfg = await client.readResource('handoff://configuration');
console.log('Config bytes:', cfg?.content?.[0]?.text?.length ?? 0);
```

### Delete backup

```ts
const deleted = await client.callTool({
  name: 'manage_configuration_backup',
  arguments: {
    action: 'delete',
    backupId: 'config-backup-2025-07-30T16:11:05.000Z'
  }
});
const parsed = JSON.parse(deleted.content[0].text);
console.log('Delete backup:', parsed.success ? 'ok' : parsed.message);
```

## Notes

- Updates are validated against runtime schemas at [`src/services/configurationManager.ts`](src/services/configurationManager.ts:1).
- Hot reload applies where supported; otherwise the response domain object will imply restart necessity (restartRequired).
- Use backups before major changes; always verify after restore using handoff://configuration and inspect backups via handoff://configuration/backups.

## Related

- Configuration details and env vars: [`../configuration.md`](docs/configuration.md:1)
- Resources guide: [`./resources.md`](docs/usage/resources.md:1)
- API reference: [`../api-reference.md`](docs/api-reference.md:1)