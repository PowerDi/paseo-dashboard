import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = buildApp(config);

async function main() {
  try {
    await app.listen({ host: config.host, port: config.port });
    app.log.info(`Paseo Dashboard server listening on ${config.host}:${config.port}`);
  } catch (err) {
    app.log.fatal(err, "Failed to start server");
    process.exit(1);
  }
}

main();
