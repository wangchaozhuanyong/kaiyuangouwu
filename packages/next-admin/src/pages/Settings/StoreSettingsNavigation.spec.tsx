import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { StoreSettingsNavigation } from './StoreSettingsNavigation';

describe('StoreSettingsNavigation', () => {
    it('renders payment and shipping as separate tabs', () => {
        const html = renderToStaticMarkup(
            <StoreSettingsNavigation
                tab="PAYMENT"
                onTabChange={vi.fn()}
                canReadFinance
                canReadBusinessSettings
            />,
        );

        expect(html).toContain('>支付</button>');
        expect(html).toContain('>配送</button>');
        expect(html).not.toContain('支付与交付');
    });
});
