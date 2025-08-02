import { Pool, PoolClient } from 'pg';
import { Knex } from 'knex';

export async function setupTestDatabase() {
  // Get the root database URL (without database name)
  const rootDbUrl = new URL(process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postgres');
  const dbName = 'ai_handoff_test';
  
  // Create a connection to the default 'postgres' database
  const pool = new Pool({
    connectionString: rootDbUrl.toString(),
  });

  try {
    // Terminate existing connections to the test database
    await pool.query(`
      SELECT pg_terminate_backend(pg_stat_activity.pid)
      FROM pg_stat_activity
      WHERE pg_stat_activity.datname = $1
      AND pid <> pg_backend_pid();
    `, [dbName]);

    // Drop the test database if it exists
    await pool.query(`DROP DATABASE IF EXISTS ${dbName}`);
    
    // Create a new test database
    await pool.query(`CREATE DATABASE ${dbName}`);
    
    console.log(`Test database '${dbName}' created successfully`);
  } catch (error) {
    console.error('Error setting up test database:', error);
    throw error;
  } finally {
    await pool.end();
  }

  // Run migrations on the test database
  try {
    const knex = (await import('knex')).default({
      client: 'pg',
      connection: process.env.DATABASE_URL,
      migrations: {
        directory: './migrations',
        tableName: 'knex_migrations'
      }
    });
    
    await knex.migrate.latest();
    console.log('Migrations run successfully on test database');
    await knex.destroy();
  } catch (error) {
    console.error('Error running migrations:', error);
    throw error;
  }
}

// Run setup if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  setupTestDatabase().catch(console.error);
}
