import { getVariableValues, Kind, validate } from 'graphql';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import {
    generatedFile,
    generateIcloudAdminContract,
    icloudAdminSchema,
} from '../../../../scripts/codegen/icloud-admin-contract';
import * as next from '../../../next-admin/src/graphql/icloud-relay.graphql';
import * as legacy from '../dashboard/icloud-relay.graphql';

import {
    BatchCreateIcloudVirtualEmailsDocument,
    UpdateIcloudPrimaryAccountDocument,
    UpdateIcloudVirtualEmailDocument,
} from './admin.generated';

// Validate the real schema/document boundary; mock mutation handlers would accept the broken arguments.
describe('iCloud admin API contract', () => {
    it('keeps both admin clients valid against the current server schema', async () => {
        const schema = await icloudAdminSchema();
        for (const documents of [next, legacy])
            for (const [name, document] of Object.entries(documents)) {
                expect(
                    validate(schema, document).map(error => error.message),
                    name,
                ).toEqual([]);
            }
        expect(next.UPDATE_ICLOUD_VIRTUAL_EMAIL_MUTATION).toBe(legacy.updateIcloudVirtualEmailMutation);
        expect(next.UPDATE_ICLOUD_PRIMARY_ACCOUNT_MUTATION).toBe(legacy.updateIcloudPrimaryAccountMutation);
        expect(next.BATCH_CREATE_ICLOUD_VIRTUAL_EMAILS_MUTATION).toBe(
            legacy.batchCreateIcloudVirtualEmailsMutation,
        );
    });

    it('requires generated documents and variable types to match the checked-in server schema', async () => {
        expect(await readFile(generatedFile, 'utf8')).toBe(await generateIcloudAdminContract());
    }, 30000);

    it('accepts current update/import payloads and rejects the previously shipped payloads', async () => {
        const schema = await icloudAdminSchema();
        const cases = [
            [
                UpdateIcloudVirtualEmailDocument,
                { input: { id: '1', note: '' } },
                { id: '1', input: { note: '备注' } },
            ],
            [
                UpdateIcloudPrimaryAccountDocument,
                { input: { id: '1', note: '备注' } },
                { id: '1', input: { note: '备注' } },
            ],
            [
                BatchCreateIcloudVirtualEmailsDocument,
                { input: { primaryAccountId: '1', rawInput: 'alias@example.com 备注' } },
                { input: { primaryAccountId: '1', items: [{ aliasEmail: 'alias@example.com' }] } },
            ],
        ] as const;
        for (const [document, current, previous] of cases) {
            const operation = document.definitions.find(
                definition => definition.kind === Kind.OPERATION_DEFINITION,
            );
            if (!operation || operation.kind !== Kind.OPERATION_DEFINITION)
                throw new Error('Operation missing');
            expect(
                getVariableValues(schema, operation.variableDefinitions ?? [], current).errors,
            ).toBeUndefined();
            expect(
                getVariableValues(schema, operation.variableDefinitions ?? [], previous).errors?.length,
            ).toBeGreaterThan(0);
        }
    });
});
