// Standalone worker process: npm run worker (use with RUN_WORKER=false on the web process).
import { existsSync } from "node:fs";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const { startWorker } = await import("../src/lib/jobs/worker");
await startWorker();
export {};
