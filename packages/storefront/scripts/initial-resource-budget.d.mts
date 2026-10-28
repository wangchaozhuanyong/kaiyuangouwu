export function staticModuleImports(source: string): string[];

export const initialRouteRoots: Record<string, RegExp[]>;

export function initialResourceCosts(
    distRoot: string,
    html: string,
): Promise<Record<string, { jsBytes: number; cssBytes: number; assets: string[] }>>;
