import { defineConfig, devices } from '@playwright/test';

const externalBaseUrl = process.env.COMPAT_BASE_URL;
const localPort = Number(process.env.COMPAT_PORT || 43_175);
const baseURL = externalBaseUrl || `http://127.0.0.1:${localPort}`;

const wechatUserAgent =
    'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A.240205.002; wv) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Version/4.0 Chrome/122.0.0.0 Mobile Safari/537.36 ' +
    'MicroMessenger/8.0.48.2580(0x2800303D) WeChat/arm64 Weixin NetType/WIFI Language/zh_CN ABI/arm64';

const ucUserAgent =
    'Mozilla/5.0 (Linux; U; Android 14; zh-CN; Pixel 7 Build/UQ1A.240205.002) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.0.0 ' +
    'UCBrowser/16.3.6.1288 Mobile Safari/537.36';

export default defineConfig({
    testDir: './compatibility',
    testMatch: '*.pw.ts',
    globalSetup: './compatibility/global-setup.ts',
    timeout: 120_000,
    expect: { timeout: 15_000 },
    fullyParallel: true,
    workers: 3,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    reporter: [['list']],
    use: {
        baseURL,
        colorScheme: 'light',
        contextOptions: {
            reducedMotion: 'reduce',
        },
        locale: 'zh-CN',
        timezoneId: 'Asia/Shanghai',
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
    },
    webServer: externalBaseUrl
        ? undefined
        : {
              command: `bun run preview --port ${localPort}`,
              url: baseURL,
              reuseExistingServer: false,
              timeout: 120_000,
              env: {
                  ...process.env,
                  VITE_SHOP_API_PROXY_TARGET: 'https://moyaoai.com',
              },
          },
    projects: [
        {
            name: 'chromium-desktop',
            use: { ...devices['Desktop Chrome'] },
        },
        {
            name: 'firefox-desktop',
            use: { ...devices['Desktop Firefox'] },
        },
        {
            name: 'webkit-desktop',
            use: { ...devices['Desktop Safari'] },
        },
        {
            name: 'wechat-android',
            use: { ...devices['Pixel 7'], userAgent: wechatUserAgent },
        },
        {
            name: 'uc-android',
            use: { ...devices['Pixel 7'], userAgent: ucUserAgent },
        },
        {
            name: 'iphone-webkit',
            use: { ...devices['iPhone 15'] },
        },
    ],
});
