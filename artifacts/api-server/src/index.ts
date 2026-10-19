import app from "./app";
import { pool } from "@workspace/db";
import { logger } from "./lib/logger";
import { env } from "./lib/env";
import { createShutdown } from "./lib/shutdown";

const server = app.listen(env.PORT, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port: env.PORT }, "Server listening");
});

const shutdown = createShutdown({ server, closePool: async () => void (await pool?.end()) });
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    // Exit naturally once the server and pool are closed; flush the logger first.
    void shutdown(signal).then(() => logger.flush(() => process.exit(0)));
  });
}
