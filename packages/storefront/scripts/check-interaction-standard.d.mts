export function checkInteractionSource(file: string, source: string): string[];
export function auditInteractionStandard(): string[];
export function interactionSources(): Array<{ file: string; source: string }>;
export function auditInteractionRoutes(): string[];
export function assertInteractionStandard(violations?: readonly string[]): void;
export function checkRouteAdmission(
    routeNames: readonly string[],
    familyNames: readonly string[],
    routeFiles: readonly string[],
): string[];
