/* eslint-disable max-len -- Keep the embedded promotion HTML and CSS readable as source. */

export const DEFAULT_PROMOTION_TEMPLATE_VERSION = 8;

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
            --bg: #070b0d;
            --bg-deep: #050809;
            --surface: rgba(13, 21, 21, 0.78);
            --surface-strong: rgba(16, 27, 26, 0.94);
            --ink: #edf4f0;
            --ink-soft: #c7d4ce;
            --muted: #93a39d;
            --faint: #7f918a;
            --accent: #91e6c4;
            --accent-strong: #b9f2da;
            --accent-ink: #092019;
            --line: rgba(164, 218, 197, 0.13);
            --line-strong: rgba(164, 225, 201, 0.24);
            --shadow: 0 32px 90px rgba(1, 13, 10, 0.42);
            --radius-outer: 30px;
            --radius-card: 20px;
            --page-progress: 0;
        }
        * { box-sizing: border-box; }
        html { min-width: 320px; scroll-behavior: smooth; background: var(--bg-deep); }
        body {
            margin: 0;
            min-width: 320px;
            min-height: 100dvh;
            overflow-x: hidden;
            color: var(--ink);
            background:
                radial-gradient(circle at 76% 8%, rgba(91, 171, 139, 0.11), transparent 29%),
                radial-gradient(circle at 11% 44%, rgba(109, 176, 150, 0.045), transparent 26%),
                linear-gradient(160deg, #0a0f10 0%, var(--bg) 44%, #060a0b 100%);
            font-family: "Avenir Next", Avenir, "SF Pro Display", "PingFang SC", "Microsoft YaHei", sans-serif;
            -webkit-font-smoothing: antialiased;
            text-rendering: optimizeLegibility;
        }
        body::before {
            position: fixed;
            z-index: 30;
            inset: 0;
            opacity: 0.16;
            background-image:
                repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.012) 0 1px, transparent 1px 4px),
                repeating-linear-gradient(90deg, rgba(145, 230, 196, 0.009) 0 1px, transparent 1px 5px);
            content: "";
            pointer-events: none;
            mix-blend-mode: soft-light;
        }
        button, a { font: inherit; }
        a { color: inherit; }
        button { -webkit-tap-highlight-color: transparent; }
        .promo-skip-link { position: fixed; z-index: 50; top: 12px; left: 12px; padding: 11px 15px; border-radius: 9px; color: var(--accent-ink); background: var(--accent-strong); font-size: 13px; font-weight: 700; transform: translateY(-160%); transition: transform 180ms ease; }
        .promo-skip-link:focus { transform: translateY(0); }
        .promo-page { position: relative; min-height: 100dvh; overflow: clip; isolation: isolate; }
        .promo-page::before {
            position: fixed;
            z-index: -2;
            inset: 0;
            background-image:
                linear-gradient(rgba(144, 205, 182, 0.026) 1px, transparent 1px),
                linear-gradient(90deg, rgba(144, 205, 182, 0.026) 1px, transparent 1px);
            background-size: 76px 76px;
            mask-image: linear-gradient(to bottom, black 0%, rgba(0, 0, 0, 0.48) 56%, transparent 94%);
            content: "";
            pointer-events: none;
        }
        .promo-page::after { position: fixed; z-index: 40; top: 0; left: 0; width: calc(var(--page-progress) * 100%); height: 2px; background: var(--accent); box-shadow: 0 0 18px rgba(145, 230, 196, 0.52); content: ""; pointer-events: none; }
        .promo-shell { width: min(calc(100% - 56px), 1320px); margin-inline: auto; }
        .promo-header { min-height: 88px; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 24px; border-bottom: 1px solid var(--line); }
        .promo-brand { min-width: 0; display: flex; align-items: center; gap: 13px; }
        .promo-logo-wrap { position: relative; width: 42px; height: 42px; display: grid; place-items: center; border: 1px solid var(--line-strong); border-radius: 12px; background: rgba(145, 230, 196, 0.045); box-shadow: inset 0 1px rgba(231, 255, 245, 0.07); }
        .promo-logo-wrap::after { position: absolute; right: -3px; bottom: -3px; width: 8px; height: 8px; border: 2px solid var(--bg); border-radius: 50%; background: var(--accent); box-shadow: 0 0 12px rgba(145, 230, 196, 0.64); content: ""; }
        .promo-logo { width: 28px; height: 28px; object-fit: contain; }
        .promo-brand-copy { min-width: 0; display: grid; gap: 3px; }
        .promo-brand-name { overflow: hidden; color: var(--ink); font-size: 14px; font-weight: 650; letter-spacing: -0.01em; text-overflow: ellipsis; white-space: nowrap; }
        .promo-brand-type { color: var(--faint); font-family: ui-monospace, "SFMono-Regular", monospace; font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; }
        .promo-header-tools { display: flex; align-items: center; gap: 20px; }
        .promo-system-status { display: flex; align-items: center; gap: 8px; color: var(--faint); font-family: ui-monospace, "SFMono-Regular", monospace; font-size: 11px; letter-spacing: 0.09em; }
        .promo-system-status::before { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 12px rgba(145, 230, 196, 0.58); content: ""; }
        .promo-header-entry-form, .promo-entry-form, .promo-footer-form { margin: 0; }
        .promo-header-entry { min-height: 42px; padding: 0 16px; border: 1px solid var(--line-strong); border-radius: 10px; color: var(--ink-soft); background: rgba(145, 230, 196, 0.04); font-size: 12px; font-weight: 650; cursor: pointer; transition: transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1), border-color 220ms ease, color 220ms ease, background 220ms ease; }
        .promo-header-entry:hover { border-color: rgba(145, 230, 196, 0.42); color: var(--ink); background: rgba(145, 230, 196, 0.08); transform: translateY(-1px); }
        .promo-header-entry:active { transform: scale(0.98); }
        .promo-hero { min-height: min(840px, calc(100dvh - 88px)); display: grid; grid-template-columns: minmax(0, 0.92fr) minmax(460px, 1.08fr); align-items: center; gap: clamp(24px, 4vw, 70px); padding: clamp(64px, 7vw, 108px) 0 clamp(78px, 9vw, 132px); }
        .promo-copy { position: relative; z-index: 4; max-width: 680px; }
        .promo-coordinate { display: flex; align-items: center; gap: 12px; margin: 0 0 28px; color: var(--accent); font-family: ui-monospace, "SFMono-Regular", monospace; font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; }
        .promo-coordinate::before { width: 34px; height: 1px; background: var(--accent); content: ""; }
        .promo-title { max-width: 12ch; margin: 0; color: var(--ink); font-size: clamp(52px, 5.25vw, 78px); font-weight: 620; letter-spacing: -0.071em; line-height: 0.96; word-break: keep-all; }
        .promo-title-highlight { color: var(--accent); font-weight: 500; }
        .promo-description { max-width: 52ch; min-height: 1.6em; margin: 28px 0 0; color: var(--muted); font-size: clamp(15px, 1.35vw, 18px); line-height: 1.72; text-wrap: pretty; }
        .promo-description:empty::before { content: "我们整理 AI 工具、软件订阅与数字服务的访问入口。这里介绍业务范围，完整方案、价格与交付说明请进入主站查看。"; }
        .promo-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 20px; margin-top: 36px; }
        .promo-entry-button { min-width: 190px; min-height: 56px; display: inline-flex; align-items: center; justify-content: space-between; gap: 18px; padding: 0 18px 0 22px; border: 1px solid rgba(211, 255, 237, 0.38); border-radius: 12px; color: var(--accent-ink); background: var(--accent); box-shadow: 0 18px 52px rgba(74, 163, 128, 0.17), inset 0 1px rgba(255, 255, 255, 0.46); font-size: 14px; font-weight: 720; cursor: pointer; transition: transform 240ms cubic-bezier(0.2, 0.85, 0.2, 1), background 220ms ease, box-shadow 220ms ease; }
        .promo-entry-button::after { content: "↗"; font-family: ui-monospace, monospace; font-size: 16px; transition: transform 220ms ease; }
        .promo-entry-button:hover { background: var(--accent-strong); box-shadow: 0 22px 66px rgba(74, 163, 128, 0.24), inset 0 1px rgba(255, 255, 255, 0.52); transform: translateY(-2px); }
        .promo-entry-button:hover::after { transform: translate(2px, -2px); }
        .promo-entry-button:active { transform: scale(0.985); }
        .promo-secondary-button { padding: 11px 2px; border-bottom: 1px solid var(--line-strong); color: var(--muted); font-size: 13px; font-weight: 600; text-decoration: none; transition: color 180ms ease, border-color 180ms ease, transform 180ms ease; }
        .promo-secondary-button:hover { border-color: var(--accent); color: var(--ink); transform: translateX(3px); }
        .promo-boundary-note { display: flex; align-items: center; gap: 10px; margin: 28px 0 0; color: var(--faint); font-size: 12px; line-height: 1.55; }
        .promo-boundary-note::before { width: 14px; height: 14px; border: 1px solid var(--line-strong); border-radius: 50%; box-shadow: inset 0 0 0 4px var(--bg), inset 0 0 0 7px var(--accent); content: ""; }
        .promo-signal-stage { --signal-x: 0px; --signal-y: 0px; position: relative; min-height: clamp(530px, 52vw, 720px); transform: translate3d(var(--signal-x), var(--signal-y), 0); transition: transform 240ms ease-out; }
        .promo-signal-stage::before { position: absolute; inset: 10% 2% 7%; border: 1px solid rgba(145, 230, 196, 0.08); border-radius: 50%; background: radial-gradient(circle at 50% 48%, rgba(100, 198, 159, 0.11), rgba(28, 68, 56, 0.035) 44%, transparent 72%); filter: blur(16px); content: ""; }
        .promo-signal-stage::after { position: absolute; right: 3%; bottom: 7%; left: 3%; height: 1px; background: linear-gradient(90deg, transparent, rgba(145, 230, 196, 0.26), transparent); box-shadow: 0 22px 72px rgba(42, 124, 92, 0.18); content: ""; }
        .promo-signal-canvas { position: absolute; z-index: 1; inset: -3% -5% -5%; width: 110%; height: 108%; opacity: 0.98; filter: drop-shadow(0 32px 80px rgba(27, 104, 75, 0.18)); }
        .promo-signal-core-logo { position: absolute; z-index: 3; top: 50.4%; left: 50%; width: clamp(68px, 6.4vw, 88px); height: clamp(68px, 6.4vw, 88px); padding: clamp(11px, 1vw, 14px); border: 1px solid rgba(184, 242, 218, 0.3); border-radius: 23%; object-fit: contain; background: linear-gradient(145deg, rgba(19, 44, 37, 0.76), rgba(7, 17, 15, 0.88)); box-shadow: 0 0 0 1px rgba(145, 230, 196, 0.08), 0 0 34px rgba(93, 203, 158, 0.24), inset 0 1px rgba(236, 255, 247, 0.14), inset 0 -12px 26px rgba(2, 12, 9, 0.3); transform: translate(-50%, -50%); backdrop-filter: blur(12px) saturate(118%); animation: promo-core-breathe 5.8s ease-in-out infinite; pointer-events: none; }
        .promo-signal-label { position: absolute; z-index: 3; display: grid; grid-template-columns: 7px minmax(0, 1fr); gap: 3px 9px; min-width: 146px; padding: 12px 14px; border: 1px solid var(--line); border-radius: 12px; background: rgba(8, 15, 15, 0.68); box-shadow: 0 18px 54px rgba(0, 12, 9, 0.24), inset 0 1px rgba(224, 255, 243, 0.04); backdrop-filter: blur(18px) saturate(112%); animation: promo-label-float 6s ease-in-out infinite; }
        .promo-signal-label::before { grid-row: 1 / span 2; align-self: center; width: 5px; height: 5px; border: 1px solid var(--accent); border-radius: 50%; box-shadow: 0 0 10px rgba(145, 230, 196, 0.44); content: ""; }
        .promo-signal-label strong { color: var(--ink-soft); font-family: ui-monospace, "SFMono-Regular", monospace; font-size: 10px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; }
        .promo-signal-label small { color: var(--faint); font-size: 11px; line-height: 1.4; }
        .promo-signal-label:nth-of-type(1) { top: 14%; right: 0; animation-delay: -1.6s; }
        .promo-signal-label:nth-of-type(2) { top: 35%; left: -1%; animation-delay: -3.5s; }
        .promo-signal-label:nth-of-type(3) { right: -1%; bottom: 19%; animation-delay: -4.8s; }
        @keyframes promo-label-float { 0%, 100% { transform: translate3d(0, 0, 0); } 50% { transform: translate3d(0, -5px, 0); } }
        @keyframes promo-core-breathe { 0%, 100% { box-shadow: 0 0 0 1px rgba(145, 230, 196, 0.08), 0 0 30px rgba(93, 203, 158, 0.2), inset 0 1px rgba(236, 255, 247, 0.14), inset 0 -12px 26px rgba(2, 12, 9, 0.3); transform: translate(-50%, -50%) scale(0.995); } 50% { box-shadow: 0 0 0 1px rgba(145, 230, 196, 0.14), 0 0 42px rgba(93, 203, 158, 0.29), inset 0 1px rgba(236, 255, 247, 0.19), inset 0 -12px 26px rgba(2, 12, 9, 0.28); transform: translate(-50%, -50%) scale(1.012); } }
        .promo-section { padding: clamp(84px, 9vw, 132px) 0 clamp(98px, 10vw, 148px); border-top: 1px solid var(--line); }
        .promo-section-header { display: grid; grid-template-columns: minmax(0, 0.88fr) minmax(320px, 0.62fr); align-items: end; gap: clamp(38px, 7vw, 110px); }
        .promo-kicker { margin: 0 0 18px; color: var(--accent); font-family: ui-monospace, "SFMono-Regular", monospace; font-size: 10px; letter-spacing: 0.17em; text-transform: uppercase; }
        .promo-section-title { max-width: 13ch; margin: 0; color: var(--ink); font-size: clamp(38px, 4.8vw, 68px); font-weight: 560; letter-spacing: -0.062em; line-height: 0.99; word-break: keep-all; }
        .promo-section-intro { max-width: 48ch; margin: 0; color: var(--muted); font-size: 15px; line-height: 1.75; text-wrap: pretty; }
        .promo-capability-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 14px; margin-top: 54px; }
        .promo-capability { --spotlight-x: 50%; --spotlight-y: 50%; position: relative; min-height: 260px; display: flex; flex-direction: column; overflow: hidden; padding: clamp(26px, 3vw, 38px); border: 1px solid var(--line); border-radius: var(--radius-card); background: radial-gradient(360px circle at var(--spotlight-x) var(--spotlight-y), rgba(145, 230, 196, 0.095), transparent 60%), linear-gradient(145deg, rgba(14, 23, 23, 0.92), rgba(8, 14, 15, 0.84)); box-shadow: inset 0 1px rgba(229, 255, 244, 0.035); transition: transform 300ms cubic-bezier(0.2, 0.8, 0.2, 1), border-color 240ms ease, box-shadow 240ms ease; }
        .promo-capability::after { position: absolute; right: 24px; bottom: 22px; width: 46px; height: 1px; background: var(--line-strong); content: ""; transition: width 260ms ease, background 260ms ease; }
        .promo-capability:hover { border-color: rgba(145, 230, 196, 0.27); box-shadow: var(--shadow), inset 0 1px rgba(229, 255, 244, 0.055); transform: translateY(-4px); }
        .promo-capability:hover::after { width: 76px; background: var(--accent); }
        .promo-capability:nth-child(1), .promo-capability:nth-child(4) { grid-column: span 7; }
        .promo-capability:nth-child(2), .promo-capability:nth-child(3) { grid-column: span 5; }
        .promo-capability-index { color: var(--faint); font-family: ui-monospace, "SFMono-Regular", monospace; font-size: 11px; letter-spacing: 0.13em; }
        .promo-capability-glyph { --glyph-angle: 0deg; --glyph-counter-angle: 0deg; position: relative; width: 52px; height: 52px; display: grid; place-items: center; margin: 34px 0 26px; border: 1px solid var(--line-strong); border-radius: 14px; transform: rotate(var(--glyph-angle)); transition: transform 300ms ease, border-color 240ms ease, border-radius 240ms ease; }
        .promo-capability-glyph::before { position: absolute; inset: 8px; border: 1px solid rgba(145, 230, 196, 0.3); border-radius: inherit; content: ""; }
        .promo-capability-glyph::after { position: absolute; right: 7px; bottom: 7px; width: 5px; height: 5px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 12px rgba(145, 230, 196, 0.48); content: ""; }
        .promo-capability-glyph-code { position: relative; z-index: 1; color: var(--accent); font-family: ui-monospace, "SFMono-Regular", monospace; font-size: 10px; font-weight: 700; letter-spacing: 0.08em; transform: rotate(var(--glyph-counter-angle)); }
        .promo-capability:nth-child(1) .promo-capability-glyph { --glyph-angle: 45deg; --glyph-counter-angle: -45deg; }
        .promo-capability:nth-child(2) .promo-capability-glyph { border-radius: 50%; }
        .promo-capability:nth-child(3) .promo-capability-glyph { border-radius: 17px 5px; }
        .promo-capability:nth-child(4) .promo-capability-glyph { border-radius: 5px 17px; }
        .promo-capability:hover .promo-capability-glyph { border-color: rgba(145, 230, 196, 0.42); transform: translateY(-2px) rotate(var(--glyph-angle)) scale(1.035); }
        .promo-capability h3 { max-width: 16ch; margin: auto 0 0; color: var(--ink); font-size: clamp(23px, 2.4vw, 32px); font-weight: 580; letter-spacing: -0.04em; line-height: 1.12; }
        .promo-capability p { max-width: 48ch; margin: 13px 0 0; color: var(--muted); font-size: 13px; line-height: 1.7; }
        .promo-layer-layout { display: grid; grid-template-columns: minmax(280px, 0.72fr) minmax(0, 1.28fr); align-items: start; gap: clamp(54px, 9vw, 132px); }
        .promo-layer-heading { position: sticky; top: 40px; }
        .promo-layer-heading .promo-section-intro { margin-top: 24px; }
        .promo-layer-stack { display: grid; gap: 16px; }
        .promo-layer { --spotlight-x: 50%; --spotlight-y: 50%; position: relative; overflow: hidden; padding: clamp(30px, 4vw, 48px); border: 1px solid var(--line); border-radius: var(--radius-outer); background: radial-gradient(420px circle at var(--spotlight-x) var(--spotlight-y), rgba(145, 230, 196, 0.075), transparent 62%), var(--surface); box-shadow: inset 0 1px rgba(229, 255, 244, 0.035); }
        .promo-layer-primary { margin-left: clamp(0px, 5vw, 70px); background: radial-gradient(420px circle at var(--spotlight-x) var(--spotlight-y), rgba(145, 230, 196, 0.1), transparent 62%), var(--surface-strong); }
        .promo-layer-topline { display: flex; align-items: center; justify-content: space-between; gap: 20px; color: var(--faint); font-family: ui-monospace, "SFMono-Regular", monospace; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; }
        .promo-layer-topline::after { width: 8px; height: 8px; border: 1px solid var(--accent); border-radius: 50%; content: ""; }
        .promo-layer h3 { margin: 44px 0 0; color: var(--ink); font-size: clamp(28px, 3.4vw, 46px); font-weight: 560; letter-spacing: -0.052em; }
        .promo-layer p { max-width: 54ch; margin: 16px 0 0; color: var(--muted); font-size: 14px; line-height: 1.75; }
        .promo-layer-items { display: flex; flex-wrap: wrap; gap: 9px; margin-top: 30px; }
        .promo-layer-items span { padding: 9px 12px; border: 1px solid var(--line); border-radius: 8px; color: var(--ink-soft); background: rgba(145, 230, 196, 0.03); font-size: 11px; }
        .promo-process-layout { display: grid; grid-template-columns: minmax(0, 0.9fr) minmax(340px, 1.1fr); gap: clamp(48px, 9vw, 130px); }
        .promo-process-copy .promo-section-intro { margin-top: 24px; }
        .promo-process-list { margin: 0; padding: 0; border-top: 1px solid var(--line); list-style: none; }
        .promo-process-item { display: grid; grid-template-columns: 46px minmax(0, 1fr); gap: 22px; padding: 29px 0 31px; border-bottom: 1px solid var(--line); }
        .promo-process-index { padding-top: 4px; color: var(--accent); font-family: ui-monospace, "SFMono-Regular", monospace; font-size: 11px; letter-spacing: 0.12em; font-variant-numeric: tabular-nums; }
        .promo-process-item strong { display: block; color: var(--ink); font-size: 20px; font-weight: 580; letter-spacing: -0.025em; }
        .promo-process-item p { max-width: 54ch; margin: 10px 0 0; color: var(--muted); font-size: 13px; line-height: 1.7; }
        .promo-final { position: relative; overflow: hidden; display: grid; grid-template-columns: minmax(0, 1.06fr) minmax(280px, 0.94fr); align-items: end; gap: clamp(42px, 8vw, 110px); margin-bottom: clamp(44px, 6vw, 82px); padding: clamp(42px, 6vw, 78px); border: 1px solid rgba(145, 230, 196, 0.2); border-radius: var(--radius-outer); background: radial-gradient(circle at 78% 36%, rgba(107, 198, 162, 0.13), transparent 31%), linear-gradient(142deg, rgba(17, 30, 29, 0.96), rgba(7, 13, 14, 0.94)); box-shadow: var(--shadow), inset 0 1px rgba(231, 255, 245, 0.05); }
        .promo-final::before { position: absolute; top: 0; right: 12%; width: 1px; height: 100%; background: linear-gradient(transparent, rgba(145, 230, 196, 0.18), transparent); content: ""; transform: rotate(16deg); }
        .promo-final h2 { max-width: 12ch; margin: 0; color: var(--ink); font-size: clamp(42px, 5.4vw, 72px); font-weight: 560; letter-spacing: -0.064em; line-height: 0.98; text-wrap: balance; }
        .promo-final-title-line { display: inline; }
        .promo-final p { max-width: 47ch; margin: 22px 0 32px; color: var(--muted); font-size: 14px; line-height: 1.72; }
        .promo-final-signal { display: grid; gap: 0; border-top: 1px solid var(--line); }
        .promo-final-signal span { display: grid; grid-template-columns: 52px minmax(0, 1fr); align-items: center; min-height: 66px; border-bottom: 1px solid var(--line); color: var(--ink-soft); font-size: 13px; }
        .promo-final-signal b { color: var(--accent); font-family: ui-monospace, "SFMono-Regular", monospace; font-size: 10px; font-weight: 600; letter-spacing: 0.12em; }
        .promo-footer { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 28px 0 34px; border-top: 1px solid var(--line); color: var(--faint); font-size: 12px; }
        .promo-footer-meta { display: flex; flex-wrap: wrap; gap: 9px 18px; }
        .promo-footer-nav { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px 18px; }
        .promo-footer-link { min-width: 44px; min-height: 40px; display: inline-flex; align-items: center; justify-content: center; padding: 0 2px; border: 0; color: var(--muted); background: transparent; font-size: 12px; cursor: pointer; transition: color 180ms ease, transform 180ms ease; }
        .promo-footer-link:hover { color: var(--ink); }
        .promo-footer-link:active { transform: scale(0.97); }
        :where(.promo-header-entry, .promo-entry-button, .promo-secondary-button, .promo-footer-link):focus-visible { outline: 3px solid rgba(145, 230, 196, 0.72); outline-offset: 4px; }
        .promo-motion-ready [data-promo-reveal] { opacity: 0; transform: translate3d(0, 28px, 0); clip-path: inset(0 0 18% 0); transition: opacity 700ms ease, transform 760ms cubic-bezier(0.18, 0.85, 0.2, 1), clip-path 760ms cubic-bezier(0.18, 0.85, 0.2, 1); }
        .promo-motion-ready [data-promo-reveal].is-visible { opacity: 1; transform: translate3d(0, 0, 0); clip-path: inset(0 0 0 0); }
        .promo-motion-ready .promo-capability:nth-child(2), .promo-motion-ready .promo-layer:nth-child(2) { transition-delay: 90ms; }
        .promo-motion-ready .promo-capability:nth-child(3) { transition-delay: 140ms; }
        .promo-motion-ready .promo-capability:nth-child(4) { transition-delay: 190ms; }
        @media (max-width: 1040px) {
            .promo-hero { min-height: auto; grid-template-columns: 1fr; padding-top: 76px; }
            .promo-copy { max-width: 760px; }
            .promo-signal-stage { min-height: min(78vw, 700px); }
            .promo-section-header { grid-template-columns: 1fr; align-items: start; }
            .promo-section-intro { max-width: 58ch; }
            .promo-layer-layout, .promo-process-layout { grid-template-columns: 1fr; }
            .promo-layer-heading { position: static; }
            .promo-final { grid-template-columns: 1fr; }
        }
        @media (max-width: 720px) {
            .promo-shell { width: min(calc(100% - 30px), 1320px); }
            .promo-header { min-height: 74px; }
            .promo-system-status { display: none; }
            .promo-header-tools { gap: 0; }
            .promo-brand-type { font-size: 9px; letter-spacing: 0.14em; }
            .promo-header-entry { min-height: 44px; padding-inline: 12px; }
            .promo-hero { gap: 16px; padding: 44px 0 52px; }
            .promo-coordinate { margin-bottom: 22px; }
            .promo-title { font-size: clamp(42px, 11.5vw, 54px); }
            .promo-description { margin-top: 23px; }
            .promo-actions { align-items: stretch; flex-direction: column; gap: 12px; margin-top: 30px; }
            .promo-entry-form, .promo-entry-button { width: 100%; }
            .promo-secondary-button { width: fit-content; }
            .promo-boundary-note { align-items: flex-start; }
            .promo-boundary-note::before { flex: none; margin-top: 1px; }
            .promo-signal-stage { min-height: 84vw; margin-inline: -10px; }
            .promo-signal-core-logo { width: 60px; height: 60px; padding: 9px; }
            .promo-signal-label { min-width: 118px; padding: 9px 10px; }
            .promo-signal-label:nth-of-type(1) { right: 3%; }
            .promo-signal-label:nth-of-type(2) { left: 4%; }
            .promo-signal-label:nth-of-type(3) { right: 2%; }
            .promo-section { padding: 56px 0 64px; }
            .promo-section-title { font-size: clamp(38px, 11vw, 54px); }
            .promo-capability-grid { grid-template-columns: 1fr; gap: 12px; margin-top: 30px; }
            .promo-capability:nth-child(n) { grid-column: 1; min-height: 0; display: grid; grid-template-columns: 46px minmax(0, 1fr); grid-template-areas: "index index" "glyph title" "glyph copy"; column-gap: 16px; padding: 22px; }
            .promo-capability-index { grid-area: index; margin-bottom: 20px; }
            .promo-capability-glyph { grid-area: glyph; width: 44px; height: 44px; margin: 0; }
            .promo-capability-glyph-code { font-size: 9px; }
            .promo-capability h3 { grid-area: title; align-self: end; margin: 0; font-size: 22px; }
            .promo-capability p { grid-area: copy; margin: 8px 0 0; }
            .promo-layer-primary { margin-left: 0; }
            .promo-layer { padding: 24px 22px; border-radius: 22px; }
            .promo-layer h3 { margin-top: 26px; }
            .promo-layer-items { margin-top: 22px; }
            .promo-process-copy .promo-section-intro { margin-top: 18px; }
            .promo-process-item { grid-template-columns: 38px minmax(0, 1fr); gap: 12px; padding: 19px 0 21px; }
            .promo-process-item strong { font-size: 18px; }
            .promo-final { padding: 30px 22px; border-radius: 22px; }
            .promo-final h2 { max-width: none; font-size: clamp(38px, 10.2vw, 40px); letter-spacing: -0.055em; text-wrap: initial; }
            .promo-final-title-line { display: block; }
            .promo-final p { margin: 18px 0 26px; }
            .promo-final-signal span { grid-template-columns: 44px minmax(0, 1fr); min-height: 54px; }
            .promo-footer { align-items: flex-start; flex-direction: column; gap: 16px; padding: 24px 0 28px; }
            .promo-footer-nav { justify-content: flex-start; }
        }
        @media (prefers-reduced-motion: reduce) {
            html { scroll-behavior: auto; }
            *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
            .promo-signal-stage { transform: none; }
            .promo-motion-ready [data-promo-reveal] { opacity: 1; transform: none; clip-path: none; }
        }
    </style>
</head>
<body>
    <a class="promo-skip-link" href="#promo-main">跳到主要内容</a>
    <div class="promo-page" data-promo-page>
        <header class="promo-header promo-shell">
            <div class="promo-brand" aria-label="{{store.name}}">
                <span class="promo-logo-wrap" data-bind-visible="store.logoUrl"><img class="promo-logo" data-bind-src="store.logoUrl" data-hide-if-empty alt="{{store.name}}"></span>
                <span class="promo-brand-copy"><span class="promo-brand-name" data-bind-text="store.name"></span><span class="promo-brand-type">Digital service access</span></span>
            </div>
            <div class="promo-header-tools">
                <span class="promo-system-status">ENTRY NODE ONLINE</span>
                <form class="promo-header-entry-form" data-store-entry><button class="promo-header-entry" type="submit">进入主站</button></form>
            </div>
        </header>

        <main id="promo-main">
            <section class="promo-hero promo-shell">
                <div class="promo-copy" data-promo-reveal>
                    <p class="promo-coordinate">Access point / 01</p>
                    <h1 class="promo-title">复杂的数字服务，<br><span class="promo-title-highlight">应该有一个<br>清楚的入口。</span></h1>
                    <p class="promo-description" data-bind-text="store.description"></p>
                    <div class="promo-actions">
                        <form class="promo-entry-form" data-store-entry><button class="promo-entry-button" type="submit">进入业务主站</button></form>
                        <a class="promo-secondary-button" href="#services">查看服务范围</a>
                    </div>
                    <p class="promo-boundary-note">本页只用于业务介绍，商品、价格、交付与售后信息以主站为准。</p>
                </div>
                <div class="promo-signal-stage" data-promo-signal-stage data-promo-reveal role="img" aria-label="AI 工具、软件订阅、数字交付与订单支持组成的动态业务网络">
                    <canvas class="promo-signal-canvas" data-promo-signal-canvas></canvas>
                    <img class="promo-signal-core-logo" data-promo-signal-core-logo data-bind-src="store.logoUrl" data-hide-if-empty alt="">
                    <span class="promo-signal-label"><strong>AI Access</strong><small>工具与模型服务</small></span>
                    <span class="promo-signal-label"><strong>Digital Service</strong><small>软件与数字交付</small></span>
                    <span class="promo-signal-label"><strong>Order Support</strong><small>订单与售后承接</small></span>
                </div>
            </section>

            <section class="promo-section promo-shell" id="services">
                <div class="promo-section-header" data-promo-reveal>
                    <div><p class="promo-kicker">Service matrix / 02</p><h2 class="promo-section-title">不展示商品列表，<br>只讲清服务方向。</h2></div>
                    <p class="promo-section-intro">我们把分散的 AI 工具、软件订阅和数字服务整理为清楚的进入路径。这一页帮你判断业务是否匹配，具体方案则回到主站确认。</p>
                </div>
                <div class="promo-capability-grid">
                    <article class="promo-capability" data-promo-surface data-promo-reveal><span class="promo-capability-index">01 / AI</span><span class="promo-capability-glyph" aria-hidden="true"><span class="promo-capability-glyph-code">AI</span></span><h3>AI 接入与效率工具</h3><p>了解工具的适用场景、接入方式和使用边界，再到主站选择对应方案。</p></article>
                    <article class="promo-capability" data-promo-surface data-promo-reveal><span class="promo-capability-index">02 / SOFTWARE</span><span class="promo-capability-glyph" aria-hidden="true"><span class="promo-capability-glyph-code">SW</span></span><h3>软件订阅与数字授权</h3><p>统一查找常用数字服务入口，减少在多个平台之间反复筛选。</p></article>
                    <article class="promo-capability" data-promo-surface data-promo-reveal><span class="promo-capability-index">03 / DELIVERY</span><span class="promo-capability-glyph" aria-hidden="true"><span class="promo-capability-glyph-code">DX</span></span><h3>数字商品与交付说明</h3><p>交付方式、使用说明和限制条件在主站商品与订单链路中统一展示。</p></article>
                    <article class="promo-capability" data-promo-surface data-promo-reveal><span class="promo-capability-index">04 / SUPPORT</span><span class="promo-capability-glyph" aria-hidden="true"><span class="promo-capability-glyph-code">CS</span></span><h3>订单查询与持续支持</h3><p>从购买前的范围确认，到交付后的订单查询与售后支持，都回到同一业务入口。</p></article>
                </div>
            </section>

            <section class="promo-section">
                <div class="promo-layer-layout promo-shell">
                    <div class="promo-layer-heading" data-promo-reveal><p class="promo-kicker">Clear boundary / 03</p><h2 class="promo-section-title">介绍与交易，<br>各自清楚。</h2><p class="promo-section-intro">推广页负责讲清业务，主站负责给出可以决策和交易的完整信息。</p></div>
                    <div class="promo-layer-stack">
                        <article class="promo-layer" data-promo-surface data-promo-reveal><div class="promo-layer-topline"><span>Promotion layer</span><span>Public introduction</span></div><h3>推广介绍层</h3><p>对外介绍品牌定位、服务类型与进入路径，不展开实时商品、价格或库存。</p><div class="promo-layer-items"><span>业务范围</span><span>服务路径</span><span>主站入口</span></div></article>
                        <article class="promo-layer promo-layer-primary" data-promo-surface data-promo-reveal><div class="promo-layer-topline"><span>Store layer</span><span>Protected business</span></div><h3>主站业务层</h3><p>访客主动点击进入后，再查看完整商品信息、实时价格、交付条件、订单记录与售后支持。</p><div class="promo-layer-items"><span>商品详情</span><span>价格与交付</span><span>订单与售后</span></div></article>
                    </div>
                </div>
            </section>

            <section class="promo-section promo-shell">
                <div class="promo-process-layout">
                    <div class="promo-process-copy" data-promo-reveal><p class="promo-kicker">Entry sequence / 04</p><h2 class="promo-section-title">先了解，<br>再进入，最后决定。</h2><p class="promo-section-intro">这一页不催促交易。它的任务是让你明白这是什么类型的站点，以及下一步应该去哪里。</p></div>
                    <ol class="promo-process-list" data-promo-reveal>
                        <li class="promo-process-item"><span class="promo-process-index">01</span><div><strong>快速确认业务是否匹配</strong><p>通过服务类型和边界说明，判断这里是否值得继续了解。</p></div></li>
                        <li class="promo-process-item"><span class="promo-process-index">02</span><div><strong>主动点击进入业务主站</strong><p>只有当你决定继续时，页面才把你带入完整主站。</p></div></li>
                        <li class="promo-process-item"><span class="promo-process-index">03</span><div><strong>查看详情并完成后续服务</strong><p>在主站确认具体内容、价格、交付与退款条件，再决定是否下单。</p></div></li>
                    </ol>
                </div>
            </section>

            <section class="promo-final promo-shell" data-promo-reveal>
                <div><p class="promo-kicker">Continue to store / 05</p><h2><span class="promo-final-title-line">继续进入，</span><span class="promo-final-title-line">查看与你需求</span><span class="promo-final-title-line">匹配的服务。</span></h2><p>主站会展示当前可用内容、完整说明与服务条件。请确认信息后再进行后续操作。</p><form class="promo-entry-form" data-store-entry><button class="promo-entry-button" type="submit">进入业务主站</button></form></div>
                <div class="promo-final-signal" aria-label="主站信息范围"><span><b>INFO</b>完整商品与服务说明</span><span><b>ORDER</b>价格、交付与订单状态</span><span><b>CARE</b>客服、条款与售后入口</span></div>
            </section>
        </main>

        <footer class="promo-footer promo-shell">
            <div class="promo-footer-meta"><span><span data-bind-text="store.name"></span> · Digital service access</span><span>© <span data-bind-text="store.currentYear"></span></span></div>
            <nav class="promo-footer-nav" aria-label="规则与支持">
                <form class="promo-footer-form" data-store-entry data-store-entry-target="privacy"><button class="promo-footer-link" type="submit">隐私政策</button></form>
                <form class="promo-footer-form" data-store-entry data-store-entry-target="terms"><button class="promo-footer-link" type="submit">使用条款</button></form>
                <form class="promo-footer-form" data-store-entry data-store-entry-target="support"><button class="promo-footer-link" type="submit">客服中心</button></form>
            </nav>
        </footer>
    </div>
</body>
</html>`;
