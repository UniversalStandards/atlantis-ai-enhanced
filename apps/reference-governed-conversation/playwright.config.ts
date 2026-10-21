import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test",
  testMatch: /.*\.playwright\.ts/,
  fullyParallel: false,
  workers: 1,
  use: {
    browserName: "chromium",
    headless: true,
    launchOptions: {
      executablePath: process.env.ATLANTIS_REFERENCE_BROWSER_PATH ?? "/usr/bin/google-chrome",
    },
  },
});
