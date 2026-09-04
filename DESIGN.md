# MOYAO AI default-site design system

## Brand direction

MOYAO AI 的默认站点是一个清晰、克制、可信的 AI 服务商店。视觉重点是“一个入口连接多种模型”，不使用堆满发光图标、重复大海报或赛博装饰的模板化表达。

## Identity

- Primary name: `MOYAO AI｜模钥`.
- English name: `MOYAO AI`.
- Tagline: `全球模型，一钥直达` / `One Key to Every Model.`
- Primary violet: `#635BFF`.
- Secondary violet: `#8B5CF6`.
- Signal cyan: `#22D3EE`.
- White: `#FFFFFF`.
- Deep ground: `#070B14`.

The horizontal wordmark is used in the storefront header and other wide brand lockups. The square icon is used for favicon, app icon, compact cards and referral-avatar positions. Monochrome artwork is reserved for single-color print or constrained UI; it must not replace the main gradient icon by default.

## Layout and hierarchy

- Header uses the wordmark without repeating the brand name as adjacent text.
- Page shell is stable across loading and route transitions; media reserves its final aspect ratio before download.
- Homepage sections must each have one purpose. Avoid repeating the same product grid under multiple labels unless the backend intentionally provides different products.
- Desktop product cards use a `4:3` media frame with `object-fit: contain`; mobile cards stay square for compact two-column browsing.
- Hero copy remains a live HTML layer. Never bake prices, CTA text or frequently changing promises into an image.
- Long pages use clear section rhythm and progressively disclosed detail instead of stacking full-width posters.

## Image system

| Surface               | Master size      | Crop and safe area                          | Content rule                                                     |
| --------------------- | ---------------- | ------------------------------------------- | ---------------------------------------------------------------- |
| Product cover         | `1600×1600`      | Keep key text/object inside central 80%     | One product or one service concept; no dense specification sheet |
| Desktop card render   | `4:3` container  | Use `contain`, never crop critical copy     | Preserve complete product cover with quiet padding               |
| Homepage hero         | `1600×900`       | Left 46% is copy-safe; main object on right | No embedded CTA, price or third-party logo wall                  |
| Category/story banner | `1600×900`       | Central 80% safe                            | One theme and one focal object                                   |
| Social share          | `1200×630`       | Central 84% safe                            | Brand, short value line and canonical domain only                |
| Referral poster       | `1080×1920`      | 64px side safety; QR kept clear             | One headline, three benefits maximum and one CTA                 |
| Favicon/app icon      | `512×512` master | Mark centered with breathing room           | Icon only, no wordmark                                           |

Use WebP or optimized JPEG for photography/artwork and SVG for true vector monochrome marks. Do not upscale small images, stretch logos, add third-party watermarks, or place essential words at crop edges. Product families share lighting and background structure while retaining a clear per-product differentiator.

## Components

- Buttons use violet for primary action; cyan is a signal/focus accent, not a second competing primary action.
- Cards use white/fog surfaces, restrained borders and one shadow level. Hover motion is subtle and disabled for reduced-motion users.
- Dark campaign surfaces use `#070B14` with violet/cyan lines. Black-and-gold legacy campaign styling is not part of the MOYAO system.
- Status colors retain semantic meaning and are not replaced by the brand palette.

## Motion and loading

- Reserve image dimensions and skeleton geometry before content arrives.
- Use opacity or small translation transitions only when they do not move surrounding layout.
- Do not animate the logo continuously or run decorative background motion behind reading content.
- `prefers-reduced-motion` removes autoplay and nonessential reveals.

## Content and accessibility

- Use concise, factual copy. `AI` and `MOYAO AI` retain uppercase spelling.
- Text contrast targets WCAG AA; focus rings use signal cyan on dark surfaces and primary violet on light surfaces.
- Touch targets are at least 44px. Logos have descriptive alt text; decorative textures use empty alt text.

## Asset provenance

The approved source is `MOYAO_AI_Logo_Brand_Pack.zip`. Runtime assets are optimized derivatives stored under `packages/storefront/src/assets/brand/moyao-ai/` and `packages/storefront/public/storefront/moyao-ai/`; do not edit those derivatives as a new source of truth.
