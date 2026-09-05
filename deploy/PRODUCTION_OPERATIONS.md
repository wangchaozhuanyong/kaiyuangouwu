# Production operations

`Production Operations` uses the existing GitHub OIDC deployment role and AWS SSM
connection to the Vendure production instance. It does not need a local AWS login,
an open SSH port, or a stored AWS access key. The external SSH key remains a fallback.

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
