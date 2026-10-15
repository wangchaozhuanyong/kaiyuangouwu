# Production operations

## Bounded disk policy

The production disk maintenance helper preserves the active backend plus its two
rollback runtimes, every runtime still owning an active storefront/Admin/2FA
pointer, and two usable historical frontend outputs for each component. It prunes
only verified, strictly named generated releases; unknown output and changed
pointers fail closed or remain protected.

Persistent-file backups retain the newest three complete, locally verified
recovery sets. An older local set can be removed only after the fixed offsite
30-day policy, local checksums, encrypted/versioned remote objects and the
version-pinned remote checksum agree. A blocked offsite verification preserves
the local files and prevents another capture from increasing the footprint.
Successful uploads run retention while reusing the backup lock; an upload failure
resumes the existing complete set on the next run.

The installer accepts a SHA-256-bound control package and saves replaced control
files under `/var/backups/vendure`. Independent systemd overrides keep the disk
policy active when an older application release reinstalls a base unit. The
existing release path unit additionally watches `/var/www` to detect atomic
replacement of the frontend current pointers. Watching the symlinks themselves
follows their targets and does not trigger on the actual publication operation;
backup capture checks the coexistence of the source snapshot and compressed
archive before writing. Runtime and frontend downloads use the existing 85%
maximum-usage reserve without lowering the protection threshold.

Install or update this server policy only within explicit operations authorization:

```bash
bash deploy/install-production-disk-policy.sh <verified-package-root> <manifest-sha256> --check
bash deploy/install-production-disk-policy.sh <verified-package-root> <manifest-sha256> --apply
```

The installation does not promote an application version. Production source,
installed policy fingerprints, resulting counts, disk headroom and service health
must be recorded separately. Retention bounds derived files, not business assets;
if protected source data itself outgrows capacity, the peak-write budget stops
before filling the volume.

`Production Operations` uses the existing GitHub OIDC deployment role and AWS SSM
connection to the Vendure production instance. It does not need a local AWS login,
an open SSH port, or a stored AWS access key. The external SSH key remains a fallback.

SSM runs the fixed, reviewed script as root so retention can remove historical
root-owned build files without changing directory ownership or permissions. PM2
and repository reads still explicitly use the existing ubuntu account. No new
IAM permission or interactive root access is granted.

Run the default read-only operation from the current `main` revision:

```bash
gh workflow run production_operations.yml --ref main -f operation=diagnose
```

The run summary contains disk usage, release directory size, the source checkout,
current runtime and version marker, health service status, recent backup file
metadata, and the existing release retention plan. Backup contents, environment
files and PM2 environment values are never logged. A blocked retention snapshot
cannot produce an approval hash.

Image diagnostics also report the fixed `vendure-clamd.service` and
`vendure-image-worker.service` states, startup limits, dependencies, and local
socket presence. A release with an existing image worker stops at preflight if
either service or socket is unavailable. This read-only diagnosis uses the same
GitHub OIDC authorization; no long-lived AWS access key or browser-token export is
needed. Keep the local GitHub session and existing SSH key in their normal stores.

When refreshing the image worker, deployment performs separate `stop` and `start`
transactions. The production antivirus wants the worker and the worker requires
the antivirus; a combined restart can propagate through this dependency cycle.
Keep antivirus startup limits and scanning enabled. Recover the dependency first
and verify its socket response before releasing a repaired candidate.

Review every `keepDirectories`, `deleteDirectories` and `deleteArchives` entry.
The existing retention policy keeps the current runtime and the two immediately
older runtime directories. Failed candidates newer than current are included in
the deletion plan. Keep their immutable GitHub/S3 artifact evidence if they still
need to be deployed. This operation does not remove offsite artifacts, database
backups, uploaded assets, application logs or checksum records.

After reviewing the exact plan, run `retain-reviewed` with its `planSha256`:

```bash
gh workflow run production_operations.yml --ref main \
    -f operation=retain-reviewed -f expected_plan_sha256=<reviewed-plan-sha256>
```

The hash binds both the complete plan and the operations source commit. A new
commit or changed release inventory requires a new diagnosis and review. Both
operations acquire the existing production deployment lock. Cleanup revalidates
the plan before deleting anything and refreshes the existing health service after
completion; a remaining health failure is reported as a failed operation.
If a reboot cleared `/run/lock`, the operation restores the lock exclusively as
the `ubuntu` deployment account before acquiring it. A foreign-owned or
non-regular lock is not replaced.

Normal deployment, verification, rollback and branch cleanup continue to use
the existing workflows described in `DEPLOYMENT_RUNBOOK.md`. This operation
does not promote an application release or change its version marker.

## Planned application or database maintenance

An operation which stops `vendure-api` interrupts every store served by the shared
upstream. Record it as a maintenance window, even when no application SHA changes.
The 2026-10-15 incident linked an SSM stop/restart operation to the three-store 502
window; an unrelated successful read-only diagnosis did not establish availability.

Before an operation can stop the API or Worker, its reviewed record must include:

- The exact instance, current component SHAs, UTC start/end window, affected stores
  and capabilities, operator, business approval, and recovery owner.
- The exact reviewed operation and input hash, whether stopping writes is necessary,
  the existing deployment lock, preserved backup/recovery evidence, and a recovery
  deadline. Keep data cleanup tools separate from an application release candidate.
- A maintenance response that remains available while the API is stopped. Verify
  the real response before stopping: HTTP 503, a bounded `Retry-After`, `no-store`,
  and useful browser/API feedback. A maintenance page returned with HTTP 200, or
  generated by the API that is about to stop, does not meet this requirement.

These are admission requirements, not a new automatically installed maintenance
endpoint. If the independent response or reviewed recovery path is absent, keep
the running application serving and prepare the missing control before the window.
Read-only diagnosis, backups, file retention and static frontend work must not add
an unrelated API/Worker stop. Do not disable monitoring to hide the maintenance;
bind any expected alert interval to the same reviewed window.

During the approved window, acquire the existing deployment lock as its existing
owner and recheck the bound inputs. Block new writes, allow active transactions
and jobs to drain within their existing shutdown policy, then stop only the
components required by the operation. Preserve the operation ID, phase timestamps
and failure evidence. Recovery must be arranged before stopping, including the
failure path; an early command error must not leave the services forgotten.

Before reopening traffic, verify the expected runtime and frontend identities,
database connectivity, API readiness, Worker heartbeat, and the affected job/retry
state. Confirm required dependencies and the original failed routes on all three
stores. Process `online`, a command exit code, or one health URL alone is
insufficient. Remove the maintenance response only after these checks pass, then
verify normal browser/API responses and record the actual end time and any
remaining restrictions. A failed recovery retains the maintenance feedback and
an explicit recovery owner; it does not silently resume business traffic.

Keep credentials, raw environment values, customer payloads and core dump contents
out of the maintenance record. None of these requirements authorizes a production
write, a cleanup, or a deployment by itself.

## Configure the fixed offsite persistent-file backup

If release readiness reports that the single production host does not have a
distinct persistent-file backup destination, first run the read-only plan:

```bash
gh workflow run production_operations.yml --ref main \
    -f operation=plan-offsite-file-backup-config
```

The plan verifies the fixed `files/` S3 prefix has bucket versioning, bucket-owner
enforcement, full public-access blocking, SSE-S3 defaults, and a bounded current
and noncurrent lifecycle. It reports only the three non-secret setting names that
need to change plus a hash of their current values. It never logs the environment
file or unrelated settings.

After reviewing the exact plan hash, apply it once:

```bash
gh workflow run production_operations.yml --ref main \
    -f operation=apply-offsite-file-backup-config-reviewed \
    -f expected_plan_sha256=<reviewed-plan-sha256>
```

The write revalidates the plan and S3 policy under the production deployment
lock, atomically updates only `VENDURE_REQUIRE_OFFSITE_FILE_BACKUP`,
`VENDURE_FILE_BACKUP_S3_URI`, and `VENDURE_FILE_BACKUP_S3_RETENTION_DAYS`, and
preserves all unrelated values, ownership, and mode. A changed plan or duplicate
setting fails closed. This operation does not restart PM2, run a migration, or
promote a release; the next reviewed release consumes the completed configuration.

## Clean reviewed deployment caches

If release retention has already preserved only the current runtime and two
rollback runtimes but the root disk is still above the release health limit,
plan cleanup of regenerated package caches and the source checkout's
`node_modules` directory:

```bash
gh workflow run production_operations.yml --ref main \
    -f operation=plan-deployment-cache-cleanup
```

The plan is limited to fixed package-cache paths. It requires the server source
checkout to be an ancestor of the reviewed `main` revision with no tracked
changes, proves that no candidate contains the current immutable runtime, and
reports each candidate's size. It never includes `.env` files, uploads, logs,
database backups, release directories, Git data or application data.

After reviewing the exact candidates and total size, apply the bound plan:

```bash
gh workflow run production_operations.yml --ref main \
    -f operation=apply-deployment-cache-cleanup-reviewed \
    -f expected_plan_sha256=<reviewed-plan-sha256>
```

The write revalidates the full plan under the production deployment lock,
removes only those reviewed cache directories, and reruns the production health
check. Any source, runtime, cache-size or candidate change requires a new plan.

If that plan has no candidates and a release is short of disk staging space, inspect
the fixed APT package archive directory without touching installed packages:

```bash
gh workflow run production_operations.yml --ref main \
    -f operation=plan-apt-archive-cleanup
```

The plan reports `/var/cache/apt/archives`, its size, the source SHA and the
running runtime. Review the size before applying the exact plan hash:

```bash
gh workflow run production_operations.yml --ref main \
    -f operation=apply-apt-archive-cleanup-reviewed \
    -f expected_plan_sha256=<reviewed-plan-sha256>
```

The write rechecks the source, runtime and cache size under the deployment lock,
then runs `apt-get clean` against that fixed directory and refreshes production
health. It does not remove installed packages, application files, release
directories, backups or logs. A zero-size or changed plan fails closed.

If downloaded archives are empty but `/var/cache/apt` remains large, inspect
only APT's generated `pkgcache.bin` and `srcpkgcache.bin` metadata files:

```bash
gh workflow run production_operations.yml --ref main \
    -f operation=plan-apt-metadata-cleanup
```

The plan lists each existing regular file, its size and modification time,
the running runtime, and a source-bound hash. After reviewing the exact files:

```bash
gh workflow run production_operations.yml --ref main \
    -f operation=apply-apt-metadata-cleanup-reviewed \
    -f expected_plan_sha256=<reviewed-plan-sha256>
```

The write revalidates the file list under the deployment lock and unlinks only
those two generated metadata cache files. APT rebuilds them when needed.
Installed packages, APT configuration, package lists, application files,
backups and logs are outside the plan.

If the release still needs disk space, inspect the downloaded APT package
indexes stored under `/var/lib/apt/lists`:

```bash
gh workflow run production_operations.yml --ref main \
    -f operation=plan-apt-lists-cleanup
```

The plan lists each regular index file and its allocated size, while keeping
`InRelease`, `Release`, `Release.gpg`, and the APT lock outside the cleanup. It
requires empty `partial` and `auxfiles` directories, a clean tracked source
checkout, and a stable running runtime. Apply only if the reviewed size covers
the release shortfall:

```bash
gh workflow run production_operations.yml --ref main \
    -f operation=apply-apt-lists-cleanup-reviewed \
    -f expected_plan_sha256=<reviewed-plan-sha256>
```

The write revalidates the exact plan under the deployment lock and runs APT's
`distclean`, which preserves release signature metadata. Future package
maintenance must run `apt-get update` to fetch the package indexes again.
Installed packages, APT sources, backup data, logs, and release files are not
part of this cleanup.

If more disk staging space is needed, inspect Snap's downloaded cache files:

```bash
gh workflow run production_operations.yml --ref main \
    -f operation=plan-snap-cache-cleanup
```

The plan selects only regular files in `/var/lib/snapd/cache` with one hard link,
reports their allocated disk blocks and modification times, and binds the
source and running runtime to a hash. Installed Snap revisions in
`/var/lib/snapd/snaps` and cache files still hard-linked to them are excluded.
Review the exact candidates and effective size before applying:

```bash
gh workflow run production_operations.yml --ref main \
    -f operation=apply-snap-cache-cleanup-reviewed \
    -f expected_plan_sha256=<reviewed-plan-sha256>
```

The write revalidates the plan under the deployment lock, removes only the
reviewed cache files, and refreshes production health. If any cache entry or
runtime changes, a new plan is required.

If those caches have no reclaimable entries, inspect archived systemd journals
and numbered, rotated SSM agent logs:

```bash
gh workflow run production_operations.yml --ref main \
    -f operation=plan-archived-log-cleanup
```

The plan lists fixed log paths, sizes, inode metadata, the running runtime, and
a source-bound hash. It excludes the active journal and current SSM agent log.
After reviewing the exact candidates and confirming their allocated size covers
the release shortfall, apply the same plan hash:

```bash
gh workflow run production_operations.yml --ref main \
    -f operation=apply-archived-log-cleanup-reviewed \
    -f expected_plan_sha256=<reviewed-plan-sha256>
```

The operation revalidates the entire plan under the deployment lock. It asks
`journalctl` to vacuum archived journals, removes only the numbered rotated SSM
logs in the plan, and refreshes production health. Current logs, application
logs, releases, uploaded assets and backups remain untouched. The journal and
SSM agent retain their current files for ongoing diagnostics.

## Remove redundant local persistent-file backups

Use this only after the owner authorizes local backup cleanup. The read-only
plan keeps the newest three archive sets on the server and checks each older
complete archive against its local SHA-256 sidecar and the versioned, encrypted
offsite archive, manifest and checksum objects:

```bash
gh workflow run production_operations.yml --ref main \
    -f operation=plan-file-backup-cleanup
```

Review every candidate, blocked set, retained set and the total allocated size.
The plan includes the source and running runtime revisions and an exact digest.
Only the reviewed candidates can be removed:

```bash
gh workflow run production_operations.yml --ref main \
    -f operation=apply-file-backup-cleanup-reviewed \
    -f expected_plan_sha256=<reviewed-plan-sha256>
```

The apply operation takes both deployment and file-backup locks, repeats the
local checksum and offsite-object checks, and refuses a changed plan. It only
unlinks the three local files in each verified older set. S3 versions, the
latest three local sets, database backups, uploads and incomplete sets remain.
Production health is refreshed after cleanup.

## Audit one product before changing store ownership

Use the fixed read-only audit for a specific product and the exact running runtime:

```bash
gh workflow run production_operations.yml --ref main \
    -f operation=audit-administrator-product-readiness \
    -f source_sha=<latest-main-sha> \
    -f expected_runtime_sha=<running-runtime-sha> \
    -f product_id=<reviewed-product-id>
```

The product report counts related entities and historical orders by their
`order.salesChannelId`, including orders for deleted variants. It also reads
stock levels only for the requested product's active variant IDs, reporting
stock-level, variant and warehouse IDs, quantities, warehouse existence and
warehouse Channel memberships. Missing, default and shared memberships remain
facts to review; the audit never assigns a store or changes stock.

The Operations output retains counts and explicit truncation flags for variant
IDs, stock levels and warehouse Channels. Truncated details cannot prove a
complete ownership map. The stock receipt validator is transported only for
this audit, preserving the transport capacity of other Operations. No order IDs,
customer details, SKU or warehouse names, or credentials are published. A null
sales owner is reported separately. This
evidence identifies historical dependencies but is not an ownership migration
plan or permission to detach a Channel. Review any default-Channel, other-store,
or unresolved sale or stock before preparing a separate scoped migration.

## Backfill historical order sales ownership

The store-isolation audit can identify legacy orders whose immutable
`salesChannelId` is missing even though their existing Channel memberships are
unambiguous. Plan the repair against the exact running runtime:

```bash
gh workflow run production_operations.yml --ref main \
    -f operation=plan-order-sales-ownership-backfill \
    -f source_sha=<latest-main-sha> \
    -f expected_runtime_sha=<running-runtime-sha>
```

The plan reports only aggregate counts by Channel and an operation digest; order
identifiers never leave the production host. The fixed mapping prefers the sole
non-default membership and otherwise retains the default-only membership. Missing
memberships or multiple non-default memberships stop the plan.

After reviewing the aggregate counts and exact digest, run the reviewed write:

```bash
gh workflow run production_operations.yml --ref main \
    -f operation=apply-order-sales-ownership-backfill-reviewed \
    -f source_sha=<latest-main-sha> \
    -f expected_runtime_sha=<running-runtime-sha> \
    -f expected_plan_sha256=<reviewed-operation-digest>
```

The write holds the production deployment lock, recomputes the plan, creates and
verifies a fresh offsite MySQL backup, updates only still-null owner fields in one
transaction, and checks both completeness and Channel membership before commit.
Any drift requires a new read-only plan. Re-run `audit-store-isolation-data`
afterward; this operation does not move domains, content, catalog, or customers.

## Move the MOYAO storefront out of the native default Channel

After the dedicated `moyao-ai` Channel exists, its catalog assignment has been
reviewed, and the order-owner backfill is complete, plan the remaining storefront
migration against the exact running runtime:

```bash
gh workflow run production_operations.yml --ref main \
    -f operation=plan-moyao-default-store-migration \
    -f source_sha=<latest-main-sha> \
    -f expected_runtime_sha=<running-runtime-sha>
```

The plan contains aggregate counts and one exact operation digest, never customer,
product, asset, content, or profile identifiers. It requires the target storefront
to contain no content blocks, copies the default Channel's customer and catalog
memberships and any missing per-store entry-history rows to `moyao-ai`, copies the
StoreProfile and content setting, moves the default storefront business data to the
dedicated Channel, and transfers any default-owned historical sales after proving
they have no other public-store owner. Existing entry-history rows are preserved.

After reviewing the counts and digest, apply the fixed plan:

```bash
gh workflow run production_operations.yml --ref main \
    -f operation=apply-moyao-default-store-migration-reviewed \
    -f source_sha=<latest-main-sha> \
    -f expected_runtime_sha=<running-runtime-sha> \
    -f expected_plan_sha256=<reviewed-operation-digest>
```

The reviewed write holds the deployment lock, rechecks the complete plan, creates
and verifies a fresh offsite MySQL backup, commits one transaction, verifies that
all source memberships are represented in `moyao-ai`, and confirms that storefront
content no longer belongs to the native default Channel. A standalone read-only
verification is available as `verify-moyao-default-store-migration`. Domain transfer
still happens separately through the Admin impact preview after public API checks.

## Separate 2FA key recovery

The same fixed workflow can back up the two existing 2FA encryption keys to
`s3://yunqiao-vendure-prod-backup-079740175286-apne1/mysql/two-factor-key-backups/<source-sha>.json`.
This is an independent, versioned object outside the production host and outside
the database dump. It uses the existing private backup bucket and SSE-S3; it does
**not** create a separate permission boundary from readers of the `mysql/*` prefix.
No IAM policy, bucket setting, local AWS credential or application key is changed.

Run the read-only plan from the latest main:

```bash
gh workflow run production_operations.yml --ref main -f operation=plan-two-factor-backup
```

The plan checks bucket versioning, all four public-access blocks, bucket-owner
enforcement and the reviewed AES256 encryption default before reading any key.
The instance needs the corresponding bucket metadata read permissions and
`s3:GetObject`, `s3:GetObjectVersion`, `s3:PutObject` for the fixed prefix. A missing
permission stops the operation; it does not fall back to another account, bucket
or unencrypted upload. The workflow does not grant these permissions or enumerate
Secrets Manager/Parameter Store.

Only `TWO_FACTOR_DASHBOARD_ENCRYPTION_KEY` and `ADMIN_TWO_FACTOR_ENCRYPTION_KEY`
are extracted from the fixed production environment file. File ownership/mode,
duplicate definitions, key syntax and independence are checked; the effective
PM2 API and Worker values must match. No environment file is sourced or uploaded.
Python and the installed AWS CLI exchange payloads through seekable Linux memfd
objects, so keys never enter command arguments, temporary disk files, GitHub
runner files or logs.

Review the exact source SHA, object path and action, then use that plan hash:

```bash
gh workflow run production_operations.yml --ref main \
    -f operation=backup-two-factor-reviewed -f expected_plan_sha256=<reviewed-plan-sha256>
gh workflow run production_operations.yml --ref main -f operation=verify-two-factor-backup
```

The hash also binds the current key values and source file identity without
printing them. Upload uses `If-None-Match: *`; an existing object is verified,
never replaced. A conflicting or changed key stops the operation. After upload,
the exact returned S3 VersionId is read back into memory and both values are
compared in constant time, then source and running-process values are rechecked.
The explicit verify operation performs no write. All operations hold the same
production lock for the entire Python subprocess.

Save object path, VersionId, source SHA and `restoreVerified/sourceUnchanged`
results in the release record. Repeating the operation is safe. A new source
revision gets a new object, preserving earlier recovery versions. There is no
automatic backup deletion, key rotation, production `.env` restore, database
restore, account enrollment or service restart. The verification proves that the
saved keys can be fetched and match the running instance; it is not a complete
blank-host database/application disaster-recovery drill. A real environment
restore must use the recorded exact VersionId with the matching database backup
and retain the existing key values.

Linux memfd avoids application-created plaintext disk files; operating-system
memory and swap protections remain the existing host's responsibility.

## Verify repaired runtime dependencies

After the new main SHA is deployed, run:

```bash
gh workflow run production_operations.yml --ref main -f operation=verify-security-dependencies
```

This read-only operation requires the current runtime marker to equal the
workflow source SHA. It loads the dependencies from that validated immutable
runtime, rejects resolution outside the runtime, and checks the actual qs and
Tiptap vulnerability behavior. The result contains only package versions and
pass/fail evidence. It does not install dependencies or execute supplied code.

## Bound completed Node core dumps

The runtime release installs `vendure-node-core-retention.timer`, which runs five
minutes after boot and every fifteen minutes. Ubuntu Apport and its existing
three-day age policy remain enabled. The additional capacity policy is limited
to regular, singly linked Node UID 1000 dumps in `/var/lib/apport/coredump`.
It reads only filesystem and process-reference metadata, never dump contents,
environment files or crash reports.

The helper defaults to `--dry-run`; the installed oneshot service uses `--apply`.
It keeps the newest completed full diagnostic and removes older completed dumps
only when their allocated storage exceeds a 2 GiB soft budget. Active PIDs,
open descriptors, unknown names or owners, symlinks and changing metadata are
protected. Unverifiable permissions or references block the operation. Each
unlink rechecks directory and file identity and records only safe metadata.

If protected files or the latest individual dump exceed the budget, the helper
reports `protected-over-budget` and retains them. The existing root-disk health
threshold still applies. This maintenance neither changes process core limits
nor restarts Apport or the website. Backups, uploads, databases, logs and formal
runtime/frontend releases are outside its scope.
