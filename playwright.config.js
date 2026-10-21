'use strict';
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
    testDir:  './tests/e2e',
    timeout:  20000,
    retries:  0,
    reporter: 'line',
    use: {
        baseURL:           'http://localhost:3000',
        headless:          true,
        // Full Chromium in new-headless mode; avoids the separate
        // chromium-headless-shell download.
        channel:           'chromium',
        ignoreHTTPSErrors: true,
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ],
});
