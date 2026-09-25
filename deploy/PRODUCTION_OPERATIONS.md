# Production operations

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
`order.salesChannelId`, including orders for deleted variants. It reports only
Channel codes and aggregate order and order-line counts; it does not publish
order IDs, customer details, SKU labels, or credentials. A null sales owner is
reported separately. This evidence identifies historical dependencies but is
not an ownership migration plan or permission to detach a Channel. Review any
default-Channel, other-store, or unresolved sale before preparing a separate
scoped migration.

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
