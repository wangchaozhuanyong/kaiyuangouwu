import { useMemo } from 'react';
import {
    catalogReferenceRequest,
    resolveCatalogReferences,
    type CatalogReferenceKind,
    type CatalogReferenceResult,
} from '../utils/catalog-references';
import { useAdminQuery } from './use-admin-query';

export function useCatalogReferences(
    ids: readonly string[],
    kind: CatalogReferenceKind = 'products',
    enabled = true,
    includeVariants = false,
) {
    const identity = JSON.stringify(ids);
    const request = useMemo(
        () => catalogReferenceRequest(JSON.parse(identity), kind, includeVariants),
        [identity, kind, includeVariants],
    );
    const query = useAdminQuery<CatalogReferenceResult>(request.document, {
        variables: request.variables,
        skip: !enabled || !request.batches.length,
        pollInterval: 30_000,
        errorPolicy: 'all',
    });
    const failures = (error: unknown): boolean | string[] => {
        if (!error) return false;
        const errors = (error as { errors?: Array<{ path?: readonly (string | number)[] }> }).errors;
        // A transport/permission failure cannot prove an identity was deleted. GraphQL
        // field failures only make their own batch unknown; completed siblings survive.
        if (!errors?.length || errors.some(item => !item.path?.length)) return true;
        return errors.map(item => String(item.path![0]));
    };
    const references = resolveCatalogReferences(
        request.batches,
        enabled ? query.data : undefined,
        failures(query.error),
    );
    return {
        ...query,
        recheck: async () => {
            const result = await query.refetch();
            return resolveCatalogReferences(request.batches, result.data, failures(result.error));
        },
        references,
        available: references.filter(reference => reference.state === 'available'),
        unavailable: references.filter(reference => reference.state === 'unavailable'),
        unknown: references.filter(reference => reference.state === 'unknown'),
    };
}
