import { Channel, Role, User } from '@vendure/core';
import { describe, expect, it } from 'vitest';

import { preferredAdminChannelToken } from './admin-two-factor.service';

function userWithChannels(channels: Array<{ id: string; code: string; token: string }>) {
    return new User({
        roles: [
            new Role({
                channels: channels.map(channel => new Channel(channel)),
            }),
        ],
    });
}

describe('preferredAdminChannelToken', () => {
    it('opens a single-store account directly in its only store', () => {
        expect(
            preferredAdminChannelToken(
                userWithChannels([{ id: 'store', code: 'moyao-ai', token: 'store-token' }]),
            ),
        ).toBe('store-token');
    });

    it('opens a multi-store platform account in the technical platform channel', () => {
        expect(
            preferredAdminChannelToken(
                userWithChannels([
                    { id: 'store', code: 'moyao-ai', token: 'store-token' },
                    { id: 'platform', code: '__default_channel__', token: 'platform-token' },
                ]),
            ),
        ).toBe('platform-token');
    });

    it('fails closed when an ambiguous multi-channel account has no platform channel', () => {
        expect(
            preferredAdminChannelToken(
                userWithChannels([
                    { id: 'a', code: 'store-a', token: 'store-a-token' },
                    { id: 'b', code: 'store-b', token: 'store-b-token' },
                ]),
            ),
        ).toBeUndefined();
    });
});
