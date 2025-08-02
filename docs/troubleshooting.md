# Troubleshooting

This page consolidates common issues, diagnostics, FAQs pointers, and recovery steps for AI Handoff MCP Server.

Quick Checklist
- Validate environment variables: .env matches docs/configuration.md
- Check DB and Redis are reachable
- Inspect health endpoints and metrics
- Review structured logs for error codes and request correlation

Common Issues

Server fails to start
- Symptoms: immediate crash, invalid configuration errors
- Actions
  - Validate required env vars
    ```bash
    grep -E "^(DATABASE_URL|REDIS_URL|SESSION_SECRET|JWT_SECRET)" .env
    ```
  - Compile and type-check
    ```bash
    npx tsc --noEmit
    ```
  - Check port conflicts
    ```bash
    lsof -i :3000
    ```

Database connection problems
- Symptoms: connect ECONNREFUSED, timeouts
- Actions
  ```bash
  nc -zv localhost 5432
  PGPASSWORD=ai_handoff_password psql -h localhost -U ai_handoff_user -d ai_handoff -c "select 1"
  tail -n 200 -f /var/log/postgresql/*.log 2>/dev/null || true
  ```

Redis connectivity issues
- Symptoms: timeouts, cache misses spike
- Actions
  ```bash
  redis-cli -h localhost -p 6379 ping
  redis-cli info memory | head
  ```

Context update fails
- Symptoms: success false with Session not found or Session is not active
- Likely causes: wrong sessionKey, expired session, or completed after full_handoff
- Actions
  - Ensure registerSession response sessionKey is used verbatim
  - Reactivate dormant sessions by sending updateContext; the service reactivates when applicable
  - Inspect session status via resource handoff://sessions

Handoff failures
- Symptoms: status failed or errors in logs
- Actions
  - Reduce payload by relying on summary where feasible
  - Retry transient failures; backoff is applied internally
  - Confirm targetAgent is valid in your environment

Authentication and authorization
- If you enabled any auth layer in front of the server, verify keys and headers
- See docs/security.md for recommendations

Diagnostics

Health and readiness
```bash
curl -sf http://localhost:3000/health | jq .
curl -sf http://localhost:3000/ready | jq .
```

Metrics
```bash
# If Prometheus export enabled
curl -s http://localhost:9090/metrics | head -n 50
```

Logs
- Structured JSON logs: search by error and requestId
```bash
# Example grep filters
grep -i error /var/log/handoff-mcp/server.log | tail -50
```

Database
```bash
# Check active connections and slow queries
psql -h localhost -U ai_handoff_user -d ai_handoff -c "select state, count(*) from pg_stat_activity group by state;"
psql -h localhost -U ai_handoff_user -d ai_handoff -c "select query, calls, total_time, mean_time from pg_stat_statements order by total_time desc limit 10;"
```

Performance Symptoms

High CPU
- Capture CPU profile and analyze hottest stacks
- Tune database queries and reduce per-request allocations

High memory
- Inspect heap; trim large context entries or paginate reads
- Adjust NODE_OPTIONS=--max-old-space-size and review caching TTLs

Increased latency
- Check DB pool saturation and query plans
- Confirm Redis and network I/O health

Recovery Procedures
- Graceful restart with backoff if transient infra issues persist
- Use manageConfigurationBackup to restore last known good configuration
- Ensure background cleanup jobs are running to keep datasets lean

FAQ
- See ./faq.md for quick answers to recurring questions

Metrics and Monitoring
- Ensure MONITORING_ENABLE_PROMETHEUS_EXPORT=true to expose /metrics
- Correlate logs with requestId when triaging

Related
- Deployment: ./deployment.md
- Performance: ./performance.md
- Security: ./security.md
- API Reference: ./api-reference.md