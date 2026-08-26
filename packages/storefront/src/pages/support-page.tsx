import { useRouter } from '@tanstack/react-router';
import { Headphones } from 'lucide-react';

import { ManagedContentSection } from '../storefront-ui/content-ui';
import { EmptyState, Subpage } from '../storefront-ui/page-shell';
import { useStorefront } from '../StorefrontContext';
import { Product, StorefrontContentBlock, StorefrontContentTargetType, StorefrontLanguage } from '../types';

// TODO: Fix internal imports later

interface SupportPageProps {
    content?: StorefrontContentBlock;
    products: Product[];
    language: StorefrontLanguage;
    onContentTarget: (targetType: StorefrontContentTargetType, targetValue: string | null) => void;
}

export function SupportPage() {
    const router = useRouter();
    const goBack = () => router.history.back();
    const { content, products, language, onContentTarget } = useStorefront<SupportPageProps>();
    const isZh = language === 'zh';
    return (
        <Subpage
            title={isZh ? '客服中心' : 'Customer support'}
            language={language}
            onBack={goBack}
            surfaceColor={content?.backgroundColor}
        >
            {content ? (
                <ManagedContentSection
                    block={content}
                    products={products}
                    onContentTarget={onContentTarget}
                />
            ) : (
                <EmptyState
                    icon={<Headphones />}
                    title={isZh ? '客服信息暂未配置' : 'Support is not configured yet'}
                    detail={
                        isZh
                            ? '待商家配置电话、邮箱或在线客服后，将在这里显示'
                            : 'Phone, email, or online support will appear here after merchant setup'
                    }
                />
            )}
        </Subpage>
    );
}
