import { ConfigurableOperation } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';

export function numberArg(operation: ConfigurableOperation | undefined, name: string): number {
    const value = operationArgument(operation, name);
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return 0;
}

export function stringArg(operation: ConfigurableOperation | undefined, name: string): string {
    const value = operationArgument(operation, name);
    return typeof value === 'string' ? value : '';
}

export function idListArg(operation: ConfigurableOperation | undefined, name: string): ID[] {
    const value = operationArgument(operation, name);
    if (Array.isArray(value)) return stringIds(value);
    if (typeof value !== 'string' || !value.trim()) return [];
    try {
        const parsed = JSON.parse(value) as unknown;
        return Array.isArray(parsed) ? stringIds(parsed) : [];
    } catch {
        return [];
    }
}

function operationArgument(operation: ConfigurableOperation | undefined, name: string): unknown {
    const args = operation?.args as unknown;
    if (Array.isArray(args)) {
        return (args as Array<{ name?: string; value?: unknown }>).find(argument => argument.name === name)
            ?.value;
    }
    return args && typeof args === 'object' ? (args as Record<string, unknown>)[name] : undefined;
}

function stringIds(value: unknown[]): ID[] {
    return value.filter((item): item is ID => typeof item === 'string');
}
