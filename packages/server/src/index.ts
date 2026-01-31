import { createServer } from "./server";

async function start() {
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
