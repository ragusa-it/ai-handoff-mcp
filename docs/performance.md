# Performance

This guide unifies tuning advice and placeholders for benchmarks to help you meet latency and throughput targets in production.

Note on legacy docs
- If a legacy page named performance-tuning.md exists, it is superseded by this page. Keep the legacy file with a short note pointing here.

Goals
- P95 latency <= 100ms for core tools under nominal load
- Error rate <= 0.1% sustained
- Efficient resource utilization CPU < 70%, memory < 80%

Key Metrics
- Business: sessions_created_total, handoffs_processed_total, context_entries_total
- Technical: tool_duration_ms_bucket, db_query_time_seconds, cache_hit_ratio, error_rate

Monitoring
```bash
# Prometheus exposition if enabled
curl -s http://localhost:9090/metrics | head -n 50
```

Database Optimization
- Use prepared statements for hot queries
- Keep indexes on sessions.session_key, context_history.session_id, context_history.created_at
- Limit result sets and use pagination for large contexts

Connection Pooling
- Start with pool size near CPU cores * 2 and tune empirically
- Monitor saturation and queue time; increase gradually

Caching
- Cache latest context and session summaries with TTL
- Invalidate event-driven on writes and set conservative TTLs for summaries

Node.js Memory
- Set NODE_OPTIONS=--max-old-space-size appropriate to instance memory
- Watch heap usage; investigate leaks with inspect profiles if growth persists

k6 Load Test Example (placeholder)
```js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '1m', target: 10 },
    { duration: '3m', target: 50 },
    { duration: '1m', target: 0 },
  ],
};

export default function () {
  // Replace with your MCP wrapper endpoint if applicable
  const res = http.get('http://localhost:3000/health');
  check(res, { 'status is 200': (r) => r.status === 200 });
  sleep(1);
}
```

Artillery Scenario Sketch (placeholder)
```yaml
config:
  target: "http://localhost:3000"
  phases:
    - duration: 60
      arrivalRate: 10
scenarios:
  - name: "Mixed tools"
    flow:
      - get:
          url: "/health"
      # Use HTTP bridge or wrapper to trigger MCP calls in test harness
```

Benchmark Template
```text
Environment: 4 vCPU, 8GB RAM, Postgres 15, Redis 7
Workload: 50 rps sustained, 10 min warmup, 30 min run
Results:
- P50/P95 tool duration: 18ms / 85ms
- Error rate: 0.02%
- DB avg query: 6ms
- Cache hit ratio: 0.78
```

Troubleshooting Performance
- Latency spikes: check DB slow queries and connection pool saturation
- High CPU: sample profiles and reduce GC pressure by batching writes
- High memory: reduce context payload sizes and add truncation previews

Related
- Deployment: ./deployment.md
- Troubleshooting: ./troubleshooting.md
- API Reference: ./api-reference.md