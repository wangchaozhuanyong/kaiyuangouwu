import { ExternalLink, Plus } from 'lucide-react';
import {
    defaultStorefrontSeoDocument,
    type StorefrontSeoDocument,
    type StorefrontSeoIdentity,
    type StorefrontSeoSettings,
} from '../../../../store-management-plugin/src/seo/storefront-seo.contract';
import { AdminButton, AdminInput, AdminSelect, AdminTextArea } from '../../components/AdminControls';
import { AdminField } from '../../components/AdminField';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import type { StorefrontSeoRecord } from '../../graphql/storefront-seo.graphql';
import { lines, seoLocalDateTime, seoPublicPath } from './storefront-seo-utils';
export function SeoPublishedPreview({
    record,
    settings,
    publicOrigin,
}: {
    record: StorefrontSeoRecord;
    settings?: StorefrontSeoSettings | null;
    publicOrigin?: string;
}) {
    const document = record.published as StorefrontSeoDocument | null;
    const language = record.languageCode === 'en' ? 'en' : 'zh_Hans';
    const allowed = Boolean(
        settings?.indexingEnabled &&
        settings.enabledLanguages.includes(language) &&
        document?.indexMode !== 'NOINDEX',
    );
    return (
        <section className="space-y-2 rounded-xl bg-slate-50 p-4">
            <h2 className="flex items-center gap-2 font-semibold">
                公开版本与继承来源
                <FeatureHelpButton
                    title="公开版本与继承来源"
                    content={{
                        purpose: '核对当前店铺、语言的公开版本及默认继承内容。',
                        requirements: [
                            '核对当前店铺、语言与相应权限',
                            '使用真实内容和可追溯证据，缺项保留待核验',
                        ],
                        example: '检查继承资料后保存本店覆盖草稿，核对完成再发布。',
                        impact: '保存草稿与发布分开；搜索收录、排名与 AI 引用以实际外部结果为准。',
                    }}
                />
            </h2>
            <p className="break-all text-sm">
                {publicOrigin ?? ''}
                {seoPublicPath(record as StorefrontSeoIdentity)}
            </p>
            {publicOrigin && (
                <a
                    className="inline-flex items-center gap-2 text-sm text-blue-600"
                    href={`${publicOrigin}${seoPublicPath(record as StorefrontSeoIdentity)}`}
                    target="_blank"
                    rel="noreferrer"
                >
                    打开当前公开页面 <ExternalLink size={16} />
                </a>
            )}
            <p className="text-sm">
                标题来源：
                {document?.title ? `页面覆盖 · ${document.title}` : '原始店铺 / 商品 / 分类 / 内容标题'}
            </p>
            <p className="text-sm">
                描述来源：
                {document?.description
                    ? `页面覆盖 · ${document.description}`
                    : settings?.defaultDescriptions[language]
                      ? `店铺默认 · ${settings.defaultDescriptions[language]}`
                      : '原始公开内容'}
            </p>
            <p className="text-sm">
                分享图片来源：{document?.shareImageUrl || settings?.shareImageUrl || '原始公开素材'}
            </p>
            <p className="text-sm text-slate-500">
                {settings === undefined
                    ? '店铺全局策略未读取；此编辑器只显示对应实体的覆盖来源。'
                    : allowed
                      ? '配置允许收录；仍需满足 LIVE、主域名和内容发布条件。'
                      : '配置不允许收录。'}
                最终状态以公开页面响应和搜索平台检验为准。
            </p>
        </section>
    );
}

export function SeoDocumentFields({
    value,
    onChange,
    article,
    disabled,
}: {
    value: StorefrontSeoDocument;
    onChange: (value: StorefrontSeoDocument) => void;
    article: boolean;
    disabled: boolean;
}) {
    const content = value.article ?? defaultStorefrontSeoDocument('ARTICLE').article!;
    return (
        <div className="space-y-4">
            <AdminField label="搜索标题" description="留空继承原始内容；文章必须填写。">
                <AdminInput
                    disabled={disabled}
                    value={value.title}
                    onChange={event => onChange({ ...value, title: event.target.value })}
                />
            </AdminField>
            <AdminField label="搜索描述" layout="stacked">
                <AdminTextArea
                    disabled={disabled}
                    rows={3}
                    value={value.description}
                    onChange={event => onChange({ ...value, description: event.target.value })}
                />
            </AdminField>
            <AdminField label="收录规则">
                <AdminSelect
                    disabled={disabled}
                    value={value.indexMode}
                    onChange={event =>
                        onChange({
                            ...value,
                            indexMode: event.target.value as StorefrontSeoDocument['indexMode'],
                        })
                    }
                >
                    <option value="INHERIT">继承店铺</option>
                    <option value="INDEX">允许（仍受店铺与发布条件限制）</option>
                    <option value="NOINDEX">不允许</option>
                </AdminSelect>
            </AdminField>
            <div className="grid gap-3 md:grid-cols-2">
                <AdminField label="分享标题">
                    <AdminInput
                        disabled={disabled}
                        value={value.shareTitle}
                        onChange={event => onChange({ ...value, shareTitle: event.target.value })}
                    />
                </AdminField>
                <AdminField label="分享图片">
                    <AdminInput
                        type="url"
                        disabled={disabled}
                        value={value.shareImageUrl}
                        onChange={event => onChange({ ...value, shareImageUrl: event.target.value })}
                    />
                </AdminField>
            </div>
            <AdminField label="分享描述" layout="stacked">
                <AdminTextArea
                    rows={2}
                    disabled={disabled}
                    value={value.shareDescription}
                    onChange={event => onChange({ ...value, shareDescription: event.target.value })}
                />
            </AdminField>
            {article && (
                <section className="space-y-4">
                    <h2 className="flex items-center gap-2 font-semibold">
                        GEO 知识正文与审核
                        <FeatureHelpButton
                            title="GEO 知识正文与审核"
                            content={{
                                purpose: '维护可核验的知识正文、作者、审核人和审核时间。',
                                requirements: [
                                    '核对当前店铺、语言与相应权限',
                                    '使用真实内容和可追溯证据，缺项保留待核验',
                                ],
                                example: '为一篇购买指南补齐真实来源，审核后发布已保存版本。',
                                impact: '保存草稿与发布分开；搜索收录、排名与 AI 引用以实际外部结果为准。',
                            }}
                        />
                    </h2>
                    <p className="text-sm text-slate-500">
                        先回答真实问题，再说明适用范围和证据。案例、认证、评价、价格和服务地区需核实。
                    </p>
                    <AdminField label="简明答案摘要" layout="stacked">
                        <AdminTextArea
                            rows={3}
                            disabled={disabled}
                            value={content.summary}
                            onChange={event =>
                                onChange({ ...value, article: { ...content, summary: event.target.value } })
                            }
                        />
                    </AdminField>
                    <AdminField label="正文（Markdown）" layout="stacked">
                        <AdminTextArea
                            rows={14}
                            disabled={disabled}
                            value={content.body}
                            onChange={event =>
                                onChange({ ...value, article: { ...content, body: event.target.value } })
                            }
                        />
                    </AdminField>
                    <div className="grid gap-3 md:grid-cols-2">
                        <AdminField label="作者">
                            <AdminInput
                                disabled={disabled}
                                value={content.authorName}
                                onChange={event =>
                                    onChange({
                                        ...value,
                                        article: { ...content, authorName: event.target.value },
                                    })
                                }
                            />
                        </AdminField>
                        <AdminField label="事实审核人">
                            <AdminInput
                                disabled={disabled}
                                value={content.reviewerName}
                                onChange={event =>
                                    onChange({
                                        ...value,
                                        article: { ...content, reviewerName: event.target.value },
                                    })
                                }
                            />
                        </AdminField>
                    </div>
                    <AdminField label="实际审核时间">
                        <AdminInput
                            type="datetime-local"
                            disabled={disabled}
                            value={seoLocalDateTime(content.reviewedAt)}
                            onChange={event =>
                                onChange({
                                    ...value,
                                    article: {
                                        ...content,
                                        reviewedAt: event.target.value
                                            ? new Date(event.target.value).toISOString()
                                            : null,
                                    },
                                })
                            }
                        />
                    </AdminField>
                    <AdminField
                        label="关联商品 ID"
                        description="每行一个当前店铺真实商品 ID。"
                        layout="stacked"
                    >
                        <AdminTextArea
                            rows={2}
                            disabled={disabled}
                            value={content.relatedProductIds.join('\n')}
                            onChange={event =>
                                onChange({
                                    ...value,
                                    article: { ...content, relatedProductIds: lines(event.target.value) },
                                })
                            }
                        />
                    </AdminField>
                    <h3 className="flex items-center gap-2 font-medium">
                        事实来源
                        <FeatureHelpButton
                            title="事实来源"
                            content={{
                                purpose: '记录支持当前正文的真实来源网址和说明。',
                                requirements: [
                                    '核对当前店铺、语言与相应权限',
                                    '使用真实内容和可追溯证据，缺项保留待核验',
                                ],
                                example: '引用实际产品说明网址，并核对它支持文中所述事实。',
                                impact: '保存草稿与发布分开；搜索收录、排名与 AI 引用以实际外部结果为准。',
                            }}
                        />
                    </h3>
                    {content.sources.map((source, index) => (
                        <div key={index} className="grid gap-3 md:grid-cols-3">
                            <AdminField label="来源标题">
                                <AdminInput
                                    disabled={disabled}
                                    value={source.label}
                                    onChange={event =>
                                        onChange({
                                            ...value,
                                            article: {
                                                ...content,
                                                sources: content.sources.map((item, position) =>
                                                    position === index
                                                        ? { ...item, label: event.target.value }
                                                        : item,
                                                ),
                                            },
                                        })
                                    }
                                />
                            </AdminField>
                            <AdminField label="来源地址">
                                <AdminInput
                                    type="url"
                                    disabled={disabled}
                                    value={source.url}
                                    onChange={event =>
                                        onChange({
                                            ...value,
                                            article: {
                                                ...content,
                                                sources: content.sources.map((item, position) =>
                                                    position === index
                                                        ? { ...item, url: event.target.value }
                                                        : item,
                                                ),
                                            },
                                        })
                                    }
                                />
                            </AdminField>
                            <div className="flex items-end gap-2">
                                <AdminField label="实际查阅日期">
                                    <AdminInput
                                        type="date"
                                        disabled={disabled}
                                        value={source.accessedAt?.slice(0, 10) ?? ''}
                                        onChange={event =>
                                            onChange({
                                                ...value,
                                                article: {
                                                    ...content,
                                                    sources: content.sources.map((item, position) =>
                                                        position === index
                                                            ? {
                                                                  ...item,
                                                                  accessedAt: event.target.value || null,
                                                              }
                                                            : item,
                                                    ),
                                                },
                                            })
                                        }
                                    />
                                </AdminField>
                                <AdminButton
                                    className="inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium disabled:opacity-50 text-slate-600 hover:bg-slate-100"
                                    disabled={disabled}
                                    onClick={() =>
                                        onChange({
                                            ...value,
                                            article: {
                                                ...content,
                                                sources: content.sources.filter(
                                                    (_, position) => position !== index,
                                                ),
                                            },
                                        })
                                    }
                                >
                                    移除
                                </AdminButton>
                            </div>
                        </div>
                    ))}
                    <AdminButton
                        className="inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium disabled:opacity-50 text-slate-600 hover:bg-slate-100"
                        disabled={disabled}
                        onClick={() =>
                            onChange({
                                ...value,
                                article: {
                                    ...content,
                                    sources: [...content.sources, { label: '', url: '', accessedAt: null }],
                                },
                            })
                        }
                    >
                        <Plus size={16} />
                        添加来源
                    </AdminButton>
                    <section className="space-y-2 rounded-xl bg-slate-50 p-4">
                        <h3 className="flex items-center gap-2 font-semibold">
                            草稿内容预览
                            <FeatureHelpButton
                                title="草稿内容预览"
                                content={{
                                    purpose: '预览尚未发布的标题、正文和来源，检查语言及内容。',
                                    requirements: [
                                        '核对当前店铺、语言与相应权限',
                                        '使用真实内容和可追溯证据，缺项保留待核验',
                                    ],
                                    example: '保存前检查中英文标题与正文；公开页面继续使用已发布版本。',
                                    impact: '保存草稿与发布分开；搜索收录、排名与 AI 引用以实际外部结果为准。',
                                }}
                            />
                        </h3>
                        <p className="text-sm">{content.summary || '尚未填写摘要'}</p>
                        <div className="whitespace-pre-wrap text-sm leading-relaxed">
                            {content.body || '尚未填写正文'}
                        </div>
                    </section>
                </section>
            )}
        </div>
    );
}
