// Minimal forward-only migration runner: applies db/migrations/*.sql in name order, once each.
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const dir = path.resolve("db/migrations");

await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
const applied = new Set((await sql<{ name: string }[]>`SELECT name FROM schema_migrations`).map((r) => r.name));

for (const file of (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort()) {
  if (applied.has(file)) continue;
  const body = await readFile(path.join(dir, file), "utf8");
  await sql.begin(async (tx) => {
    await tx.unsafe(body);
    await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
  });
  console.log(`applied ${file}`);
}
await sql.end();
