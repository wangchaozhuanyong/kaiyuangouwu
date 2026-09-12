import { generate } from '@graphql-codegen/cli';
import { buildASTSchema, Kind, parse, printSchema } from 'graphql';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { format } from 'prettier';

import { adminApiExtensions } from '../../packages/icloud-relay-plugin/src/api/api-extensions';

const root = path.resolve(__dirname, '../..');
export const operationsFile = path.join(root, 'packages/icloud-relay-plugin/src/client/admin.graphql');
export const generatedFile = path.join(root, 'packages/icloud-relay-plugin/src/client/admin.generated.ts');

export async function icloudAdminSchema() {
    const common = parse(
        await readFile(path.join(root, 'packages/core/src/api/schema/common/common-types.graphql'), 'utf8'),
    );
    return buildASTSchema({
        kind: Kind.DOCUMENT,
        definitions: [
            ...parse('type Query { _contract: Boolean } type Mutation { _contract: Boolean }').definitions,
            ...common.definitions.filter(
                definition =>
                    'name' in definition && ['Node', 'DateTime'].includes(definition.name?.value ?? ''),
            ),
            ...adminApiExtensions.definitions,
        ],
    });
}

export async function generateIcloudAdminContract() {
    const results = await generate(
        {
            silent: true,
            schema: printSchema(await icloudAdminSchema()),
            documents: operationsFile,
            generates: {
                [generatedFile]: {
                    plugins: ['typescript', 'typescript-operations', 'typed-document-node'],
                    config: {
                        skipTypename: true,
                        enumsAsTypes: true,
                        useTypeImports: true,
                        scalars: { DateTime: 'string' },
                    },
                },
            },
        },
        false,
    );
    return format(
        '// Generated from the server schema and client/admin.graphql. Do not edit.\n' +
            '// Refresh: bun scripts/codegen/icloud-admin-contract.ts\n/* eslint-disable */\n' +
            results[0].content,
        { parser: 'typescript', singleQuote: true, printWidth: 110, tabWidth: 4 },
    );
}

async function main() {
    const output = await generateIcloudAdminContract();
    if (process.argv.includes('--check')) {
        if ((await readFile(generatedFile, 'utf8')) !== output) {
            throw new Error(
                'iCloud Admin contract is stale. Run bun scripts/codegen/icloud-admin-contract.ts',
            );
        }
    } else await writeFile(generatedFile, output);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.join(__dirname, 'icloud-admin-contract.ts')) {
    void main().catch((error: unknown) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
