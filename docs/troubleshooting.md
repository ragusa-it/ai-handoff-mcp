# AI Handoff MCP Server Troubleshooting Guide

## Overview

This guide provides solutions for common issues encountered when running the AI Handoff MCP Server, along with diagnostic procedures and best practices for maintaining system health.

## Table of Contents

1. [Common Issues and Solutions](#common-issues-and-solutions)
2. [Diagnostic Procedures](#diagnostic-procedures)
3. [Performance Issues](#performance-issues)
4. [Database Problems](#database-problems)
5. [Network and Connectivity](#network-and-connectivity)
6. [Security Issues](#security-issues)
7. [Logging and Monitoring](#logging-and-monitoring)
8. [Recovery Procedures](#recovery-procedures)
9. [Best Practices](#best-practices)

## Common Issues and Solutions

### Server Fails to Start

**Symptom**: Server crashes immediately on startup with error messages.

**Possible Causes and Solutions**:

1. **Missing Environment Variables**
   - **Error**: `Error: Missing required environment variable`
   - **Solution**: Check that all required environment variables are set in your `.env` file:
   ```bash
   # Verify environment variables
   cat .env | grep -E "^(DATABASE_URL|REDIS_URL|API_KEY_SECRET)"
   ```

2. **Database Connection Failed**
   - **Error**: `Error: connect ECONNREFUSED`
   - **Solution**: Verify database is running and accessible:
   ```bash
   # Test database connection
   nc -zv localhost 5432
   
   # Check database service status
   sudo systemctl status postgresql
   ```

3. **Port Already in Use**
   - **Error**: `Error: listen EADDRINUSE`
   - **Solution**: Check which process is using the port and stop it:
   ```bash
   # Find process using port 3000
   lsof -i :3000
   
   # Kill the process
   kill -9 <PID>
   ```

### Context Handoff Failures

**Symptom**: Handoff requests fail with timeout or error responses.

**Possible Causes and Solutions**:

1. **Target System Unreachable**
   - **Error**: `HANDOFF_FAILED: Target system unreachable`
   - **Solution**: Verify target system is running and accessible:
   ```bash
   # Test connectivity to target system
   curl -v http://target-system:port/health
   
   # Check network connectivity
   ping target-system
   ```

2. **Context Size Limit Exceeded**
   - **Error**: `VALIDATION_ERROR: Context size exceeds limit`
   - **Solution**: Reduce context size or increase limits:
   ```bash
   # Check current context size
   du -sh /var/lib/handoff-mcp/context/
   
   # Adjust configuration
   echo "CONTEXT_MAX_SIZE=10485760" >> .env  # 10MB
   ```

3. **Serialization Issues**
   - **Error**: `HANDOFF_FAILED: Context serialization failed`
   - **Solution**: Check context data for invalid characters or structures:
   ```bash
   # Validate JSON context data
   cat /var/log/handoff-mcp/server.log | grep -A 10 "serialization failed"
   ```

### Authentication Errors

**Symptom**: API requests return 401 or 403 errors.

**Possible Causes and Solutions**:

1. **Invalid API Key**
   - **Error**: `AUTHENTICATION_FAILED: Invalid API key`
   - **Solution**: Verify API key is correct and active:
   ```bash
   # Test API key
   curl -H "Authorization: Bearer YOUR_API_KEY" http://localhost:3000/health
   
   # Check key in configuration
   grep API_KEY_SECRET .env
   ```

2. **Token Expired**
   - **Error**: `AUTHENTICATION_FAILED: Token expired`
   - **Solution**: Generate new token or refresh existing one:
   ```bash
   # Generate new API key
   npm run generate-api-key -- --name="new-client"
   ```

## Diagnostic Procedures

### Health Check Commands

1. **Server Health**:
```bash
# Check if server is running
curl -f http://localhost:3000/health || echo "Server down"

# Check detailed health status
curl -s http://localhost:3000/health | jq '.'
```

2. **Database Health**:
```bash
# Check database connectivity
pg_isready -h localhost -p 5432 -U handoff_user

# Check database performance
psql -U handoff_user -c "SELECT * FROM pg_stat_database WHERE datname = 'handoff_mcp';"
```

3. **Redis Health**:
```bash
# Check Redis connectivity
redis-cli ping

# Check Redis memory usage
redis-cli info memory
```

### Log Analysis

1. **Error Pattern Search**:
```bash
# Search for recent errors
grep -i error /var/log/handoff-mcp/server.log | tail -20

# Search for specific error types
grep "HANDOFF_FAILED" /var/log/handoff-mcp/server.log | tail -10
```

2. **Performance Analysis**:
```bash
# Analyze response times
awk '/"duration_ms"/ {print $NF}' /var/log/handoff-mcp/server.log | sort -n | tail -10

# Count requests by status code
grep "HTTP/" /var/log/handoff-mcp/server.log | awk '{print $9}' | sort | uniq -c
```

3. **Resource Usage**:
```bash
# Monitor process resource usage
ps aux | grep handoff-mcp

# Monitor system resources
top -p $(pgrep -f handoff-mcp)
```

### Configuration Validation

1. **Environment Variables**:
```bash
# Validate required environment variables
required_vars=("DATABASE_URL" "REDIS_URL" "API_KEY_SECRET")
for var in "${required_vars[@]}"; do
  if [ -z "${!var}" ]; then
    echo "Missing required variable: $var"
  fi
done
```

2. **Configuration File**:
```bash
# Validate JSON configuration
jq empty config.json || echo "Invalid JSON in config.json"
```

## Performance Issues

### High CPU Usage

**Symptoms**: Server becomes unresponsive, high CPU usage in `top`.

**Diagnostic Steps**:
```bash
# Check CPU usage by process
top -p $(pgrep -f handoff-mcp)

# Profile Node.js application
node --prof server.js
node --prof-process isolate-*.log > profile.txt
```

**Solutions**:
1. **Optimize Database Queries**:
```bash
# Check slow queries
psql -U handoff_user -c "SELECT query, calls, total_time FROM pg_stat_statements ORDER BY total_time DESC LIMIT 10;"
```

2. **Increase Connection Pooling**:
```env
DATABASE_POOL_SIZE=30
DATABASE_MAX_CONNECTIONS=50
```

3. **Enable Caching**:
```env
CONTEXT_CACHE_ENABLED=true
CONTEXT_CACHE_TTL=3600
```

### High Memory Usage

**Symptoms**: Server crashes with out-of-memory errors, high memory usage.

**Diagnostic Steps**:
```bash
# Check memory usage
free -h

# Check Node.js heap usage
node -e "console.log(process.memoryUsage())"

# Monitor memory over time
watch -n 5 'ps aux | grep handoff-mcp | awk "{print \$6/1024 \"MB\"}"'
```

**Solutions**:
1. **Tune Garbage Collection**:
```bash
# Add GC tuning flags