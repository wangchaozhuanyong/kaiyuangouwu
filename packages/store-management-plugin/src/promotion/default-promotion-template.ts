export const DEFAULT_PROMOTION_TEMPLATE_VERSION = 1;

export const DEFAULT_PROMOTION_TEMPLATE = `<!doctype html>
<html lang="{{store.language}}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="{{store.description}}">
    <meta property="og:type" content="website">
    <meta property="og:title" content="{{store.name}}">
    <meta property="og:description" content="{{store.description}}">
    <meta property="og:image" content="{{store.heroImageUrl}}">
    <title>{{store.name}}</title>
    <style>
        :root {
            color-scheme: light dark;
            --promo-surface: #f4f7f6;
            --promo-panel: #e4ebe8;
            --promo-text: #18201d;
            --promo-muted: #53605b;
            --promo-accent: #276b58;
            --promo-accent-text: #f7fbf9;
            --promo-line: rgba(24, 32, 29, 0.14);
        }
        * { box-sizing: border-box; }
        html { background: var(--promo-surface); }
        body {
            margin: 0;
            min-width: 320px;
            min-height: 100dvh;
            background: var(--promo-surface);
            color: var(--promo-text);
            font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            -webkit-font-smoothing: antialiased;
        }
        .promo-shell {
            width: min(100%, 1440px);
            min-height: 100dvh;
            margin: 0 auto;
            padding: clamp(20px, 3vw, 44px);
            display: grid;
            grid-template-rows: auto 1fr auto;
            gap: clamp(28px, 4vw, 64px);
        }
        .promo-brand {
            min-width: 0;
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .promo-logo {
            width: 44px;
            height: 44px;
            border-radius: 14px;
            object-fit: contain;
            background: var(--promo-panel);
        }
        .promo-brand-name {
            overflow: hidden;
            color: var(--promo-text);
            font-size: 15px;
            font-weight: 720;
            letter-spacing: -0.02em;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .promo-hero {
            min-height: 0;
            display: grid;
            grid-template-columns: minmax(0, 1.08fr) minmax(300px, 0.92fr);
            align-items: center;
            gap: clamp(36px, 7vw, 112px);
        }
        .promo-copy {
            max-width: 680px;
            padding-left: clamp(0px, 4vw, 64px);
        }
        .promo-title {
            max-width: 12ch;
            margin: 0;
            font-size: clamp(44px, 7vw, 92px);
            font-weight: 760;
            letter-spacing: -0.065em;
            line-height: 0.96;
            text-wrap: balance;
        }
        .promo-description {
            max-width: 48ch;
            margin: clamp(24px, 3vw, 38px) 0 0;
            color: var(--promo-muted);
            font-size: clamp(16px, 1.5vw, 20px);
            line-height: 1.65;
        }
        .promo-entry-form { margin: clamp(30px, 4vw, 48px) 0 0; }
        .promo-entry-button {
            min-height: 54px;
            padding: 0 28px;
            border: 1px solid transparent;
            border-radius: 16px;
            background: var(--promo-accent);
            color: var(--promo-accent-text);
            font: inherit;
            font-size: 16px;
            font-weight: 720;
            line-height: 1;
            white-space: nowrap;
            cursor: pointer;
            transition: transform 160ms ease, filter 160ms ease;
        }
        .promo-entry-button:hover { filter: brightness(0.94); }
        .promo-entry-button:active { transform: translateY(1px) scale(0.99); }
        .promo-entry-button:focus-visible {
            outline: 3px solid var(--promo-accent);
            outline: 3px solid color-mix(in srgb, var(--promo-accent), transparent 55%);
            outline-offset: 4px;
        }
        .promo-media {
            position: relative;
            min-height: clamp(380px, 68vh, 760px);
            margin: 0;
            overflow: hidden;
            border: 1px solid var(--promo-line);
            border-radius: 16px;
            background: var(--promo-panel);
        }
        .promo-hero-image {
            position: absolute;
            inset: 0;
            z-index: 1;
            width: 100%;
            height: 100%;
            object-fit: cover;
        }
        .promo-media-fallback {
            position: absolute;
            inset: 0;
            display: grid;
            place-items: center;
            padding: 48px;
            text-align: center;
        }
        .promo-media-fallback img {
            width: min(48%, 220px);
            max-height: 180px;
            object-fit: contain;
        }
        .promo-media-fallback span {
            max-width: 12ch;
            font-size: clamp(30px, 5vw, 62px);
            font-weight: 760;
            letter-spacing: -0.05em;
            line-height: 1;
            text-wrap: balance;
        }
        .promo-footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 20px;
            border-top: 1px solid var(--promo-line);
            padding-top: 18px;
            color: var(--promo-muted);
            font-size: 13px;
        }
        @media (max-width: 767px) {
            .promo-shell { padding: 18px; gap: 28px; }
            .promo-hero { grid-template-columns: 1fr; gap: 28px; }
            .promo-copy { padding-left: 0; order: 2; }
            .promo-title { max-width: 13ch; font-size: clamp(40px, 13vw, 64px); }
            .promo-description { margin-top: 20px; }
            .promo-entry-form { margin-top: 26px; }
            .promo-entry-button { width: 100%; }
            .promo-media { min-height: min(54dvh, 520px); order: 1; }
            .promo-footer { align-items: flex-start; flex-direction: column; gap: 6px; }
        }
        @media (prefers-color-scheme: dark) {
            :root {
                --promo-surface: #111714;
                --promo-panel: #202925;
                --promo-text: #edf3f0;
                --promo-muted: #abb8b2;
                --promo-accent: #79bda7;
                --promo-accent-text: #10221c;
                --promo-line: rgba(237, 243, 240, 0.16);
            }
        }
        @media (prefers-reduced-motion: reduce) {
            *, *::before, *::after {
                scroll-behavior: auto !important;
                transition-duration: 0.01ms !important;
            }
        }
    </style>
</head>
<body>
    <div class="promo-shell">
        <header class="promo-brand">
            <img class="promo-logo" data-bind-src="store.logoUrl" data-hide-if-empty alt="{{store.name}}">
            <span class="promo-brand-name" data-bind-text="store.name"></span>
        </header>
        <main class="promo-hero">
            <section class="promo-copy">
                <h1 class="promo-title" data-bind-text="store.name"></h1>
                <p class="promo-description" data-bind-text="store.description" data-hide-if-empty></p>
                <form class="promo-entry-form" data-store-entry>
                    <button class="promo-entry-button" type="submit">进入主网站</button>
                </form>
            </section>
            <figure class="promo-media">
                <img class="promo-hero-image" data-bind-src="store.heroImageUrl" data-hide-if-empty alt="{{store.name}}">
                <div class="promo-media-fallback">
                    <img data-bind-src="store.logoUrl" data-hide-if-empty alt="{{store.name}}">
                    <span data-bind-text="store.name"></span>
                </div>
            </figure>
        </main>
        <footer class="promo-footer">
            <span data-bind-text="store.name"></span>
            <span>© <span data-bind-text="store.currentYear"></span></span>
        </footer>
    </div>
</body>
</html>`;
