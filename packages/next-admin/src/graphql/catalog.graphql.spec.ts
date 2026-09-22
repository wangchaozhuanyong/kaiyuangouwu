import { print } from 'graphql';
import { describe, expect, it } from 'vitest';

import { GET_CATALOG_CHANNELS } from './catalog.graphql';

describe('catalog GraphQL boundaries', () => {
    it('loads only the active channel instead of exposing the platform channel list', () => {
        const query = print(GET_CATALOG_CHANNELS);

        expect(query).toContain('activeChannel');
        expect(query).not.toContain('channels(');
        expect(query).not.toContain('manageableChannels');
    });
});
