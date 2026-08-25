import { setupI18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ChannelCodeLabel, useChannelDisplayName } from './channel-code-label.js';

const i18n = setupI18n({
    locale: 'zh_Hans',
    messages: {
        zh_Hans: {
            // Lingui compiles source-message IDs to stable runtime hashes.
            GeSePD: '默认店铺',
            'channel.cnMainland': '中国大陆',
            'channel.malaysia': '马来西亚',
        },
    },
});

function DisplayNameAttribute({ code }: Readonly<{ code: string | undefined }>) {
    const displayName = useChannelDisplayName(code);
    return <span data-display-name={displayName} />;
}

function renderWithI18n(children: React.ReactNode) {
    return renderToStaticMarkup(<I18nProvider i18n={i18n}>{children}</I18nProvider>);
}

describe('Channel display names', () => {
    it.each([
        ['__default_channel__', '默认店铺'],
        ['cn-mainland', '中国大陆'],
        ['my-malaysia', '马来西亚'],
    ])('localizes the known Channel code %s', (code, expected) => {
        expect(renderWithI18n(<ChannelCodeLabel code={code} />)).toBe(expected);
    });

    it('keeps custom Channel codes unchanged', () => {
        expect(renderWithI18n(<ChannelCodeLabel code="partner-store" />)).toBe('partner-store');
    });

    it('provides the same display rule for string-only UI such as tooltips', () => {
        const markup = renderWithI18n(<DisplayNameAttribute code="__default_channel__" />);

        expect(markup).toContain('data-display-name="默认店铺"');
    });
});
