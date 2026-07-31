import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.local.example to .env.local and point it at your Neon database.",
  );
}

/*
 * The Neon HTTP driver issues each query as a `fetch`, and Next.js patches
 * global fetch with its Data Cache. Without `no-store`, query results are
 * cached to disk in `.next/cache/fetch-cache` and survive restarts, so reads
 * silently return stale rows even from routes marked `force-dynamic`.
 */
const sql = neon(connectionString, {
  fetchOptions: { cache: "no-store" },
});

export const db = drizzle(sql, { schema });
export { schema };
