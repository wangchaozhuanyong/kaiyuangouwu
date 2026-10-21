# Authentication artwork preview

Local fixture using the real authentication components and synthetic account actions. No account request is sent to a live service.

Run Vite from `packages/storefront`, then open `/e2e/auth-visuals/index.html?store=moyao&variant=register`.

Parameters: `store=moyao|flashcast|damatong`, `variant=login|register|forgot-password|verify-account`, `lang=zh|en`, `skin=classic|neo-minimalist`.

`artwork-plan.json` maps candidate images and colors to existing Admin content blocks. Artwork is 1296×1360 for the 648×680 standard desktop frame. Apply the shared CSS with the matching Admin artwork and colors. Uploading these fixtures alone does not publish merchant configuration. Preserve existing copy, translations, items and logos when applying the artwork.

Build the storefront, then run `node e2e/auth-visuals/cold-entry-server.mjs` from `packages/storefront` to exercise the real built router with a synthetic backend on port 5358. Open `/promo/account-entry?scenario=automatic|password|configuration-failure|session-failure|server-rendered`. Read `/__qa/cold-entry` for request counts. The server listens only on 127.0.0.1.

Email verification fixtures use `variant=verify-account&state=password|pending|expired|missing|network|session-error|success`. Passwords, verification and resend actions are synthetic and never create credentials, accounts or outgoing mail. The session-error fixture fails the first session recovery and allows a manual retry. Actual signed email-entry links and production account verification have not been exercised.
