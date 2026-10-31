import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pool } from "../lib/db";

// The number only orders the files; the rest of the filename identifies the
// migration. Renumbering a file that was already applied (the documented way
// to resolve a collision with another PR) must not run its SQL a second time.
function migrationName(file: string): string {
  return file.replace(/^\d+_/, "").replace(/\.sql$/i, "");
}

export async function migrate() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const dir = join(process.cwd(), "db", "migrations");
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    const applied = await client.query<{ name: string }>(
      "SELECT name FROM schema_migrations"
    );
    const appliedNames = new Map(
      applied.rows.map(({ name }) => [migrationName(name), name])
    );

    for (const file of files) {
      const name = migrationName(file);
      const previous = appliedNames.get(name);
      if (previous) {
        if (previous !== file) {
          // Applied under an older number: record the new filename so future
          // runs skip it, but do not run the SQL again.
          await client.query(
            "INSERT INTO schema_migrations(name) VALUES($1) ON CONFLICT (name) DO NOTHING",
            [file]
          );
          appliedNames.set(name, file);
          console.log(`skip ${file} (already applied as ${previous})`);
        } else {
          console.log(`skip ${file}`);
        }
        continue;
      }

      const sql = readFileSync(join(dir, file), "utf8");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(name) VALUES($1)", [file]);
      appliedNames.set(name, file);
      console.log(`applied ${file}`);
    }

    await client.query("COMMIT");
    console.log("migrations complete");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  migrate().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
