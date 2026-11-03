import { ArrowRight, Check, ChevronDown, CircleAlert, Info, LoaderCircle, RotateCcw } from 'lucide-react';

import {
    type Finding,
    findingTone,
    type PreviewNetwork,
    type PreviewReport,
    type RecheckResult,
} from './design-diagnostics';
import { checks, type Copy } from './design-model';

export interface RecheckRecord {
    finding: Finding;
    result: RecheckResult;
    before: Copy;
    after: Copy;
    checkedAt: Date;
}
const outcomeCopy: Record<RecheckResult, Copy> = {
    cleared: ['已不再检出', 'No longer detected'],
    persists: ['仍需关注', 'Still present'],
    unknown: ['无法确认', 'Unconfirmed'],
};
export function findingSnapshot(
    finding: Finding,
    report: PreviewReport,
    network: PreviewNetwork | null,
): Copy {
    if (finding.scope === 'network')
        return network
            ? [
                  '风险分 ' +
                      String(network.score ?? '—') +
                      '/100；代理标记：' +
                      String(network.proxy === null ? '未知' : network.proxy ? '是' : '否') +
                      '；类型：' +
                      String(network.type === 'datacenter' ? '数据中心' : '住宅网络'),
                  'Risk ' +
                      String(network.score ?? '—') +
                      '/100; proxy: ' +
                      String(network.proxy === null ? 'unknown' : network.proxy ? 'yes' : 'no') +
                      '; type: ' +
                      String(network.type === 'datacenter' ? 'data center' : 'residential'),
              ]
            : ['网络查询未取得结果', 'No network result'];
    return [0, 1].map(language =>
        finding.related
            .map(id => report.values[checks.findIndex(check => check.id === id)][language])
            .join(' · '),
    ) as unknown as Copy;
}

export function DiagnosisPanel({
    zh,
    report,
    network,
    findings,
    updating,
    disabled,
    reviewingId,
    records,
    onRecheck,
    onShowCheck,
}: {
    zh: boolean;
    report: PreviewReport | null;
    network: PreviewNetwork | null;
    findings: readonly Finding[];
    updating: boolean;
    disabled: boolean;
    reviewingId: string | null;
    records: readonly RecheckRecord[];
    onRecheck: (finding: Finding) => void;
    onShowCheck: (id: string) => void;
}) {
    const t = (cn: string, en: string) => (zh ? cn : en);
    const copy = (pair: Copy) => pair[zh ? 0 : 1];
    const cleared = records.filter(
        record => record.result === 'cleared' && !findings.some(item => item.id === record.finding.id),
    );
    return (
        <section
            id="design-diagnosis"
            className="design-diagnosis"
            aria-labelledby="design-diagnosis-title"
            tabIndex={-1}
        >
            <div className="design-diagnosis-heading">
                <div>
                    <h2 id="design-diagnosis-title" className="type-section">
                        {t('检查建议与优化', 'Findings and next steps')}
                    </h2>
                    <p className="type-helper">
                        {t(
                            '先看实际依据，再决定是否调整；完成后复查对应项目。',
                            'Review the evidence, decide whether a change is needed, then recheck the related items.',
                        )}
                    </p>
                </div>
                <span className="design-state type-meta">
                    {report
                        ? t(
                              `${findings.length} 条建议`,
                              `${findings.length} finding${findings.length === 1 ? '' : 's'}`,
                          )
                        : t('等待检测', 'Awaiting check')}
                </span>
            </div>
            <div className="design-diagnosis-summary type-body" aria-live="polite">
                {updating ? (
                    <LoaderCircle className="design-spinner" />
                ) : report && !findings.length ? (
                    <Check />
                ) : (
                    <Info />
                )}
                <p>
                    {updating
                        ? t(
                              '正在更新检测结果；已有建议保留，完成后重新评估。',
                              'Updating results. Earlier guidance remains visible until the new checks finish.',
                          )
                        : !report
                          ? t(
                                '检测完成后，按实际结果生成建议与操作步骤。',
                                'Run a check to get guidance and steps based on its results.',
                            )
                          : findings.length
                            ? t(
                                  '以下项目值得核对。按需检查不代表已经发现故障。',
                                  'Review the findings below. A conditional check does not mean a fault has been confirmed.',
                              )
                            : t(
                                  '在本次可读取的项目中，未发现需要处理的问题。中文、系统字体与正常时区属于使用偏好。',
                                  'No actionable findings were identified in the available checks. Chinese languages, system fonts and normal timezones are preferences.',
                              )}
                </p>
            </div>
            <div className="design-finding-list">
                {findings.map(finding => {
                    const record = records.find(item => item.finding.id === finding.id);
                    return (
                        <article
                            className={`design-finding tone-${finding.tone}`}
                            key={finding.id}
                            id={`finding-${finding.id}`}
                            tabIndex={-1}
                        >
                            <div className="design-finding-top">
                                <CircleAlert aria-hidden="true" />
                                <h3 className="type-card">{copy(finding.title)}</h3>
                                <span
                                    className={`design-state type-meta is-${finding.tone === 'review' ? 'review' : 'note'}`}
                                >
                                    {copy(findingTone[finding.tone])}
                                </span>
                            </div>
                            <dl className="design-finding-evidence">
                                <dt className="type-meta">{t('发现依据', 'Evidence')}</dt>
                                <dd className="type-body">{copy(finding.evidence)}</dd>
                            </dl>
                            <p className="type-body">{copy(finding.explanation)}</p>
                            <details className="design-finding-details">
                                <summary className="type-label">
                                    {t('查看操作步骤与复查方法', 'View steps and how to verify')}
                                    <ChevronDown />
                                </summary>
                                <ol className="type-body">
                                    {finding.steps.map((step, index) => (
                                        <li key={index}>{copy(step)}</li>
                                    ))}
                                </ol>
                                <p className="design-verify type-helper">
                                    <Check />
                                    {copy(finding.verify)}
                                </p>
                                {finding.source && (
                                    <a
                                        className="design-text-button type-label"
                                        href={finding.source.url}
                                        target="_blank"
                                        rel="noreferrer"
                                    >
                                        {copy(finding.source.title)}
                                        <ArrowRight />
                                    </a>
                                )}
                            </details>
                            <div className="design-finding-actions">
                                <button
                                    type="button"
                                    className="design-secondary type-label"
                                    aria-label={t('复查：', 'Recheck: ') + copy(finding.title)}
                                    disabled={disabled}
                                    onClick={() => onRecheck(finding)}
                                >
                                    {reviewingId === finding.id ? (
                                        <LoaderCircle className="design-spinner" />
                                    ) : (
                                        <RotateCcw />
                                    )}
                                    {reviewingId === finding.id
                                        ? t('正在复查', 'Rechecking')
                                        : finding.scope === 'network'
                                          ? t('仅复查网络', 'Recheck network only')
                                          : t('复查相关项', 'Recheck related items')}
                                </button>
                                {!!finding.related.length && (
                                    <button
                                        type="button"
                                        className="design-text-button type-label"
                                        onClick={() => onShowCheck(finding.related[0])}
                                    >
                                        {t('查看相关采集值', 'View related readings')}
                                        <ArrowRight />
                                    </button>
                                )}
                            </div>
                            {record && (
                                <p className="design-recheck-note type-helper" role="status">
                                    {t('演示复查：', 'Sample recheck: ')}
                                    {copy(outcomeCopy[record.result])} ·{' '}
                                    {record.checkedAt.toLocaleTimeString(zh ? 'zh-CN' : 'en-GB', {
                                        hour12: false,
                                    })}
                                    {record.result === 'unknown' &&
                                        t(
                                            '。未取得新依据，以上保留上次结果。',
                                            '. No new evidence was returned; earlier results remain above.',
                                        )}
                                </p>
                            )}
                            {record && (
                                <dl className="design-recheck-comparison type-helper">
                                    <div>
                                        <dt>{t('复查前', 'Before')}</dt>
                                        <dd>{copy(record.before)}</dd>
                                    </div>
                                    <div>
                                        <dt>{t('复查后', 'After')}</dt>
                                        <dd>{copy(record.after)}</dd>
                                    </div>
                                </dl>
                            )}
                        </article>
                    );
                })}
            </div>
            {!!cleared.length && (
                <div className="design-recheck-history" aria-live="polite">
                    {cleared.map(record => (
                        <article key={record.finding.id}>
                            <h3 className="type-card">
                                <Check />
                                {copy(outcomeCopy[record.result])} · {copy(record.finding.title)}
                            </h3>
                            <dl className="type-helper">
                                <div>
                                    <dt>{t('复查前', 'Before')}</dt>
                                    <dd>{copy(record.before)}</dd>
                                </div>
                                <div>
                                    <dt>{t('复查后', 'After')}</dt>
                                    <dd>{copy(record.after)}</dd>
                                </div>
                            </dl>
                            <p className="type-meta">
                                {t(
                                    '演示结果，仅代表此线索本次未再检出。',
                                    'Sample result: this finding was not detected on this recheck.',
                                )}{' '}
                                ·{' '}
                                {record.checkedAt.toLocaleTimeString(zh ? 'zh-CN' : 'en-GB', {
                                    hour12: false,
                                })}
                            </p>
                        </article>
                    ))}
                </div>
            )}
            {report && (
                <details className="design-normal-preferences">
                    <summary className="type-label">
                        <Info />
                        {t(
                            '正常偏好与区域线索：无需为降低分数修改',
                            'Preferences and regional signals: no need to lower the score',
                        )}
                        <ChevronDown />
                    </summary>
                    <div className="design-normal-content type-helper">
                        <p>
                            {t(
                                '语言、语言变体与区域格式合并解读，避免把同一偏好当成三个问题：',
                                'Language, language variant and regional format are interpreted together rather than treated as three problems: ',
                            )}
                        </p>
                        <p>{[1, 2, 7].map(index => copy(report.values[index])).join(' · ')}</p>
                        <p>
                            {t(
                                '中文字体、厂商字体和表情风格仅作参考，不建议删除系统字体、更换设备或改变常用语言。',
                                'Chinese fonts, vendor fonts and estimated emoji style are informational. There is no ' +
                                    'reason to remove system fonts, replace devices or change useful languages.',
                            )}
                        </p>
                        {network?.type === 'datacenter' && (
                            <p>
                                {t(
                                    '网络类型为数据中心。该类型本身不证明代理、异常或账号风险。',
                                    'The IP is classified as a data center. That classification alone does not prove proxy use, a fault or account risk.',
                                )}
                            </p>
                        )}
                    </div>
                </details>
            )}
            <p className="design-diagnosis-disclosure type-meta">
                {t(
                    '此处为规则与交互演示。复查使用示例数据，不会修改设备或网络设置。',
                    'This previews rules and interactions. Rechecks use sample data and do not change device or network settings.',
                )}
            </p>
        </section>
    );
}
