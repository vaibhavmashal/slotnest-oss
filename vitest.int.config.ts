import { defineConfig } from "vitest/config";
import path from "node:path";

process.loadEnvFile?.(".env.local");

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: { include: ["src/**/*.int.test.ts"], testTimeout: 30_000 },
});
