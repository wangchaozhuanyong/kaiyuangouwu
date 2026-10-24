# Zod 3 compatibility security backport

Upstream repair: https://github.com/colinhacks/zod/commit/a0ebf97
Advisory: https://github.com/advisories/GHSA-mrhx-c7xc-m3w5

Keep Zod 3.25.76 for consumers requiring the version3 API. Reject arrays and sets exceeding an existing upper bound before walking their elements; port the same leading size gate to the bundled older version4 array/map/set entry points. Valid bounded input and the existing API stay compatible. Schemas intentionally lacking an upper bound retain upstream behavior.

The older version4 constructor initializes its runner more than once. Install its gate through the existing deferred constructor hook, and wrap the final runner so later checks cannot re-walk a rejected raw collection. Stop scanning size caps at a potentially rewriting check, matching the upstream repair's ordering rule.

The production audit verifies patch registration, frozen-lock registration, source checksum, every changed CJS/ESM/source file, and installed CJS behavior. It refuses an unpatched3.x copy, any older4.x copy, or a different advisory; a name-level proof requires all installed copies to be safe. Tests cover ESM and CJS, asynchronous parsing, wrong input types, normal object parsing, size limits and tampering. Zod4 consumers use the official4.6.6 release.
