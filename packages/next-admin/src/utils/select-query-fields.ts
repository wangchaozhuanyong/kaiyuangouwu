import { Kind, visit, type DocumentNode, type OperationDefinitionNode } from 'graphql';

const cache = new WeakMap<DocumentNode, Map<string, DocumentNode>>();

/** Reuse the existing schema and fragments while omitting unrelated page resources. */
export function selectQueryFields(document: DocumentNode, fields: readonly string[]): DocumentNode {
    const key = fields.join('|');
    const documentCache = cache.get(document) ?? new Map<string, DocumentNode>();
    cache.set(document, documentCache);
    const cached = documentCache.get(key);
    if (cached) return cached;
    const allowed = new Set(fields);
    const operations = document.definitions
        .filter(definition => definition.kind === Kind.OPERATION_DEFINITION)
        .map(operation => ({
            ...operation,
            selectionSet: {
                ...operation.selectionSet,
                selections: operation.selectionSet.selections.filter(
                    selection => selection.kind === Kind.FIELD && allowed.has(selection.name.value),
                ),
            },
        }));
    const fragments = new Map(
        document.definitions
            .filter(definition => definition.kind === Kind.FRAGMENT_DEFINITION)
            .map(fragment => [fragment.name.value, fragment]),
    );
    const referenced = new Set<string>();
    const collect = (node: DocumentNode | OperationDefinitionNode) =>
        visit(node, {
            FragmentSpread(node) {
                if (referenced.has(node.name.value)) return;
                referenced.add(node.name.value);
                const fragment = fragments.get(node.name.value);
                if (fragment) collect({ kind: Kind.DOCUMENT, definitions: [fragment] });
            },
        });
    operations.forEach(collect);
    const definitions: DocumentNode['definitions'] = [
        ...operations,
        ...[...referenced].flatMap(name => (fragments.get(name) ? [fragments.get(name)!] : [])),
    ];
    const variables = new Set<string>();
    visit(
        { kind: Kind.DOCUMENT, definitions },
        {
            VariableDefinition() {
                return false;
            },
            Variable(node) {
                variables.add(node.name.value);
            },
        },
    );
    const result: DocumentNode = {
        kind: Kind.DOCUMENT,
        definitions: definitions.map(definition =>
            definition.kind === Kind.OPERATION_DEFINITION
                ? {
                      ...definition,
                      variableDefinitions: definition.variableDefinitions?.filter(variable =>
                          variables.has(variable.variable.name.value),
                      ),
                  }
                : definition,
        ),
    };
    documentCache.set(key, result);
    return result;
}
