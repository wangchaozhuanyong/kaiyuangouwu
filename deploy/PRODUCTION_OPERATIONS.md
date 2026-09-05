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

Normal deployment, verification, rollback and branch cleanup continue to use
the existing workflows described in `DEPLOYMENT_RUNBOOK.md`. This operation
does not promote an application release or change its version marker.

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
