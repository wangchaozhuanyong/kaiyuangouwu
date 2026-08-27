export const DEFAULT_PROMOTION_TEMPLATE_VERSION = 7;

export const DEFAULT_PROMOTION_TEMPLATE = `<!doctype html>
<html lang="{{store.language}}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="{{store.description}}">
    <meta property="og:type" content="website">
    <meta property="og:title" content="{{store.name}}">
    <meta property="og:description" content="{{store.description}}">
    <meta property="og:image" content="{{store.shareImageUrl}}">
    <title>{{store.name}}</title>
    <style>
        :root {
            color-scheme: dark;
            --ink: #f4f7fb;
            --muted: #a7b5c7;
            --faint: #8192a8;
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
        .promo-skip-link {
            position: fixed;
            z-index: 20;
            top: 12px;
            left: 12px;
            padding: 10px 14px;
            border-radius: 10px;
            color: #06111f;
            background: #a9dcff;
            font-size: 13px;
            font-weight: 760;
            transform: translateY(-160%);
            transition: transform 160ms ease;
        }
        .promo-skip-link:focus { transform: translateY(0); }
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
        .promo-brand-type { color: var(--faint); font-size: 11px; font-weight: 700; letter-spacing: 0.13em; text-transform: uppercase; }
        .promo-header-entry-form { margin: 0; }
        .promo-header-entry {
            min-height: 44px;
            padding: 0 16px;
            border: 1px solid rgba(132, 185, 235, 0.22);
            border-radius: 11px;
            color: #cfdeed;
            background: rgba(12, 30, 51, 0.54);
            font-size: 13px;
            font-weight: 680;
            cursor: pointer;
            transition: border-color 180ms ease, color 180ms ease, background 180ms ease, transform 180ms ease;
        }
        .promo-header-entry:hover { border-color: rgba(131, 199, 255, 0.5); color: #f5f9ff; background: rgba(31, 84, 132, 0.24); transform: translateY(-1px); }
        .promo-header-entry:active { transform: translateY(0) scale(0.98); }
        .promo-header-entry:focus-visible { outline: 3px solid rgba(77, 174, 255, 0.64); outline-offset: 3px; }
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
        .promo-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 18px; margin-top: 34px; }
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
            transition: transform 180ms ease, border-color 180ms ease, color 180ms ease, background 180ms ease, box-shadow 180ms ease;
        }
        .promo-entry-button {
            min-width: 164px;
            border: 1px solid rgba(119, 192, 255, 0.8);
            color: #06111f;
            background: linear-gradient(135deg, #eef8ff 0%, #7fc3ff 58%, #5de0d0 120%);
            box-shadow: 0 16px 48px rgba(45, 146, 239, 0.22), inset 0 1px rgba(255, 255, 255, 0.75);
        }
        .promo-secondary-button {
            min-height: 44px;
            padding-inline: 4px;
            border: 0;
            border-bottom: 1px solid rgba(135, 179, 221, 0.28);
            border-radius: 0;
            color: #aab9ca;
            background: transparent;
        }
        .promo-entry-button:hover {
            transform: translateY(-2px);
            box-shadow: 0 20px 58px rgba(45, 146, 239, 0.3), inset 0 1px rgba(255, 255, 255, 0.82);
        }
        .promo-secondary-button:hover { border-bottom-color: rgba(127, 196, 255, 0.7); color: #e0ecf9; transform: translateX(3px); }
        .promo-entry-button:active { transform: translateY(0) scale(0.985); }
        .promo-secondary-button:active { transform: translateX(2px) scale(0.98); }
        .promo-entry-button:focus-visible, .promo-secondary-button:focus-visible { outline: 3px solid rgba(77, 174, 255, 0.64); outline-offset: 4px; }
        .promo-proof { display: flex; flex-wrap: wrap; gap: 16px 24px; margin-top: 28px; color: #91a4ba; font-size: 12px; }
        .promo-proof span { display: inline-flex; align-items: center; gap: 8px; }
        .promo-proof span::before { width: 4px; height: 4px; border-radius: 50%; background: #5db7f4; box-shadow: 0 0 10px rgba(69, 169, 238, 0.42); content: ""; }
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
            padding: clamp(10px, 1.05vw, 14px);
            border: 1px solid rgba(145, 217, 255, 0.34);
            border-radius: 24%;
            object-fit: contain;
            background:
                radial-gradient(circle at 34% 26%, rgba(225, 247, 255, 0.2), transparent 42%),
                linear-gradient(145deg, rgba(9, 39, 68, 0.72), rgba(2, 13, 27, 0.84));
            box-shadow:
                0 0 0 1px rgba(39, 139, 226, 0.1),
                0 0 30px rgba(39, 167, 255, 0.32),
                0 0 66px rgba(31, 119, 211, 0.16),
                inset 0 1px rgba(228, 249, 255, 0.2),
                inset 0 -10px 24px rgba(2, 10, 24, 0.28);
            transform: translate(-50%, -50%);
            backdrop-filter: blur(10px) saturate(135%);
            filter: saturate(1.08);
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
        .promo-signal-label strong { color: #e2eefb; font-size: 10.5px; letter-spacing: 0.1em; text-transform: uppercase; }
        .promo-signal-label small { color: #8ea2b8; font-size: 11px; line-height: 1.35; letter-spacing: 0.025em; }
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
                    0 0 0 1px rgba(39, 139, 226, 0.1),
                    0 0 28px rgba(39, 167, 255, 0.28),
                    0 0 62px rgba(31, 119, 211, 0.14),
                    inset 0 1px rgba(228, 249, 255, 0.2),
                    inset 0 -10px 24px rgba(2, 10, 24, 0.28);
                transform: translate(-50%, -50%) scale(0.995);
            }
            50% {
                box-shadow:
                    0 0 0 1px rgba(101, 207, 255, 0.17),
                    0 0 36px rgba(46, 184, 255, 0.38),
                    0 0 76px rgba(34, 134, 225, 0.19),
                    inset 0 1px rgba(228, 249, 255, 0.25),
                    inset 0 -10px 24px rgba(2, 10, 24, 0.24);
                transform: translate(-50%, -50%) scale(1.012);
            }
        }
        .promo-section { padding-block: clamp(72px, 8vw, 112px); border-top: 1px solid var(--line); }
        .promo-section-heading { max-width: 680px; }
        .promo-kicker { margin: 0 0 16px; color: #70b7fb; font-size: 11px; font-weight: 760; letter-spacing: 0.16em; text-transform: uppercase; }
        .promo-section-title { margin: 0; font-size: clamp(34px, 4.5vw, 62px); letter-spacing: -0.055em; line-height: 1; text-wrap: balance; }
        .promo-section-intro { max-width: 50ch; margin: 22px 0 0; color: var(--muted); font-size: 16px; line-height: 1.65; }
        .promo-catalog-grid {
            display: grid;
            grid-template-columns: minmax(0, 1.14fr) minmax(320px, 0.86fr);
            grid-template-rows: repeat(2, minmax(196px, auto));
            gap: 14px;
            margin-top: 42px;
        }
        .promo-product-card {
            position: relative;
            min-height: 196px;
            overflow: hidden;
            border: 1px solid var(--line);
            border-radius: 18px;
            background:
                radial-gradient(circle at 92% 6%, rgba(47, 143, 229, 0.13), transparent 38%),
                linear-gradient(145deg, rgba(14, 29, 49, 0.9), rgba(7, 17, 31, 0.8));
            box-shadow: inset 0 1px rgba(226, 244, 255, 0.035);
        }
        .promo-product-card-featured { grid-row: 1 / span 2; min-height: 406px; }
        .promo-product-card:not(.promo-product-card-featured) {
            display: grid;
            grid-template-columns: minmax(148px, 0.72fr) minmax(0, 1.28fr);
        }
        .promo-product-media {
            min-height: 168px;
            overflow: hidden;
            background: rgba(5, 14, 27, 0.72);
        }
        .promo-product-card-featured .promo-product-media { height: 220px; }
        .promo-product-media img {
            width: 100%;
            height: 100%;
            display: block;
            object-fit: cover;
            filter: saturate(0.88) contrast(1.04);
            transition: transform 420ms cubic-bezier(0.2, 0.75, 0.2, 1), filter 240ms ease;
        }
        .promo-product-card:hover .promo-product-media img { transform: scale(1.025); filter: saturate(1) contrast(1.06); }
        .promo-product-body {
            min-width: 0;
            min-height: 100%;
            display: flex;
            flex-direction: column;
            padding: 24px;
        }
        .promo-product-card-featured .promo-product-body { min-height: 186px; padding: 26px; }
        .promo-product-meta { color: #85a6c5; font-size: 11px; font-weight: 720; letter-spacing: 0.12em; text-transform: uppercase; }
        .promo-product-title {
            margin: 12px 0 0;
            color: #f4f7fb;
            font-size: clamp(20px, 2vw, 27px);
            letter-spacing: -0.035em;
            line-height: 1.12;
            text-wrap: balance;
        }
        .promo-product-copy {
            display: -webkit-box;
            overflow: hidden;
            margin: 10px 0 0;
            color: #9aabba;
            font-size: 13px;
            line-height: 1.55;
            -webkit-box-orient: vertical;
            -webkit-line-clamp: 2;
        }
        .promo-product-footer {
            display: flex;
            align-items: flex-end;
            justify-content: space-between;
            gap: 18px;
            margin-top: auto;
            padding-top: 20px;
        }
        .promo-product-price { color: #d8e9f7; font-size: 16px; font-weight: 720; font-variant-numeric: tabular-nums; }
        .promo-product-entry-form { flex: none; margin: 0; }
        .promo-product-entry-button {
            min-height: 42px;
            padding: 0 14px;
            border: 1px solid rgba(128, 191, 244, 0.26);
            border-radius: 10px;
            color: #cfe7fb;
            background: rgba(50, 126, 191, 0.12);
            font-size: 12px;
            font-weight: 720;
            cursor: pointer;
            transition: border-color 180ms ease, color 180ms ease, background 180ms ease, transform 180ms ease;
        }
        .promo-product-entry-button:hover { border-color: rgba(121, 201, 255, 0.56); color: #f7fbff; background: rgba(63, 151, 221, 0.2); transform: translateY(-1px); }
        .promo-product-entry-button:active { transform: translateY(0) scale(0.98); }
        .promo-product-entry-button:focus-visible { outline: 3px solid rgba(77, 174, 255, 0.64); outline-offset: 3px; }
        .promo-catalog-empty {
            margin-top: 40px;
            padding: 28px;
            border-top: 1px solid var(--line);
            border-bottom: 1px solid var(--line);
            color: #9fb0c2;
            font-size: 15px;
            line-height: 1.7;
        }
        .promo-trust-layout {
            display: grid;
            grid-template-columns: minmax(280px, 0.78fr) minmax(0, 1.22fr);
            align-items: start;
            gap: clamp(54px, 8vw, 120px);
        }
        .promo-process-list { margin: 0; padding: 0; border-top: 1px solid var(--line); list-style: none; }
        .promo-process-item {
            display: grid;
            grid-template-columns: 54px minmax(0, 1fr);
            gap: 20px;
            padding: 26px 0 28px;
            border-bottom: 1px solid var(--line);
        }
        .promo-process-index { color: #76b8f4; font-size: 12px; font-weight: 760; letter-spacing: 0.12em; font-variant-numeric: tabular-nums; }
        .promo-process-copy strong { display: block; color: #e9f1f9; font-size: 20px; letter-spacing: -0.025em; }
        .promo-process-copy p { max-width: 54ch; margin: 9px 0 0; color: #91a3b8; font-size: 14px; line-height: 1.65; }
        .promo-final {
            display: grid;
            grid-template-columns: minmax(0, 1.08fr) minmax(300px, 0.92fr);
            align-items: center;
            gap: clamp(42px, 7vw, 100px);
            margin-bottom: clamp(40px, 5vw, 72px);
            padding: clamp(42px, 6vw, 76px);
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
        .promo-final-path { display: grid; gap: 0; border-top: 1px solid rgba(142, 185, 225, 0.2); }
        .promo-final-path span {
            display: grid;
            grid-template-columns: 34px minmax(0, 1fr);
            align-items: center;
            gap: 12px;
            min-height: 64px;
            border-bottom: 1px solid rgba(142, 185, 225, 0.2);
            color: #b9c9d8;
            font-size: 14px;
        }
        .promo-final-path b { color: #6eb9f5; font-size: 11px; font-weight: 760; letter-spacing: 0.08em; font-variant-numeric: tabular-nums; }
        .promo-footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 20px;
            padding-block: 28px;
            border-top: 1px solid var(--line);
            color: #8294a9;
            font-size: 12px;
        }
        .promo-footer-meta { display: flex; flex-wrap: wrap; gap: 10px 18px; }
        .promo-footer-nav { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px 16px; }
        .promo-footer-form { margin: 0; }
        .promo-footer-link {
            padding: 6px 0;
            border: 0;
            color: #9eafc1;
            background: transparent;
            font-size: 12px;
            cursor: pointer;
            transition: color 160ms ease;
        }
        .promo-footer-link:hover { color: #e4edf6; }
        .promo-footer-link:focus-visible { outline: 3px solid rgba(77, 174, 255, 0.64); outline-offset: 3px; }
        @media (max-width: 980px) {
            .promo-hero { min-height: auto; grid-template-columns: 1fr; padding-top: 70px; }
            .promo-copy { max-width: 760px; }
            .promo-signal-stage { min-height: min(82vw, 690px); }
            .promo-catalog-grid { grid-template-columns: 1fr; grid-template-rows: none; }
            .promo-product-card-featured { grid-row: auto; min-height: 0; }
            .promo-product-card-featured, .promo-product-card:not(.promo-product-card-featured) {
                display: grid;
                grid-template-columns: minmax(190px, 0.72fr) minmax(0, 1.28fr);
            }
            .promo-product-card-featured .promo-product-media { height: auto; }
            .promo-trust-layout { grid-template-columns: 1fr; gap: 42px; }
            .promo-final { grid-template-columns: 1fr; }
        }
        @media (max-width: 620px) {
            .promo-shell { width: min(calc(100% - 28px), 1360px); }
            .promo-header { min-height: 74px; }
            .promo-brand-type { font-size: 10px; }
            .promo-header-entry { min-height: 40px; padding-inline: 12px; }
            .promo-hero { padding-block: 44px 58px; gap: 20px; }
            .promo-eyebrow { margin-bottom: 20px; }
            .promo-title { font-size: clamp(42px, 13.5vw, 64px); }
            .promo-actions { align-items: center; flex-direction: column; gap: 14px; }
            .promo-entry-form, .promo-entry-button { width: 100%; }
            .promo-secondary-button { width: fit-content; }
            .promo-proof { gap: 12px 16px; }
            .promo-signal-stage { min-height: 94vw; margin-inline: -8px; }
            .promo-signal-core-logo { width: 62px; height: 62px; padding: 10px; }
            .promo-signal-label { min-width: 98px; padding: 8px 10px; }
            .promo-signal-label:nth-of-type(2) { left: 4%; }
            .promo-section { padding-block: 64px 72px; }
            .promo-catalog-grid { gap: 12px; margin-top: 34px; }
            .promo-product-card-featured, .promo-product-card:not(.promo-product-card-featured) {
                min-height: 176px;
                display: grid;
                grid-template-columns: 118px minmax(0, 1fr);
            }
            .promo-product-media, .promo-product-card-featured .promo-product-media { width: 118px; height: 100%; min-height: 176px; }
            .promo-product-body, .promo-product-card-featured .promo-product-body { min-height: 176px; padding: 18px; }
            .promo-product-meta { font-size: 10px; }
            .promo-product-title { margin-top: 9px; font-size: 18px; }
            .promo-product-copy { margin-top: 8px; font-size: 12px; -webkit-line-clamp: 2; }
            .promo-product-footer { align-items: center; gap: 10px; padding-top: 14px; }
            .promo-product-price { font-size: 14px; }
            .promo-product-entry-button { min-height: 40px; padding-inline: 11px; }
            .promo-process-item { grid-template-columns: 42px minmax(0, 1fr); gap: 12px; padding: 22px 0 24px; }
            .promo-process-copy strong { font-size: 18px; }
            .promo-final { padding: 34px 24px; }
            .promo-final-path span { min-height: 58px; }
            .promo-footer { align-items: flex-start; flex-direction: column; }
            .promo-footer-nav { justify-content: flex-start; }
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
    <a class="promo-skip-link" href="#promo-main">跳到主要内容</a>
    <div class="promo-page">
        <header class="promo-header promo-shell">
            <div class="promo-brand">
                <img class="promo-logo" data-bind-src="store.logoUrl" data-hide-if-empty alt="{{store.name}}">
                <span class="promo-brand-copy">
                    <span class="promo-brand-name" data-bind-text="store.name"></span>
                    <span class="promo-brand-type">Software Relay</span>
                </span>
            </div>
            <form class="promo-header-entry-form" data-store-entry>
                <button class="promo-header-entry" type="submit">进入主站</button>
            </form>
        </header>

        <main id="promo-main">
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
                        <span>价格与说明以主站为准</span>
                        <span>订单在主站统一管理</span>
                        <span>售前售后均有入口</span>
                    </div>
                </div>

                <div class="promo-signal-stage" data-promo-signal-stage role="img" aria-label="由 AI 服务、软件商品和售后支持组成的动态中转网络">
                    <canvas class="promo-signal-canvas" data-promo-signal-canvas></canvas>
                    <img class="promo-signal-core-logo" data-promo-signal-core-logo data-bind-src="store.logoUrl" data-hide-if-empty alt="">
                    <span class="promo-signal-label"><strong>AI Gateway</strong><small>智能服务接入</small></span>
                    <span class="promo-signal-label"><strong>Software</strong><small>软件与数字商品</small></span>
                    <span class="promo-signal-label"><strong>Support</strong><small>订单与售后承接</small></span>
                </div>
            </section>

            <section class="promo-section promo-shell" id="catalog">
                <div class="promo-section-heading">
                    <p class="promo-kicker">Live catalog</p>
                    <h2 class="promo-section-title">主站正在提供的真实商品</h2>
                    <p class="promo-section-intro">商品名称、起售价格与图片来自主站当前数据。具体规格、库存、交付方式和退款条件以商品详情页为准。</p>
                </div>
                <div class="promo-catalog-grid">
                    <article class="promo-product-card promo-product-card-featured" data-bind-visible="store.featuredProduct1Name">
                        <div class="promo-product-media" data-bind-visible="store.featuredProduct1ImageUrl">
                            <img data-bind-src="store.featuredProduct1ImageUrl" data-hide-if-empty alt="">
                        </div>
                        <div class="promo-product-body">
                            <span class="promo-product-meta">01 · 主站上架</span>
                            <h3 class="promo-product-title" data-bind-text="store.featuredProduct1Name"></h3>
                            <p class="promo-product-copy" data-bind-text="store.featuredProduct1Description" data-hide-if-empty></p>
                            <div class="promo-product-footer">
                                <strong class="promo-product-price" data-bind-text="store.featuredProduct1PriceLabel"></strong>
                                <form class="promo-product-entry-form" data-store-entry data-bind-entry-product="store.featuredProduct1Id">
                                    <button class="promo-product-entry-button" type="submit">查看商品</button>
                                </form>
                            </div>
                        </div>
                    </article>
                    <article class="promo-product-card" data-bind-visible="store.featuredProduct2Name">
                        <div class="promo-product-media" data-bind-visible="store.featuredProduct2ImageUrl">
                            <img data-bind-src="store.featuredProduct2ImageUrl" data-hide-if-empty alt="">
                        </div>
                        <div class="promo-product-body">
                            <span class="promo-product-meta">02 · 主站上架</span>
                            <h3 class="promo-product-title" data-bind-text="store.featuredProduct2Name"></h3>
                            <p class="promo-product-copy" data-bind-text="store.featuredProduct2Description" data-hide-if-empty></p>
                            <div class="promo-product-footer">
                                <strong class="promo-product-price" data-bind-text="store.featuredProduct2PriceLabel"></strong>
                                <form class="promo-product-entry-form" data-store-entry data-bind-entry-product="store.featuredProduct2Id">
                                    <button class="promo-product-entry-button" type="submit">查看商品</button>
                                </form>
                            </div>
                        </div>
                    </article>
                    <article class="promo-product-card" data-bind-visible="store.featuredProduct3Name">
                        <div class="promo-product-media" data-bind-visible="store.featuredProduct3ImageUrl">
                            <img data-bind-src="store.featuredProduct3ImageUrl" data-hide-if-empty alt="">
                        </div>
                        <div class="promo-product-body">
                            <span class="promo-product-meta">03 · 主站上架</span>
                            <h3 class="promo-product-title" data-bind-text="store.featuredProduct3Name"></h3>
                            <p class="promo-product-copy" data-bind-text="store.featuredProduct3Description" data-hide-if-empty></p>
                            <div class="promo-product-footer">
                                <strong class="promo-product-price" data-bind-text="store.featuredProduct3PriceLabel"></strong>
                                <form class="promo-product-entry-form" data-store-entry data-bind-entry-product="store.featuredProduct3Id">
                                    <button class="promo-product-entry-button" type="submit">查看商品</button>
                                </form>
                            </div>
                        </div>
                    </article>
                </div>
                <p class="promo-catalog-empty" data-bind-empty="store.featuredProduct1Name">商品正在整理中。你仍可进入主站查看最新上架、价格和购买说明。</p>
            </section>

            <section class="promo-section promo-shell">
                <div class="promo-trust-layout">
                    <div class="promo-section-heading">
                        <p class="promo-kicker">Clear purchase path</p>
                        <h2 class="promo-section-title">每一步，都回到真实信息</h2>
                        <p class="promo-section-intro">推广页负责帮你快速判断，主站负责展示完整商品信息、完成订单并承接后续服务。</p>
                    </div>
                    <ol class="promo-process-list">
                        <li class="promo-process-item">
                            <span class="promo-process-index">01</span>
                            <div class="promo-process-copy"><strong>先看真实商品与价格</strong><p>名称、图片和起售价格来自主站当前数据，不使用虚构商品或演示价格。</p></div>
                        </li>
                        <li class="promo-process-item">
                            <span class="promo-process-index">02</span>
                            <div class="promo-process-copy"><strong>再确认交付与退款条件</strong><p>适用范围、交付方式和退款限制以商品详情与结算页面展示为准。</p></div>
                        </li>
                        <li class="promo-process-item">
                            <span class="promo-process-index">03</span>
                            <div class="promo-process-copy"><strong>最后在主站管理订单</strong><p>登录主站查看订单记录；售后范围按商品说明和订单状态处理。</p></div>
                        </li>
                    </ol>
                </div>
            </section>

            <section class="promo-final promo-shell">
                <div class="promo-final-copy">
                    <h2>准备好，进入真正的商品主站</h2>
                    <p>查看完整规格、实时库存、交付方式和购买说明，再决定是否下单。</p>
                    <form class="promo-entry-form" data-store-entry>
                        <button class="promo-entry-button" type="submit">进入主站选购</button>
                    </form>
                </div>
                <div class="promo-final-path" aria-label="主站购买流程">
                    <span><b>01</b>查看商品与适用范围</span>
                    <span><b>02</b>确认价格、库存与交付方式</span>
                    <span><b>03</b>完成订单并按规则获得支持</span>
                </div>
            </section>
        </main>

        <footer class="promo-footer promo-shell">
            <div class="promo-footer-meta">
                <span><span data-bind-text="store.name"></span> · 软件与数字服务中转站</span>
                <span>© <span data-bind-text="store.currentYear"></span></span>
            </div>
            <nav class="promo-footer-nav" aria-label="规则与支持">
                <form class="promo-footer-form" data-store-entry data-store-entry-target="privacy"><button class="promo-footer-link" type="submit">隐私政策</button></form>
                <form class="promo-footer-form" data-store-entry data-store-entry-target="terms"><button class="promo-footer-link" type="submit">使用条款</button></form>
                <form class="promo-footer-form" data-store-entry data-store-entry-target="support"><button class="promo-footer-link" type="submit">客服中心</button></form>
            </nav>
        </footer>
    </div>
</body>
</html>`;
