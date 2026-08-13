export type DataTableErrorKind = 'forbidden' | 'generic';

export function getDataTableErrorKind(error: unknown): DataTableErrorKind {
    if (!error || typeof error !== 'object') {
        return 'generic';
    }

    const graphqlError = error as {
        extensions?: { code?: string };
        response?: { errors?: Array<{ extensions?: { code?: string } }> };
    };
    const codes = [
        graphqlError.extensions?.code,
        ...(graphqlError.response?.errors?.map(item => item.extensions?.code) ?? []),
    ];

    return codes.includes('FORBIDDEN') ? 'forbidden' : 'generic';
}
