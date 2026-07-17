import { defineConfig, configDefaults } from "vitest/config";

export default defineConfig({
  base: "/crypto-lab-power-trace/",
  test: {
    include: ["src/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
