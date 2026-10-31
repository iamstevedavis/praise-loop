import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { migrate } from "./migrate";

const dir = join(process.cwd(), "db", "migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

function urlFor(base: string, schema: string) {
  const url = new URL(base);
  url.searchParams.set("options", `-c search_path=${schema}`);
  return url.toString();
}

async function appliedNames(connectionString: string) {
  const pool = new Pool({ connectionString });
  try {
    const result = await pool.query<{ name: string }>(
      "SELECT name FROM schema_migrations"
    );
    return result.rows.map(({ name }) => name);
  } finally {
    await pool.end();
  }
}

async function main() {
  const configured = process.env.TEST_DATABASE_URL;
  if (!configured) {
    console.log("Migration database tests skipped: set TEST_DATABASE_URL");
    return;
  }
  const base: string = configured;

  const admin = new Pool({ connectionString: base });
  const schemas: string[] = [];

  async function withSchema(run: (connectionString: string) => Promise<void>) {
    const schema = `migration_test_${randomUUID().replaceAll("-", "")}`;
    schemas.push(schema);
    await admin.query(`CREATE SCHEMA ${schema}`);
    const connectionString = urlFor(base, schema);
    process.env.DATABASE_URL = connectionString;
    await run(connectionString);
  }

  try {
    // The reported state: 016_email_sign_in.sql had been applied before the file
    // was renumbered to 018, so the table exists and the old name is recorded.
    await withSchema(async (connectionString) => {
      const setup = new Pool({ connectionString });
      await setup.query(`
        CREATE TABLE schema_migrations (
          id BIGSERIAL PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      const email = files.find((f) => f.endsWith("_email_sign_in.sql"));
      assert.ok(email, "the email sign-in migration must exist");
      await setup.query(readFileSync(join(dir, email), "utf8"));
      await setup.query(
        "INSERT INTO schema_migrations(name) VALUES ($1)",
        ["016_email_sign_in.sql"]
      );
      await setup.end();

      await migrate();

      const names = await appliedNames(connectionString);
      for (const file of files) {
        assert.ok(names.includes(file), `${file} must be recorded as applied`);
      }
      assert.ok(
        names.includes("016_email_sign_in.sql"),
        "the old name stays in the history"
      );

      const check = new Pool({ connectionString });
      const table = await check.query<{ name: string | null }>(
        "SELECT to_regclass('email_sign_in_codes')::text AS name"
      );
      assert.equal(table.rows[0].name, "email_sign_in_codes");
      await check.end();

      // Running again changes nothing and does not trip the unique name.
      await migrate();
      assert.equal((await appliedNames(connectionString)).length, names.length);
    });

    // A database that has never migrated still gets every file.
    await withSchema(async (connectionString) => {
      await migrate();
      const names = await appliedNames(connectionString);
      assert.deepEqual(names.slice().sort(), files);
    });

    console.log("migration tests passed");
  } finally {
    for (const schema of schemas) {
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    }
    await admin.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
