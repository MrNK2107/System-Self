// Bootstrap an operator: `pnpm --filter @workspace/api-server admin:grant <email>` (uses DATABASE_URL).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { createDb, users, type Db, type User } from "@workspace/db";

export async function grantAdmin(db: Db, email: string): Promise<User | null> {
  const [row] = await db
    .update(users)
    .set({ role: "admin", updatedAt: new Date() })
    .where(eq(users.email, email.trim().toLowerCase()))
    .returning();
  return row ?? null;
}

async function main(): Promise<number> {
  const email = process.argv[2];
  const url = process.env.DATABASE_URL;
  if (!email) {
    console.error("usage: pnpm --filter @workspace/api-server admin:grant <email>");
    return 1;
  }
  if (!url) {
    console.error("DATABASE_URL is required");
    return 1;
  }
  const { db, pool } = createDb(url);
  try {
    const user = await grantAdmin(db, email);
    if (!user) {
      console.error(`no user with email ${email.trim().toLowerCase()}`);
      return 1;
    }
    console.log(`granted admin to ${user.email} (${user.id})`);
    return 0;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
