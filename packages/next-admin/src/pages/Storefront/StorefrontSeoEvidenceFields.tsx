import { Plus } from 'lucide-react';
import { useState } from 'react';
import type { StorefrontSeoSettings } from '../../../../store-management-plugin/src/seo/storefront-seo.contract';
import { AdminButton, AdminInput, AdminSelect, AdminTextArea } from '../../components/AdminControls';
import { AdminField } from '../../components/AdminField';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { toUserFacingError } from '../../utils/user-facing-error';
import { parseSeoMetricCsv, seoDate, seoStatusLabel } from './storefront-seo-utils';

interface Props {
    value: StorefrontSeoSettings;
    onChange: (value: StorefrontSeoSettings) => void;
    disabled: boolean;
}
export function SeoRedirectFields({ value, onChange, disabled }: Props) {
    return (
        <section className="space-y-4">
            <p className="text-sm text-slate-500">
                使用同一店铺内的绝对路径。不能指向登录、支付或账户页面，也不能形成循环。保存后先检查草稿，再发布。
            </p>
            {!value.redirects.length && <div className="admin-page-status">尚无自定义重定向。</div>}
            {value.redirects.map((redirect, index) => (
                <div key={index} className="grid items-end gap-3 md:grid-cols-4">
                    <AdminField label="旧路径">
                        <AdminInput
                            disabled={disabled}
                            value={redirect.from}
                            placeholder="/zh/old-page"
                            onChange={event =>
                                onChange({
                                    ...value,
                                    redirects: value.redirects.map((item, position) =>
                                        position === index ? { ...item, from: event.target.value } : item,
                                    ),
                                })
                            }
                        />
                    </AdminField>
                    <AdminField label="新路径">
                        <AdminInput
                            disabled={disabled}
                            value={redirect.to}
                            placeholder="/zh/about"
                            onChange={event =>
                                onChange({
                                    ...value,
                                    redirects: value.redirects.map((item, position) =>
                                        position === index ? { ...item, to: event.target.value } : item,
                                    ),
                                })
                            }
                        />
                    </AdminField>
                    <AdminField label="状态码">
                        <AdminSelect
                            disabled={disabled}
                            value={redirect.status}
                            onChange={event =>
                                onChange({
                                    ...value,
                                    redirects: value.redirects.map((item, position) =>
                                        position === index
                                            ? { ...item, status: Number(event.target.value) as 301 | 308 }
                                            : item,
                                    ),
                                })
                            }
                        >
                            <option value={301}>301 永久移动</option>
                            <option value={308}>308 永久移动</option>
                        </AdminSelect>
                    </AdminField>
                    <AdminButton
                        className="inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium disabled:opacity-50 text-slate-600 hover:bg-slate-100"
                        disabled={disabled}
                        onClick={() =>
                            onChange({
                                ...value,
                                redirects: value.redirects.filter((_, position) => position !== index),
                            })
                        }
                    >
                        移除规则
                    </AdminButton>
                </div>
            ))}
            <AdminButton
                className="inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium disabled:opacity-50 text-slate-600 hover:bg-slate-100"
                disabled={disabled}
                onClick={() =>
                    onChange({ ...value, redirects: [...value.redirects, { from: '', to: '', status: 301 }] })
                }
            >
                <Plus size={16} />
                添加规则
            </AdminButton>
        </section>
    );
}

export function SeoPlatformFields({ value, onChange, disabled }: Props) {
    const [csv, setCsv] = useState('');
    const [importError, setImportError] = useState('');
    const [importNotice, setImportNotice] = useState('');
    return (
        <div className="space-y-6">
            <section className="space-y-3">
                <h2 className="flex items-center gap-2 font-semibold">
                    平台属性与访问证据
                    <FeatureHelpButton
                        title="平台属性与访问证据"
                        content={{
                            purpose: '登记实际平台属性与可核验的访问证据。',
                            requirements: [
                                '核对当前店铺、语言与相应权限',
                                '使用真实内容和可追溯证据，缺项保留待核验',
                            ],
                            example: '填写真实的网站属性和核验来源；缺少数据时保留未测状态。',
                            impact: '保存草稿与发布分开；搜索收录、排名与 AI 引用以实际外部结果为准。',
                        }}
                    />
                </h2>
                <p className="text-sm text-slate-500">
                    只记录真实属性、访问核验时间和说明。此处不连接账号，也不保存密钥；手工登记的 VERIFIED
                    不代表系统已验证连接。
                </p>
                {value.platformBindings.map((binding, index) => (
                    <div key={index} className="space-y-3">
                        <div className="grid gap-3 md:grid-cols-3">
                            <AdminField label="平台">
                                <AdminSelect
                                    disabled={disabled}
                                    value={binding.platform}
                                    onChange={event =>
                                        onChange({
                                            ...value,
                                            platformBindings: value.platformBindings.map((item, position) =>
                                                position === index
                                                    ? {
                                                          ...item,
                                                          platform: event.target
                                                              .value as typeof binding.platform,
                                                      }
                                                    : item,
                                            ),
                                        })
                                    }
                                >
                                    {['GSC', 'BING', 'GA4', 'MERCHANT_CENTER'].map(platform => (
                                        <option key={platform}>{platform}</option>
                                    ))}
                                </AdminSelect>
                            </AdminField>
                            <AdminField label="真实属性标识">
                                <AdminInput
                                    disabled={disabled}
                                    value={binding.property}
                                    placeholder="sc-domain:example.com"
                                    onChange={event =>
                                        onChange({
                                            ...value,
                                            platformBindings: value.platformBindings.map((item, position) =>
                                                position === index
                                                    ? { ...item, property: event.target.value }
                                                    : item,
                                            ),
                                        })
                                    }
                                />
                            </AdminField>
                            <AdminField label="人工核验状态">
                                <AdminSelect
                                    disabled={disabled}
                                    value={binding.status}
                                    onChange={event =>
                                        onChange({
                                            ...value,
                                            platformBindings: value.platformBindings.map((item, position) =>
                                                position === index
                                                    ? {
                                                          ...item,
                                                          status: event.target.value as typeof binding.status,
                                                      }
                                                    : item,
                                            ),
                                        })
                                    }
                                >
                                    <option value="UNVERIFIED">未核验 / NO_ACCESS</option>
                                    <option value="VERIFIED">已人工核验</option>
                                </AdminSelect>
                            </AdminField>
                        </div>
                        <AdminField label="实际核验日期">
                            <AdminInput
                                type="date"
                                disabled={disabled}
                                value={binding.verifiedAt?.slice(0, 10) ?? ''}
                                onChange={event =>
                                    onChange({
                                        ...value,
                                        platformBindings: value.platformBindings.map((item, position) =>
                                            position === index
                                                ? { ...item, verifiedAt: event.target.value || null }
                                                : item,
                                        ),
                                    })
                                }
                            />
                        </AdminField>
                        <AdminField label="核验说明与证据" layout="stacked">
                            <AdminTextArea
                                disabled={disabled}
                                rows={2}
                                value={binding.note}
                                onChange={event =>
                                    onChange({
                                        ...value,
                                        platformBindings: value.platformBindings.map((item, position) =>
                                            position === index ? { ...item, note: event.target.value } : item,
                                        ),
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
                                    platformBindings: value.platformBindings.filter(
                                        (_, position) => position !== index,
                                    ),
                                })
                            }
                        >
                            移除登记
                        </AdminButton>
                    </div>
                ))}
                {!value.platformBindings.length && (
                    <div className="admin-page-status">平台访问：NO_ACCESS。登记实际平台属性后再核验。</div>
                )}
                <AdminButton
                    className="inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium disabled:opacity-50 text-slate-600 hover:bg-slate-100"
                    disabled={disabled}
                    onClick={() =>
                        onChange({
                            ...value,
                            platformBindings: [
                                ...value.platformBindings,
                                {
                                    platform: 'GSC',
                                    property: '',
                                    status: 'UNVERIFIED',
                                    verifiedAt: null,
                                    note: '',
                                },
                            ],
                        })
                    }
                >
                    <Plus size={16} />
                    添加平台属性
                </AdminButton>
                <div className="flex flex-wrap gap-4 text-sm">
                    <a
                        className="text-blue-600"
                        href="https://search.google.com/search-console"
                        target="_blank"
                        rel="noreferrer"
                    >
                        Google 搜索管理平台
                    </a>
                    <a
                        className="text-blue-600"
                        href="https://www.bing.com/webmasters"
                        target="_blank"
                        rel="noreferrer"
                    >
                        Bing 网站管理平台
                    </a>
                    <a
                        className="text-blue-600"
                        href="https://analytics.google.com/"
                        target="_blank"
                        rel="noreferrer"
                    >
                        Google 网站分析
                    </a>
                </div>
            </section>
            <section className="space-y-3">
                <h2 className="flex items-center gap-2 font-semibold">
                    真实报告人工导入
                    <FeatureHelpButton
                        title="真实报告人工导入"
                        content={{
                            purpose: '核对真实报告的来源、日期、网址和指标后加入草稿。',
                            requirements: [
                                '核对当前店铺、语言与相应权限',
                                '使用真实内容和可追溯证据，缺项保留待核验',
                            ],
                            example: '从已有报告复制对应日期的指标，校验 CSV 后再保存。',
                            impact: '保存草稿与发布分开；搜索收录、排名与 AI 引用以实际外部结果为准。',
                        }}
                    />
                </h2>
                <p className="text-sm text-slate-500">
                    把平台导出的数据整理为下方列名后粘贴。空指标保留为未知，不能填 0 代替未知。Google AI
                    报告只记录实际展示量。导入先进入草稿，保存后成为管理记录。
                </p>
                <p className="break-all text-xs text-slate-500">
                    必填列：source,property,dateFrom,dateTo,url,status,evidenceUrl；可选：impressions,clicks,sessions,orders,revenue,currencyCode,languageCode,country,device
                </p>
                <p className="text-sm text-slate-500">
                    source：GSC / GOOGLE_AI / GA4 / BING / MANUAL；status：MEASURED / NO_ACCESS / DATA_MISSING
                    / NOT_MEASURED；日期 YYYY-MM-DD。
                </p>
                <AdminField label="CSV 数据" layout="stacked">
                    <AdminTextArea
                        disabled={disabled}
                        rows={6}
                        value={csv}
                        onChange={event => {
                            setCsv(event.target.value);
                            setImportError('');
                            setImportNotice('');
                        }}
                    />
                </AdminField>
                {importError && (
                    <div role="alert" className="admin-page-status" data-failed>
                        {importError}
                    </div>
                )}
                {importNotice && (
                    <div role="status" className="admin-page-status">
                        {importNotice}
                    </div>
                )}
                <AdminButton
                    className="inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium disabled:opacity-50 text-slate-600 hover:bg-slate-100"
                    disabled={disabled || !csv.trim()}
                    onClick={() => {
                        try {
                            const imported = parseSeoMetricCsv(csv);
                            if (value.metrics.length + imported.length > 250)
                                throw new Error('指标记录总数最多 250 行，请先整理历史数据。');
                            onChange({ ...value, metrics: [...value.metrics, ...imported] });
                            setCsv('');
                            setImportError('');
                            setImportNotice(`${imported.length} 行已加入草稿，尚未保存。`);
                        } catch (error) {
                            setImportError(toUserFacingError(error, '导入数据无效。'));
                        }
                    }}
                >
                    校验并加入草稿
                </AdminButton>
                {!value.metrics.length ? (
                    <div className="admin-page-status">
                        搜索效果数据：DATA_MISSING；实际收录：NOT_MEASURED。
                    </div>
                ) : (
                    <div className="overflow-auto">
                        <table className="w-full text-left text-sm admin-mobile-record-table">
                            <thead>
                                <tr>
                                    {['来源 / 属性', '报告范围', '状态 / 指标', '来源证据', '操作'].map(
                                        label => (
                                            <th key={label} className="p-2 font-medium">
                                                {label}
                                            </th>
                                        ),
                                    )}
                                </tr>
                            </thead>
                            <tbody>
                                {value.metrics.map((metric, index) => (
                                    <tr key={metric.id}>
                                        <td className="p-2" data-label="来源 / 属性">
                                            {metric.source}
                                            <br />
                                            <span className="break-all text-slate-500">
                                                {metric.property}
                                            </span>
                                        </td>
                                        <td className="p-2" data-label="报告范围">
                                            {metric.dateFrom} — {metric.dateTo}
                                            <br />
                                            <span className="break-all text-slate-500">
                                                {metric.url || '全属性'} ·{' '}
                                                {metric.languageCode || '未标记语言'}
                                            </span>
                                            <br />
                                            <span className="text-slate-500">
                                                {metric.country || '全部国家'} · {metric.device || '全部设备'}
                                            </span>
                                        </td>
                                        <td className="p-2" data-label="状态 / 指标">
                                            {seoStatusLabel(metric.status)}
                                            <br />
                                            展示 {metric.impressions ?? '未知'} · 点击{' '}
                                            {metric.clicks ?? '未知'}
                                            <br />
                                            访问 {metric.sessions ?? '未知'} · 订单 {metric.orders ?? '未知'}
                                            <br />
                                            收入 {metric.revenue ?? '未知'} {metric.currencyCode}
                                        </td>
                                        <td className="p-2" data-label="来源证据">
                                            <a
                                                className="text-blue-600"
                                                href={metric.evidenceUrl}
                                                target="_blank"
                                                rel="noreferrer"
                                            >
                                                人工导入证据
                                            </a>
                                            <br />
                                            <span className="text-slate-500">
                                                {seoDate(metric.importedAt)}
                                            </span>
                                        </td>
                                        <td className="p-2" data-label="操作">
                                            <AdminButton
                                                className="inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium disabled:opacity-50 text-slate-600 hover:bg-slate-100"
                                                disabled={disabled}
                                                onClick={() =>
                                                    onChange({
                                                        ...value,
                                                        metrics: value.metrics.filter(
                                                            (_, position) => position !== index,
                                                        ),
                                                    })
                                                }
                                            >
                                                移除记录
                                            </AdminButton>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>
            <section className="space-y-3">
                <h2 className="flex items-center gap-2 font-semibold">
                    AI 回答引用样本
                    <FeatureHelpButton
                        title="AI 回答引用样本"
                        content={{
                            purpose: '记录实际观察到的 AI 回答和对应引用网址。',
                            requirements: [
                                '核对当前店铺、语言与相应权限',
                                '使用真实内容和可追溯证据，缺项保留待核验',
                            ],
                            example: '保留一次真实回答的证据和观察时间，核对是否引用本店页面。',
                            impact: '保存草稿与发布分开；搜索收录、排名与 AI 引用以实际外部结果为准。',
                        }}
                    />
                </h2>
                <p className="text-sm text-slate-500">
                    保存实际提问、地区、语言、观察时间、引用网址和证据。样本不等于全平台排名或业务成交。
                </p>
                {!value.aiCitations.length && (
                    <div className="admin-page-status">AI 引用：NOT_MEASURED。</div>
                )}
                {value.aiCitations.map((citation, index) => {
                    const change = (patch: Partial<typeof citation>) =>
                        onChange({
                            ...value,
                            aiCitations: value.aiCitations.map((item, position) =>
                                position === index ? { ...item, ...patch } : item,
                            ),
                        });
                    return (
                        <div key={citation.id} className="space-y-3">
                            <div className="grid gap-3 md:grid-cols-3">
                                <AdminField label="实际平台">
                                    <AdminInput
                                        disabled={disabled}
                                        value={citation.platform}
                                        onChange={event => change({ platform: event.target.value })}
                                    />
                                </AdminField>
                                <AdminField label="语言">
                                    <AdminSelect
                                        disabled={disabled}
                                        value={citation.languageCode}
                                        onChange={event => change({ languageCode: event.target.value })}
                                    >
                                        <option value="zh_Hans">简体中文</option>
                                        <option value="en">英文</option>
                                    </AdminSelect>
                                </AdminField>
                                <AdminField label="地区">
                                    <AdminInput
                                        disabled={disabled}
                                        value={citation.region}
                                        onChange={event => change({ region: event.target.value })}
                                    />
                                </AdminField>
                            </div>
                            <AdminField label="实际提问" layout="stacked">
                                <AdminTextArea
                                    rows={2}
                                    disabled={disabled}
                                    value={citation.prompt}
                                    onChange={event => change({ prompt: event.target.value })}
                                />
                            </AdminField>
                            <div className="grid gap-3 md:grid-cols-2">
                                <AdminField label="被引用页面">
                                    <AdminInput
                                        type="url"
                                        disabled={disabled}
                                        value={citation.url}
                                        onChange={event => change({ url: event.target.value })}
                                    />
                                </AdminField>
                                <AdminField label="引用证据地址">
                                    <AdminInput
                                        type="url"
                                        disabled={disabled}
                                        value={citation.evidenceUrl}
                                        onChange={event => change({ evidenceUrl: event.target.value })}
                                    />
                                </AdminField>
                                <AdminField label="观察日期">
                                    <AdminInput
                                        type="date"
                                        disabled={disabled}
                                        value={citation.observedAt.slice(0, 10)}
                                        onChange={event => change({ observedAt: event.target.value })}
                                    />
                                </AdminField>
                                <AdminField label="观察类型">
                                    <AdminSelect
                                        disabled={disabled}
                                        value={citation.kind}
                                        onChange={event =>
                                            change({ kind: event.target.value as typeof citation.kind })
                                        }
                                    >
                                        <option value="CITATION">有链接引用</option>
                                        <option value="MENTION">仅提及品牌</option>
                                    </AdminSelect>
                                </AdminField>
                            </div>
                            <AdminField label="观察说明" layout="stacked">
                                <AdminTextArea
                                    disabled={disabled}
                                    rows={2}
                                    value={citation.notes}
                                    onChange={event => change({ notes: event.target.value })}
                                />
                            </AdminField>
                            <AdminButton
                                className="inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium disabled:opacity-50 text-slate-600 hover:bg-slate-100"
                                disabled={disabled}
                                onClick={() =>
                                    onChange({
                                        ...value,
                                        aiCitations: value.aiCitations.filter(
                                            (_, position) => position !== index,
                                        ),
                                    })
                                }
                            >
                                移除样本
                            </AdminButton>
                        </div>
                    );
                })}
                <AdminButton
                    className="inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium disabled:opacity-50 text-slate-600 hover:bg-slate-100"
                    disabled={disabled}
                    onClick={() =>
                        onChange({
                            ...value,
                            aiCitations: [
                                ...value.aiCitations,
                                {
                                    id: `citation-${crypto.randomUUID()}`,
                                    platform: '',
                                    prompt: '',
                                    url: '',
                                    observedAt: '',
                                    languageCode: 'zh_Hans',
                                    region: '',
                                    kind: 'CITATION',
                                    evidenceUrl: '',
                                    notes: '',
                                },
                            ],
                        })
                    }
                >
                    <Plus size={16} />
                    添加实际样本
                </AdminButton>
            </section>
        </div>
    );
}
