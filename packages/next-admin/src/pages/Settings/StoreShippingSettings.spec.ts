import { describe, expect, it } from 'vitest';
import { STORE_SHIPPING_SETTINGS_QUERY } from './shipping-manager-utils';

describe('dedicated store shipping query', () => {
    it('requests shipping configuration without platform directories or payment settings', () => {
        const operation = STORE_SHIPPING_SETTINGS_QUERY.definitions.find(
            definition => definition.kind === 'OperationDefinition',
        );
        if (!operation || operation.kind !== 'OperationDefinition')
            throw new Error('Missing shipping operation');
        const fields = operation.selectionSet.selections.map(selection =>
            selection.kind === 'Field' ? selection.name.value : 'fragment',
        );
        expect(fields).toEqual([
            'activeChannel',
            'shippingMethods',
            'shippingEligibilityCheckers',
            'shippingCalculators',
            'fulfillmentHandlers',
        ]);
        expect(operation.variableDefinitions?.map(variable => variable.variable.name.value)).toEqual([
            'shippingMethodOptions',
        ]);
    });
});
