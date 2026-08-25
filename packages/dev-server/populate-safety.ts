const allowedNodeEnvironments = new Set(['development', 'test']);
const productionDatabasePattern = /(^|[._-])prod(?:uction)?($|[._-])/i;

/**
 * The dev population command clears every table before inserting sample data.
 * Keep it impossible to run against a production-shaped environment by mistake.
 */
export function assertSafeDevPopulateEnvironment(environment: NodeJS.ProcessEnv = process.env): void {
    const nodeEnvironment = environment.NODE_ENV?.trim().toLowerCase() ?? '';
    const databaseName = environment.DB_NAME?.trim() ?? '';
    const blockers: string[] = [];

    if (!allowedNodeEnvironments.has(nodeEnvironment)) {
        blockers.push(`NODE_ENV must be development or test (received ${nodeEnvironment || 'unset'})`);
    }
    if (productionDatabasePattern.test(databaseName)) {
        blockers.push(`DB_NAME looks like a production database (${databaseName})`);
    }

    if (blockers.length > 0) {
        throw new Error(
            `Refusing to run the destructive development population command: ${blockers.join('; ')}.`,
        );
    }
}
