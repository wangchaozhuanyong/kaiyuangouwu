# Damatong Promo v24: Silver Mist Stage

## Direction

The promotion surface is a premium AI service gateway, not a catalog or transaction page. The selected visual direction is “Silver Mist Stage”: a quiet graphite reading field, a restrained silver architectural fold, one lunar-amber seam, and centered editorial typography. The Hero is one unified service stage; its three chapter controls switch the content shown in that same stage instead of repeating the same information below it.

## Visual system

- Ground: static graphite and silver artwork with a low-detail center reading zone. Decorative folds stay at the upper-right and outer edge.
- Type: mineral-white display text with the existing system sans stack (`Avenir Next`, Helvetica, PingFang SC).
- Accent: lunar amber `#efa83f` and bright amber `#ffc65f`; only primary actions, active chapter state, focus rings, and small rules use it.
- Chrome: thin neutral rules, matte translucent surfaces, four-pixel controls, and restrained shadows.
- Readability: no light streak, fold edge, particle, texture, or animated background may pass behind the primary copy.

## Layout grammar

- Sticky header: 72px desktop, 64px mobile.
- Shell: maximum 1200px.
- Hero: one shared title and action area, one active service description, and one integrated three-part chapter rail.
- No duplicated value rail beneath the Hero.
- Following forms: asymmetric capability channels, an offset 7/5 then 5/7 workflow theater, a continuous four-node path, one support panel without repeated numbering, a dual-column FAQ, and a closing gateway CTA.
- Mobile: the Hero, support panel, FAQ introduction, and final CTA are centered; service, scenario, and process headings are left aligned to avoid a repeated poster layout. The fixed service-center entry appears after the Hero and hides at the final CTA and footer.
- Surface rhythm: the complete silver artwork belongs to the Hero and closing CTA. Service capability uses a narrow right-edge silver fold, scenarios use warm graphite, process uses a clean path surface, support uses a silver-black panel, and FAQ uses a low-detail reading field.

## Motion

- The Hero background is a static raster asset; no Canvas, WebGL, particles, light sweeps, or continuous ambient animation is used.
- The three service chapters crossfade every three seconds and support direct selection, keyboard arrows, Home/End, and touch swipe.
- Autoplay pauses when the Hero is outside the viewport, the page is hidden, the pointer is over the Hero, the Hero contains keyboard focus, or a touch interaction is active.
- A manual chapter selection holds for ten seconds before autoplay resumes. No visible playback bar or pause control is shown.
- The page fades in once; lower sections reveal with a short upward movement and clipped edge as they enter the viewport.
- FAQ disclosure uses a measured height and opacity transition rather than the native hard jump.
- `prefers-reduced-motion` removes reveal movement and disables carousel autoplay while retaining all content and controls.

## Content and interaction rules

- Chinese and English are complete, separate outputs. Damatong spelling is fixed and AI is always uppercase.
- Service capabilities: AI service subscriptions, AI API routing, AI usage credits, and AI productivity tools.
- The user-confirmed “selected routes from 0.1×” claim appears with the model, route, and current-price qualifier in the same active Hero chapter.
- Scenarios: entrepreneurship, content creation, developer integration, and team workflows.
- Do not introduce prices, inventory, product cards, transactions, third-party logos, testimonials, customer names, or unverified metrics.
- The non-transaction boundary appears once in FAQ.
- Every service-center entry remains a signed `POST /promo/enter` form.

## Assets and provenance

- User-selected composition reference: `/var/folders/y2/73zzsdhn3d78m_qqhkb2lrq80000gn/T/codex-clipboard-1b08f5bb-0a9a-4f21-b698-87be366f1044.png`.
- Desktop static Hero and section texture: `packages/storefront/public/storefront/promo/damatong-silver-stage-v23.webp`, generated for this page with the built-in image generation workflow.
- Mobile static Hero and section texture: `packages/storefront/public/storefront/promo/damatong-silver-stage-mobile-v23.webp`, generated separately so the fold remains outside the mobile reading zone.
- Brand mark: `packages/storefront/public/storefront/promo/damatong-amber-mark-v15.webp`.

## Accessibility

- Semantic headings, landmarks, native FAQ details, visible keyboard focus, and a skip link are required.
- Primary touch targets are at least 44px, including the compact-height mobile layout, and body text targets 4.5:1 contrast.
- The inactive chapter labels use the readable `--faint` token rather than the previous low-contrast gray.
- Anchors `#services`, `#scenarios`, `#process`, and `#faq` remain stable.
