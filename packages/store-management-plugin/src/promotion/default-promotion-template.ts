export const DEFAULT_PROMOTION_TEMPLATE_VERSION = 4;

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
            color-scheme: dark;
            --ink: #f4f7fb;
            --muted: #98a6b9;
            --faint: #66758b;
            --blue: #3b9cff;
            --cyan: #40dfd0;
            --line: rgba(159, 190, 224, 0.16);
            --panel: rgba(10, 21, 38, 0.64);
            --panel-strong: rgba(13, 28, 48, 0.88);
        }
        * { box-sizing: border-box; }
        html { min-width: 320px; scroll-behavior: smooth; background: #030813; }
        body {
            margin: 0;
            min-width: 320px;
            min-height: 100dvh;
            overflow-x: hidden;
            color: var(--ink);
            background:
                radial-gradient(circle at 76% 14%, rgba(25, 105, 194, 0.24), transparent 33%),
                radial-gradient(circle at 18% 58%, rgba(24, 115, 119, 0.12), transparent 30%),
                linear-gradient(145deg, #07111f 0%, #030813 48%, #06101d 100%);
            font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            -webkit-font-smoothing: antialiased;
        }
        button, a { font: inherit; }
        a { color: inherit; }
        .promo-page { position: relative; min-height: 100dvh; overflow-x: clip; isolation: isolate; }
        .promo-page::before {
            position: fixed;
            z-index: -1;
            inset: 0;
            background-image:
                linear-gradient(rgba(142, 176, 211, 0.025) 1px, transparent 1px),
                linear-gradient(90deg, rgba(142, 176, 211, 0.025) 1px, transparent 1px);
            background-size: 64px 64px;
            mask-image: linear-gradient(to bottom, black, transparent 84%);
            content: "";
            pointer-events: none;
        }
        .promo-shell { width: min(calc(100% - 40px), 1360px); margin-inline: auto; }
        .promo-header {
            min-height: 88px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 24px;
            border-bottom: 1px solid var(--line);
        }
        .promo-brand { min-width: 0; display: flex; align-items: center; gap: 12px; text-decoration: none; }
        .promo-logo {
            width: 38px;
            height: 38px;
            border: 1px solid var(--line);
            border-radius: 11px;
            object-fit: contain;
            background: rgba(255, 255, 255, 0.04);
        }
        .promo-brand-copy { min-width: 0; display: grid; gap: 2px; }
        .promo-brand-name {
            overflow: hidden;
            color: #f8fbff;
            font-size: 14px;
            font-weight: 720;
            letter-spacing: -0.015em;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .promo-brand-type { color: var(--faint); font-size: 10px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; }
        .promo-header-status { display: flex; align-items: center; gap: 9px; color: #a8b5c5; font-size: 12px; letter-spacing: 0.02em; }
        .promo-status-dot {
            width: 7px;
            height: 7px;
            border-radius: 50%;
            background: var(--cyan);
            box-shadow: 0 0 18px rgba(64, 223, 208, 0.86);
        }
        .promo-hero {
            min-height: min(800px, calc(100dvh - 88px));
            display: grid;
            grid-template-columns: minmax(0, 0.88fr) minmax(420px, 1.12fr);
            align-items: center;
            gap: clamp(28px, 4vw, 72px);
            padding-block: clamp(54px, 7vw, 108px);
        }
        .promo-copy { position: relative; z-index: 3; max-width: 680px; }
        .promo-eyebrow {
            width: fit-content;
            margin: 0 0 26px;
            padding: 8px 12px;
            border: 1px solid rgba(90, 172, 255, 0.25);
            border-radius: 999px;
            color: #8fc7ff;
            background: rgba(31, 107, 181, 0.1);
            font-size: 11px;
            font-weight: 760;
            letter-spacing: 0.13em;
            text-transform: uppercase;
        }
        .promo-title {
            max-width: 11.5ch;
            margin: 0;
            font-size: clamp(48px, 5.8vw, 84px);
            font-weight: 760;
            letter-spacing: -0.067em;
            line-height: 0.97;
            text-wrap: balance;
        }
        .promo-title-highlight {
            color: #91c9ff;
            background: linear-gradient(108deg, #f5f9ff 5%, #77b9ff 55%, #49dccd 105%);
            background-clip: text;
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .promo-description {
            max-width: 52ch;
            min-height: 1.5em;
            margin: 26px 0 0;
            color: var(--muted);
            font-size: clamp(15px, 1.25vw, 18px);
            line-height: 1.7;
        }
        .promo-description:empty::before { content: "汇集 AI 中转、软件订阅与数字商品。价格、使用说明和售后支持，都在主站清晰呈现。"; }
        .promo-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-top: 34px; }
        .promo-entry-form { margin: 0; }
        .promo-entry-button, .promo-secondary-button {
            min-height: 54px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border-radius: 12px;
            padding: 0 23px;
            font-size: 14px;
            font-weight: 760;
            text-decoration: none;
            cursor: pointer;
            transition: transform 180ms ease, border-color 180ms ease, background 180ms ease, box-shadow 180ms ease;
        }
        .promo-entry-button {
            border: 1px solid rgba(119, 192, 255, 0.8);
            color: #06111f;
            background: linear-gradient(135deg, #eef8ff 0%, #7fc3ff 58%, #5de0d0 120%);
            box-shadow: 0 16px 48px rgba(45, 146, 239, 0.22), inset 0 1px rgba(255, 255, 255, 0.75);
        }
        .promo-secondary-button { border: 1px solid var(--line); color: #bec9d6; background: rgba(255, 255, 255, 0.025); }
        .promo-entry-button:hover, .promo-secondary-button:hover { transform: translateY(-2px); }
        .promo-secondary-button:hover { border-color: rgba(128, 186, 242, 0.38); background: rgba(74, 147, 219, 0.08); }
        .promo-entry-button:focus-visible, .promo-secondary-button:focus-visible { outline: 3px solid rgba(77, 174, 255, 0.64); outline-offset: 4px; }
        .promo-proof { display: flex; flex-wrap: wrap; gap: 16px 24px; margin-top: 28px; color: #6f8197; font-size: 11px; }
        .promo-proof span { display: inline-flex; align-items: center; gap: 8px; }
        .promo-proof span::before { width: 4px; height: 4px; border-radius: 50%; background: #4b9dda; content: ""; }
        .promo-signal-stage {
            --signal-x: 0px;
            --signal-y: 0px;
            position: relative;
            min-height: clamp(500px, 55vw, 720px);
            transform: translate3d(var(--signal-x), var(--signal-y), 0);
            transition: transform 220ms ease-out;
        }
        .promo-signal-stage::before {
            position: absolute;
            inset: 4% -4% 0%;
            border-radius: 50%;
            background:
                radial-gradient(circle at 48% 43%, rgba(78, 187, 255, 0.17), transparent 28%),
                radial-gradient(circle, rgba(31, 111, 204, 0.14), rgba(15, 72, 145, 0.035) 48%, transparent 74%);
            filter: blur(24px);
            content: "";
        }
        .promo-signal-stage::after {
            position: absolute;
            right: -2%;
            bottom: 5%;
            left: -2%;
            height: 1px;
            background: linear-gradient(90deg, transparent, rgba(107, 178, 244, 0.22), transparent);
            box-shadow: 0 22px 72px rgba(28, 106, 192, 0.24);
            content: "";
        }
        .promo-signal-canvas {
            position: absolute;
            z-index: 1;
            inset: -4% -6% -6%;
            width: 112%;
            height: 110%;
            opacity: 1;
            filter: drop-shadow(0 28px 70px rgba(16, 97, 183, 0.2));
        }
        .promo-signal-core-logo {
            position: absolute;
            z-index: 2;
            top: 51%;
            left: 50%;
            width: clamp(66px, 6.8vw, 88px);
            height: clamp(66px, 6.8vw, 88px);
            padding: clamp(11px, 1.15vw, 15px);
            border: 1px solid rgba(145, 217, 255, 0.42);
            border-radius: 50%;
            object-fit: contain;
            background: radial-gradient(circle at 34% 28%, rgba(225, 247, 255, 0.2), rgba(4, 22, 43, 0.82) 62%, rgba(2, 10, 22, 0.96));
            box-shadow:
                0 0 0 1px rgba(39, 139, 226, 0.12),
                0 0 34px rgba(39, 167, 255, 0.38),
                0 0 74px rgba(31, 119, 211, 0.18),
                inset 0 1px rgba(228, 249, 255, 0.22),
                inset 0 -10px 24px rgba(2, 10, 24, 0.36);
            transform: translate(-50%, -50%);
            animation: promo-signal-core-breathe 5.2s ease-in-out infinite;
            pointer-events: none;
            will-change: transform, box-shadow;
        }
        .promo-signal-label {
            position: absolute;
            z-index: 2;
            display: grid;
            gap: 4px;
            min-width: 112px;
            padding: 10px 12px;
            border: 1px solid rgba(143, 202, 255, 0.22);
            border-radius: 10px;
            color: #a9b7c7;
            background: linear-gradient(145deg, rgba(14, 35, 61, 0.7), rgba(4, 13, 26, 0.62));
            box-shadow:
                0 16px 46px rgba(0, 0, 0, 0.24),
                inset 0 1px rgba(220, 243, 255, 0.08),
                inset 0 -1px rgba(50, 133, 211, 0.08);
            backdrop-filter: blur(16px) saturate(125%);
            animation: promo-signal-label-float 5.6s ease-in-out infinite;
        }
        .promo-signal-label strong { color: #dceafb; font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; }
        .promo-signal-label small { color: #607790; font-size: 9px; letter-spacing: 0.04em; }
        .promo-signal-label:nth-of-type(1) { top: 12%; right: 1%; animation-delay: -1.4s; }
        .promo-signal-label:nth-of-type(2) { top: 31%; left: 0; animation-delay: -3.2s; }
        .promo-signal-label:nth-of-type(3) { right: -1%; bottom: 20%; animation-delay: -4.6s; }
        @keyframes promo-signal-label-float {
            0%, 100% { transform: translate3d(0, 0, 0); }
            50% { transform: translate3d(0, -5px, 0); }
        }
        @keyframes promo-signal-core-breathe {
            0%, 100% {
                box-shadow:
                    0 0 0 1px rgba(39, 139, 226, 0.12),
                    0 0 30px rgba(39, 167, 255, 0.32),
                    0 0 68px rgba(31, 119, 211, 0.16),
                    inset 0 1px rgba(228, 249, 255, 0.22),
                    inset 0 -10px 24px rgba(2, 10, 24, 0.36);
                transform: translate(-50%, -50%) scale(0.985);
            }
            50% {
                box-shadow:
                    0 0 0 1px rgba(101, 207, 255, 0.2),
                    0 0 42px rgba(46, 184, 255, 0.46),
                    0 0 86px rgba(34, 134, 225, 0.22),
                    inset 0 1px rgba(228, 249, 255, 0.28),
                    inset 0 -10px 24px rgba(2, 10, 24, 0.28);
                transform: translate(-50%, -50%) scale(1.025);
            }
        }
        .promo-section { padding-block: clamp(84px, 10vw, 140px); border-top: 1px solid var(--line); }
        .promo-section-heading { max-width: 680px; }
        .promo-kicker { margin: 0 0 16px; color: #70b7fb; font-size: 11px; font-weight: 760; letter-spacing: 0.16em; text-transform: uppercase; }
        .promo-section-title { margin: 0; font-size: clamp(34px, 4.5vw, 62px); letter-spacing: -0.055em; line-height: 1; text-wrap: balance; }
        .promo-section-intro { max-width: 50ch; margin: 22px 0 0; color: var(--muted); font-size: 16px; line-height: 1.65; }
        .promo-catalog-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-top: 48px; }
        .promo-catalog-card {
            position: relative;
            min-height: 300px;
            overflow: hidden;
            padding: 28px;
            border: 1px solid var(--line);
            border-radius: 18px;
            background:
                radial-gradient(circle at 88% 12%, rgba(47, 143, 229, 0.18), transparent 34%),
                linear-gradient(145deg, rgba(14, 29, 49, 0.88), rgba(7, 17, 31, 0.76));
        }
        .promo-catalog-card::after {
            position: absolute;
            right: -44px;
            bottom: -72px;
            width: 190px;
            height: 190px;
            border: 1px solid rgba(91, 168, 238, 0.17);
            border-radius: 50%;
            box-shadow: 0 0 0 24px rgba(70, 153, 229, 0.035), 0 0 0 54px rgba(70, 153, 229, 0.025);
            content: "";
        }
        .promo-card-index { color: #5c7690; font-size: 11px; font-weight: 700; letter-spacing: 0.14em; }
        .promo-card-title { margin: 94px 0 0; font-size: 24px; letter-spacing: -0.035em; }
        .promo-card-copy { max-width: 30ch; margin: 14px 0 0; color: #8291a3; font-size: 14px; line-height: 1.65; }
        .promo-trust-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 1px;
            margin-top: 52px;
            border: 1px solid var(--line);
            border-radius: 18px;
            overflow: hidden;
            background: var(--line);
        }
        .promo-trust-item { min-height: 180px; padding: 28px; background: var(--panel-strong); }
        .promo-trust-item strong { display: block; color: #e5eef8; font-size: 18px; letter-spacing: -0.025em; }
        .promo-trust-item p { margin: 14px 0 0; color: #77889d; font-size: 13px; line-height: 1.6; }
        .promo-final {
            margin-bottom: clamp(40px, 5vw, 72px);
            padding: clamp(40px, 7vw, 88px);
            border: 1px solid rgba(113, 178, 240, 0.22);
            border-radius: 24px;
            background:
                radial-gradient(circle at 78% 44%, rgba(54, 168, 255, 0.22), transparent 28%),
                linear-gradient(132deg, rgba(13, 32, 55, 0.94), rgba(5, 14, 27, 0.92));
        }
        .promo-final h2 {
            max-width: 14ch;
            margin: 0;
            font-size: clamp(38px, 5vw, 68px);
            letter-spacing: -0.06em;
            line-height: 0.98;
        }
        .promo-final p { max-width: 46ch; margin: 20px 0 30px; color: #94a4b7; line-height: 1.65; }
        .promo-footer {
            display: flex;
            justify-content: space-between;
            gap: 20px;
            padding-block: 28px;
            border-top: 1px solid var(--line);
            color: #5f7186;
            font-size: 12px;
        }
        @media (max-width: 980px) {
            .promo-hero { min-height: auto; grid-template-columns: 1fr; padding-top: 70px; }
            .promo-copy { max-width: 760px; }
            .promo-signal-stage { min-height: min(82vw, 690px); }
            .promo-catalog-grid { grid-template-columns: 1fr; }
            .promo-catalog-card { min-height: 230px; }
            .promo-card-title { margin-top: 54px; }
            .promo-trust-grid { grid-template-columns: repeat(2, 1fr); }
        }
        @media (max-width: 620px) {
            .promo-shell { width: min(calc(100% - 28px), 1360px); }
            .promo-header { min-height: 74px; }
            .promo-header-status { display: none; }
            .promo-hero { padding-block: 48px 70px; gap: 24px; }
            .promo-eyebrow { margin-bottom: 20px; }
            .promo-title { font-size: clamp(42px, 13.5vw, 64px); }
            .promo-actions { align-items: stretch; flex-direction: column; }
            .promo-entry-form, .promo-entry-button, .promo-secondary-button { width: 100%; }
            .promo-signal-stage { min-height: 108vw; margin-inline: -12px; }
            .promo-signal-core-logo { width: 62px; height: 62px; padding: 10px; }
            .promo-signal-label { min-width: 98px; padding: 8px 10px; }
            .promo-signal-label:nth-of-type(2) { left: 4%; }
            .promo-catalog-card, .promo-trust-item { padding: 24px; }
            .promo-trust-grid { grid-template-columns: 1fr; }
            .promo-trust-item { min-height: 148px; }
            .promo-final { padding: 34px 24px; }
            .promo-footer { align-items: flex-start; flex-direction: column; }
        }
        @media (prefers-reduced-motion: reduce) {
            html { scroll-behavior: auto; }
            *, *::before, *::after { transition-duration: 0.01ms !important; }
            .promo-signal-stage { transform: none; }
            .promo-signal-core-logo, .promo-signal-label { animation: none; }
        }
    </style>
</head>
<body>
    <div class="promo-page">
        <header class="promo-header promo-shell">
            <div class="promo-brand">
                <img class="promo-logo" data-bind-src="store.logoUrl" data-hide-if-empty alt="{{store.name}}">
                <span class="promo-brand-copy">
                    <span class="promo-brand-name" data-bind-text="store.name"></span>
                    <span class="promo-brand-type">Software Relay</span>
                </span>
            </div>
            <span class="promo-header-status"><i class="promo-status-dot"></i>中转站服务在线</span>
        </header>

        <main>
            <section class="promo-hero promo-shell">
                <div class="promo-copy">
                    <p class="promo-eyebrow">Software · AI · Subscription</p>
                    <h1 class="promo-title">找软件、订阅和 AI 服务，<span class="promo-title-highlight">从这里进入</span></h1>
                    <p class="promo-description" data-bind-text="store.description"></p>
                    <div class="promo-actions">
                        <form class="promo-entry-form" data-store-entry>
                            <button class="promo-entry-button" type="submit">进入主站选软件</button>
                        </form>
                        <a class="promo-secondary-button" href="#catalog">看看这里卖什么</a>
                    </div>
                    <div class="promo-proof" aria-label="服务特点">
                        <span>商品信息透明</span>
                        <span>下单路径清晰</span>
                        <span>售后统一承接</span>
                    </div>
                </div>

                <div class="promo-signal-stage" data-promo-signal-stage aria-label="实时渲染的服务网络信号球">
                    <canvas class="promo-signal-canvas" data-promo-signal-canvas></canvas>
                    <img class="promo-signal-core-logo" data-promo-signal-core-logo data-bind-src="store.logoUrl" data-hide-if-empty alt="">
                    <span class="promo-signal-label"><strong>AI Gateway</strong><small>智能服务接入</small></span>
                    <span class="promo-signal-label"><strong>Software</strong><small>软件与数字商品</small></span>
                    <span class="promo-signal-label"><strong>Support</strong><small>订单与售后承接</small></span>
                </div>
            </section>

            <section class="promo-section promo-shell" id="catalog">
                <div class="promo-section-heading">
                    <p class="promo-kicker">Selected catalog</p>
                    <h2 class="promo-section-title">不是信息堆积，是更短的购买路径</h2>
                    <p class="promo-section-intro">这里是软件与数字服务的入口。先理解分类，再进入主站查看具体商品、价格和交付说明。</p>
                </div>
                <div class="promo-catalog-grid">
                    <article class="promo-catalog-card">
                        <span class="promo-card-index">01 · AI SERVICE</span>
                        <h3 class="promo-card-title">AI 中转与接口服务</h3>
                        <p class="promo-card-copy">面向个人与团队的稳定接入方案，规格、使用说明与交付方式集中展示。</p>
                    </article>
                    <article class="promo-catalog-card">
                        <span class="promo-card-index">02 · SUBSCRIPTION</span>
                        <h3 class="promo-card-title">软件订阅与会员</h3>
                        <p class="promo-card-copy">常用生产力工具与数字订阅，按周期、版本和适用场景进行选择。</p>
                    </article>
                    <article class="promo-catalog-card">
                        <span class="promo-card-index">03 · DIGITAL GOODS</span>
                        <h3 class="promo-card-title">数字商品与工具</h3>
                        <p class="promo-card-copy">聚合实用软件、授权和数字化工具，下单前即可确认关键商品信息。</p>
                    </article>
                </div>
            </section>

            <section class="promo-section promo-shell">
                <div class="promo-section-heading">
                    <p class="promo-kicker">Relay with confidence</p>
                    <h2 class="promo-section-title">中转的价值，是把复杂留在幕后</h2>
                </div>
                <div class="promo-trust-grid">
                    <div class="promo-trust-item"><strong>看得懂</strong><p>商品分类、适用人群和交付方式集中说明。</p></div>
                    <div class="promo-trust-item"><strong>选得快</strong><p>通过主站筛选和详情页缩短决策时间。</p></div>
                    <div class="promo-trust-item"><strong>买得稳</strong><p>订单状态与购买记录统一在主站管理。</p></div>
                    <div class="promo-trust-item"><strong>找得到</strong><p>售前问题和售后支持都有明确承接入口。</p></div>
                </div>
            </section>

            <section class="promo-final promo-shell">
                <h2>准备好，进入真正的商品主站</h2>
                <p>所有具体商品、价格、库存与购买说明以主站为准。点击进入，开始选择适合你的软件与数字服务。</p>
                <form class="promo-entry-form" data-store-entry>
                    <button class="promo-entry-button" type="submit">进入主站选购</button>
                </form>
            </section>
        </main>

        <footer class="promo-footer promo-shell">
            <span><span data-bind-text="store.name"></span> · 软件与数字服务中转站</span>
            <span>© <span data-bind-text="store.currentYear"></span></span>
        </footer>
    </div>
</body>
</html>`;
