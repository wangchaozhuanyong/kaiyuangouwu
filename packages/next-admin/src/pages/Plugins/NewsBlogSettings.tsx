// organize-imports-ignore -- Preserve ESLint import groups.
import { useMutation } from '@apollo/client/react';

import { serviceMessageDisplay } from '../../../../common/src/display-localization';
import { getAdminQueryScope } from '../../apollo';
import { AdminButton, AdminInput, AdminSelect } from '../../components/AdminControls';
import { AdminField } from '../../components/AdminField';
import { DraftUpdateNotice } from '../../components/DraftUpdateNotice';
import { useAdminQuery } from '../../hooks/use-admin-query';
import { useServerDraft } from '../../hooks/use-server-draft';

import { type BlogAdminAction, type BlogAdminSettings } from './news-blog-types';
import * as G from './news-blog.graphql';
export function NewsBlogSettings({
    source,
    execute,
}: {
    source: BlogAdminSettings;
    execute: BlogAdminAction;
}) {
    const scope = getAdminQueryScope();
    const server = useServerDraft(`news-blog-settings:${scope}`, String(source.version), source);
    const [save, state] = useMutation<{ saveNewsBlogSettings: BlogAdminSettings }>(G.SAVE_NEWS_BLOG_SETTINGS);
    const providers = useAdminQuery<{ newsBlogProviderOptions: Array<{ code: string; name: string }> }>(
        G.NEWS_BLOG_PROVIDERS,
        { skip: server.draft?.freeMode === true },
    );
    const draft = server.draft;
    if (!draft) return null;
    const update = (patch: Partial<BlogAdminSettings>) => server.setDraft(x => (x ? { ...x, ...patch } : x));
    return (
        <section className="space-y-4">
            <p className="text-sm text-slate-500">
                {draft.freeMode
                    ? '关闭自动发布时，仅采集来源资料并保留待人工编辑，不生成模板文章、不自动翻译，不调用文本或图片模型。热门 Skill 按独立设置处理。'
                    : 'AI 编辑模式使用平台供应商，不扣客户余额；未填写预算时不启动付费任务。'}
            </p>
            {server.sourceChanged && <DraftUpdateNotice onReload={server.reload} />}
            <AdminField label="内容整理方式">
                <AdminSelect
                    value={draft.freeMode ? 'FREE' : 'AI'}
                    onChange={e => update({ freeMode: e.target.value === 'FREE' })}
                >
                    <option value="FREE">免费原文采集（无需模型）</option>
                    <option value="AI">AI 编辑（需配置供应商与预算）</option>
                </AdminSelect>
            </AdminField>
            {draft.freeMode && (
                <AdminField
                    label="免费快讯通过检查后自动发布"
                    description="关闭时仅保存采集资料、等待人工编辑；开启后将生成并发布免费模板快讯，不提供自动翻译。"
                >
                    <AdminInput
                        type="checkbox"
                        checked={draft.freeAutoPublish ?? false}
                        onChange={e => update({ freeAutoPublish: e.target.checked })}
                    />
                </AdminField>
            )}
            <AdminField label="启用当前店铺新闻博客">
                <AdminInput
                    type="checkbox"
                    checked={draft.enabled}
                    onChange={e => update({ enabled: e.target.checked })}
                />
            </AdminField>
            <AdminField label={draft.freeMode ? '自动采集资讯原文' : '自动采集并生成待审文章'}>
                <AdminInput
                    type="checkbox"
                    checked={draft.automationEnabled}
                    onChange={e => update({ automationEnabled: e.target.checked })}
                />
            </AdminField>
            <AdminField
                label="每日自动发布热门 Skill"
                description={
                    draft.freeMode
                        ? '每天一条，核对固定版本原文和采集时的仓库热度，通过免费来源规则复核后发布。'
                        : '每天一条，自动核验原文与热度；AI 新闻文章仍需人工审核。未配置模型或预算时只采集资料。'
                }
            >
                <AdminInput
                    type="checkbox"
                    checked={draft.skillEnabled ?? false}
                    onChange={e => update({ skillEnabled: e.target.checked })}
                />
            </AdminField>
            {source.skillStatus && (
                <p className="text-sm text-slate-500">{serviceMessageDisplay(source.skillStatus)}</p>
            )}
            <AdminField label="Skill 发布时间（马来西亚时间）">
                <AdminInput
                    type="time"
                    value={draft.skillPublishTime ?? '09:00'}
                    onChange={e => update({ skillPublishTime: e.target.value })}
                />
            </AdminField>
            <AdminField label="Skill 所属仓库最低 Star">
                <AdminInput
                    type="number"
                    min="1000"
                    step="1"
                    value={draft.skillMinStars ?? 1000}
                    onChange={e => update({ skillMinStars: Number(e.target.value) })}
                />
            </AdminField>
            {(['title', 'description', 'textModel', 'imageModel'] as const)
                .filter(key => !draft.freeMode || key === 'title' || key === 'description')
                .map(key => (
                    <AdminField
                        key={key}
                        label={
                            {
                                title: '栏目标题',
                                description: '栏目说明',
                                textModel: '文本模型 ID',
                                imageModel: '配图模型 ID',
                            }[key]
                        }
                    >
                        <AdminInput value={draft[key]} onChange={e => update({ [key]: e.target.value })} />
                    </AdminField>
                ))}
            {(['textProviderCode', 'imageProviderCode'] as const)
                .filter(() => !draft.freeMode)
                .map(key => (
                    <AdminField key={key} label={key === 'textProviderCode' ? '文本供应商' : '配图供应商'}>
                        <AdminSelect value={draft[key]} onChange={e => update({ [key]: e.target.value })}>
                            <option value="">
                                未配置{key === 'imageProviderCode' ? '（使用模板封面）' : ''}
                            </option>
                            {providers.data?.newsBlogProviderOptions.map(provider => (
                                <option key={provider.code} value={provider.code}>
                                    {provider.name} · {provider.code}
                                </option>
                            ))}
                        </AdminSelect>
                    </AdminField>
                ))}
            {providers.error && <p role="alert">供应商读取失败，已有配置保留，可重新读取。</p>}
            {!draft.freeMode && (
                <AdminField label="配图接口协议">
                    <AdminSelect
                        value={draft.imageProtocol}
                        onChange={e => update({ imageProtocol: e.target.value })}
                    >
                        {[
                            'OPENAI_IMAGES',
                            'OPENAI_RESPONSES_IMAGE',
                            'OPENAI_COMPATIBLE_CHAT',
                            'GEMINI_NATIVE',
                            'GEMINI_NATIVE_STREAM',
                            'GEMINI_INTERACTIONS',
                        ].map(value => (
                            <option key={value} value={value}>
                                {value}
                            </option>
                        ))}
                    </AdminSelect>
                </AdminField>
            )}
            {(
                [
                    'intervalMinutes',
                    'dailyMaxArticles',
                    'dailyBudgetMicros',
                    'textReserveMicros',
                    'imageReserveMicros',
                ] as const
            )
                .filter(key => !draft.freeMode || !key.endsWith('Micros'))
                .map(key => (
                    <AdminField
                        key={key}
                        label={
                            {
                                intervalMinutes: '采集间隔（分钟，至少 30）',
                                dailyMaxArticles: '每日最多生成篇数',
                                dailyBudgetMicros: '每日运营预算（USD）',
                                textReserveMicros: '单次写作预留（USD）',
                                imageReserveMicros: '单次配图预留（USD）',
                            }[key]
                        }
                    >
                        <AdminInput
                            type="number"
                            min="0"
                            step={key.endsWith('Micros') ? '0.000001' : '1'}
                            value={key.endsWith('Micros') ? draft[key] / 1000000 : draft[key]}
                            onChange={e =>
                                update({
                                    [key]: Math.round(
                                        Number(e.target.value) * (key.endsWith('Micros') ? 1000000 : 1),
                                    ),
                                })
                            }
                        />
                    </AdminField>
                ))}
            <AdminButton
                className="bg-slate-900 text-white"
                disabled={state.loading || server.sourceChanged}
                onClick={() =>
                    void execute(async () => {
                        const response = await save({
                            variables: { settings: draft, expectedVersion: draft.version },
                        });
                        if (!response.data?.saveNewsBlogSettings) throw new Error('保存结果需重新读取核对');
                        const result = response.data.saveNewsBlogSettings;
                        if (getAdminQueryScope() === scope) server.accept(result, String(result.version));
                    }, '博客设置已保存。前台入口需在客户端插件中心启用并发布。')
                }
            >
                保存设置
            </AdminButton>
        </section>
    );
}
