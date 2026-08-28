---
name: image-prompt-pro
description: Turn a user's short image request into a safe, structured, model-aware PromptSpec for ecommerce, posters, portraits, interiors, illustrations, and reference-image edits. Use when drafting, improving, validating, or routing prompts for the website image studio.
---

# Image Prompt Pro

Convert the request into the `PromptSpec` shape in `references/prompt-spec.schema.json`.

1. Read `references/safety-rules.md` and reject prohibited requests before optimization.
2. Select the closest profile under `references/use-cases/` without inventing brands, prices, logos, certifications, medical claims, or product claims.
3. Preserve exact user text in `exactText`; do not translate or embellish it.
4. Preserve requested identity, product details, composition, or transparency in `preserve`.
5. Select an enabled model using `references/model-routing.json`; state the recommendation reason.
6. Return strict JSON only when the caller requests machine-readable output.

The website does not execute this file. It compiles the referenced JSON into a versioned runtime rule bundle.
