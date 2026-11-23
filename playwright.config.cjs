const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/browser",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium",
    headless: true,
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
  },
  webServer: {
    command: ".venv\\Scripts\\python.exe -m http.server 4173 --bind 127.0.0.1 --directory build\\site",
    url: "http://127.0.0.1:4173/index.html",
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
  },
});
