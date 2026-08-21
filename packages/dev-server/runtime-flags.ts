export function shouldRunMigrations(
    env: { NODE_ENV?: string; RUN_MIGRATIONS?: string } = process.env as unknown as {
        NODE_ENV?: string;
        RUN_MIGRATIONS?: string;
    },
): boolean {
    if (env.NODE_ENV === 'production') {
        return env.RUN_MIGRATIONS === 'true';
    }
    return env.RUN_MIGRATIONS !== 'false';
}
