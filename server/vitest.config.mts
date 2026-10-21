import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    env: { NODE_ENV: "test", GROQ_API_KEY: "", APP_ORIGIN: "http://localhost:5173" },
  },
});
