import { defineConfig } from 'drizzle-kit';

const migrationDatabaseUrl = process.env.MIGRATION_DATABASE_URL?.trim();

if (!migrationDatabaseUrl) {
  throw new Error('MIGRATION_DATABASE_URL is required for Drizzle migration commands.');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './server/db/schema',
  out: './drizzle',
  dbCredentials: {
    url: migrationDatabaseUrl,
  },
  migrations: {
    schema: 'drizzle',
    table: '__drizzle_migrations',
  },
  breakpoints: true,
  strict: true,
  verbose: true,
});
