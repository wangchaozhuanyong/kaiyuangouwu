# Independent customer tools redesign

Approved scope: 2FA and mail query at their existing independent origins. Keep shared business logic and the existing same-tab return marker; a directly opened or copied tool URL exposes no storefront navigation.

- Shared warm neutral and evergreen appearance, stronger page titles, responsive 2FA workspace and larger verification codes. Query entry stays focused; mail results use a 240 px list beside the expanded reader on desktop and a list/detail flow on mobile.
- Mail bodies grow with their contents. A fit-width control and accessible full-screen sheet support large emails. External images require an explicit reader action, retain their aspect ratio, and show a retry action when unavailable. Source URLs that expire or reject requests can still fail.
- Historical mail HTML is sanitized again before removing its restrictive legacy preview policy. Sender scripts, handlers and embedded documents are stripped. An opaque-origin sandbox executes only the fixed application layout observer; its content policy denies forms, connections and external scripts. Layout messages are accepted only from the active frame. No backend, credential, authentication or storage protocol changes.
- The independent mail host permits HTTPS image resources, while the inner frame blocks remote images until the reader opts in.
- Existing Sheet styles are extracted into their shared owner so independent entries receive the same accessible overlay. The new `otp` typography role belongs to the shared typography owner. Approved reader separators are registered by exact selector/property/value. Existing size ceilings are unchanged.

## Local evidence

Evidence directory: `outputs/customer-tools-redesign/` (not part of the release).

- Storefront production build, types, typography and interaction verification: passed (`build-final-2.log`).
- Next Admin production build: passed (`admin-build-final.log`); shared storefront preview is covered.
- Customer tool browser matrix: 19 scenarios passed (`browser-complete.log`), Chinese/English, 390/1440 px, both existing skin presets, direct/copy/source navigation, synthetic mail, long body/image fitting, image failure/retry, full screen, sender-script isolation and error input retention.
- Shared navigation continuity: 22 scenarios passed (`navigation.log`).
- Visual review uses the actual built components with synthetic example.test messages; no real customer mailbox or business data is used.
- Lint, shared ownership, architecture and affected unit/control gates are recorded in the release ledger. Production and live version verification are separate from this local report.
