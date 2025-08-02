# Deployment

This guide consolidates and expands deployment for local, Docker, Compose, Kubernetes, CI/CD, scaling, monitoring hooks, and operational runbooks. It unifies previous deployment notes.

Supported Environments
- Local development on macOS/Linux
- Docker single container
- Docker Compose multi-service stack Postgres, Redis, Server
- Kubernetes with Helm or raw manifests
- CI/CD runners GitHub Actions, GitLab CI, etc.

System Requirements
- Node.js LTS >= 18
- PostgreSQL 13+ recommended 15
- Redis 6+ recommended 7
- 2 vCPU, 4 GB RAM minimum dev; 4 vCPU, 8 GB RAM recommended staging/prod

Local Development
```bash
npm install
cp .env.example .env
docker-compose up -d postgres redis
# optional migrations/setup if provided by repo
npm run db:setup
npm run dev
```

Docker
Build and run a container image.
```bash
# Build image
docker build -t ai-handoff-mcp:latest .

# Create a network and run dependencies
docker network create handoff-network || true
docker run -d --name handoff-postgres --network handoff-network \
  -e POSTGRES_DB=ai_handoff \
  -e POSTGRES_USER=ai_handoff_user \
  -e POSTGRES_PASSWORD=ai_handoff_password \
  -v postgres-data:/var/lib/postgresql/data \
  -p 5432:5432 postgres:15

docker run -d --name handoff-redis --network handoff-network \
  -v redis-data:/data -p 6379:6379 redis:7 redis-server --appendonly yes

# Run app
docker run -d --name handoff-server --network handoff-network \
  -e DATABASE_URL=postgresql://ai_handoff_user:ai_handoff_password@handoff-postgres:5432/ai_handoff \
  -e REDIS_URL=redis://handoff-redis:6379 \
  -e NODE_ENV=production \
  -p 3000:3000 ai-handoff-mcp:latest
```

Docker Compose
A Compose stack is provided at ./docker-compose.yml for Postgres, Redis, and optional pgAdmin.
```bash
docker-compose up -d postgres redis
# optional
docker-compose --profile tools up -d
```
Example service override for the app:
```yaml
services:
  handoff-server:
    build: .
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://ai_handoff_user:ai_handoff_password@postgres:5432/ai_handoff
      REDIS_URL: redis://redis:6379
      LOG_LEVEL: info
    depends_on:
      - postgres
      - redis
    ports:
      - 3000:3000
    restart: unless-stopped
```

Kubernetes
Helm values sketch:
```yaml
replicaCount: 3
image:
  repository: your-repo/ai-handoff-mcp
  tag: latest
service:
  type: ClusterIP
  port: 3000
env:
  NODE_ENV: production
  LOG_LEVEL: info
config:
  database:
    url: postgresql://handoff_user:password@postgres:5432/ai_handoff
  redis:
    url: redis://redis:6379
resources:
  requests:
    cpu: 250m
    memory: 512Mi
  limits:
    cpu: 500m
    memory: 1Gi
ingress:
  enabled: false
```
Deployment and Service manifests sketch:
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ai-handoff-mcp
spec:
  replicas: 3
  selector:
    matchLabels:
      app: ai-handoff-mcp
  template:
    metadata:
      labels:
        app: ai-handoff-mcp
    spec:
      containers:
      - name: server
        image: your-repo/ai-handoff-mcp:latest
        ports:
        - containerPort: 3000
        env:
        - name: NODE_ENV
          value: production
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: handoff-secrets
              key: DATABASE_URL
        - name: REDIS_URL
          valueFrom:
            configMapKeyRef:
              name: handoff-config
              key: REDIS_URL
        readinessProbe:
          httpGet:
            path: /ready
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
---
apiVersion: v1
kind: Service
metadata:
  name: ai-handoff-mcp
spec:
  selector:
    app: ai-handoff-mcp
  ports:
  - port: 80
    targetPort: 3000
    protocol: TCP
```

Monitoring and Logging
- Prometheus scrape if enabled by MONITORING_ENABLE_PROMETHEUS_EXPORT true
- Health endpoints
  - GET /health liveness
  - GET /ready readiness
  - GET /metrics metrics exposure if configured
- Structured logs JSON preferred for ingestion to ELK/Datadog/Loki

Scaling
Horizontal
- Increase replicas and use a load balancer; ensure session-affinity is not required client-side MCP is stdio for local, but in server-side transports consider sticky routing if applicable
Vertical
- Bump CPU/memory limits and DB pool sizes
Database
- Tune pool sizes see docs/performance.md
- Add read replicas for analytics-heavy workloads

CI/CD example GitHub Actions
```yaml
name: ci
on:
  push:
    branches: [ main ]
jobs:
  build-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npm test -- --ci --reporters=default
  docker:
    needs: build-test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          push: true
          tags: ghcr.io/your-org/ai-handoff-mcp:latest
```

Security
- Inject secrets via K8s Secrets or CI secrets never commit
- Configure TLS at ingress or proxy layer
- Rate limiting and auth hardening if exposed over HTTP transport variants

Backup and Recovery
- Database: use pg_dump or managed backups
- Configuration: use manageConfigurationBackup tool to create and restore snapshots
- Redis: enable append-only AOF with persistence for durability where appropriate

Runbooks
- High error rate
  - Check /metrics error counters and logs
  - Validate database connectivity and pool saturation
- Latency spikes
  - Inspect DB slow queries, adjust indexes or pool settings
- Memory pressure
  - Review heap, increase limits, audit large contexts

Related
- Performance: ./performance.md
- Configuration: ./configuration.md
- Troubleshooting: ./troubleshooting.md