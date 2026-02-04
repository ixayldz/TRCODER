import { createServer } from "./server";
import path from "path";
import { getDataDir } from "./storage";

async function start() {
  // Default to a persistent local DB for the standalone server process so
  // project ids / plans don't disappear on restart. Tests typically call
  // createServer() directly and set TRCODER_DB_PATH=:memory: as needed.
  if (!process.env.TRCODER_DB_DRIVER && !process.env.TRCODER_DB_PATH) {
    process.env.TRCODER_DB_PATH = path.join(getDataDir(), "db.sqlite");
  }

  const port = Number(process.env.PORT ?? 3333);
  const host = process.env.HOST ?? "127.0.0.1";
  const { app } = await createServer();
  await app.listen({ port, host });
  // eslint-disable-next-line no-console
  console.log(`TRCODER server listening on ${host}:${port}`);
}

start().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
