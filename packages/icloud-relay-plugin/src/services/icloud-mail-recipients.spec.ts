import { simpleParser } from 'mailparser';
import { describe, expect, it } from 'vitest';

import {
    extractMailRecipients,
    matchMailRecipient,
    normalizeRecipients,
    storedMailRecipients,
} from './icloud-mail-recipients';

describe('recipient evidence for new and historical mail', () => {
    const virtuals = [
        { id: 'a', primaryAccountId: 'owner', aliasEmail: 'first@icloud.com' },
        { id: 'b', primaryAccountId: 'owner', aliasEmail: 'second@icloud.com' },
        { id: 'c', primaryAccountId: 'other', aliasEmail: 'foreign@icloud.com' },
    ];
    it('normalizes display names, brackets and repeated header values without reading body/sender', async () => {
        const parsed = await simpleParser(
            Buffer.from(
                [
                    'From: second@icloud.com',
                    'To: Person <FIRST@icloud.com>',
                    'Delivered-To: <first@icloud.com>',
                    'X-Original-To: first@icloud.com',
                    'Received: from example.com for <FIRST@icloud.com>; Sun, 13 Sep 2026 00:00:00 +0000',
                    '',
                    'Contact second@icloud.com about this message.',
                ].join('\r\n'),
            ),
        );
        expect(extractMailRecipients(parsed)).toEqual(['first@icloud.com']);
        expect(matchMailRecipient(extractMailRecipients(parsed), virtuals, 'owner').match?.id).toBe('a');
    });
    it('does not treat an address inside a quoted display name as the recipient', () => {
        expect(normalizeRecipients('"first@icloud.com" <stranger@example.com>')).toEqual([
            'stranger@example.com',
        ]);
    });
    it('excludes unquoted display names and comments while retaining separate bare recipients', () => {
        expect(
            normalizeRecipients(
                'first@icloud.com <stranger@example.com>, second@icloud.com (first@icloud.com)',
            ),
        ).toEqual(['stranger@example.com', 'second@icloud.com']);
        expect(normalizeRecipients('stranger@example.com (broken first@icloud.com')).toEqual([]);
    });
    it('never chooses the first match for conflicting recipients, or a different owner', () => {
        expect(matchMailRecipient(['first@icloud.com', 'second@icloud.com'], virtuals, 'owner')).toEqual({
            match: undefined,
            ambiguous: true,
        });
        expect(matchMailRecipient(['foreign@icloud.com'], virtuals, 'owner').match).toBeUndefined();
    });
    it('normalizes stored legacy addresses and leaves corrupt evidence unresolved', () => {
        expect(storedMailRecipients('[" Person <FIRST@icloud.com> ", "first@icloud.com"]')).toEqual([
            'first@icloud.com',
        ]);
        expect(storedMailRecipients('{invalid')).toEqual([]);
        expect(storedMailRecipients('{"body":"first@icloud.com"}')).toEqual([]);
    });
});
