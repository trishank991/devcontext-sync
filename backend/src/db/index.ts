import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is required');
}

// Connection pool configuration optimized for Supabase/serverless
const client = postgres(connectionString, {
  // Connection pool settings
  max: parseInt(process.env.DB_POOL_SIZE || '10', 10),
  idle_timeout: 20,
  connect_timeout: 10,

  // SSL required for Supabase
  ssl: process.env.NODE_ENV === 'production' ? 'require' : false,

  // Prepare statements for better performance
  prepare: true,

  // Connection lifecycle hooks for debugging
  onnotice: process.env.NODE_ENV !== 'production' ? console.log : undefined
});

export const db = drizzle(client, { schema });

// Graceful shutdown
export async function closeDatabase() {
  await client.end();
}

export * from './schema';
