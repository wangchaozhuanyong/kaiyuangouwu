import { GraphQLResolveInfo, Kind, SelectionSetNode } from 'graphql';

export type GlobalSettingsReadInfo = Pick<GraphQLResolveInfo, 'fieldNodes' | 'fragments'>;

const runtimeFields = new Set(['__typename', 'availableLanguages', 'trackInventory', 'outOfStockThreshold']);
const schemaFields = new Set(['__typename', 'entityCustomFields']);

/** Store pages need read-only field definitions and inventory defaults, not platform administration. */
export function isStoreRuntimeGlobalSettingsRead(info?: GlobalSettingsReadInfo): boolean {
    if (!info?.fieldNodes.length) return false;

    const allows = (
        selectionSet: SelectionSetNode | undefined,
        schema: boolean,
        visited = new Set<string>(),
        depth = 0,
    ): boolean => {
        if (!selectionSet?.selections.length || depth > 32) return false;
        return selectionSet.selections.every(selection => {
            if (selection.kind === Kind.INLINE_FRAGMENT) {
                return allows(selection.selectionSet, schema, visited, depth + 1);
            }
            if (selection.kind === Kind.FRAGMENT_SPREAD) {
                const fragmentName = selection.name.value;
                const fragment = info.fragments[fragmentName];
                if (!fragment || visited.has(fragmentName)) return false;
                return allows(fragment.selectionSet, schema, new Set([...visited, fragmentName]), depth + 1);
            }
            // Inspect schema names, never aliases, operation names or client-supplied directives.
            const name = selection.name.value;
            if (!schema && name === 'serverConfig') {
                return allows(selection.selectionSet, true, visited, depth + 1);
            }
            return (schema ? schemaFields : runtimeFields).has(name);
        });
    };

    return info.fieldNodes.every(
        field => field.name.value === 'globalSettings' && allows(field.selectionSet, false),
    );
}
