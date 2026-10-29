// organize-imports-ignore -- Keep type-only dependencies separate from runtime imports.
import type { HomeNoticeItem } from '../../pages/home-page';
import type { StorefrontLanguage } from '../../types';
import { ChevronRight, ExternalLink } from 'lucide-react';

import { Sheet } from '../../storefront-ui/page-shell';

import { AnnouncementContent } from './announcement-content';

export function NoticeDetailSheet({
    item,
    language,
    onClose,
    onFollowTarget,
}: {
    item: HomeNoticeItem;
    language: StorefrontLanguage;
    onClose: () => void;
    onFollowTarget: () => void;
}) {
    const isZh = language === 'zh';
    const hasTarget =
        Boolean(item.linkUrl) || (item.targetType !== 'NONE' && Boolean(item.targetValue?.trim()));
    const actionLabel =
        item.ctaLabel.trim() ||
        (item.linkUrl ? (isZh ? '前往链接' : 'Open link') : isZh ? '查看详情' : 'View details');

    return (
        <Sheet
            title={isZh ? '系统公告' : 'Announcement'}
            language={language}
            onClose={onClose}
            className="notice-detail-sheet"
            initialFocus="dialog"
        >
            <div className="notice-detail-content">
                <h2 className="notice-detail-title type-page">
                    {item.title || (isZh ? '公告详情' : 'Notice details')}
                </h2>
                {item.content.trim() ? (
                    <AnnouncementContent className="notice-detail-body" content={item.content} />
                ) : (
                    <p className="notice-detail-body notice-detail-empty">
                        {isZh ? '此公告暂无更多内容。' : 'There are no additional details for this notice.'}
                    </p>
                )}
                {hasTarget ? (
                    <div className="notice-detail-actions">
                        <button
                            className="notice-detail-action"
                            type="button"
                            onClick={() => {
                                onClose();
                                onFollowTarget();
                            }}
                        >
                            <span>{actionLabel}</span>
                            {item.linkUrl ? (
                                <ExternalLink aria-hidden="true" />
                            ) : (
                                <ChevronRight aria-hidden="true" />
                            )}
                        </button>
                    </div>
                ) : null}
            </div>
        </Sheet>
    );
}
