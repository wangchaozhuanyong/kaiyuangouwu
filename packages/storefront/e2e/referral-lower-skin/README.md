# Local referral lower-section skin acceptance

This temporary local fixture renders the real `ReferralPage`, its production page context, query client and shared stylesheet entry. Palette resolution and skin CSS variables use the shared production functions. It does not reproduce or override the page styles.

All customer, program, wallet, invitee and ledger records are synthetic, declared in `fixture.tsx`. Only in-memory query functions are provided; no Shop API instance, remote account, live account writes or production records are used. Poster templates are intentionally empty because poster rendering is outside this acceptance scope.

Vite path:

`/e2e/referral-lower-skin/index.html?storefrontPreviewEmbedded=1&skin=classic&lang=zh&state=empty`

Keep `storefrontPreviewEmbedded=1` in the URL to suppress the unrelated public-page bootstrap request that Vite injects into HTML pages.

Parameters:

- `skin=classic` or `skin=neo-minimalist`.
- `lang=zh` or `lang=en`.
- `state=empty` produces zero balances and empty invitation/activity tabs. Any other state (for example `state=populated`) produces 12 invitees and 12 ledger records, exercising both pagination controls, purchased/unpurchased badges and positive/negative amounts.
- `currency=CNY` (default) or `currency=MYR`.

The production viewport hook selects the desktop class at 1024px. Verify at 390px and 1440px by resizing the browser. Record tabs, reward help and pagination are the real component interactions. Invite copy/share controls are also real and are outside this fixture's intended interaction checks.

This fixture alone is not a browser acceptance result or evidence of production behavior.
