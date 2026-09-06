import { Kind } from 'graphql';
import { describe, expect, it } from 'vitest';
import { SHARING_SETTINGS_QUERY } from './sharing.graphql';

describe('sharing settings query', () => {
    it('loads channel settings without referral reports or business metrics', () => {
        const operation = SHARING_SETTINGS_QUERY.definitions.find(
            node => node.kind === Kind.OPERATION_DEFINITION,
        );
        expect(
            operation?.selectionSet.selections.map(node => (node.kind === Kind.FIELD ? node.name.value : '')),
        ).toEqual(['activeChannel', 'referralProgram']);
    });
});
