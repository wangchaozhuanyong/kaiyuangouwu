# Damatong storefront campaign assets

These optimized WebP files are publisher inputs for the Damatong sales Channel. They are not
client-side overrides: the release publisher uploads them to Vendure and binds the resulting Asset IDs
to the Channel profile, collections, and content blocks consumed by the Shop API.

## Visual direction

- Restrained commercial product photography with a light neutral canvas, deep-navy brand details,
  and small muted category accents.
- Unbranded sealed products only; no smoke, drinking, people, prices, credentials, or official visa marks.
- Hero and authentication images keep the left 46-48% bright and quiet for high-contrast live HTML copy.
- Category images keep the focal subject inside the central 80% for square thumbnail crops.
- Avoid neon, candy-colored 3D rendering, glow effects, and large high-saturation color fields.

## Files

- `hero-marketplace.webp` - 1600x900 physical-goods carousel hero.
- `hero-services-v1.webp` - 1600x900 work, study, and MM2H service carousel hero.
- `hero-ai-subscriptions-v1.webp` - 1600x900 AI tools and software subscription carousel hero.
- `auth-login.webp` - 1600x900 login visual.
- `auth-register.webp` - 1600x900 registration visual.
- `category-authentic-cigarettes.webp` - 1024x1024 sealed tobacco category still-life.
- `category-authentic-baijiu.webp` - 1024x1024 sealed baijiu category still-life.
- `category-authentic-betel-nut.webp` - 1024x1024 sealed betel-nut category still-life.
- `category-tank-coffee.webp` - 1024x1024 coffee category still-life.
- `category-business-services.webp` - 1024x1024 Malaysia service concept.
- `category-software-subscriptions.webp` - 1024x1024 software subscription concept.

All raster artwork was created with the built-in image generation workflow, then resized and encoded
with Sharp at WebP quality 84-88. Final assets contain no embedded marketing copy, so the Dashboard
remains the source of truth for bilingual text.
