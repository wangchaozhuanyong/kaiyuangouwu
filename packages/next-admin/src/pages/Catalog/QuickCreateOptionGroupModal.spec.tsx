// @vitest-environment jsdom

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FeatureHelpProvider } from '../../components/FeatureHelp';
import { QuickCreateOptionGroupModal } from './QuickCreateOptionGroupModal';

vi.mock('@apollo/client/react', () => ({
    useMutation: () => [vi.fn(), { loading: false }],
}));

describe('QuickCreateOptionGroupModal', () => {
    it('returns null when isOpen is false', () => {
        const html = renderToStaticMarkup(
            <FeatureHelpProvider>
                <QuickCreateOptionGroupModal
                    isOpen={false}
                    onClose={vi.fn()}
                    onCreated={vi.fn()}
                    isSingleVariantWithoutOptions={false}
                />
            </FeatureHelpProvider>,
        );
        expect(html).toBe('');
    });

    it('renders modal with presets and upgrade message when isSingleVariantWithoutOptions is true', () => {
        const html = renderToStaticMarkup(
            <FeatureHelpProvider>
                <QuickCreateOptionGroupModal
                    isOpen={true}
                    onClose={vi.fn()}
                    onCreated={vi.fn()}
                    isSingleVariantWithoutOptions={true}
                />
            </FeatureHelpProvider>,
        );

        expect(html).toContain('快速新建商品销售规格');
        expect(html).toContain('智能平滑升级多规格');
        expect(html).toContain('售卖包装');
        expect(html).toContain('单盒, 整条');
        expect(html).toContain('规格属性名称');
        expect(html).toContain('规格选项值');
        expect(html).toContain('确定并生成规格行');
    });

    it('omits upgrade message when already multi-variant', () => {
        const html = renderToStaticMarkup(
            <FeatureHelpProvider>
                <QuickCreateOptionGroupModal
                    isOpen={true}
                    onClose={vi.fn()}
                    onCreated={vi.fn()}
                    isSingleVariantWithoutOptions={false}
                />
            </FeatureHelpProvider>,
        );

        expect(html).not.toContain('智能平滑升级多规格');
    });
});
