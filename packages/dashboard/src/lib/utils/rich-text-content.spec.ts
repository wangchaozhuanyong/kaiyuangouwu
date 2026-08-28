import { describe, expect, it } from 'vitest';

import { hasMeaningfulRichText } from './rich-text-content.js';

describe('hasMeaningfulRichText', () => {
    it.each([undefined, null, '', '   ', '<p></p>', '<p><br></p>', '<p>&nbsp;</p>', '<p>\u200b</p>'])(
        'rejects empty rich-text content: %s',
        value => {
            expect(hasMeaningfulRichText(value)).toBe(false);
        },
    );

    it.each(['商品描述', '<p>商品描述</p>', '<p>&amp;</p>', '<table><tr><td>参数</td></tr></table>'])(
        'accepts visible rich-text content: %s',
        value => {
            expect(hasMeaningfulRichText(value)).toBe(true);
        },
    );
});
