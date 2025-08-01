# AI Handoff MCP Server Deployment Guide

## Overview

This guide provides comprehensive instructions for deploying the AI Handoff MCP Server in various environments, from local development to production clusters.

## Table of Contents

1. [System Requirements](#system-requirements)
2. [Installation](#installation)
3. [Configuration](#configuration)
4. [Database Setup](#database-setup)
5. [Environment-Specific Deployment](#environment-specific-deployment)
6. [Container Deployment](#container-deployment)
7. [Kubernetes Deployment](#kubernetes-deployment)
8. [Monitoring and Logging](#monitoring-and-logging)
9. [Security Considerations](#security-considerations)
10. [Backup and Recovery](#backup-and-recovery)
11. [Scaling](#scaling)
12. [Troubleshooting](#troubleshooting)

## System Requirements

### Minimum Requirements

- **CPU**: 2 cores
- **Memory**: 4 GB RAM
- **Storage**: 20 GB available disk space
- **Operating System**: Linux (Ubuntu 20.04+), macOS (12+), or Windows Server 2019+
- **Node.js**: 18.x or higher
- **PostgreSQL**: 13.x or higher
- **Redis**: 6.x or higher

### Recommended Requirements

- **CPU**: 4 cores
- **Memory**: 8 GB RAM
- **Storage**: 50 GB available disk space (SSD recommended)
- **Operating System**: Ubuntu 22.04 LTS
- **Node.js**: 20.x LTS
- **PostgreSQL**: 15.x
- **Redis**: 7.x

## Installation

### Prerequisites

1. Install Node.js and npm:
```bash
# Using nvm (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 20
nvm use 20
```

2. Install PostgreSQL:
```bash
# Ubuntu/Debian
sudo apt update
sudo apt install postgresql postgresql-contrib

# macOS (using Homebrew)
brew install postgresql

# Start PostgreSQL service
sudo systemctl start postgresql
```

3. Install Redis:
```bash
# Ubuntu/Debian
sudo apt install redis-server

# macOS (using Homebrew)
brew install redis

# Start Redis service
sudo systemctl start redis
```

### Install AI Handoff MCP Server

1. Clone the repository:
```bash
git clone https://github.com/your-org/ai-handoff-mcp.git
cd ai-handoff-mcp
```

2. Install dependencies:
```bash
npm install
```

3. Build the project:
```bash
npm run build
```

## Configuration

### Environment Variables

Create a `.env` file in the project root with the following variables:

```env
# Server Configuration
SERVER_PORT=3000
SERVER_HOST=localhost
NODE_ENV=production

# Database Configuration
DATABASE_URL=postgresql://username:password@localhost:5432/handoff_mcp
DATABASE_POOL_SIZE=20
DATABASE_SSL=false

# Redis Configuration
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=
REDIS_DB=0

# Security Configuration
API_KEY_SECRET=your-secret-key-here
JWT_SECRET=your-jwt-secret-here
ENCRYPTION_KEY=your-encryption-key-here

# Logging Configuration
LOG_LEVEL=info
LOG_FORMAT=json
LOG_FILE_PATH=/var/log/handoff-mcp/server.log

# Metrics and Monitoring
METRICS_ENABLED=true
METRICS_COLLECTION_INTERVAL=60000
ALERTING_ENABLED=true
ALERTING_EMAIL_RECIPIENTS=admin@example.com,alerts@example.com

# Performance Tuning
CONTEXT_CACHE_TTL=3600
SESSION_TTL=86400
MAX_CONCURRENT_HANDOFFS=100
```

### Configuration File

For advanced configuration, create a `config.json` file:

```json
{
  "server": {
    "port": 3000,
    "host": "0.0.0.0",
    "cors": {
      "origin": ["https://your-frontend.com"],
      "credentials": true
    }
  },
  "database": {
    "connectionTimeout": 30000,
    "idleTimeout": 10000,
    "maxRetries": 3
  },
  "redis": {
    "connectTimeout": 5000,
    "commandTimeout": 10000
  },
  "logging": {
    "level": "info",
    "transports": [
      {
        "type": "file",
        "filename": "/var/log/handoff-mcp/server.log",
        "maxsize": 104857600,
        "maxFiles": 10
      },
      {
        "type": "console",
        "format": "pretty"
      }
    ]
  },
  "metrics": {
    "enabled": true,
    "collectionInterval": 60000,
    "prometheus": {
      "enabled": true,
      "port": 9090
    }
  },
  "alerting": {
    "enabled": true,
    "channels": {
      "email": {
        "enabled": true,
        "smtp": {
          "host": "smtp.example.com",
          "port": 587,
          "secure": false,
          "auth": {
            "user": "alerts@example.com",
            "pass": "your-password"
          }
        }
      },
      "slack": {
        "enabled": true,
        "webhookUrl": "https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK"
      }
    }
  }
}
```

## Database Setup

### PostgreSQL Setup

1. Create database and user:
```sql
sudo -u postgres psql
CREATE DATABASE handoff_mcp;
CREATE USER handoff_user WITH ENCRYPTED PASSWORD 'your-password';
GRANT ALL PRIVILEGES ON DATABASE handoff_mcp TO handoff_user;
\q
```

2. Run database migrations:
```bash
npm run migrate
```

3. Seed initial data (optional):
```bash
npm run seed
```

### Redis Setup

1. Configure Redis persistence (optional but recommended):
```bash
# Edit redis.conf
sudo nano /etc/redis/redis.conf

# Add or modify:
save 900 1
save 300 10
save 60 10000
```

2. Restart Redis:
```bash
sudo systemctl restart redis
```

## Environment-Specific Deployment

### Development Environment

For local development, use the following configuration:

```env
NODE_ENV=development
SERVER_PORT=3000
LOG_LEVEL=debug
METRICS_ENABLED=true
ALERTING_ENABLED=false
```

Start the server:
```bash
npm run dev
```

### Staging Environment

For staging, use production-like settings with test data:

```env
NODE_ENV=staging
SERVER_PORT=3000
LOG_LEVEL=info
METRICS_ENABLED=true
ALERTING_ENABLED=true
DATABASE_URL=postgresql://staging_user:password@staging-db.example.com:5432/handoff_mcp_staging
```

### Production Environment

For production, use optimized settings:

```env
NODE_ENV=production
SERVER_PORT=3000
LOG_LEVEL=warn
METRICS_ENABLED=true
ALERTING_ENABLED=true
DATABASE_URL=postgresql://prod_user:password@prod-db.example.com:5432/handoff_mcp
DATABASE_POOL_SIZE=50
CONTEXT_CACHE_TTL=1800
SESSION_TTL=43200
```

## Container Deployment

### Docker

1. Build Docker image:
```bash
docker build -t ai-handoff-mcp:latest .
```

2. Create Docker network:
```bash
docker network create handoff-network
```

3. Run PostgreSQL container:
```bash
docker run -d \
  --name handoff-postgres \
  --network handoff-network \
  -e POSTGRES_DB=handoff_mcp \
  -e POSTGRES_USER=handoff_user \
  -e POSTGRES_PASSWORD=your-password \
  -v postgres-data:/var/lib/postgresql/data \
  -p 5432:5432 \
  postgres:15
```

4. Run Redis container:
```bash
docker run -d \
  --name handoff-redis \
  --network handoff-network \
  -v redis-data:/data \
  -p 6379:6379 \
  redis:7 redis-server --appendonly yes
```

5. Run application container:
```bash
docker run -d \
  --name handoff-server \
  --network handoff-network \
  -p 3000:3000 \
  -v /path/to/config:/app/config \
  -v /var/log/handoff-mcp:/var/log/handoff-mcp \
  ai-handoff-mcp:latest
```

### Docker Compose

Create a `docker-compose.yml` file:

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: handoff_mcp
      POSTGRES_USER: handoff_user
      POSTGRES_PASSWORD: your-password
    volumes:
      - postgres-data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    networks:
      - handoff-network

  redis:
    image: redis:7
    command: redis-server --appendonly yes
    volumes:
      - redis-data:/data
    ports:
      - "6379:6379"
    networks:
      - handoff-network

  handoff-server:
    build: .
    depends_on:
      - postgres
      - redis
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://handoff_user:your-password@postgres:5432/handoff_mcp
      - REDIS_URL=redis://redis:6379
    volumes:
      - ./config:/app/config
      - /var/log/handoff-mcp:/var/log/handoff-mcp
    ports:
      - "3000:3000"
    networks:
      - handoff-network

volumes:
  postgres-data:
  redis-data:

networks:
  handoff-network:
    driver: bridge
```

Run with:
```bash
docker-compose up -d
```

## Kubernetes Deployment

### Helm Chart

Create a Helm chart for deployment:

```yaml
# Chart.yaml
apiVersion: v2
name: ai-handoff-mcp
version: 1.0.0
appVersion: 1.0.0
```

```yaml
# values.yaml
replicaCount: 3

image:
  repository: your-registry/ai-handoff-mcp
  tag: latest
  pullPolicy: IfNotPresent

service:
  type: ClusterIP
  port: 3000

resources:
  limits:
    cpu: 500m
    memory: 1Gi
  requests:
    cpu: 250m
    memory: 512Mi

env:
  NODE_ENV: production
  SERVER_PORT: 3000
  LOG_LEVEL: info

config:
  database:
    url: postgresql://handoff_user:password@postgres:5432/handoff_mcp
    poolSize: 20
  redis:
    url: redis://redis:6379

ingress:
  enabled: true
  hosts:
    - host: handoff.example.com
      paths:
        - path: /
          pathType: Prefix
```

### Deployment Manifest

```yaml
# deployment.yaml
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
        image: your-registry/ai-handoff-mcp:latest
        ports:
        - containerPort: 3000
        envFrom:
        - configMapRef:
            name: handoff-config
        - secretRef:
            name: handoff-secrets
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "1Gi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: ai-handoff-mcp
spec:
  selector:
    app: ai-handoff-mcp
  ports:
    - protocol: TCP
      port: 80
      targetPort: 3000
  type: ClusterIP
```

## Monitoring and Logging

### Logging Configuration

The server supports multiple logging transports:

1. **File Logging**:
```json
{
  "logging": {
    "transports": [
      {
        "type": "file",
        "filename": "/var/log/handoff-mcp/server.log",
        "maxsize": 104857600,
        "maxFiles": 10
      }
    ]
  }
}
```

2. **Syslog**:
```json
{
  "logging": {
    "transports": [
      {
        "type": "syslog",
        "host": "syslog.example.com",
        "port": 514,
        "protocol": "tcp"
      }
    ]
  }
}
```

3. **Elasticsearch**:
```json
{
  "logging": {
    "transports": [
      {
        "type": "elasticsearch",
        "host": "https://elasticsearch.example.com",
        "index": "handoff-mcp-logs"
      }
    ]
  }
}
```

### Metrics Collection

Enable Prometheus metrics:
```env
METRICS_ENABLED=true
METRICS_PROMETHEUS_ENABLED=true
METRICS_PROMETHEUS_PORT=9090
```

Metrics are available at `http://localhost:9090/metrics`

### Health Checks

The server provides health check endpoints:

- **Liveness**: `GET /health` - Basic server health
- **Readiness**: `GET /ready` - Server ready for requests
- **Metrics**: `GET /metrics` - System metrics

## Security Considerations

### API Authentication

Enable API key authentication:
```env
API_KEY_AUTH_ENABLED=true
API_KEY_HEADER=X-API-Key
```

### TLS Configuration

For HTTPS, configure TLS in the server settings:
```json
{
  "server": {
    "tls": {
      "enabled": true,
      "certFile": "/path/to/certificate.crt",
      "keyFile": "/path/to/private.key"
    }
  }
}
```

### Rate Limiting

Configure rate limiting:
```json
{
  "rateLimiting": {
    "enabled": true,
    "requestsPerMinute": 1000,
    "burstLimit": 100
  }
}
```

## Backup and Recovery

### Database Backup

1. **Automated Backups**:
```bash
# Create backup script
#!/bin/bash
pg_dump -U handoff_user -h localhost -p 5432 handoff_mcp > /backups/handoff_mcp_$(date +%Y%m%d_%H%M%S).sql

# Schedule with cron
0 2 * * * /scripts/backup-db.sh
```

2. **Point-in-Time Recovery**:
```bash
# Restore from backup
psql -U handoff_user -h localhost -p 5432 handoff_mcp < backup.sql
```

### Configuration Backup

Use the built-in configuration backup tool:
```bash
# Create configuration backup
npm run config-backup -- --description="Pre-update backup"

# List backups
npm run config-backup -- --list

# Restore backup
npm run config-backup -- --restore=backup-id-here
```

## Scaling

### Horizontal Scaling

Deploy multiple instances behind a load balancer:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: ai-handoff-mcp-lb
spec:
  type: LoadBalancer
  selector:
    app: ai-handoff-mcp
  ports:
    - protocol: TCP
      port: 80
      targetPort: 3000
```

### Vertical Scaling

Increase resource limits in your deployment configuration:

```yaml
resources:
  limits:
    cpu: 1000m
    memory: 2Gi
  requests:
    cpu: 500m
    memory: 1Gi
```

### Database Scaling

1. **Connection Pooling**:
```env
DATABASE_POOL_SIZE=50
DATABASE_MAX_CONNECTIONS=100
```

2. **Read Replicas**:
Configure read replicas in the database configuration:
```json
{
  "database": {
    "readReplicas": [
      "postgresql://user:pass@replica1:5432/handoff_mcp",
      "postgresql://user:pass@replica2:5432/handoff_mcp"
    ]
  }
}
```

## Troubleshooting

### Common Issues

1. **Database Connection Failed**:
```bash
# Check database connectivity
nc -zv localhost 5432

# Check database logs
tail -f /var/log/postgresql/postgresql-15-main.log
```

2. **Redis Connection Failed**:
```bash
# Check Redis connectivity
redis-cli ping

# Check Redis logs
tail -f /var/log/redis/redis-server.log
```

3. **High Memory Usage**:
```bash
# Check memory usage
free -h

# Check Node.js heap usage
node --inspect -e "console.log(process.memoryUsage())"
```

4. **Performance Issues**:
```bash
# Check system metrics
top
iostat -x 1

# Check application logs
tail -f /var/log/handoff-mcp/server.log
```

### Log Analysis

Use log analysis tools to identify issues:

```bash
# Search for errors
grep -i error /var/log/handoff-mcp/server.log

# Count requests by endpoint
awk '/"GET/ {print $7}' /var/log/handoff-mcp/server.log | sort | uniq -c | sort -nr

# Analyze response times
awk '/"duration_ms"/ {print $NF}' /var/log/handoff-mcp/server.log | sort -n
```

### Health Monitoring

Set up health monitoring with external tools:

1. **Uptime Monitoring**:
```bash
# Simple health check script
#!/bin/bash
curl -f http://localhost:3000/health || echo "Server down"
```

2. **Alerting**:
Configure alerts for critical metrics:
- High CPU usage (>80% for 5 minutes)
- High memory usage (>85% for 5 minutes)
- Database connection failures
- High error rates (>5% for 1 minute)