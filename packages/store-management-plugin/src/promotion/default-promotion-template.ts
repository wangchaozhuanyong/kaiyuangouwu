/* eslint-disable max-len -- Keep the embedded promotion HTML and CSS readable as source. */

export const DEFAULT_PROMOTION_TEMPLATE_VERSION = 14;

export const DEFAULT_PROMOTION_TEMPLATE = `<!doctype html>
<html lang="{{store.language}}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="{{promo.metaDescription}}">
    <meta property="og:type" content="website">
    <meta property="og:title" content="{{promo.metaTitle}}">
    <meta property="og:description" content="{{promo.metaDescription}}">
    <meta property="og:image" content="{{store.shareImageUrl}}">
    <title>{{promo.metaTitle}}</title>
    <style>
        :root {
            color-scheme: dark;
            --bg: #080e16;
            --bg-deep: #050a11;
            --surface: rgba(14, 24, 37, 0.8);
            --surface-strong: rgba(17, 30, 46, 0.94);
            --surface-soft: rgba(14, 27, 43, 0.54);
            --ink: #f0f5fc;
            --ink-soft: #c9d5e4;
            --muted: #9cabbc;
            --faint: #728198;
            --accent: #82b8ff;
            --accent-strong: #b7d7ff;
            --accent-ink: #071322;
            --accent-deep: #1d4776;
            --line: rgba(145, 182, 224, 0.15);
            --line-strong: rgba(157, 199, 245, 0.3);
            --shadow: 0 34px 100px rgba(2, 10, 22, 0.44);
            --radius-outer: 24px;
            --radius-card: 16px;
            --page-progress: 0;
            --space-section: clamp(58px, 5.5vw, 74px);
            --space-section-compact: clamp(44px, 4.5vw, 60px);
        }
        * { box-sizing: border-box; }
        html { min-width: 320px; scroll-behavior: smooth; background: var(--bg-deep); }
        body {
            min-width: 320px;
            min-height: 100dvh;
            margin: 0;
            overflow-x: hidden;
            color: var(--ink);
            background:
                radial-gradient(circle at 72% 2%, rgba(74, 125, 194, 0.12), transparent 29%),
                radial-gradient(circle at 12% 38%, rgba(76, 117, 170, 0.06), transparent 26%),
                linear-gradient(150deg, #0b121c 0%, var(--bg) 46%, #060b12 100%);
            font-family: "Avenir Next", Avenir, "SF Pro Display", "PingFang SC", "Microsoft YaHei", sans-serif;
            -webkit-font-smoothing: antialiased;
            text-rendering: optimizeLegibility;
        }
        body::before {
            position: fixed;
            z-index: 30;
            inset: 0;
            opacity: 0.14;
            background-image:
                repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.012) 0 1px, transparent 1px 4px),
                repeating-linear-gradient(90deg, rgba(142, 183, 232, 0.01) 0 1px, transparent 1px 5px);
            content: "";
            pointer-events: none;
            mix-blend-mode: soft-light;
        }
        button, a { font: inherit; }
        a { color: inherit; }
        button { -webkit-tap-highlight-color: transparent; }
        .promo-skip-link { position: fixed; z-index: 60; top: 12px; left: 12px; padding: 11px 15px; border-radius: 8px; color: var(--accent-ink); background: var(--accent-strong); font-size: 13px; font-weight: 700; transform: translateY(-160%); transition: transform 180ms ease; }
        .promo-skip-link:focus { transform: translateY(0); }
        .promo-page { position: relative; min-height: 100dvh; overflow: clip; isolation: isolate; }
        .promo-page::before {
            position: fixed;
            z-index: -2;
            inset: 0;
            background-image:
                linear-gradient(rgba(142, 183, 232, 0.032) 1px, transparent 1px),
                linear-gradient(90deg, rgba(142, 183, 232, 0.032) 1px, transparent 1px);
            background-size: 74px 74px;
            mask-image: linear-gradient(to bottom, black 0%, rgba(0, 0, 0, 0.52) 54%, transparent 94%);
            content: "";
            pointer-events: none;
        }
        .promo-page::after { position: fixed; z-index: 50; top: 0; left: 0; width: calc(var(--page-progress) * 100%); height: 2px; background: var(--accent); box-shadow: 0 0 18px rgba(130, 184, 255, 0.48); content: ""; pointer-events: none; }
        .promo-shell { width: min(calc(100% - 48px), 1200px); margin-inline: auto; }
        .promo-header { position: sticky; z-index: 40; top: 0; min-height: 72px; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 28px; border-bottom: 1px solid transparent; background: rgba(8, 14, 22, 0.38); backdrop-filter: blur(14px) saturate(120%); transition: background 260ms ease, border-color 260ms ease, box-shadow 260ms ease; }
        .promo-header.is-scrolled { border-color: var(--line); background: rgba(6, 12, 20, 0.88); box-shadow: 0 14px 38px rgba(2, 8, 17, 0.24); }
        .promo-brand { min-width: 0; display: flex; align-items: center; gap: 12px; text-decoration: none; }
        .promo-logo-mark { width: 34px; height: 34px; display: grid; place-items: center; border: 1px solid var(--line-strong); border-radius: 10px; color: var(--accent); background: rgba(130, 184, 255, 0.07); box-shadow: inset 0 1px rgba(235, 245, 255, 0.1); font-family: ui-monospace, "SFMono-Regular", monospace; font-size: 13px; font-weight: 700; letter-spacing: -0.08em; }
        .promo-brand-copy { min-width: 0; display: grid; gap: 2px; }
        .promo-brand-name { color: var(--ink); font-size: 14px; font-weight: 700; letter-spacing: -0.02em; }
        .promo-brand-type { color: var(--faint); font-family: ui-monospace, "SFMono-Regular", monospace; font-size: 9px; letter-spacing: 0.15em; text-transform: uppercase; }
        .promo-nav { display: flex; align-items: center; justify-content: center; gap: clamp(16px, 2.7vw, 34px); }
        .promo-nav a { position: relative; padding: 10px 0; color: var(--muted); font-size: 12px; font-weight: 600; text-decoration: none; transition: color 180ms ease; }
        .promo-nav a::after { position: absolute; right: 0; bottom: 4px; left: 0; height: 1px; background: var(--accent); content: ""; opacity: 0; transform: scaleX(0.35); transition: opacity 180ms ease, transform 180ms ease; }
        .promo-nav a:hover, .promo-nav a:focus-visible, .promo-nav a.is-active { color: var(--ink); }
        .promo-nav a:hover::after, .promo-nav a:focus-visible::after, .promo-nav a.is-active::after { opacity: 1; transform: scaleX(1); }
        .promo-header-entry-form, .promo-entry-form, .promo-footer-form { margin: 0; }
        .promo-header-entry { min-height: 40px; padding: 0 15px; border: 1px solid var(--line-strong); border-radius: 9px; color: var(--ink-soft); background: rgba(130, 184, 255, 0.05); font-size: 12px; font-weight: 650; cursor: pointer; transition: transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1), border-color 220ms ease, color 220ms ease, background 220ms ease; }
        .promo-header-entry:hover { border-color: rgba(130, 184, 255, 0.62); color: var(--ink); background: rgba(130, 184, 255, 0.12); transform: translateY(-1px); }
        .promo-header-entry:active { transform: scale(0.98); }
        .promo-hero { min-height: min(700px, calc(100dvh - 72px)); display: grid; grid-template-columns: minmax(0, 1.16fr) minmax(390px, 0.84fr); align-items: center; gap: clamp(28px, 5vw, 76px); padding: clamp(54px, 6vw, 76px) 0 clamp(60px, 6.3vw, 82px); }
        .promo-copy { position: relative; z-index: 4; max-width: 690px; }
        .promo-eyebrow, .promo-section-label { display: flex; align-items: center; gap: 11px; margin: 0 0 24px; color: var(--accent); font-family: ui-monospace, "SFMono-Regular", monospace; font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; }
        .promo-eyebrow::before, .promo-section-label::before { width: 30px; height: 1px; background: currentColor; content: ""; }
        .promo-title { max-width: 12ch; margin: 0; color: var(--ink); font-size: clamp(52px, 5.4vw, 68px); font-weight: 630; letter-spacing: -0.073em; line-height: 1.08; word-break: keep-all; text-wrap: balance; }
        .promo-title-line { display: block; }
        .promo-title-highlight { color: var(--accent); font-weight: 540; }
        .promo-description { max-width: 52ch; margin: 27px 0 0; color: var(--muted); font-size: clamp(15px, 1.25vw, 17px); line-height: 1.75; text-wrap: pretty; }
        .promo-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 18px; margin-top: 30px; }
        .promo-entry-button { min-width: 184px; min-height: 54px; display: inline-flex; align-items: center; justify-content: space-between; gap: 18px; padding: 0 17px 0 21px; border: 1px solid rgba(216, 235, 255, 0.54); border-radius: 10px; color: var(--accent-ink); background: var(--accent); box-shadow: 0 18px 52px rgba(50, 102, 168, 0.2), inset 0 1px rgba(255, 255, 255, 0.5); font-size: 14px; font-weight: 720; cursor: pointer; transition: transform 240ms cubic-bezier(0.2, 0.85, 0.2, 1), background 220ms ease, box-shadow 220ms ease; }
        .promo-entry-button::after { content: "↗"; font-family: ui-monospace, monospace; font-size: 16px; transition: transform 220ms ease; }
        .promo-entry-button:hover { background: var(--accent-strong); box-shadow: 0 22px 66px rgba(50, 102, 168, 0.28), inset 0 1px rgba(255, 255, 255, 0.56); transform: translateY(-2px); }
        .promo-entry-button:hover::after { transform: translate(2px, -2px); }
        .promo-entry-button:active { transform: scale(0.985); }
        .promo-secondary-button { display: inline-flex; align-items: center; gap: 8px; padding: 11px 0; color: var(--muted); font-size: 13px; font-weight: 600; text-decoration: none; transition: color 180ms ease, transform 180ms ease; }
        .promo-secondary-button::after { color: var(--accent); content: "↘"; font-family: ui-monospace, monospace; font-size: 15px; transition: transform 180ms ease; }
        .promo-secondary-button:hover { color: var(--ink); transform: translateX(3px); }
        .promo-secondary-button:hover::after { transform: translate(1px, 2px); }
        .promo-trust-line { display: flex; flex-wrap: wrap; align-items: center; gap: 9px 16px; margin: 21px 0 0; color: var(--faint); font-size: 12px; line-height: 1.55; }
        .promo-trust-line span { display: inline-flex; align-items: center; gap: 8px; }
        .promo-trust-line span::before { width: 5px; height: 5px; border: 1px solid var(--accent); border-radius: 50%; box-shadow: 0 0 10px rgba(130, 184, 255, 0.42); content: ""; }
        .promo-network { --signal-x: 0px; --signal-y: 0px; position: relative; min-height: clamp(460px, 40vw, 560px); transform: translate3d(var(--signal-x), var(--signal-y), 0); transition: transform 240ms ease-out; }
        .promo-network::before { position: absolute; inset: 9% -4% 5%; border: 1px solid rgba(130, 184, 255, 0.11); border-radius: 50%; background: radial-gradient(circle at 50% 48%, rgba(78, 132, 204, 0.16), rgba(26, 49, 79, 0.04) 44%, transparent 72%); filter: blur(14px); content: ""; }
        .promo-network::after { position: absolute; right: 4%; bottom: 6%; left: 4%; height: 1px; background: linear-gradient(90deg, transparent, rgba(130, 184, 255, 0.34), transparent); box-shadow: 0 20px 68px rgba(41, 92, 157, 0.26); content: ""; }
        .promo-network-canvas { position: absolute; z-index: 1; inset: -4% -8% -6%; width: 116%; height: 110%; opacity: 0.94; filter: drop-shadow(0 28px 74px rgba(35, 90, 157, 0.2)); }
        .promo-network-core { position: absolute; z-index: 3; top: 50%; left: 50%; display: grid; width: 118px; height: 118px; place-items: center; border: 1px solid rgba(187, 216, 255, 0.5); border-radius: 50%; color: var(--ink); background: rgba(8, 18, 32, 0.72); box-shadow: 0 0 0 8px rgba(130, 184, 255, 0.035), 0 0 38px rgba(91, 151, 224, 0.26), inset 0 1px rgba(245, 250, 255, 0.14); font-family: ui-monospace, "SFMono-Regular", monospace; font-size: 17px; font-weight: 700; letter-spacing: -0.06em; transform: translate(-50%, -50%); backdrop-filter: blur(16px); }
        .promo-network-core::before { position: absolute; inset: 16px; border: 1px solid rgba(130, 184, 255, 0.28); border-radius: 50%; content: ""; }
        .promo-network-core::after { position: absolute; right: 12px; bottom: 13px; width: 7px; height: 7px; border: 2px solid var(--bg); border-radius: 50%; background: var(--accent); box-shadow: 0 0 14px rgba(130, 184, 255, 0.8); content: ""; }
        .promo-network-node { position: absolute; z-index: 4; min-width: 140px; padding: 12px 14px; border: 1px solid var(--line); border-radius: 10px; background: rgba(7, 15, 27, 0.7); box-shadow: 0 16px 42px rgba(1, 7, 16, 0.26), inset 0 1px rgba(238, 247, 255, 0.05); backdrop-filter: blur(18px) saturate(118%); }
        .promo-network-node::before { display: block; width: 5px; height: 5px; margin-bottom: 9px; border: 1px solid var(--accent); border-radius: 50%; box-shadow: 0 0 10px rgba(130, 184, 255, 0.56); content: ""; }
        .promo-network-node strong { display: block; color: var(--ink-soft); font-family: ui-monospace, "SFMono-Regular", monospace; font-size: 10px; font-weight: 600; letter-spacing: 0.11em; text-transform: uppercase; }
        .promo-network-node small { display: block; margin-top: 4px; color: var(--faint); font-size: 11px; line-height: 1.4; }
        .promo-network-node-assistant { top: 13%; left: 4%; }
        .promo-network-node-coding { top: 21%; right: 0; }
        .promo-network-node-creative { bottom: 17%; left: 0; }
        .promo-network-node-api { right: 9%; bottom: 8%; }
        .promo-section { padding: var(--space-section) 0; }
        .promo-section[id] { scroll-margin-top: 92px; }
        .promo-section--compact { padding-block: var(--space-section-compact); }
        .promo-section-heading { max-width: 720px; margin-bottom: 32px; }
        .promo-section-title { max-width: 14ch; margin: 0; color: var(--ink); font-size: clamp(40px, 4.6vw, 58px); font-weight: 610; letter-spacing: -0.066em; line-height: 1; text-wrap: balance; }
        .promo-section-intro { max-width: 58ch; margin: 22px 0 0; color: var(--muted); font-size: 15px; line-height: 1.75; text-wrap: pretty; }
        .promo-values { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-top: 1px solid var(--line-strong); border-bottom: 1px solid var(--line); }
        .promo-value { min-height: 176px; display: flex; flex-direction: column; justify-content: space-between; gap: 24px; padding: 24px 28px 27px 0; border-right: 1px solid var(--line); }
        .promo-value + .promo-value { padding-left: 28px; }
        .promo-value:last-child { border-right: 0; }
        .promo-value-index { color: var(--accent); font-family: ui-monospace, "SFMono-Regular", monospace; font-size: 11px; letter-spacing: 0.12em; font-variant-numeric: tabular-nums; }
        .promo-value strong { color: var(--ink); font-size: 22px; font-weight: 580; letter-spacing: -0.04em; }
        .promo-value p { max-width: 27ch; margin: 0; color: var(--muted); font-size: 14px; line-height: 1.65; }
        .promo-capability-heading { display: grid; gap: 18px; max-width: 760px; margin-bottom: 32px; }
        .promo-capability-heading .promo-section-intro { max-width: 58ch; margin: 0; }
        .promo-capability-matrix { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border-top: 1px solid var(--line); border-left: 1px solid var(--line); }
        .promo-capability { position: relative; min-height: 196px; display: grid; grid-template-columns: 58px minmax(0, 1fr); align-items: start; gap: 22px; padding: 24px 28px 26px; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); overflow: hidden; transition: border-color 240ms ease, transform 240ms cubic-bezier(0.2, 0.85, 0.2, 1), background 240ms ease; }
        .promo-capability::before { position: absolute; top: var(--spotlight-y, 50%); left: var(--spotlight-x, 50%); width: 240px; height: 240px; border-radius: 50%; background: radial-gradient(circle, rgba(130, 184, 255, 0.1), transparent 68%); content: ""; opacity: 0; pointer-events: none; transform: translate(-50%, -50%); transition: opacity 260ms ease; }
        .promo-capability:hover { border-color: rgba(130, 184, 255, 0.32); background: rgba(17, 32, 50, 0.58); transform: translateY(-4px); }
        .promo-capability:hover::before { opacity: 1; }
        .promo-capability:nth-child(2), .promo-capability:nth-child(3) { background: rgba(12, 22, 35, 0.44); }
        .promo-capability-mark { position: relative; width: 46px; height: 46px; display: grid; place-items: center; margin-top: 2px; border: 1px solid var(--line-strong); border-radius: 12px; color: var(--accent); background: rgba(130, 184, 255, 0.06); font-family: ui-monospace, "SFMono-Regular", monospace; font-size: 11px; font-weight: 700; letter-spacing: -0.08em; }
        .promo-capability h3 { position: relative; margin: 0; color: var(--ink); font-size: 25px; font-weight: 570; letter-spacing: -0.045em; }
        .promo-capability p { position: relative; max-width: 42ch; margin: 10px 0 0; color: var(--muted); font-size: 14px; line-height: 1.7; }
        .promo-scenarios { display: grid; grid-template-columns: minmax(280px, 0.76fr) minmax(0, 1.24fr); gap: clamp(36px, 6vw, 82px); align-items: start; }
        .promo-scenarios-copy { position: sticky; top: 112px; }
        .promo-scenarios-copy .promo-section-title { max-width: 11ch; }
        .promo-scenarios-copy p { max-width: 37ch; margin: 24px 0 0; color: var(--muted); font-size: 14px; line-height: 1.75; }
        .promo-scenario-list { margin: 0; padding: 0; border-top: 1px solid var(--line-strong); list-style: none; }
        .promo-scenario { display: grid; grid-template-columns: 44px minmax(132px, 0.42fr) minmax(0, 1fr); gap: 18px; align-items: start; padding: 22px 0 24px; border-bottom: 1px solid var(--line); }
        .promo-scenario-index { padding-top: 3px; color: var(--accent); font-family: ui-monospace, "SFMono-Regular", monospace; font-size: 11px; letter-spacing: 0.1em; font-variant-numeric: tabular-nums; }
        .promo-scenario strong { color: var(--ink); font-size: 19px; font-weight: 580; letter-spacing: -0.03em; }
        .promo-scenario p { max-width: 39ch; margin: 0; color: var(--muted); font-size: 13px; line-height: 1.7; }
        .promo-process-heading { max-width: 670px; margin-bottom: 30px; }
        .promo-timeline { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-top: 1px solid var(--line-strong); }
        .promo-step { position: relative; min-height: 188px; display: flex; flex-direction: column; justify-content: space-between; gap: 22px; padding: 22px 22px 24px 20px; border-right: 1px solid var(--line); }
        .promo-step:first-child { padding-left: 0; }
        .promo-step:last-child { border-right: 0; }
        .promo-step::before { position: absolute; top: -4px; left: 20px; width: 7px; height: 7px; border: 2px solid var(--bg); border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 1px var(--accent), 0 0 15px rgba(130, 184, 255, 0.54); content: ""; }
        .promo-step:first-child::before { left: 0; }
        .promo-step-index { color: var(--accent); font-family: ui-monospace, "SFMono-Regular", monospace; font-size: 11px; letter-spacing: 0.1em; font-variant-numeric: tabular-nums; }
        .promo-step strong { display: block; color: var(--ink); font-size: 20px; font-weight: 580; letter-spacing: -0.03em; }
        .promo-step p { max-width: 24ch; margin: 12px 0 0; color: var(--muted); font-size: 14px; line-height: 1.7; }
        .promo-trust-layout { display: grid; grid-template-columns: minmax(280px, 0.82fr) minmax(0, 1.18fr); gap: clamp(36px, 6vw, 82px); align-items: stretch; }
        .promo-trust-statement { position: relative; min-height: 294px; display: flex; flex-direction: column; justify-content: space-between; padding: 30px; border: 1px solid var(--line-strong); border-radius: var(--radius-outer); background: linear-gradient(145deg, rgba(27, 49, 76, 0.66), rgba(9, 18, 30, 0.7)); box-shadow: var(--shadow), inset 0 1px rgba(237, 246, 255, 0.08); overflow: hidden; }
        .promo-trust-statement::after { position: absolute; right: -12%; bottom: -24%; width: 70%; height: 78%; border: 1px solid rgba(130, 184, 255, 0.18); border-radius: 50%; box-shadow: 0 0 0 22px rgba(130, 184, 255, 0.022), 0 0 0 44px rgba(130, 184, 255, 0.018); content: ""; transform: rotate(-18deg); }
        .promo-trust-statement small { position: relative; z-index: 1; color: var(--accent); font-family: ui-monospace, "SFMono-Regular", monospace; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; }
        .promo-trust-statement h2 { position: relative; z-index: 1; max-width: 9ch; margin: 0; color: var(--ink); font-size: clamp(38px, 4.2vw, 56px); font-weight: 600; letter-spacing: -0.065em; line-height: 0.99; }
        .promo-trust-statement p { position: relative; z-index: 1; max-width: 32ch; margin: 0; color: var(--ink-soft); font-size: 14px; line-height: 1.7; }
        .promo-trust-list { margin: 0; padding: 0; border-top: 1px solid var(--line-strong); list-style: none; }
        .promo-trust-item { display: grid; grid-template-columns: 54px minmax(0, 1fr); gap: 22px; padding: 24px 0 27px; border-bottom: 1px solid var(--line); }
        .promo-trust-index { padding-top: 3px; color: var(--accent); font-family: ui-monospace, "SFMono-Regular", monospace; font-size: 11px; font-variant-numeric: tabular-nums; }
        .promo-trust-item strong { display: block; color: var(--ink); font-size: 20px; font-weight: 580; letter-spacing: -0.03em; }
        .promo-trust-item p { max-width: 47ch; margin: 10px 0 0; color: var(--muted); font-size: 14px; line-height: 1.72; }
        .promo-faq-layout { display: grid; grid-template-columns: minmax(270px, 0.75fr) minmax(0, 1.25fr); gap: clamp(36px, 6vw, 82px); align-items: start; }
        .promo-faq-heading { position: sticky; top: 112px; }
        .promo-faq-heading p { max-width: 34ch; margin: 24px 0 0; color: var(--muted); font-size: 14px; line-height: 1.75; }
        .promo-faq-list { border-top: 1px solid var(--line-strong); }
        .promo-faq-item { border-bottom: 1px solid var(--line); }
        .promo-faq-item summary { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 24px; min-height: 74px; padding: 20px 0; color: var(--ink); font-size: 17px; font-weight: 560; letter-spacing: -0.025em; cursor: pointer; list-style: none; }
        .promo-faq-item summary::-webkit-details-marker { display: none; }
        .promo-faq-item summary::after { flex: none; color: var(--accent); content: "+"; font-family: ui-monospace, monospace; font-size: 19px; font-weight: 400; transition: transform 220ms ease; }
        .promo-faq-item[open] summary::after { transform: rotate(45deg); }
        .promo-faq-item summary:focus-visible { outline: 3px solid rgba(130, 184, 255, 0.7); outline-offset: 6px; }
        .promo-faq-answer { max-width: 60ch; padding: 0 46px 24px 0; color: var(--muted); font-size: 14px; line-height: 1.75; }
        .promo-final { position: relative; overflow: hidden; display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(280px, 0.95fr); align-items: end; gap: clamp(36px, 6vw, 88px); margin-bottom: clamp(32px, 4vw, 56px); padding: clamp(36px, 4.5vw, 58px); border: 1px solid rgba(130, 184, 255, 0.25); border-radius: var(--radius-outer); background: radial-gradient(circle at 82% 28%, rgba(93, 151, 224, 0.18), transparent 33%), linear-gradient(140deg, rgba(18, 35, 56, 0.96), rgba(7, 14, 24, 0.96)); box-shadow: var(--shadow), inset 0 1px rgba(237, 247, 255, 0.07); }
        .promo-final::before { position: absolute; top: -16%; right: 23%; width: 1px; height: 132%; background: linear-gradient(transparent, rgba(130, 184, 255, 0.24), transparent); content: ""; transform: rotate(19deg); }
        .promo-final::after { position: absolute; top: 21%; right: -8%; width: 58%; height: 1px; background: linear-gradient(90deg, transparent, rgba(130, 184, 255, 0.18), transparent); box-shadow: 0 62px rgba(130, 184, 255, 0.11), 0 124px rgba(130, 184, 255, 0.06); content: ""; transform: rotate(-13deg); }
        .promo-final h2 { position: relative; z-index: 1; max-width: 10ch; margin: 0; color: var(--ink); font-size: clamp(42px, 5.2vw, 68px); font-weight: 600; letter-spacing: -0.07em; line-height: 1.06; text-wrap: balance; }
        .promo-final p { position: relative; z-index: 1; max-width: 45ch; margin: 22px 0 31px; color: var(--ink-soft); font-size: 15px; line-height: 1.72; }
        .promo-final-signal { position: relative; z-index: 1; display: grid; gap: 0; border-top: 1px solid var(--line); }
        .promo-final-signal span { display: grid; grid-template-columns: 65px minmax(0, 1fr); align-items: center; min-height: 66px; border-bottom: 1px solid var(--line); color: var(--ink-soft); font-size: 14px; }
        .promo-final-signal b { color: var(--accent); font-family: ui-monospace, "SFMono-Regular", monospace; font-size: 10px; font-weight: 600; letter-spacing: 0.1em; }
        .promo-footer { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 28px 0 34px; border-top: 1px solid var(--line); color: var(--faint); font-size: 12px; }
        .promo-footer-meta { display: flex; flex-wrap: wrap; gap: 9px 18px; }
        .promo-footer-nav { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px 18px; }
        .promo-footer-link { min-width: 44px; min-height: 40px; display: inline-flex; align-items: center; justify-content: center; padding: 0 2px; border: 0; color: var(--muted); background: transparent; font-size: 12px; cursor: pointer; transition: color 180ms ease, transform 180ms ease; }
        .promo-footer-link:hover { color: var(--ink); }
        .promo-footer-link:active { transform: scale(0.97); }
        .promo-mobile-entry { display: none; }
        :where(.promo-header-entry, .promo-entry-button, .promo-secondary-button, .promo-nav a, .promo-footer-link):focus-visible { outline: 3px solid rgba(130, 184, 255, 0.74); outline-offset: 4px; }
        .promo-motion-ready [data-promo-reveal] { opacity: 0; transform: translate3d(0, 24px, 0); clip-path: inset(0 0 16% 0); transition: opacity 560ms ease, transform 620ms cubic-bezier(0.18, 0.85, 0.2, 1), clip-path 620ms cubic-bezier(0.18, 0.85, 0.2, 1); }
        .promo-motion-ready [data-promo-reveal].is-visible { opacity: 1; transform: translate3d(0, 0, 0); clip-path: inset(0 0 0 0); }
        .promo-motion-ready .promo-capability:nth-child(2), .promo-motion-ready .promo-scenario:nth-child(2), .promo-motion-ready .promo-step:nth-child(2) { transition-delay: 80ms; }
        .promo-motion-ready .promo-capability:nth-child(3), .promo-motion-ready .promo-scenario:nth-child(3), .promo-motion-ready .promo-step:nth-child(3) { transition-delay: 130ms; }
        .promo-motion-ready .promo-capability:nth-child(4), .promo-motion-ready .promo-scenario:nth-child(4), .promo-motion-ready .promo-step:nth-child(4) { transition-delay: 180ms; }
        @media (max-width: 1040px) {
            .promo-header { grid-template-columns: auto minmax(0, 1fr) auto; gap: 18px; }
            .promo-nav { gap: 16px; }
            .promo-nav a { font-size: 11px; }
            .promo-hero { min-height: auto; grid-template-columns: 1fr; padding-top: 74px; }
            .promo-copy { max-width: 760px; }
            .promo-network { min-height: min(74vw, 650px); }
            .promo-capability-heading { display: block; }
            .promo-capability-heading .promo-section-intro { margin-top: 22px; }
            .promo-scenarios, .promo-trust-layout, .promo-faq-layout { grid-template-columns: 1fr; gap: 48px; }
            .promo-scenarios-copy, .promo-faq-heading { position: static; }
            .promo-scenarios-copy .promo-section-title { max-width: 14ch; }
        }
        @media (max-width: 720px) {
            .promo-shell { width: min(calc(100% - 32px), 1200px); }
            .promo-header { min-height: 64px; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; }
            .promo-nav { display: none; }
            .promo-brand { gap: 10px; }
            .promo-logo-mark { width: 30px; height: 30px; border-radius: 9px; font-size: 12px; }
            .promo-brand-name { font-size: 15px; }
            .promo-brand-type { font-size: 9px; letter-spacing: 0.04em; text-transform: none; }
            .promo-header-entry { min-height: 36px; padding-inline: 11px; font-size: 11px; }
            .promo-hero { gap: 10px; padding: 38px 0 44px; }
            .promo-eyebrow { margin-bottom: 21px; font-size: 9px; letter-spacing: 0.12em; }
            .promo-title { max-width: none; font-size: clamp(38px, 10.8vw, 43px); letter-spacing: -0.065em; line-height: 1.13; }
            .promo-description { margin-top: 22px; font-size: 15px; }
            .promo-actions { align-items: stretch; flex-direction: column; gap: 13px; margin-top: 29px; }
            .promo-entry-form, .promo-entry-button { width: 100%; }
            .promo-secondary-button { width: fit-content; }
            .promo-trust-line { align-items: flex-start; flex-direction: column; gap: 8px; margin-top: 23px; }
            .promo-network { min-height: 88vw; margin: 2px -9px 0; }
            .promo-network-core { width: 92px; height: 92px; font-size: 14px; }
            .promo-network-core::before { inset: 12px; }
            .promo-network-node { min-width: 112px; padding: 9px 10px; }
            .promo-network-node strong { font-size: 9px; }
            .promo-network-node small { font-size: 10px; }
            .promo-network-node-assistant { top: 11%; left: 1%; }
            .promo-network-node-coding { top: 16%; right: 0; }
            .promo-network-node-creative { bottom: 18%; left: 0; }
            .promo-network-node-api { right: 2%; bottom: 8%; }
            .promo-section { padding: 48px 0 56px; }
            .promo-section[id] { scroll-margin-top: 76px; }
            .promo-section--compact { padding: 40px 0 48px; }
            .promo-section-heading { margin-bottom: 28px; }
            .promo-section-title { max-width: 12ch; font-size: clamp(38px, 10.7vw, 44px); }
            .promo-section-intro { margin-top: 18px; font-size: 14px; }
            .promo-values { grid-template-columns: 1fr; }
            .promo-value, .promo-value + .promo-value { min-height: 0; gap: 12px; padding: 18px 0 20px; border-right: 0; border-bottom: 1px solid var(--line); }
            .promo-value:last-child { border-bottom: 0; }
            .promo-value strong { font-size: 21px; }
            .promo-value p { max-width: 38ch; }
            .promo-capability-heading { margin-bottom: 27px; }
            .promo-capability-matrix { grid-template-columns: 1fr; }
            .promo-capability { min-height: 0; grid-template-columns: 48px minmax(0, 1fr); gap: 14px; padding: 18px 16px 20px; }
            .promo-capability-mark { width: 42px; height: 42px; margin-top: 0; border-radius: 11px; }
            .promo-capability h3 { font-size: 21px; }
            .promo-capability p { margin-top: 8px; font-size: 13px; }
            .promo-scenarios { gap: 26px; }
            .promo-scenario { grid-template-columns: 36px 1fr; gap: 8px 15px; padding: 18px 0 20px; }
            .promo-scenario strong { font-size: 18px; }
            .promo-scenario p { grid-column: 2; }
            .promo-process-heading { margin-bottom: 28px; }
            .promo-timeline { display: block; border-top: 1px solid var(--line-strong); border-left: 1px solid var(--line-strong); }
            .promo-step, .promo-step:first-child { min-height: 0; display: grid; grid-template-columns: 34px minmax(0, 1fr); gap: 5px 12px; padding: 18px 0 20px 18px; border-right: 0; border-bottom: 1px solid var(--line); }
            .promo-step:last-child { border-bottom: 0; }
            .promo-step::before, .promo-step:first-child::before { top: 19px; left: -5px; }
            .promo-step-index { grid-row: 1 / span 2; }
            .promo-step p { grid-column: 2; max-width: none; margin-top: 2px; }
            .promo-trust-layout, .promo-faq-layout { gap: 26px; }
            .promo-trust-statement { min-height: 260px; padding: 24px 20px; border-radius: 18px; }
            .promo-trust-statement h2 { font-size: 36px; }
            .promo-trust-item { grid-template-columns: 41px minmax(0, 1fr); gap: 14px; padding: 18px 0 20px; }
            .promo-trust-item strong { font-size: 17px; }
            .promo-faq-item summary { min-height: 60px; font-size: 16px; }
            .promo-faq-answer { padding-right: 25px; padding-bottom: 20px; font-size: 13px; }
            .promo-final { display: block; margin-bottom: 44px; padding: 26px 20px; border-radius: 18px; }
            .promo-final h2 { max-width: 11ch; font-size: clamp(38px, 10.4vw, 43px); }
            .promo-final p { margin: 18px 0 26px; font-size: 13px; }
            .promo-final-signal { margin-top: 38px; }
            .promo-final-signal span { grid-template-columns: 58px minmax(0, 1fr); min-height: 58px; }
            .promo-footer { align-items: flex-start; flex-direction: column; gap: 16px; padding: 24px 0 30px; }
            .promo-footer-nav { justify-content: flex-start; }
            .promo-mobile-entry { position: fixed; z-index: 60; right: 15px; bottom: 15px; left: 15px; display: block; padding: 7px; border: 1px solid rgba(130, 184, 255, 0.3); border-radius: 14px; background: rgba(6, 13, 22, 0.88); box-shadow: 0 18px 48px rgba(1, 7, 16, 0.46), inset 0 1px rgba(237, 247, 255, 0.08); backdrop-filter: blur(18px) saturate(120%); transition: opacity 240ms ease, transform 240ms ease; }
            .promo-mobile-entry .promo-entry-button { width: 100%; min-height: 47px; }
            .promo-mobile-entry.is-hidden { opacity: 0; pointer-events: none; transform: translateY(120%); }
        }
        @media (max-width: 350px) {
            .promo-title { font-size: 34px; }
        }
        @media (prefers-reduced-motion: reduce) {
            html { scroll-behavior: auto; }
            *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
            .promo-network { transform: none; }
            .promo-motion-ready [data-promo-reveal] { opacity: 1; transform: none; clip-path: none; }
        }
    </style>
</head>
<body>
    <a class="promo-skip-link" href="#promo-main">{{promo.skipToContent}}</a>
    <div class="promo-page" data-promo-page>
        <header class="promo-header promo-shell" data-promo-header>
            <a class="promo-brand" href="#promo-main" aria-label="Damatong">
                <span class="promo-logo-mark" aria-hidden="true">D/</span>
                <span class="promo-brand-copy"><span class="promo-brand-name">Damatong</span><span class="promo-brand-type">{{promo.brandType}}</span></span>
            </a>
            <nav class="promo-nav" aria-label="{{promo.navigation}}">
                <a href="#services">{{promo.navServices}}</a>
                <a href="#scenarios">{{promo.navScenarios}}</a>
                <a href="#process">{{promo.navProcess}}</a>
                <a href="#faq">{{promo.navFaq}}</a>
            </nav>
            <form class="promo-header-entry-form" data-store-entry><button class="promo-header-entry" type="submit">{{promo.viewServices}}</button></form>
        </header>

        <main id="promo-main">
            <section class="promo-hero promo-shell">
                <div class="promo-copy" data-promo-reveal>
                    <p class="promo-eyebrow">{{promo.heroEyebrow}}</p>
                    <h1 class="promo-title"><span class="promo-title-line">{{promo.heroLead}} <span class="promo-title-highlight">{{promo.heroHighlight}}</span></span><span class="promo-title-line">{{promo.heroTail}}</span></h1>
                    <p class="promo-description">{{promo.heroDescription}}</p>
                    <div class="promo-actions">
                        <form class="promo-entry-form" data-store-entry><button class="promo-entry-button" type="submit">{{promo.viewServices}}</button></form>
                        <a class="promo-secondary-button" href="#process">{{promo.learnService}}</a>
                    </div>
                    <p class="promo-trust-line"><span>{{promo.trustClear}}</span><span>{{promo.trustScenarios}}</span><span>{{promo.trustSupport}}</span></p>
                </div>
                <div class="promo-network" data-promo-signal-stage data-promo-reveal role="img" aria-label="{{promo.networkAria}}">
                    <canvas class="promo-network-canvas" data-promo-signal-canvas></canvas>
                    <div class="promo-network-core">Damatong</div>
                    <span class="promo-network-node promo-network-node-assistant"><strong>{{promo.networkAssistant}}</strong><small>{{promo.networkAssistantDescription}}</small></span>
                    <span class="promo-network-node promo-network-node-coding"><strong>{{promo.networkCoding}}</strong><small>{{promo.networkCodingDescription}}</small></span>
                    <span class="promo-network-node promo-network-node-creative"><strong>{{promo.networkCreative}}</strong><small>{{promo.networkCreativeDescription}}</small></span>
                    <span class="promo-network-node promo-network-node-api"><strong>{{promo.networkApi}}</strong><small>{{promo.networkApiDescription}}</small></span>
                </div>
            </section>

            <section class="promo-section promo-section--compact promo-shell" id="values">
                <div class="promo-section-heading" data-promo-reveal>
                    <h2 class="promo-section-title">{{promo.valuesTitle}}</h2>
                    <p class="promo-section-intro">{{promo.valuesIntro}}</p>
                </div>
                <div class="promo-values" data-promo-reveal>
                    <article class="promo-value"><span class="promo-value-index">{{promo.valueDiscoverLabel}}</span><strong>{{promo.valueDiscoverTitle}}</strong><p>{{promo.valueDiscoverDescription}}</p></article>
                    <article class="promo-value"><span class="promo-value-index">{{promo.valueUnderstandLabel}}</span><strong>{{promo.valueUnderstandTitle}}</strong><p>{{promo.valueUnderstandDescription}}</p></article>
                    <article class="promo-value"><span class="promo-value-index">{{promo.valueSupportLabel}}</span><strong>{{promo.valueSupportTitle}}</strong><p>{{promo.valueSupportDescription}}</p></article>
                </div>
            </section>

            <section class="promo-section promo-shell" id="services">
                <div class="promo-capability-heading" data-promo-reveal>
                    <div><p class="promo-section-label">{{promo.servicesLabel}}</p><h2 class="promo-section-title">{{promo.servicesTitle}}</h2></div>
                    <p class="promo-section-intro">{{promo.servicesIntro}}</p>
                </div>
                <div class="promo-capability-matrix">
                    <article class="promo-capability" data-promo-surface data-promo-reveal><span class="promo-capability-mark" aria-hidden="true">{{promo.capabilitySubscriptionMark}}</span><div><h3>{{promo.capabilitySubscriptionTitle}}</h3><p>{{promo.capabilitySubscriptionDescription}}</p></div></article>
                    <article class="promo-capability" data-promo-surface data-promo-reveal><span class="promo-capability-mark" aria-hidden="true">{{promo.capabilityApiMark}}</span><div><h3>{{promo.capabilityApiTitle}}</h3><p>{{promo.capabilityApiDescription}}</p></div></article>
                    <article class="promo-capability" data-promo-surface data-promo-reveal><span class="promo-capability-mark" aria-hidden="true">{{promo.capabilityTokenMark}}</span><div><h3>{{promo.capabilityTokenTitle}}</h3><p>{{promo.capabilityTokenDescription}}</p></div></article>
                    <article class="promo-capability" data-promo-surface data-promo-reveal><span class="promo-capability-mark" aria-hidden="true">{{promo.capabilityToolsMark}}</span><div><h3>{{promo.capabilityToolsTitle}}</h3><p>{{promo.capabilityToolsDescription}}</p></div></article>
                </div>
            </section>

            <section class="promo-section promo-shell" id="scenarios">
                <div class="promo-scenarios">
                    <div class="promo-scenarios-copy" data-promo-reveal><h2 class="promo-section-title">{{promo.scenariosTitle}}</h2><p>{{promo.scenariosIntro}}</p></div>
                    <ol class="promo-scenario-list" data-promo-reveal>
                        <li class="promo-scenario"><span class="promo-scenario-index">01</span><strong>{{promo.scenarioPersonalTitle}}</strong><p>{{promo.scenarioPersonalDescription}}</p></li>
                        <li class="promo-scenario"><span class="promo-scenario-index">02</span><strong>{{promo.scenarioCreatorTitle}}</strong><p>{{promo.scenarioCreatorDescription}}</p></li>
                        <li class="promo-scenario"><span class="promo-scenario-index">03</span><strong>{{promo.scenarioDeveloperTitle}}</strong><p>{{promo.scenarioDeveloperDescription}}</p></li>
                        <li class="promo-scenario"><span class="promo-scenario-index">04</span><strong>{{promo.scenarioTeamTitle}}</strong><p>{{promo.scenarioTeamDescription}}</p></li>
                    </ol>
                </div>
            </section>

            <section class="promo-section promo-shell" id="process">
                <div class="promo-process-heading" data-promo-reveal><h2 class="promo-section-title">{{promo.processTitle}}</h2><p class="promo-section-intro">{{promo.processIntro}}</p></div>
                <ol class="promo-timeline" data-promo-reveal>
                    <li class="promo-step"><span class="promo-step-index">01</span><div><strong>{{promo.processStepOneTitle}}</strong><p>{{promo.processStepOneDescription}}</p></div></li>
                    <li class="promo-step"><span class="promo-step-index">02</span><div><strong>{{promo.processStepTwoTitle}}</strong><p>{{promo.processStepTwoDescription}}</p></div></li>
                    <li class="promo-step"><span class="promo-step-index">03</span><div><strong>{{promo.processStepThreeTitle}}</strong><p>{{promo.processStepThreeDescription}}</p></div></li>
                    <li class="promo-step"><span class="promo-step-index">04</span><div><strong>{{promo.processStepFourTitle}}</strong><p>{{promo.processStepFourDescription}}</p></div></li>
                </ol>
            </section>

            <section class="promo-section promo-section--compact promo-shell" id="trust">
                <div class="promo-trust-layout">
                    <article class="promo-trust-statement" data-promo-surface data-promo-reveal><small>{{promo.trustLabel}}</small><h2>{{promo.trustTitle}}</h2><p>{{promo.trustIntro}}</p></article>
                    <ul class="promo-trust-list" data-promo-reveal>
                        <li class="promo-trust-item"><span class="promo-trust-index">01</span><div><strong>{{promo.trustOneTitle}}</strong><p>{{promo.trustOneDescription}}</p></div></li>
                        <li class="promo-trust-item"><span class="promo-trust-index">02</span><div><strong>{{promo.trustTwoTitle}}</strong><p>{{promo.trustTwoDescription}}</p></div></li>
                        <li class="promo-trust-item"><span class="promo-trust-index">03</span><div><strong>{{promo.trustThreeTitle}}</strong><p>{{promo.trustThreeDescription}}</p></div></li>
                    </ul>
                </div>
            </section>

            <section class="promo-section promo-section--compact promo-shell" id="faq">
                <div class="promo-faq-layout">
                    <div class="promo-faq-heading" data-promo-reveal><h2 class="promo-section-title">{{promo.faqTitle}}</h2><p>{{promo.faqIntro}}</p></div>
                    <div class="promo-faq-list" data-promo-reveal>
                        <details class="promo-faq-item" open><summary>{{promo.faqOneQuestion}}</summary><div class="promo-faq-answer">{{promo.faqOneAnswer}}</div></details>
                        <details class="promo-faq-item"><summary>{{promo.faqTwoQuestion}}</summary><div class="promo-faq-answer">{{promo.faqTwoAnswer}}</div></details>
                        <details class="promo-faq-item"><summary>{{promo.faqThreeQuestion}}</summary><div class="promo-faq-answer">{{promo.faqThreeAnswer}}</div></details>
                        <details class="promo-faq-item"><summary>{{promo.faqFourQuestion}}</summary><div class="promo-faq-answer">{{promo.faqFourAnswer}}</div></details>
                        <details class="promo-faq-item"><summary>{{promo.faqFiveQuestion}}</summary><div class="promo-faq-answer">{{promo.faqFiveAnswer}}</div></details>
                    </div>
                </div>
            </section>

            <section class="promo-final promo-shell" data-promo-reveal>
                <div><p class="promo-section-label">{{promo.finalLabel}}</p><h2>{{promo.finalTitle}}</h2><p>{{promo.finalIntro}}</p><form class="promo-entry-form" data-store-entry><button class="promo-entry-button" type="submit">{{promo.viewServices}}</button></form></div>
                <div class="promo-final-signal" aria-label="{{promo.finalSignalAria}}"><span><b>{{promo.finalDiscoverLabel}}</b>{{promo.finalDiscoverDescription}}</span><span><b>{{promo.finalChooseLabel}}</b>{{promo.finalChooseDescription}}</span><span><b>{{promo.finalSupportLabel}}</b>{{promo.finalSupportDescription}}</span></div>
            </section>
        </main>

        <div class="promo-mobile-entry" data-promo-mobile-entry aria-label="{{promo.mobileEntryAria}}"><form class="promo-entry-form" data-store-entry><button class="promo-entry-button" type="submit">{{promo.mobileEntry}}</button></form></div>

        <footer class="promo-footer promo-shell" data-promo-footer>
            <div class="promo-footer-meta"><span>{{promo.footerType}}</span><span>© <span data-bind-text="store.currentYear"></span></span></div>
            <nav class="promo-footer-nav" aria-label="{{promo.footerNavigation}}">
                <form class="promo-footer-form" data-store-entry data-store-entry-target="privacy"><button class="promo-footer-link" type="submit">{{promo.privacy}}</button></form>
                <form class="promo-footer-form" data-store-entry data-store-entry-target="terms"><button class="promo-footer-link" type="submit">{{promo.terms}}</button></form>
                <form class="promo-footer-form" data-store-entry data-store-entry-target="support"><button class="promo-footer-link" type="submit">{{promo.support}}</button></form>
            </nav>
        </footer>
    </div>
</body>
</html>`;
