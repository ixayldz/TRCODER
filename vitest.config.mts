import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@trcoder/shared": path.resolve(__dirname, "packages/shared/src")
    }
  },
  test: {
    environment: "node",
    include: ["packages/**/test/**/*.test.ts"]
  }
});
