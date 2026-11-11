// Starts the background job worker inside the Next.js server process (set RUN_WORKER=false to run it separately).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { config } = await import("./src/lib/config");
  if (!config.runWorkerInProcess) return;
  const { startWorker } = await import("./src/lib/jobs/worker");
  await startWorker();
}
