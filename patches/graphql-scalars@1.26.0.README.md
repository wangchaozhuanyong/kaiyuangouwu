# PhoneNumber regular-expression security backport

Backports the equivalent linear-time expression from upstream commit
https://github.com/graphql-hive/graphql-scalars/commit/210fd24 for
https://github.com/advisories/GHSA-x8rm-f576-gq67 to both installed CJS and ESM
entries of graphql-scalars 1.26.0. This avoids a scalar API major upgrade.

The dependency audit requires the registered patch, frozen lockfile, patch hash,
installed file hashes, exact package version, and ordinary/adversarial behavior.
It retains the original advisory in audit evidence and recognizes only this
verified repair. Altered bytes or an unrelated advisory still fail the gate.
