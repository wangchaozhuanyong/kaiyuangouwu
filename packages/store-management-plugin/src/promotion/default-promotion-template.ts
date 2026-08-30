/* eslint-disable max-len -- Keep the embedded Silver Mist promotion HTML and CSS readable as source. */

export const DEFAULT_PROMOTION_TEMPLATE_VERSION = 25;

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
    <meta name="theme-color" content="#0a0c0e">
    <title>{{promo.metaTitle}}</title>
    <style>
        :root { color-scheme:dark; --black:#090b0d; --black-soft:#0d1013; --panel:#111519; --panel-soft:#171b1f; --white:#f4f2ed; --white-soft:#c7c7c3; --muted:#92969a; --faint:#858a8f; --silver:#b7bcc0; --amber:#efa83f; --amber-bright:#ffc65f; --amber-ink:#191006; --line:rgba(214,216,216,.15); --line-strong:rgba(239,168,63,.58); --promo-focus-color:#ffc65f; --shell:min(1200px,calc(100% - 48px)); --section-top:clamp(76px,6.4vw,108px); --section-bottom:clamp(56px,4.8vw,82px); --ease:cubic-bezier(.16,1,.3,1); }
        * { box-sizing:border-box; }
        html { overflow-x:hidden; overflow-x:clip; scroll-behavior:smooth; scroll-padding-top:92px; background:var(--black); }
        body { min-height:100dvh; margin:0; overflow-x:hidden; overflow-x:clip; color:var(--white); background:var(--black); font-family:"Avenir Next",Avenir,"Helvetica Neue",Helvetica,"PingFang SC","Microsoft YaHei",sans-serif; -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility; }
        ::selection { color:var(--amber-ink); background:var(--amber-bright); }
        button,a { font:inherit; } button { -webkit-tap-highlight-color:transparent; } a { color:inherit; text-underline-offset:4px; } :focus-visible { outline:2px solid var(--amber-bright); outline-offset:4px; }
        .promo-skip-link { position:fixed; z-index:100; top:12px; left:12px; padding:11px 15px; color:var(--amber-ink); background:var(--amber-bright); font-size:13px; font-weight:750; text-decoration:none; transform:translateY(-170%); transition:transform 180ms ease; }
        .promo-skip-link:focus { transform:none; }
        .promo-sr-only { position:absolute; width:1px; height:1px; padding:0; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
        .promo-page { position:relative; min-height:100dvh; isolation:isolate; background:var(--black); }
        .promo-shell { width:var(--shell); margin-inline:auto; }
        .promo-header-wrap { position:sticky; z-index:60; top:0; height:72px; }
        .promo-header { width:100%; height:72px; border-bottom:1px solid rgba(214,216,216,.1); background:rgba(9,11,13,.76); -webkit-backdrop-filter:blur(18px) saturate(78%); backdrop-filter:blur(18px) saturate(78%); transition:background 300ms ease,border-color 300ms ease,box-shadow 300ms ease; }
        .promo-header.is-scrolled { border-color:var(--line); background:rgba(9,11,13,.95); box-shadow:0 18px 58px rgba(0,0,0,.28); -webkit-backdrop-filter:blur(26px) saturate(72%); backdrop-filter:blur(26px) saturate(72%); }
        .promo-header-inner { width:var(--shell); height:100%; display:grid; grid-template-columns:auto minmax(0,1fr) auto; align-items:center; gap:30px; margin-inline:auto; }
        .promo-brand { display:inline-flex; align-items:center; gap:11px; color:var(--white); text-decoration:none; }
        .promo-brand-mark { width:36px; height:36px; display:block; object-fit:contain; filter:brightness(1.34) saturate(1.12); }
        .promo-brand-name { font-size:16px; font-weight:720; letter-spacing:-.02em; }
        .promo-nav { display:flex; justify-content:center; gap:clamp(22px,3vw,42px); }
        .promo-nav a { position:relative; padding:10px 0; color:var(--muted); font-size:13px; font-weight:560; text-decoration:none; transition:color 200ms ease; }
        .promo-nav a::after { position:absolute; right:0; bottom:3px; left:0; height:1px; background:var(--amber); content:""; opacity:0; transform:scaleX(.2); transform-origin:left; transition:opacity 220ms ease,transform 240ms var(--ease); }
        .promo-nav a:hover,.promo-nav a:focus-visible,.promo-nav a.is-active { color:var(--white); }
        .promo-nav a:hover::after,.promo-nav a:focus-visible::after,.promo-nav a.is-active::after { opacity:1; transform:scaleX(1); }
        .promo-entry-form,.promo-header-entry-form,.promo-footer-form { margin:0; }
        .promo-header-entry,.promo-entry-button { min-height:48px; display:inline-flex; align-items:center; justify-content:center; padding:0 22px; border:1px solid var(--line-strong); border-radius:4px; color:var(--amber-bright); background:rgba(16,17,18,.76); box-shadow:inset 0 1px rgba(255,255,255,.04); font-size:13px; font-weight:700; cursor:pointer; transition:transform 240ms var(--ease),color 220ms ease,border-color 220ms ease,background 220ms ease,box-shadow 220ms ease; }
        .promo-header-entry:hover,.promo-entry-button:hover { color:var(--amber-ink); border-color:var(--amber-bright); background:var(--amber-bright); box-shadow:0 16px 44px rgba(242,167,75,.18); transform:translateY(-2px); }
        .promo-header-entry:active,.promo-entry-button:active { transform:scale(.985); }
        .promo-header-entry { min-height:42px; padding-inline:18px; font-size:12px; }
        .promo-hero { position:relative; min-height:680px; overflow:hidden; border-bottom:1px solid var(--line); background:#0a0c0e; }
        .promo-hero-art { position:absolute; z-index:0; inset:0; display:block; pointer-events:none; }
        .promo-hero-art img { width:100%; height:100%; display:block; object-fit:cover; object-position:center; }
        .promo-hero-inner { position:relative; z-index:2; min-height:680px; display:grid; align-items:center; padding:64px 0 30px; }
        .promo-hero-content { width:min(100%,780px); margin-inline:auto; text-align:center; }
        .promo-brand-line { display:flex; align-items:center; justify-content:center; gap:14px; margin:0 0 22px; color:var(--white-soft); font-size:11px; font-weight:620; letter-spacing:.15em; }
        .promo-brand-line::before,.promo-brand-line::after { width:26px; height:1px; background:var(--amber); content:""; }
        .promo-title { max-width:12ch; margin:0 auto; color:var(--white); font-size:clamp(56px,5.5vw,72px); font-weight:520; letter-spacing:-.038em; line-height:1.04; text-wrap:balance; }
        .promo-title-line { display:block; }
        .promo-title-highlight { color:var(--white); font-weight:590; }
        .promo-title-line:empty { display:none; }
        html[lang="en"] .promo-title { max-width:13ch; font-size:clamp(50px,4.9vw,66px); }
        .promo-hero-stage { display:grid; min-height:154px; align-items:center; margin-top:26px; }
        .promo-slide { grid-area:1/1; visibility:hidden; opacity:0; pointer-events:none; transform:translateY(10px) scale(.985); transition:opacity 360ms ease,transform 460ms var(--ease),visibility 0s linear 460ms; }
        .promo-slide.is-active { visibility:visible; opacity:1; pointer-events:auto; transform:none; transition-delay:0s; }
        .promo-slide-title { display:table; margin:0 auto; padding:0 0 8px; border-bottom:2px solid var(--amber-bright); color:var(--amber-bright); font-size:clamp(19px,1.8vw,24px); font-weight:650; letter-spacing:.02em; }
        .promo-slide-accent { margin:16px 0 0; color:var(--white-soft); font-size:clamp(20px,2vw,28px); font-weight:560; letter-spacing:-.02em; }
        .promo-description { max-width:48ch; margin:14px auto 0; color:var(--muted); font-size:clamp(14px,1.12vw,16px); line-height:1.72; text-wrap:pretty; }
        .promo-actions { display:flex; flex-direction:column; align-items:center; gap:12px; margin-top:22px; }
        .promo-actions .promo-entry-form { width:min(100%,360px); }
        .promo-actions .promo-entry-button { width:100%; min-height:56px; color:var(--amber-ink); border-color:var(--amber-bright); background:var(--amber-bright); box-shadow:0 18px 52px rgba(239,168,63,.16),inset 0 1px rgba(255,255,255,.42); font-size:14px; }
        .promo-actions .promo-entry-button:hover { color:var(--amber-ink); background:#ffd47d; }
        .promo-secondary-button { min-height:44px; display:inline-flex; align-items:center; justify-content:center; padding:0 2px; border:0; border-bottom:1px solid rgba(239,168,63,.72); border-radius:0; color:var(--white-soft); background:transparent; font-size:14px; font-weight:600; text-decoration:none; transition:color 200ms ease,border-color 200ms ease,transform 220ms var(--ease); }
        .promo-secondary-button::after { margin-left:14px; color:var(--amber-bright); content:"→"; }
        .promo-secondary-button:hover { color:var(--white); border-color:var(--amber-bright); transform:translateX(3px); }
        .promo-entry-note { max-width:48ch; margin:0; color:var(--faint); font-size:11px; line-height:1.55; }
        .promo-carousel-controls { width:min(100%,760px); margin:40px auto 0; }
        .promo-carousel-nav { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); overflow:hidden; border:1px solid rgba(214,216,216,.16); border-radius:5px; background:rgba(12,14,16,.82); box-shadow:inset 0 1px rgba(255,255,255,.025); }
        .promo-slide-button { min-height:58px; display:grid; place-items:center; padding:0 18px; border:0; color:var(--faint); background:transparent; text-align:center; cursor:pointer; transition:color 220ms ease,background 220ms ease,box-shadow 300ms var(--ease); }
        .promo-slide-button+.promo-slide-button { border-left:1px solid var(--line); }
        .promo-slide-button:hover,.promo-slide-button:focus-visible { color:var(--white); background:rgba(242,167,75,.035); }
        .promo-slide-button.is-active { color:var(--amber-bright); background:rgba(239,168,63,.045); box-shadow:inset 0 -3px var(--amber-bright); }
        .promo-slide-control-label { font-size:11px; font-weight:650; letter-spacing:.04em; white-space:nowrap; }
        .promo-section { position:relative; isolation:isolate; padding:var(--section-top) 0 var(--section-bottom); background:radial-gradient(circle at 88% -10%,rgba(190,196,201,.075),transparent 31%),linear-gradient(180deg,#111519 0%,#0d1013 100%); }
        .promo-section::before { position:absolute; z-index:0; inset:0; border-top:1px solid rgba(235,224,206,.045); background:linear-gradient(112deg,transparent 0 66%,rgba(255,255,255,.018) 66.1%,transparent 78%); content:""; pointer-events:none; }
        .promo-section>.promo-shell { position:relative; z-index:1; }
        .promo-kicker { display:flex; align-items:center; gap:13px; margin:0 0 24px; color:var(--muted); font-size:11px; font-weight:650; letter-spacing:.14em; }
        .promo-kicker::before { width:24px; height:2px; background:var(--amber); content:""; }
        .promo-section-title { max-width:13ch; margin:0; color:var(--white); font-size:clamp(42px,5vw,62px); font-weight:500; letter-spacing:-.03em; line-height:1.06; text-wrap:balance; }
        .promo-section-intro { max-width:60ch; margin:24px 0 0; color:var(--muted); font-size:15px; line-height:1.76; text-wrap:pretty; }
        .promo-services { padding-top:44px; background:#111316; background-image:linear-gradient(90deg,#111316 0%,rgba(17,19,22,.99) 58%,rgba(17,19,22,.78) 100%),url("/storefront/promo/damatong-silver-stage-v23.webp"); background-position:center,right -80px top; background-size:100% 100%,760px auto; background-repeat:no-repeat; }
        .promo-services-layout { position:relative; z-index:1; display:grid; grid-template-columns:minmax(280px,.78fr) minmax(0,1.22fr); gap:clamp(58px,9vw,124px); align-items:start; }
        .promo-services-copy { position:sticky; top:116px; }
        .promo-capability-channels { border-top:1px solid var(--line-strong); }
        .promo-capability { position:relative; min-height:170px; display:grid; grid-template-columns:58px minmax(190px,.52fr) minmax(0,.48fr); align-items:center; gap:clamp(22px,3.5vw,48px); padding:30px 0; border-bottom:1px solid var(--line); overflow:hidden; transition:transform 300ms var(--ease),border-color 240ms ease,background 240ms ease; }
        .promo-capability::after { position:absolute; right:0; bottom:-1px; left:0; height:1px; background:var(--amber); content:""; transform:scaleX(0); transform-origin:left; transition:transform 420ms var(--ease); }
        .promo-capability:hover { border-color:rgba(242,167,75,.32); background:rgba(242,167,75,.026); transform:translateX(4px); }
        .promo-capability:hover::after { transform:scaleX(1); }
        .promo-capability-number { color:var(--amber); font-size:11px; font-weight:720; letter-spacing:.16em; }
        .promo-capability h3 { margin:0; color:var(--white); font-size:clamp(23px,2.2vw,30px); font-weight:550; letter-spacing:-.025em; }
        .promo-capability p { max-width:42ch; margin:0; color:var(--muted); font-size:14px; line-height:1.72; }
        .promo-scenarios { overflow:hidden; background:radial-gradient(circle at 82% 16%,rgba(239,168,63,.09),transparent 31%),linear-gradient(135deg,#0b0e11 0%,#15120f 58%,#0a0d10 100%); }
        .promo-scenarios::after { position:absolute; inset:0; background:linear-gradient(90deg,rgba(255,255,255,.018) 1px,transparent 1px) 0 0/12.5% 100%; opacity:.28; content:""; pointer-events:none; }
        .promo-scenario-layout { position:relative; z-index:1; }
        .promo-scenario-copy { display:grid; grid-template-columns:minmax(0,.9fr) minmax(320px,.72fr); align-items:end; gap:64px; margin-bottom:64px; }
        .promo-scenario-copy .promo-section-intro { margin:0; }
        .promo-theater { display:grid; grid-template-columns:repeat(12,minmax(0,1fr)); gap:1px; padding:1px; border-top:1px solid var(--line-strong); background:var(--line); }
        .promo-scene { min-height:220px; display:grid; align-content:end; gap:14px; padding:42px; background:rgba(12,15,18,.9); transition:background 260ms ease,transform 300ms var(--ease); }
        .promo-scene:nth-child(1) { grid-column:1 / 8; }
        .promo-scene:nth-child(2) { grid-column:8 / 13; }
        .promo-scene:nth-child(3) { grid-column:1 / 6; }
        .promo-scene:nth-child(4) { grid-column:6 / 13; }
        .promo-scene:hover,.promo-scene.is-scene-active { background:rgba(25,20,14,.72); transform:translateY(-4px); }
        .promo-scene strong { color:var(--white); font-size:24px; font-weight:550; letter-spacing:-.02em; }
        .promo-scene p { max-width:42ch; margin:0; color:var(--muted); font-size:14px; line-height:1.72; }
        .promo-process { background:radial-gradient(circle at 18% 18%,rgba(183,188,192,.07),transparent 30%),linear-gradient(180deg,#101316 0%,#0b0e11 100%); }
        .promo-process-heading { display:grid; grid-template-columns:minmax(0,.86fr) minmax(320px,.72fr); align-items:end; gap:64px; margin-bottom:72px; }
        .promo-process-heading .promo-section-intro { margin:0; }
        .promo-process-path { position:relative; display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); margin:0; padding:0; list-style:none; }
        .promo-process-path::before { position:absolute; top:7px; right:0; left:0; height:1px; background:linear-gradient(90deg,var(--amber),rgba(239,168,63,.5) 52%,rgba(214,216,216,.18)); content:""; }
        .promo-step { position:relative; min-height:220px; padding:43px clamp(24px,3vw,38px) 0 0; }
        .promo-step::before { position:absolute; top:2px; left:0; width:11px; height:11px; border:2px solid var(--amber-bright); border-radius:50%; background:#111316; box-shadow:0 0 0 6px rgba(239,168,63,.07); content:""; }
        .promo-step+.promo-step { padding-left:clamp(24px,3vw,38px); }
        .promo-step+.promo-step::before { left:clamp(24px,3vw,38px); }
        .promo-step strong { display:block; color:var(--white); font-size:21px; font-weight:560; letter-spacing:-.02em; }
        .promo-step p { max-width:26ch; margin:14px 0 0; color:var(--muted); font-size:14px; line-height:1.7; }
        .promo-trust-section { padding-bottom:48px; background:radial-gradient(circle at 80% 20%,rgba(190,196,201,.1),transparent 34%),linear-gradient(145deg,#111417 0%,#0b0e11 72%); }
        .promo-trust-panel { position:relative; display:grid; grid-template-columns:minmax(270px,.82fr) minmax(0,1.18fr); gap:clamp(52px,8vw,108px); padding:clamp(46px,6vw,78px); border:1px solid rgba(242,167,75,.34); background:rgba(15,17,19,.94); box-shadow:0 30px 90px rgba(0,0,0,.26); overflow:hidden; }
        .promo-trust-panel::before { position:absolute; top:0; right:0; width:34%; height:2px; background:var(--amber); content:""; }
        .promo-trust-panel h2 { max-width:9ch; margin:0; color:var(--white); font-size:clamp(40px,4.5vw,58px); font-weight:500; letter-spacing:-.03em; line-height:1.08; }
        .promo-trust-panel>div>p { max-width:38ch; margin:22px 0 0; color:var(--white-soft); font-size:14px; line-height:1.74; }
        .promo-trust-list { display:grid; align-content:center; margin:0; padding:0; list-style:none; }
        .promo-trust-item { display:grid; grid-template-columns:14px minmax(0,1fr); gap:18px; padding:23px 0; border-bottom:1px solid var(--line); }
        .promo-trust-item:last-child { border-bottom:0; }
        .promo-trust-mark { width:9px; height:9px; margin-top:7px; border:1px solid var(--amber-bright); transform:rotate(45deg); box-shadow:0 0 18px rgba(239,168,63,.24); }
        .promo-trust-item strong { color:var(--white); font-size:18px; font-weight:560; }
        .promo-trust-item p { max-width:46ch; margin:9px 0 0; color:var(--muted); font-size:13px; line-height:1.68; }
        #faq { background:radial-gradient(circle at 12% 18%,rgba(183,188,192,.055),transparent 28%),linear-gradient(180deg,#0c0f12 0%,#0a0d10 100%); }
        .promo-faq-layout { display:grid; grid-template-columns:minmax(250px,.68fr) minmax(0,1.32fr); gap:clamp(60px,10vw,130px); align-items:start; }
        .promo-faq-heading { position:sticky; top:118px; }
        .promo-faq-list { border-top:1px solid var(--line-strong); }
        .promo-faq-item { border-bottom:1px solid var(--line); }
        .promo-faq-item summary { position:relative; min-height:88px; display:flex; align-items:center; padding:24px 54px 24px 0; color:var(--white); font-size:17px; font-weight:550; line-height:1.45; cursor:pointer; list-style:none; transition:color 220ms ease,box-shadow 220ms ease; }
        .promo-faq-item summary::-webkit-details-marker { display:none; }
        .promo-faq-item summary:focus-visible { outline:0; color:var(--amber-bright); box-shadow:inset 2px 0 var(--amber); }
        .promo-faq-item summary::before,.promo-faq-item summary::after { position:absolute; top:50%; right:8px; width:18px; height:1px; background:var(--amber); content:""; transition:transform 260ms var(--ease); }
        .promo-faq-item summary::after { transform:rotate(90deg); }
        .promo-faq-item[open] summary::after { transform:rotate(0); }
        .promo-faq-item.is-faq-closing summary::after { transform:rotate(90deg); }
        .promo-faq-answer { max-width:62ch; padding:0 52px 26px 0; color:var(--muted); font-size:14px; line-height:1.75; }
        .promo-final { position:relative; min-height:560px; display:grid; align-items:center; overflow:hidden; border:1px solid var(--line); background:#090b0d url("/storefront/promo/damatong-silver-stage-v23.webp") center center/cover no-repeat; }
        .promo-final::before { position:absolute; inset:0; background:rgba(7,9,11,.74); content:""; }
        .promo-final-inner { position:relative; z-index:1; max-width:660px; padding:clamp(46px,7vw,86px); }
        .promo-final h2 { max-width:10ch; margin:0; color:var(--white); font-size:clamp(48px,5.8vw,72px); font-weight:500; letter-spacing:-.035em; line-height:1.04; }
        .promo-final p { max-width:46ch; margin:25px 0 34px; color:var(--white-soft); font-size:15px; line-height:1.72; }
        .promo-final .promo-entry-button { min-width:210px; color:var(--amber-ink); border-color:var(--amber-bright); background:var(--amber-bright); box-shadow:0 18px 52px rgba(242,167,75,.18),inset 0 1px rgba(255,255,255,.38); }
        #faq { padding-top:64px; }
        .promo-footer { min-height:150px; display:flex; align-items:center; justify-content:space-between; gap:32px; color:var(--faint); font-size:12px; }
        .promo-footer-meta,.promo-footer-nav { display:flex; align-items:center; gap:24px; }
        .promo-footer-link { min-height:44px; padding:0; border:0; color:var(--muted); background:transparent; font-size:12px; cursor:pointer; transition:color 180ms ease; }
        .promo-footer-link:hover { color:var(--amber-bright); }
        .promo-mobile-entry { position:fixed; z-index:70; right:14px; bottom:max(14px,env(safe-area-inset-bottom)); left:14px; display:none; padding:7px; border:1px solid rgba(242,167,75,.38); background:rgba(8,10,12,.92); box-shadow:0 16px 48px rgba(0,0,0,.44); -webkit-backdrop-filter:blur(18px); backdrop-filter:blur(18px); opacity:0; pointer-events:none; transform:translateY(120%); transition:opacity 260ms ease,transform 320ms var(--ease); }
        .promo-mobile-entry.is-visible { opacity:1; pointer-events:auto; transform:none; }
        .promo-mobile-entry .promo-entry-button { width:100%; min-height:50px; color:var(--amber-ink); border-color:var(--amber-bright); background:var(--amber-bright); }
        .promo-motion-ready [data-promo-reveal] { opacity:0; clip-path:inset(0 0 18% 0); transform:translateY(24px); transition:opacity 420ms ease,clip-path 520ms var(--ease),transform 520ms var(--ease); }
        .promo-motion-ready [data-promo-reveal].is-visible { opacity:1; clip-path:inset(0); transform:none; }
        .promo-motion-ready .promo-capability:nth-child(2),.promo-motion-ready .promo-scene:nth-child(2) { transition-delay:70ms; }
        .promo-motion-ready .promo-capability:nth-child(3),.promo-motion-ready .promo-scene:nth-child(3) { transition-delay:140ms; }
        .promo-motion-ready .promo-capability:nth-child(4),.promo-motion-ready .promo-scene:nth-child(4) { transition-delay:210ms; }
        .promo-motion-ready .promo-page { opacity:0; transition:opacity 320ms ease; }
        .promo-motion-ready.is-page-ready .promo-page { opacity:1; }
        @media (max-width:980px) {
            :root { --shell:min(100% - 40px,900px); --section-top:64px; --section-bottom:44px; }
            .promo-nav { gap:20px; } .promo-nav a { font-size:12px; }
            .promo-title { font-size:clamp(50px,6vw,62px); }
            .promo-services-layout { grid-template-columns:.72fr 1.28fr; gap:54px; }
            .promo-capability { grid-template-columns:44px minmax(150px,.5fr) minmax(0,.5fr); gap:20px; }
            .promo-scenario-copy,.promo-process-heading { grid-template-columns:1fr; gap:24px; }
            .promo-scenario-copy .promo-section-intro,.promo-process-heading .promo-section-intro { margin-top:0; }
        }
        @media (max-width:760px) {
            :root { --shell:calc(100% - 36px); --section-top:48px; --section-bottom:32px; }
            html { scroll-padding-top:76px; scroll-padding-bottom:88px; }
            .promo-header-wrap,.promo-header { height:64px; }
            .promo-header-inner { grid-template-columns:minmax(0,1fr) auto; gap:12px; }
            .promo-brand { gap:8px; } .promo-brand-mark { width:30px; height:30px; } .promo-brand-name { font-size:14px; }
            .promo-nav { display:none; }
            .promo-header-entry { min-height:44px; padding-inline:13px; font-size:11px; }
            .promo-hero { min-height:auto; }
            .promo-hero-art img { object-position:center top; }
            .promo-hero-inner { min-height:0; padding:68px 0 18px; }
            .promo-hero-content { width:100%; text-align:center; }
            .promo-brand-line { margin-bottom:20px; font-size:10px; }
            .promo-brand-line::before,.promo-brand-line::after { width:18px; }
            .promo-title { max-width:10ch; margin-inline:auto; font-size:clamp(38px,10.6vw,44px); line-height:1.08; }
            html[lang="en"] .promo-title { max-width:12ch; font-size:clamp(35px,9.2vw,40px); }
            .promo-hero-stage { min-height:154px; margin-top:22px; }
            .promo-slide { width:100%; }
            .promo-slide-title { font-size:19px; }
            .promo-slide-accent { margin-top:14px; font-size:20px; }
            .promo-description { max-width:34ch; margin-top:11px; font-size:13px; line-height:1.62; }
            .promo-actions { width:min(100%,360px); gap:8px; margin:18px auto 0; }
            .promo-actions .promo-entry-form,.promo-actions .promo-entry-button { width:100%; }
            .promo-actions .promo-entry-button { min-width:0; min-height:50px; }
            .promo-secondary-button { min-height:44px; }
            .promo-entry-note { max-width:34ch; font-size:10.5px; }
            .promo-carousel-controls { width:100%; margin:28px 0 0; }
            .promo-slide-button { min-height:52px; padding:0 10px; }
            .promo-slide-control-label { overflow:hidden; font-size:10px; text-overflow:ellipsis; }
            .promo-kicker { justify-content:flex-start; margin-bottom:16px; }
            .promo-section-title { max-width:18ch; margin-inline:0; font-size:clamp(29px,7.7vw,33px); line-height:1.16; text-align:left; }
            .promo-section-intro { max-width:38ch; margin:16px 0 0; font-size:14px; text-align:left; }
            .promo-scenario-copy .promo-section-intro,.promo-process-heading .promo-section-intro { margin:16px 0 0; }
            .promo-services { padding-top:48px; }
            .promo-services-layout { grid-template-columns:1fr; gap:38px; }
            .promo-services-copy { position:static; text-align:left; }
            .promo-capability { min-height:0; grid-template-columns:38px minmax(0,1fr); gap:8px 14px; padding:26px 0; }
            .promo-capability p { grid-column:2; font-size:13px; }
            .promo-capability h3 { font-size:22px; }
            .promo-services { background-image:linear-gradient(180deg,rgba(17,19,22,.98),rgba(17,19,22,.9)),url("/storefront/promo/damatong-silver-stage-mobile-v23.webp"); background-position:center,right top; background-size:100% 100%,520px auto; }
            .promo-scenario-copy { margin-bottom:34px; }
            .promo-theater { grid-template-columns:1fr; }
            .promo-scene,.promo-scene:nth-child(n) { grid-column:1; min-height:0; padding:28px 22px; background:rgba(12,15,18,.82); }
            .promo-scene strong { font-size:22px; }
            .promo-process-heading { margin-bottom:36px; }
            .promo-process-path { grid-template-columns:1fr; padding:0; }
            .promo-process-path::before { top:4px; right:auto; bottom:22px; left:5px; width:1px; height:auto; }
            .promo-step,.promo-step+.promo-step { min-height:0; display:block; padding:0 0 30px 36px; }
            .promo-step::before,.promo-step+.promo-step::before { top:0; left:0; }
            .promo-step p { margin-top:7px; }
            .promo-trust-panel { grid-template-columns:1fr; gap:28px; padding:34px 24px; }
            .promo-trust-panel>div { text-align:center; }
            .promo-trust-panel h2 { max-width:12ch; margin-inline:auto; font-size:34px; line-height:1.14; text-wrap:balance; }
            .promo-trust-panel>div>p { max-width:34ch; margin:18px auto 0; }
            .promo-trust-panel .promo-kicker { justify-content:center; }
            .promo-trust-item { grid-template-columns:12px minmax(0,1fr); gap:14px; }
            .promo-faq-layout { grid-template-columns:1fr; gap:36px; }
            .promo-faq-heading { position:static; text-align:center; }
            .promo-faq-heading .promo-kicker { justify-content:center; }
            .promo-faq-heading .promo-section-title { max-width:15ch; margin-inline:auto; text-align:center; }
            .promo-faq-heading .promo-section-intro { max-width:34ch; margin:16px auto 0; text-align:center; }
            .promo-faq-item summary { min-height:76px; padding-right:42px; font-size:15px; }
            .promo-faq-answer { padding-right:34px; font-size:13px; }
            .promo-final { min-height:470px; background-image:url("/storefront/promo/damatong-silver-stage-mobile-v23.webp"); background-position:center top; }
            .promo-final::before { background:rgba(7,9,11,.8); }
            .promo-final-inner { max-width:100%; padding:38px 20px; text-align:center; }
            .promo-final h2 { max-width:15ch; margin-inline:auto; font-size:clamp(36px,9.1vw,38px); line-height:1.12; text-wrap:balance; }
            .promo-final p { max-width:34ch; margin:20px auto 28px; }
            .promo-trust-section { padding-bottom:32px; }
            #faq { padding-top:48px; }
            .promo-final .promo-entry-button { width:100%; min-width:0; }
            .promo-mobile-entry { display:block; }
            .promo-footer { min-height:0; align-items:center; justify-content:center; flex-direction:column; gap:14px; padding:30px 0 48px; border-top:1px solid var(--line); text-align:center; }
            .promo-footer-meta,.promo-footer-nav { width:100%; justify-content:center; }
            .promo-footer-meta { gap:16px; }
            .promo-footer-nav { flex-wrap:wrap; gap:0 18px; }
        }
        @media (max-width:360px) { :root { --shell:calc(100% - 32px); } .promo-header-entry { max-width:132px; padding-inline:10px; } .promo-hero-inner { padding-top:50px; } .promo-title { font-size:36px; } .promo-description { font-size:12.5px; } .promo-slide-control-label { font-size:9px; } }
        @media (max-height:650px) and (max-width:760px) { .promo-hero-inner { padding:34px 0 14px; } .promo-brand-line { margin-bottom:12px; } .promo-title { font-size:34px; } html[lang="en"] .promo-title { font-size:31px; } .promo-hero-stage { min-height:130px; margin-top:14px; } .promo-slide-accent { margin-top:10px; font-size:18px; } .promo-description { display:-webkit-box; margin-top:8px; overflow:hidden; -webkit-box-orient:vertical; -webkit-line-clamp:2; } .promo-actions { margin-top:12px; } .promo-actions .promo-entry-button { min-height:44px; font-size:12px; } .promo-secondary-button { min-height:44px; font-size:12px; } .promo-carousel-controls { margin-top:18px; } .promo-slide-button { min-height:46px; } }
        @media (prefers-reduced-motion:reduce) { html { scroll-behavior:auto; } *,*::before,*::after { scroll-behavior:auto!important; transition-duration:.01ms!important; animation-duration:.01ms!important; animation-iteration-count:1!important; } .promo-motion-ready [data-promo-reveal] { opacity:1; clip-path:none; transform:none; } .promo-motion-ready .promo-page { opacity:1; } }
    </style>
</head>
<body>
    <!-- DESIGN ARTIFACT: Silver Mist Stage. The background is static; motion is limited to content transitions and module reveals. -->
    <a class="promo-skip-link" href="#promo-main">{{promo.skipToContent}}</a>
    <div class="promo-page" data-promo-page data-promo-motion>
        <div class="promo-header-wrap"><header class="promo-header" data-promo-header><div class="promo-header-inner">
            <a class="promo-brand" href="#promo-main" aria-label="{{store.name}}"><img class="promo-brand-mark" data-bind-src="store.logoUrl" data-hide-if-empty alt=""><span class="promo-brand-name" data-bind-text="store.name"></span></a>
            <nav class="promo-nav" aria-label="{{promo.navigation}}"><a href="#services">{{promo.navServices}}</a><a href="#scenarios">{{promo.navScenarios}}</a><a href="#process">{{promo.navProcess}}</a><a href="#faq">{{promo.navFaq}}</a></nav>
            <form class="promo-header-entry-form" data-store-entry><button class="promo-header-entry" type="submit">{{promo.headerViewServices}}</button></form>
        </div></header></div>
        <main id="promo-main">
            <section class="promo-hero" data-promo-hero data-promo-carousel role="region" aria-roledescription="{{promo.carouselRole}}" aria-label="{{promo.heroCarouselAria}}"><picture class="promo-hero-art" aria-hidden="true"><source media="(max-width:760px)" srcset="/storefront/promo/damatong-silver-stage-mobile-v23.webp"><img src="/storefront/promo/damatong-silver-stage-v23.webp" alt="" width="1536" height="1024" fetchpriority="high"></picture><div class="promo-hero-inner promo-shell">
                <div class="promo-hero-content" data-promo-reveal><p class="promo-brand-line">{{promo.heroEyebrow}}</p><h1 class="promo-title"><span class="promo-title-line">{{promo.heroLead}}</span><span class="promo-title-line promo-title-highlight">{{promo.heroHighlight}}</span><span class="promo-title-line">{{promo.heroTail}}</span></h1><div class="promo-hero-stage" aria-live="off">
                    <article class="promo-slide is-active" id="promo-slide-1" data-promo-slide role="group" aria-roledescription="{{promo.slideRole}}" aria-label="{{promo.heroSlideOneAria}}" aria-hidden="false"><h2 class="promo-slide-title">{{promo.heroSlideOneTitleLead}}</h2><p class="promo-slide-accent">{{promo.heroSlideOneTitleAccent}}</p><p class="promo-description">{{promo.heroSlideOneDescription}}</p></article>
                    <article class="promo-slide" id="promo-slide-2" data-promo-slide role="group" aria-roledescription="{{promo.slideRole}}" aria-label="{{promo.heroSlideTwoAria}}" aria-hidden="true"><h2 class="promo-slide-title">{{promo.heroSlideTwoTitleLead}}</h2><p class="promo-slide-accent">{{promo.heroSlideTwoTitleAccent}}</p><p class="promo-description">{{promo.heroSlideTwoDescription}}</p></article>
                    <article class="promo-slide" id="promo-slide-3" data-promo-slide role="group" aria-roledescription="{{promo.slideRole}}" aria-label="{{promo.heroSlideThreeAria}}" aria-hidden="true"><h2 class="promo-slide-title">{{promo.heroSlideThreeTitleLead}}</h2><p class="promo-slide-accent">{{promo.heroSlideThreeTitleAccent}}</p><p class="promo-description">{{promo.heroSlideThreeDescription}}</p></article>
                </div><div class="promo-actions"><form class="promo-entry-form" data-store-entry><button class="promo-entry-button" type="submit">{{promo.viewServices}}</button></form><a class="promo-secondary-button" href="#process">{{promo.learnService}}</a><p class="promo-entry-note">{{promo.entryNote}}</p></div><div class="promo-carousel-controls"><div class="promo-carousel-nav" aria-label="{{promo.carouselNavigation}}">
                    <button class="promo-slide-button is-active" type="button" data-promo-slide-button="0" aria-controls="promo-slide-1" aria-current="true"><span class="promo-slide-control-label">{{promo.heroSlideOneControl}}</span></button>
                    <button class="promo-slide-button" type="button" data-promo-slide-button="1" aria-controls="promo-slide-2"><span class="promo-slide-control-label">{{promo.heroSlideTwoControl}}</span></button>
                    <button class="promo-slide-button" type="button" data-promo-slide-button="2" aria-controls="promo-slide-3"><span class="promo-slide-control-label">{{promo.heroSlideThreeControl}}</span></button>
                </div><p class="promo-sr-only" aria-live="polite" aria-atomic="true" data-promo-carousel-status></p></div></div>
            </div></section>
            <section class="promo-section promo-services" id="services"><div class="promo-shell promo-services-layout"><div class="promo-services-copy" data-promo-reveal><p class="promo-kicker">{{promo.navServices}}</p><h2 class="promo-section-title">{{promo.servicesTitle}}</h2><p class="promo-section-intro">{{promo.servicesIntro}}</p></div><div class="promo-capability-channels">
                <article class="promo-capability" data-promo-reveal><span class="promo-capability-number">01</span><h3>{{promo.capabilitySubscriptionTitle}}</h3><p>{{promo.capabilitySubscriptionDescription}}</p></article>
                <article class="promo-capability" data-promo-reveal><span class="promo-capability-number">02</span><h3>{{promo.capabilityApiTitle}}</h3><p>{{promo.capabilityApiDescription}}</p></article>
                <article class="promo-capability" data-promo-reveal><span class="promo-capability-number">03</span><h3>{{promo.capabilityTokenTitle}}</h3><p>{{promo.capabilityTokenDescription}}</p></article>
                <article class="promo-capability" data-promo-reveal><span class="promo-capability-number">04</span><h3>{{promo.capabilityToolsTitle}}</h3><p>{{promo.capabilityToolsDescription}}</p></article>
            </div></div></section>
            <section class="promo-section promo-scenarios" id="scenarios"><div class="promo-shell promo-scenario-layout"><div class="promo-scenario-copy" data-promo-reveal><div><p class="promo-kicker">{{promo.navScenarios}}</p><h2 class="promo-section-title">{{promo.scenariosTitle}}</h2></div><p class="promo-section-intro">{{promo.scenariosIntro}}</p></div><div class="promo-theater">
                <article class="promo-scene" data-promo-scene-item data-promo-reveal><strong>{{promo.scenarioPersonalTitle}}</strong><p>{{promo.scenarioPersonalDescription}}</p></article><article class="promo-scene" data-promo-scene-item data-promo-reveal><strong>{{promo.scenarioCreatorTitle}}</strong><p>{{promo.scenarioCreatorDescription}}</p></article><article class="promo-scene" data-promo-scene-item data-promo-reveal><strong>{{promo.scenarioDeveloperTitle}}</strong><p>{{promo.scenarioDeveloperDescription}}</p></article><article class="promo-scene" data-promo-scene-item data-promo-reveal><strong>{{promo.scenarioTeamTitle}}</strong><p>{{promo.scenarioTeamDescription}}</p></article>
            </div></div></section>
            <section class="promo-section promo-process" id="process"><div class="promo-shell"><div class="promo-process-heading" data-promo-reveal><div><p class="promo-kicker">{{promo.navProcess}}</p><h2 class="promo-section-title">{{promo.processTitle}}</h2></div><p class="promo-section-intro">{{promo.processIntro}}</p></div><ol class="promo-process-path"><li class="promo-step" data-promo-reveal><div><strong>{{promo.processStepOneTitle}}</strong><p>{{promo.processStepOneDescription}}</p></div></li><li class="promo-step" data-promo-reveal><div><strong>{{promo.processStepTwoTitle}}</strong><p>{{promo.processStepTwoDescription}}</p></div></li><li class="promo-step" data-promo-reveal><div><strong>{{promo.processStepThreeTitle}}</strong><p>{{promo.processStepThreeDescription}}</p></div></li><li class="promo-step" data-promo-reveal><div><strong>{{promo.processStepFourTitle}}</strong><p>{{promo.processStepFourDescription}}</p></div></li></ol></div></section>
            <section class="promo-section promo-trust-section"><div class="promo-shell promo-trust-panel" data-promo-reveal><div><p class="promo-kicker" data-bind-text="store.name"></p><h2>{{promo.trustTitle}}</h2><p>{{promo.trustIntro}}</p></div><ul class="promo-trust-list"><li class="promo-trust-item"><span class="promo-trust-mark" aria-hidden="true"></span><div><strong>{{promo.trustOneTitle}}</strong><p>{{promo.trustOneDescription}}</p></div></li><li class="promo-trust-item"><span class="promo-trust-mark" aria-hidden="true"></span><div><strong>{{promo.trustTwoTitle}}</strong><p>{{promo.trustTwoDescription}}</p></div></li><li class="promo-trust-item"><span class="promo-trust-mark" aria-hidden="true"></span><div><strong>{{promo.trustThreeTitle}}</strong><p>{{promo.trustThreeDescription}}</p></div></li></ul></div></section>
            <section class="promo-section" id="faq"><div class="promo-shell promo-faq-layout"><div class="promo-faq-heading" data-promo-reveal><p class="promo-kicker">{{promo.navFaq}}</p><h2 class="promo-section-title">{{promo.faqTitle}}</h2><p class="promo-section-intro">{{promo.faqIntro}}</p></div><div class="promo-faq-list" data-promo-reveal><details class="promo-faq-item" open><summary>{{promo.faqOneQuestion}}</summary><div class="promo-faq-answer">{{promo.faqOneAnswer}}</div></details><details class="promo-faq-item"><summary>{{promo.faqTwoQuestion}}</summary><div class="promo-faq-answer">{{promo.faqTwoAnswer}}</div></details><details class="promo-faq-item"><summary>{{promo.faqThreeQuestion}}</summary><div class="promo-faq-answer">{{promo.faqThreeAnswer}}</div></details><details class="promo-faq-item"><summary>{{promo.faqFourQuestion}}</summary><div class="promo-faq-answer">{{promo.faqFourAnswer}}</div></details><details class="promo-faq-item"><summary>{{promo.faqFiveQuestion}}</summary><div class="promo-faq-answer">{{promo.faqFiveAnswer}}</div></details></div></div></section>
            <section class="promo-final promo-shell" data-promo-final data-promo-reveal><div class="promo-final-inner"><h2>{{promo.finalTitle}}</h2><p>{{promo.finalIntro}}</p><form class="promo-entry-form" data-store-entry><button class="promo-entry-button" type="submit">{{promo.viewServices}}</button></form></div></section>
        </main>
        <div class="promo-mobile-entry" data-promo-mobile-entry aria-label="{{promo.mobileEntryAria}}"><form class="promo-entry-form" data-store-entry><button class="promo-entry-button" type="submit">{{promo.viewServices}}</button></form></div>
        <footer class="promo-footer promo-shell" data-promo-footer><div class="promo-footer-meta"><span>{{promo.footerType}}</span><span>© <span data-bind-text="store.currentYear"></span></span></div><nav class="promo-footer-nav" aria-label="{{promo.footerNavigation}}"><form class="promo-footer-form" data-store-entry data-store-entry-target="privacy"><button class="promo-footer-link" type="submit">{{promo.privacy}}</button></form><form class="promo-footer-form" data-store-entry data-store-entry-target="terms"><button class="promo-footer-link" type="submit">{{promo.terms}}</button></form><form class="promo-footer-form" data-store-entry data-store-entry-target="support"><button class="promo-footer-link" type="submit">{{promo.support}}</button></form></nav></footer>
    </div>
</body>
</html>`;
