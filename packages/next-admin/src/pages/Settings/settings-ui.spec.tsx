import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SettingsContentSkeleton } from './settings-ui';

describe('SettingsContentSkeleton', () => {
    it('keeps a full-height content frame while settings data is initializing', () => {
        const html = renderToStaticMarkup(<SettingsContentSkeleton label="正在读取设置" sections={3} />);

        expect(html).toContain('aria-label="正在读取设置"');
        expect(html).toContain('aria-busy="true"');
        expect(html).toContain('min-h-[620px]');
        expect(html.match(/<section/g)).toHaveLength(4);
    });
});
