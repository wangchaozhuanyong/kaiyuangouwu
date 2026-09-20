import { describe, expect, it } from 'vitest';

import { RequestContext } from '../../api/common/request-context';

import { catalogReadChannelId } from './catalog-read-scope';

describe('catalogReadChannelId', () => {
    it.each(['default-channel-id', 'moyao-channel-id', 'mjj-channel-id'])(
        'keeps catalog reads scoped to the selected Channel %s',
        channelId => {
            expect(catalogReadChannelId({ channelId } as RequestContext)).toBe(channelId);
        },
    );

    it('does not manufacture a platform-wide scope without a selected Channel', () => {
        expect(catalogReadChannelId({ channelId: undefined } as RequestContext)).toBeUndefined();
    });
});
