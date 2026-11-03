/** Rule-driven sample diagnosis for the isolated preview. No system settings are changed. */
import { regionalOptimizations } from '../../src/client-plugins/environment-monitor/guidance';

import {
    type CheckId,
    checks,
    type Copy,
    sampleFor,
    type Scenario,
    scoreContributions,
} from './design-model';

export type PreviewReport = ReturnType<typeof sampleFor>;
export type NetworkState = 'idle' | 'pending' | 'ready' | 'error';
export type FailureReason = 'timeout' | 'quota';
export interface PreviewNetwork {
    high: boolean;
    low: boolean;
    checkedAt: Date;
    type: 'residential' | 'datacenter' | 'unknown';
    proxy: boolean | null;
    score: number | null;
    timezone: string | null;
    utcOffset: number | null;
}
export interface Finding {
    id: string;
    kind?: 'optimization';
    tone: 'review' | 'check' | 'unknown';
    title: Copy;
    evidence: Copy;
    explanation: Copy;
    steps: readonly Copy[];
    verify: Copy;
    related: readonly CheckId[];
    scope: 'local' | 'network';
    source?: { title: Copy; url: string };
}
export type RecheckOutcome = 'resolved' | 'unchanged' | 'unknown';
export type RecheckResult = 'cleared' | 'persists' | 'unknown';
const claudeHelp = {
    title: ['Claude 官方排查说明', 'Official Claude troubleshooting'] as Copy,
    url: 'https://support.claude.com/en/articles/12466728-troubleshoot-claude-error-messages',
};
export const findingTone: Record<Finding['tone'], Copy> = {
    review: ['优先核对', 'Review first'],
    check: ['按需检查', 'Check if needed'],
    unknown: ['结果不完整', 'Incomplete result'],
};
export function sampleNetwork(scenario: Scenario): PreviewNetwork {
    return {
        high: scenario === 'high',
        low: scenario === 'low',
        checkedAt: new Date(),
        type:
            scenario === 'network-unknown'
                ? 'unknown'
                : scenario === 'high' || scenario === 'datacenter'
                  ? 'datacenter'
                  : 'residential',
        proxy: scenario === 'network-unknown' ? null : scenario === 'high',
        score:
            scenario === 'network-unknown'
                ? null
                : scenario === 'high'
                  ? 82
                  : scenario === 'network-medium'
                    ? 48
                    : 8,
        timezone:
            scenario === 'network-unknown'
                ? null
                : scenario === 'low'
                  ? 'America/New_York'
                  : 'Asia/Kuala_Lumpur',
        utcOffset: scenario === 'network-unknown' ? null : scenario === 'low' ? -240 : 480,
    };
}
export function diagnose(
    report: PreviewReport | null,
    state: NetworkState,
    network: PreviewNetwork | null,
    failure: FailureReason = 'timeout',
): Finding[] {
    const findings: Finding[] = [];
    if (state === 'error')
        findings.push({
            id: 'network-unavailable',
            tone: 'unknown',
            scope: 'network',
            related: [],
            title:
                failure === 'quota'
                    ? ['今日检测次数额度已用完', 'Today’s detection quota is used up']
                    : ['网络资料暂未取得', 'Network details are unavailable'],
            evidence:
                failure === 'quota'
                    ? [
                          '示例查询返回“限额已用完”；当前 IP 类型与信誉无法确认。',
                          'The sample lookup returned a quota limit. Current IP type and reputation cannot be confirmed.',
                      ]
                    : [
                          '示例网络查询超时；本地检测仍然有效。',
                          'The sample network lookup timed out. Local checks remain available.',
                      ],
            explanation: [
                '缺少网络结果不能解释成安全，也不代表你的电脑有故障。',
                'Missing network results do not indicate safety or a fault with your computer.',
            ],
            steps:
                failure === 'quota'
                    ? [
                          [
                              '网络查询额度恢复后可重试；浏览器本地检测仍可使用，已有报告仍可查看。',
                              'The daily network lookup allowance is exhausted. Retry after it resets; browser checks and existing reports remain available.',
                          ],
                          [
                              '无需修改电脑设置或付费解锁。持续无法查询时，可联系网站管理员核对数据源状态。',
                              'No computer changes or paid unlock are needed. If lookups remain unavailable, ask the website administrator to check the data source.',
                          ],
                      ]
                    : [
                          [
                              '先确认其他网页能否正常打开；若都失败，检查当前网络连接。',
                              'Check whether other websites load. If none do, review your network connection.',
                          ],
                          [
                              '稍后仅重试网络；仍失败时联系网站管理员核对服务状态。',
                              'Retry the network shortly. If it still fails, ask the website administrator to review service status.',
                          ],
                      ],
            verify: [
                '复查应取得新的网络结果和查询时间；失败时继续显示“无法确认”。',
                'A recheck should return new network details and a lookup time. A failure remains unconfirmed.',
            ],
        });
    if (
        state === 'ready' &&
        (!network ||
            network.score === null ||
            network.type === 'unknown' ||
            network.proxy === null ||
            network.utcOffset === null ||
            network.timezone === null)
    )
        findings.push({
            id: 'network-incomplete',
            tone: 'unknown',
            scope: 'network',
            related: [],
            title: ['部分网络信息暂不可用', 'Some network details are unavailable'],
            evidence: [
                '数据源未提供完整的网络类型、信誉、代理或时区信息，缺失字段按未知展示。',
                'The provider did not supply complete type, reputation, proxy or timezone information. Missing fields remain unknown.',
            ],
            explanation: [
                '未知不等于住宅网络或低风险；已取得的信息仍可查看。',
                'Unknown does not mean residential or low risk. Available information remains useful.',
            ],
            steps: [
                [
                    '稍后重新查询网络资料；若仍缺失，联系网站管理员核对数据源覆盖情况。',
                    'Query network details again later. If details remain missing, ask the website administrator to review provider coverage.',
                ],
                [
                    '无需为补全分数修改电脑设置；缺失信息继续保留为未知。',
                    'No computer settings need changing just to obtain a score. Missing information must remain unknown.',
                ],
            ],
            verify: [
                '查看新的查询时间及缺失字段是否返回；没有新依据时不能认定问题已解决。',
                'Check the new lookup time and whether missing fields were returned. Without new evidence, recovery is unconfirmed.',
            ],
        });
    if (state === 'ready' && network) {
        if ((network.score ?? 0) >= 40 || network.proxy === true)
            findings.push({
                id: 'network-reputation',
                tone: (network.score ?? 0) >= 70 ? 'review' : 'check',
                scope: 'network',
                related: [],
                title: ['核对当前出口网络的信誉记录', 'Review the current network reputation'],
                evidence: [
                    '示例网络数据：信誉风险分 ' +
                        String(network.score ?? '—') +
                        '/100；代理标记：' +
                        String(network.proxy === null ? '未知' : network.proxy ? '是' : '否') +
                        '；查询时间 ' +
                        String(network.checkedAt.toLocaleTimeString('en-GB', { hour12: false })) +
                        '。',
                    'Sample provider: reputation risk ' +
                        String(network.score ?? '—') +
                        '/100; proxy flag: ' +
                        String(network.proxy === null ? 'unknown' : network.proxy ? 'yes' : 'no') +
                        '; checked at ' +
                        String(network.checkedAt.toLocaleTimeString('en-GB', { hour12: false })) +
                        '.',
                ],
                explanation: [
                    '这是数据源对公网出口的标记，不是封号概率。数据中心类型本身不代表代理或异常。',
                    'These are provider flags for a public exit IP, not an account-ban probability. A data center type alone does not indicate a proxy or fault.',
                ],
                steps: [
                    [
                        '先确认这是家庭、公司还是共享出口；公司网络可请管理员核对该 IP 的信誉记录。',
                        'Confirm whether this is a home, work or shared exit. A workplace administrator can review the IP reputation records.',
                    ],
                    [
                        '如同时遇到 Claude 登录或连接错误，再按官方排查说明核对 VPN、浏览器扩展及服务状态；保留公司要求的网络配置。',
                        'If Claude also has login or connection errors, use its official troubleshooting guide' +
                            ' to review VPN use, extensions and service status. Retain required workplace network ' +
                            'settings.',
                    ],
                    [
                        '若记录与你的实际网络不符，向运营商或数据提供方申请核查。',
                        'If the record does not match your network, ask the ISP or data provider to review it.',
                    ],
                ],
                verify: [
                    '重新查询，比较 IP 类型、代理标记、信誉分与查询时间；单次低分不保证账号安全。',
                    'Requery and compare IP type, proxy flag, reputation score and lookup time. A lower score does not guarantee account safety.',
                ],
                source: claudeHelp,
            });
        if (
            report &&
            network.utcOffset !== null &&
            network.timezone !== null &&
            report.facts.utcOffset !== network.utcOffset &&
            report.ratios[0] !== null &&
            report.ratios[8] !== null
        )
            findings.push({
                id: 'time-difference',
                tone: 'check',
                scope: 'local',
                related: ['timezone', 'timezoneOffset'],
                title: ['核对系统时间是否符合你的所在地', 'Check whether system time matches your location'],
                evidence: [
                    `系统时区：${report.facts.timezone}；网络时区：${network.timezone}，当前 UTC 偏移不同。`,
                    `System timezone: ${report.facts.timezone}; network timezone: ${network.timezone}. Their current UTC offsets differ.`,
                ],
                explanation: [
                    '旅行、远程工作和 IP 位置误差都可能造成差异。只有系统时间不符合实际使用地点时才需要调整。',
                    'Travel, remote work and IP location errors can cause this difference. Adjust only if system time does not match your actual location.',
                ],
                steps: [
                    [
                        '先查看设备显示的当地时间，确认旅行、远程桌面或公司出口是否可以解释差异。',
                        'Check the local time shown on your device. Consider travel, remote desktops or a workplace exit before changing anything.',
                    ],
                    report.facts.platform === 'Windows'
                        ? [
                              'Windows：打开“设置 → 时间和语言 → 日期和时间”，核对时区；时间不准确时检查自动设置时间。',
                              'Windows: open Settings → Time & language → Date & time. Review the timezone and automatic time setting if the clock is inaccurate.',
                          ]
                        : report.facts.platform === 'macOS'
                          ? [
                                'Mac：打开“系统设置 → 通用 → 日期与时间”，核对时间与时区；根据实际所在地检查自动设置选项。',
                                'Mac: open System Settings → General → Date & Time. Review time, timezone and the automatic settings for your actual location.',
                            ]
                          : [
                                '手机：在系统设置中搜索“日期和时间”，核对所在地时区；具体入口随系统版本而异。',
                                'Mobile: search system settings for Date & time and review your local timezone. The exact path depends on your system version.',
                            ],
                    [
                        '如果设备时间正确，可保持现状；不要仅为匹配 IP 数据库而设置错误的时区。',
                        'If device time is correct, retain it. Do not set an incorrect timezone merely to match an IP database.',
                    ],
                ],
                verify: [
                    '复查时区与当前偏移；差异消失只代表此线索未再检出，不代表网络或账号已安全。',
                    'Recheck timezone and current offset. A cleared difference only means this signal was not detected again, not that an account or network is safe.',
                ],
                source:
                    report.facts.platform === 'Windows'
                        ? {
                              title: ['Windows 时间设置说明', 'Windows time settings'],
                              url: 'https://support.microsoft.com/en-us/windows/experience/personalization/set-time-date-and-time-zone-settings-in-windows',
                          }
                        : report.facts.platform === 'macOS'
                          ? {
                                title: ['Mac 时间设置说明', 'Mac time settings'],
                                url: 'https://support.apple.com/en-ie/guide/mac-help/mchlp2996/mac',
                            }
                          : undefined,
            });
    }
    if (report) {
        checks.forEach((check, index) => {
            if (report.ratios[index] !== null) return;
            findings.push({
                id: `unavailable-${check.id}`,
                tone: 'unknown',
                scope: 'local',
                related: [check.id],
                title: [`${check.title[0]}无法读取`, `${check.title[1]}: unavailable`],
                evidence: report.values[index],
                explanation: check.weight
                    ? [
                          '读取受限与“未检出”不同；此评分项缺失时暂不输出完整参考分。',
                          'An unavailable reading differs from no match. No complete reference score is shown while a scored input is missing.',
                      ]
                    : [
                          '此信息项无法读取，不影响其他评分项；不能把未知当成未检出。',
                          'This unavailable information item does not affect scored inputs. Unknown is not the same as no match.',
                      ],
                steps: [
                    [
                        '先仅重试此项，保留其他已完成的结果。',
                        'Retry only this signal and retain the other completed results.',
                    ],
                    [
                        '如持续受限，可使用常用的独立浏览器比较；不必为了取得分数关闭隐私保护。',
                        'If it remains unavailable, compare with your usual standalone browser. You do not need to disable privacy protections to obtain a score.',
                    ],
                ],
                verify: [
                    '复查成功应展示新的采集值；仍无法读取时继续标记为未知。',
                    'A successful recheck should show a new observed value. An unreadable value remains unknown.',
                ],
            });
        });
        if (report.facts.inAppBrowser)
            findings.push({
                id: 'in-app-browser',
                tone: 'check',
                scope: 'local',
                related: ['domesticBrowser', 'browser'],
                title: [
                    '遇到登录或页面异常时，换独立浏览器比较',
                    'Compare in a standalone browser if pages or sign-in fail',
                ],
                evidence: report.values[10],
                explanation: [
                    '已识别应用内置浏览器。兼容性可能与独立浏览器不同，但这本身不是故障或账号风险。',
                    'An in-app browser was identified. Its compatibility can differ from a standalone browser, but this is not itself a fault or account risk.',
                ],
                steps: [
                    [
                        '如果当前使用正常，无需更改。遇到按钮无响应或登录异常时，复制页面地址。',
                        'If everything works, no change is needed. If a button or sign-in fails, copy the page URL.',
                    ],
                    [
                        '在已安装的常用独立浏览器中打开同一页面，检查相同操作；需要时从浏览器官方渠道更新。',
                        'Open the same page in your usual installed standalone browser and compare the operation. Update through official browser channels if needed.',
                    ],
                ],
                verify: [
                    '在新的浏览器中再次检测，并实际尝试原来失败的操作；标记消失不等于故障已修复。',
                    'Run a check in that browser and retry the operation that failed. A missing marker alone does not prove the fault is fixed.',
                ],
            });
    }
    if (report) {
        for (const finding of regionalOptimizations(report)) {
            if (!findings.some(existing => existing.related.includes(finding.related[0])))
                findings.push(finding);
        }
    }
    return findings.sort(
        (a, b) =>
            ['review', 'unknown', 'check'].indexOf(a.tone) - ['review', 'unknown', 'check'].indexOf(b.tone),
    );
}

export function scanFeedback(previous: readonly Finding[] | null, current: readonly Finding[]): Copy {
    if (current.some(finding => finding.tone === 'unknown'))
        return [
            '部分结果仍无法确认，请查看对应建议后重试。',
            'Some results remain unconfirmed. Review their guidance and retry.',
        ];
    const cleared = previous?.filter(before => !current.some(after => after.id === before.id)).length ?? 0;
    if (cleared)
        return [
            `检测已更新：${cleared} 项提示本次未再检出，${current.length} 项建议仍可查看。请同时确认原来的使用问题是否恢复。`,
            `Updated: ${cleared} earlier findings were not detected; ${current.length} findings remain. Also verify whether the original operation works.`,
        ];
    if (current.length)
        return [
            previous
                ? `检测已更新，仍有 ${current.length} 项建议，请按实际情况核对。`
                : `检测完成，有 ${current.length} 项建议可查看。`,
            previous
                ? `Updated; ${current.length} findings remain. Review them for your situation.`
                : `Complete; ${current.length} findings have guidance.`,
        ];
    return [
        '本次可读取的项目未发现需要处理的问题，保持正常设置即可。',
        'No actionable findings in the available checks. Retain your normal settings.',
    ];
}

export function compareFinding(
    finding: Finding,
    report: PreviewReport | null,
    state: NetworkState,
    network: PreviewNetwork | null,
): RecheckResult {
    if (finding.scope === 'network') {
        if (state !== 'ready' || !network) return 'unknown';
        if (finding.id === 'network-reputation' && (network.score === null || network.proxy === null)) {
            return (network.score ?? 0) >= 40 || network.proxy === true ? 'persists' : 'unknown';
        }
        if (
            finding.id === 'network-incomplete' &&
            diagnose(report, state, network).some(item => item.id === finding.id)
        )
            return 'unknown';
    }
    if (
        finding.scope === 'local' &&
        (!report ||
            finding.related.some(id => report.ratios[checks.findIndex(check => check.id === id)] === null))
    )
        return 'unknown';
    if (
        finding.id === 'time-difference' &&
        (state !== 'ready' || !network || network.utcOffset === null || network.timezone === null)
    )
        return 'unknown';
    return diagnose(report, state, network).some(item => item.id === finding.id) ? 'persists' : 'cleared';
}

/** Explicit sample re-read; never applied to a visitor's actual settings. */
export function recheckSample(
    finding: Finding,
    report: PreviewReport,
    network: PreviewNetwork | null,
    outcome: RecheckOutcome,
) {
    const next = {
        ...report,
        values: [...report.values],
        ratios: [...report.ratios],
        facts: { ...report.facts },
    };
    let nextNetwork = network
        ? {
              ...network,
              checkedAt:
                  finding.scope === 'network' && outcome !== 'unknown' ? new Date() : network.checkedAt,
          }
        : null;
    if (outcome === 'resolved') {
        if (finding.id === 'network-unavailable') nextNetwork = sampleNetwork('typical');
        if (finding.id === 'network-reputation' && nextNetwork)
            nextNetwork = { ...nextNetwork, high: false, proxy: false, score: 8 };
        if (finding.id === 'time-difference' && network?.timezone && network.utcOffset !== null) {
            next.facts.timezone = network.timezone;
            next.facts.utcOffset = network.utcOffset;
            next.values[0] = [network.timezone, network.timezone];
            next.values[8] = ['UTC+8', 'UTC+8'];
            next.ratios[0] = 0.35;
            next.ratios[8] = 0.7;
        }
        if (finding.id === 'in-app-browser') {
            next.facts.inAppBrowser = false;
            next.ratios[5] = 0;
            next.values[5] = ['Chrome · 未检出内置浏览器标记', 'Chrome · No in-app browser marker'];
            next.values[10] = [`Chrome · ${next.facts.platform}`, `Chrome · ${next.facts.platform}`];
        }
        if (finding.id.startsWith('unavailable-')) {
            const recovered = sampleFor('typical');
            finding.related.forEach(id => {
                const index = checks.findIndex(check => check.id === id);
                next.ratios[index] = recovered.ratios[index];
                next.values[index] = recovered.values[index];
            });
        }
    }
    return { report: { ...next, ...scoreContributions(next.ratios) }, network: nextNetwork };
}
