import { loadConfig } from "./config.ts";
import { buildServer } from "./server.ts";
const config = loadConfig();
const { app } = await buildServer(config);
await app.listen({
  port: config.port,
  host: process.env.API_HOST ?? "127.0.0.1",
});
console.log(`Tutor API ready on ${config.port} (${config.mode})`);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => void app.close().then(() => process.exit(0)));
