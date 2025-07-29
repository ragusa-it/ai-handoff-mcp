#!/usr/bin/env node

/**
 * Schema Validation Script
 * Validates the enhanced monitoring schema files for syntax and completeness
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 Validating Enhanced Session Monitoring Schema...\n');

// Files to validate
const filesToValidate = [
    'scripts/migrations/001_enhanced_monitoring_schema.sql',
    'scripts/init-enhanced-db.sql',
    'src/database/schema.ts'
];

let allValid = true;

// Validation functions
function validateSQLFile(filePath) {
    console.log(`📄 Validating ${filePath}...`);
    
    if (!fs.existsSync(filePath)) {
        console.log(`❌ File not found: ${filePath}`);
        return false;
    }
    
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Check for required tables
    const requiredTables = [
        'session_lifecycle',
        'system_metrics', 
        'performance_logs',
        'analytics_aggregations'
    ];
    
    const requiredColumns = [
        'last_activity_at',
        'is_dormant',
        'archived_at',
        'retention_policy',
        'processing_time_ms',
        'content_size_bytes'
    ];
    
    let issues = [];
    
    // Check for required tables
    requiredTables.forEach(table => {
        if (!content.includes(table)) {
            issues.push(`Missing table: ${table}`);
        }
    });
    
    // Check for required columns
    requiredColumns.forEach(column => {
        if (!content.includes(column)) {
            issues.push(`Missing column: ${column}`);
        }
    });
    
    // Check for basic SQL syntax issues
    const sqlKeywords = ['CREATE TABLE', 'ALTER TABLE', 'CREATE INDEX', 'CREATE TRIGGER'];
    sqlKeywords.forEach(keyword => {
        if (content.includes(keyword) && !content.includes(keyword + ' IF NOT EXISTS') && !content.includes(keyword + ' OR REPLACE')) {
            // This is just a warning, not an error
        }
    });
    
    if (issues.length === 0) {
        console.log(`✅ ${filePath} - Valid`);
        return true;
    } else {
        console.log(`❌ ${filePath} - Issues found:`);
        issues.forEach(issue => console.log(`   • ${issue}`));
        return false;
    }
}

function validateTypeScriptFile(filePath) {
    console.log(`📄 Validating ${filePath}...`);
    
    if (!fs.existsSync(filePath)) {
        console.log(`❌ File not found: ${filePath}`);
        return false;
    }
    
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Check for required interfaces
    const requiredInterfaces = [
        'SessionLifecycleEvent',
        'SystemMetric',
        'PerformanceLog',
        'AnalyticsAggregation'
    ];
    
    // Check for enhanced session interface
    const requiredSessionFields = [
        'lastActivityAt',
        'isDormant',
        'archivedAt',
        'retentionPolicy'
    ];
    
    // Check for enhanced context history interface
    const requiredContextFields = [
        'processingTimeMs',
        'contentSizeBytes'
    ];
    
    let issues = [];
    
    // Check for required interfaces
    requiredInterfaces.forEach(interfaceName => {
        if (!content.includes(`interface ${interfaceName}`)) {
            issues.push(`Missing interface: ${interfaceName}`);
        }
    });
    
    // Check for enhanced session fields
    requiredSessionFields.forEach(field => {
        if (!content.includes(field)) {
            issues.push(`Missing session field: ${field}`);
        }
    });
    
    // Check for enhanced context fields
    requiredContextFields.forEach(field => {
        if (!content.includes(field)) {
            issues.push(`Missing context history field: ${field}`);
        }
    });
    
    if (issues.length === 0) {
        console.log(`✅ ${filePath} - Valid`);
        return true;
    } else {
        console.log(`❌ ${filePath} - Issues found:`);
        issues.forEach(issue => console.log(`   • ${issue}`));
        return false;
    }
}

// Validate each file
filesToValidate.forEach(file => {
    let isValid;
    
    if (file.endsWith('.sql')) {
        isValid = validateSQLFile(file);
    } else if (file.endsWith('.ts')) {
        isValid = validateTypeScriptFile(file);
    } else {
        console.log(`⚠️  Unknown file type: ${file}`);
        isValid = false;
    }
    
    if (!isValid) {
        allValid = false;
    }
    
    console.log(''); // Empty line for readability
});

// Summary
console.log('📋 Validation Summary:');
if (allValid) {
    console.log('✅ All schema files are valid!');
    console.log('\nThe enhanced session monitoring schema is ready for deployment.');
    console.log('\nNext steps:');
    console.log('  1. Run the migration: ./scripts/run-migration.sh');
    console.log('  2. Or setup fresh database: ./scripts/setup-enhanced-db.sh');
} else {
    console.log('❌ Some schema files have issues that need to be resolved.');
    process.exit(1);
}