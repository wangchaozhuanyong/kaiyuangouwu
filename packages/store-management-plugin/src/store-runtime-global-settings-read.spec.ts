import { FieldNode, FragmentDefinitionNode, Kind, parse } from 'graphql';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
    GlobalSettingsReadInfo,
    isStoreRuntimeGlobalSettingsRead,
} from './store-runtime-global-settings-read';

function globalSettingsReadInfo(source: string): GlobalSettingsReadInfo {
    const document = parse(source);
    const operation = document.definitions.find(definition => definition.kind === Kind.OPERATION_DEFINITION);
    if (!operation || operation.kind !== Kind.OPERATION_DEFINITION) throw new Error('Missing operation');
    return {
        fieldNodes: operation.selectionSet.selections.filter(
            (selection): selection is FieldNode => selection.kind === Kind.FIELD,
        ),
        fragments: Object.fromEntries(
            document.definitions
                .filter(
                    (definition): definition is FragmentDefinitionNode =>
                        definition.kind === Kind.FRAGMENT_DEFINITION,
                )
                .map(fragment => [fragment.name.value, fragment]),
        ),
    };
}

describe('store globalSettings read scope', () => {
    it('allows the actual Admin custom-field bootstrap query', () => {
        const source = readFileSync(
            resolve(__dirname, '../../next-admin/src/custom-fields/custom-fields.graphql.ts'),
            'utf8',
        );
        const operation = source.match(/CUSTOM_FIELD_SERVER_CONFIG_QUERY = gql`([\s\S]*?)`;/)?.[1];
        expect(operation).toBeTruthy();
        if (!operation) throw new Error('Missing Admin bootstrap query');
        expect(isStoreRuntimeGlobalSettingsRead(globalSettingsReadInfo(operation))).toBe(true);
    });

    it.each([
        '{ globalSettings { trackInventory outOfStockThreshold } }',
        '{ config: globalSettings { languages: availableLanguages __typename } }',
        '{ globalSettings { ...Runtime ... on GlobalSettings { outOfStockThreshold } } } fragment Runtime on GlobalSettings { availableLanguages trackInventory }',
        '{ globalSettings { serverConfig { ...Schema __typename } } } fragment Schema on ServerConfig { entityCustomFields { entityName } }',
    ])('allows read-only runtime metadata: %s', source => {
        expect(isStoreRuntimeGlobalSettingsRead(globalSettingsReadInfo(source))).toBe(true);
    });

    it.each([
        '{ globalSettings { serverConfig { permissions { name } } } }',
        '{ globalSettings { serverConfig { secret: orderProcess { name } } } }',
        '{ globalSettings { availableLanguages hidden: id } }',
        '{ globalSettings { availableLanguages id @skip(if: true) } }',
        '{ globalSettings { ...Runtime } } fragment Runtime on GlobalSettings { availableLanguages id }',
        '{ globalSettings { serverConfig { ...Schema } } } fragment Schema on ServerConfig { permissions { name } }',
        '{ globalSettings { availableLanguages } globalSettings { serverConfig { permissions { name } } } }',
        '{ globalSettings { ...Missing } }',
        '{ globalSettings { ...Cycle } } fragment Cycle on GlobalSettings { availableLanguages ...Cycle }',
        '{ updateGlobalSettings { availableLanguages } }',
        '{ globalSettings }',
    ])('retains the platform boundary: %s', source => {
        expect(isStoreRuntimeGlobalSettingsRead(globalSettingsReadInfo(source))).toBe(false);
    });

    it('fails closed without resolver selections', () => {
        expect(isStoreRuntimeGlobalSettingsRead()).toBe(false);
        expect(isStoreRuntimeGlobalSettingsRead({ fieldNodes: [], fragments: {} })).toBe(false);
    });
});
