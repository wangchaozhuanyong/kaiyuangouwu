# Storefront browser support

## Supported baseline

The storefront production build supports the current evergreen browser line with the following minimum versions:

- Chrome and Chromium-based browsers 111+
- Microsoft Edge 111+
- Firefox 128+
- Safari and iOS Safari 16.4+
- Current Chromium-based domestic browsers in their speed/modern mode

Internet Explorer 11 and Trident-based compatibility modes cannot run the interactive storefront. They receive a script-free safety page instead of a blank or broken application. Chromium 110 and earlier, Firefox 127 and earlier, and Safari/iOS Safari 16.3 and earlier are not supported. Tailwind CSS 4 relies on modern CSS features, so adding JavaScript polyfills alone cannot make those browsers compatible.

## Legacy browser handling

- The storefront and generated promotion pages declare `<meta name="renderer" content="webkit">` so 360 dual-engine browsers prefer Speed/WebKit mode.
- A classic ES5 `nomodule` guard detects IE/Trident after promotion entry and redirects to `/unsupported-browser.html`.
- The static fallback page does not use React, JavaScript, CSS variables, Flexbox or Grid. It explains how to switch 360 to Speed mode and warns users not to enter account or payment information in IE11.
- Nginx serves the guard and fallback page through exact unauthenticated static routes so the promotion gate cannot create a redirect loop.

This is graceful degradation, not full IE11 commerce support. Login, cart, checkout and payment continue to require a supported modern engine.

## Automated compatibility check

Run the local production build against Chromium, Firefox, WebKit, WeChat Android emulation, UC Android emulation, and iPhone WebKit:

```bash
bun run --cwd packages/storefront test:compat
```

The local preview proxies Shop API requests to `https://damatong.net`. To check another deployed environment instead, skip the local preview by setting:

```bash
COMPAT_BASE_URL=https://example.com bun run --cwd packages/storefront test:compat
```

Install the Playwright browser binaries before the first run when the machine or CI image does not already contain them:

```bash
bunx playwright install chromium firefox webkit
```

The emulated WeChat and UC projects validate their user-agent, viewport and underlying Chromium path. Release validation for payments and authenticated flows still requires real Windows, Android and iOS devices, including 360 speed/compatibility modes and Tencent X5.
