/** Conditional guidance for observed values. It never changes system or network settings. */
import { type CheckId, checks, type Copy } from './content';
import { reportView } from './detection';

export type BrowserView = ReturnType<typeof reportView>;
export type NetworkState = 'idle' | 'pending' | 'ready' | 'error';
export type FailureReason = 'timeout' | 'quota' | 'rate' | 'address' | 'provider';
export interface NetworkView {
    high: boolean;
    low: boolean;
    checkedAt: Date;
    type: 'residential' | 'datacenter' | 'proxy' | 'mobile' | 'business' | 'unknown';
    proxy: boolean | null;
    score: number | null;
    timezone: string | null;
    utcOffset: number | null;
    source: string;
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

/** Every scored match has guidance, independently of a confirmed compatibility fault. */
export function regionalOptimizations(
    report: Pick<BrowserView, 'ratios' | 'contributions' | 'facts'>,
): Finding[] {
    const timeSettings: Copy =
        report.facts.platform === 'Windows'
            ? [
                  'Windows：在“设置 → 时间和语言 → 日期和时间”中启用自动时区，或按实际所在地手动选择。',
                  'Windows: open Settings → Time & language → Date & time. Review automatic timezone settings, or select your actual location’s timezone manually.',
              ]
            : report.facts.platform === 'macOS'
              ? [
                    'Mac：在“系统设置 → 通用 → 日期与时间”中启用自动设置，或按实际所在地手动选择时区。',
                    'Mac: open System Settings → General → Date & Time. Review automatic settings, or select your actual location’s timezone manually.',
                ]
              : [
                    '在系统设置中搜索“日期和时间”，启用自动时区，或按实际所在地手动选择。',
                    'Search system settings for Date & time. Review automatic timezone settings, or select your actual location’s timezone manually.',
                ];
    const guidance: Partial<Record<CheckId, { explanation: Copy; steps: readonly Copy[]; verify: Copy }>> = {
        timezone: {
            explanation: [
                `当前时区 ${report.facts.timezone ?? '未知'} 命中亚洲时区参考规则，请结合实际所在地核对设置。`,
                'The current timezone, ' +
                    String(report.facts.timezone ?? 'unknown') +
                    ', matches this tool’s regional rules. Asian timezones add we' +
                    'ighted points; a correct local timezone is not itself a comp' +
                    'uter fault.',
            ],
            steps: [
                [
                    '核对实际所在地；时区一致且当地时间正确时可以保留，出差或迁居后仍沿用旧时区时再调整。',
                    'Check whether the timezone matches where you actually use the device. After travel, r' +
                        'elocation or remote work, update an outdated timezone to the actual location; retain ' +
                        'it when the region and local time are correct.',
                ],
                timeSettings,
            ],
            verify: [
                '调整后重新检测，核对时区、UTC 偏移和当地时间，并测试原来使用的服务。',
                'After a change, check again and verify timezone, UTC offset and local time, then test' +
                    ' the original service. Keeping the current timezone also keeps its reference points.',
            ],
        },
        language: {
            explanation: [
                '中文位于首选位置或出现在语言列表中，会按本工具规则加分；这反映浏览器偏好，不等于服务一定受限。',
                'Chinese as the first preference or elsewhere in the language list adds points under t' +
                    'his tool’s rules. This reflects browser preferences, not certain service restrictions' +
                    '.',
            ],
            steps: [
                [
                    '如果这套浏览器主要用于英文服务，可在浏览器“设置 → 语言”中添加 English，并将英文移到首位；仍需中文阅读时保留中文作为后续语言。',
                    'If this browser is mainly for English-language services, add English in Settings → La' +
                        'nguages and move it first. Keep Chinese later in the list if you still need it.',
                ],
                [
                    '按浏览器提示重新启动或重新打开页面；网页顶部的中英文切换只改变本站界面，不会修改浏览器首选语言。',
                    'Relaunch or reopen the page as your browser requests. This website’s language switch changes its interface, not the browser’s preferred language.',
                ],
            ],
            verify: [
                '重新检测后核对“首选”和完整语言列表。英文排首位后，列表仍含中文可能继续产生部分加分；不保证降至零分。',
                'Check again and review the preferred language and full list. Chinese remaining later ' +
                    'in the list can still add partial points; zero points are not guaranteed.',
            ],
        },
        languageVariant: {
            explanation: [
                '简体或繁体中文语言标记命中规则，与浏览器语言项有重叠；改变本站显示语言不会自动改变这些标记。',
                'Simplified or traditional Chinese language tags match the rule and overlap with brows' +
                    'er languages. Changing this website’s language does not automatically change those ta' +
                    'gs.',
            ],
            steps: [
                [
                    '需要英文工作环境时，在浏览器显示语言及首选语言中使用对应的英文设置，并检查系统语言是否仍给浏览器提供中文默认值。',
                    'For an English-language work environment, review the browser display and preferred la' +
                        'nguages, and check whether the system still provides a Chinese default.',
                ],
                [
                    '保留实际需要的中文输入和阅读能力；若继续保留中文语言标记，本项可以继续有分，不必将正常中文配置当成故障。',
                    'Retain Chinese input and reading support you need. Keeping Chinese tags can keep this item’s points; a normal Chinese configuration is not a fault.',
                ],
            ],
            verify: [
                '重新打开浏览器后检测，检查采集的语言变体是否改变，并同时核对浏览器语言项；两个项目可能一起变化。',
                'Check after reopening the browser. Review the observed variant and browser languages together, since both items can change together.',
            ],
        },
        chineseFonts: {
            explanation: [
                '检测到的中文字体按参考规则加分。系统预装字体也会命中，独立浏览器或无痕窗口仍可能读取相同系统字体。',
                'Detected Chinese fonts add reference points, including normal preinstalled fonts. A s' +
                    'tandalone browser or private window can still see the same system fonts.',
            ],
            steps: [
                [
                    '对照采集清单，在系统字体管理器核对字体来源。仅对你自行安装、确认不再需要的非系统字体按需停用；保留系统预装及日常需要的字体。',
                    'Compare the observed list with the system font manager. Consider disabling only non-s' +
                        'ystem fonts you installed and no longer need; retain preinstalled and required fonts.',
                ],
                [
                    '如果需要专用工作环境，可使用已有的独立工作设备比较字体清单和实际服务表现。仅新建浏览器配置不会移除系统字体，也不能保证本项降分。',
                    'For a dedicated work environment, compare with an existing separate work device and t' +
                        'est the service. A new browser profile does not remove system fonts or guarantee fewe' +
                        'r points.',
                ],
            ],
            verify: [
                '重新检测后比较命中字体清单与本项加分；没有修改字体时结果可能不变。读取受限仍显示未知，不会当成零风险。',
                'Compare the matched font list and points after rechecking. Without font changes, resu' +
                    'lts may stay the same. Restricted readings remain unknown, not zero risk.',
            ],
        },
        vendorFonts: {
            explanation: [
                '厂商字体命中参考规则，可能来自预装或手动安装；单凭字体不能认定设备来源或账号风险。',
                'Vendor-font matches can come from preinstallation or manual installation. Fonts alone do not establish device origin or account risk.',
            ],
            steps: [
                [
                    '在系统字体管理中查找采集到的厂商字体，核对是系统预装、软件安装还是自行安装。',
                    'Locate the observed vendor fonts in the system font manager and check whether they came from the system, software or your own installation.',
                ],
                [
                    '仅对确认不再需要的自行安装字体按需停用，再重新打开浏览器；预装字体或有排版需求的字体保持原状，避免影响其他应用。',
                    'Consider disabling only user-installed fonts you no longer need, then reopen the brow' +
                        'ser. Retain preinstalled fonts and fonts needed for documents or other apps.',
                ],
            ],
            verify: [
                '复查厂商字体名称、命中数量和加分；字体仍保留时加分可能不变，不能据此判断优化失败或账号不安全。',
                'Recheck vendor-font names, match count and points. Retained fonts can retain points; this does not prove failed optimization or an unsafe account.',
            ],
        },
        domesticBrowser: {
            explanation: [
                '浏览器品牌或标识命中地区规则。应用内浏览器还可能存在登录、跳转或页面兼容性差异。',
                'Browser branding or identifiers match a regional rule. In-app browsers may also differ in sign-in, redirects or page compatibility.',
            ],
            steps: [
                [
                    '如果当前使用微信、QQ 等应用内浏览器，复制页面地址并在已安装的 Chrome、Edge、Firefox 或 Safari 独立浏览器中打开。',
                    'If you are using an in-app browser such as WeChat or QQ, copy the page URL into an in' +
                        'stalled standalone browser such as Chrome, Edge, Firefox or Safari.',
                ],
                [
                    '从浏览器官方渠道保持更新；使用正常浏览器配置比较，避免通过伪造浏览器标识让检测结果与真实能力不一致。',
                    'Keep the browser updated through official channels. Compare normal browser configurat' +
                        'ions; spoofed identifiers can make readings differ from actual capabilities.',
                ],
            ],
            verify: [
                '在新浏览器中重新检测，确认品牌采集值及本项加分是否变化，并重试原来失败的操作。',
                'Check in the new browser, review the observed brand and points, and retry the operation that originally failed.',
            ],
        },
        domesticDevice: {
            explanation: [
                '设备或系统厂商标记命中规则。网页无法修改硬件来源，也不能据此判断设备不安全。',
                'Device or OS vendor markers match the rule. A webpage cannot change hardware origin, and these markers do not establish an unsafe device.',
            ],
            steps: [
                [
                    '先将系统和常用浏览器更新到受支持版本；如当前使用厂商内置浏览器，可用已安装的通用独立浏览器比较实际兼容性。',
                    'Keep the OS and usual browser on supported versions. If using a vendor’s built-in bro' +
                        'wser, compare compatibility with an installed standalone browser.',
                ],
                [
                    '如果设备标记仍保留，优先按服务的实际报错排查；可用手边其他设备比较，无需仅为这个分数购买或更换设备。',
                    'If the vendor marker remains, prioritize the service’s actual error. Compare with ano' +
                        'ther available device; this score alone does not justify buying or replacing hardware' +
                        '.',
                ],
            ],
            verify: [
                '重新检测设备和浏览器标记，并验证实际访问；更换浏览器不保证设备厂商标记消失。',
                'Recheck device and browser markers and test actual access. Switching browsers does not guarantee removal of device vendor markers.',
            ],
        },
        intlLocale: {
            explanation: [
                '当前日期、数字格式采用中文区域设置，按参考规则加分；这与语言偏好相关，不是系统故障。',
                'Chinese date and number formatting adds reference points. It overlaps with language preferences and is not a system fault.',
            ],
            steps: [
                [
                    '如工作场景需要英文日期与数字格式，在浏览器显示语言或系统“语言与地区”中选择实际需要的英文区域格式。',
                    'If work requires English date and number formats, choose the appropriate English form' +
                        'at in browser display-language settings or the system’s Language & Region settings.',
                ],
                [
                    '关闭并重新打开浏览器，再检查日期和小数分隔符是否符合日常需要；不要把本站语言切换当作已修改系统区域格式。',
                    'Reopen the browser and check date and decimal formats for your needs. This website’s language switch does not change the system’s regional format.',
                ],
            ],
            verify: [
                '重新检测系统区域格式，核对采集的 locale 与本项加分；保留中文格式时本项可以继续有分。',
                'Recheck the observed locale and points. Keeping Chinese formatting can retain this item’s points.',
            ],
        },
        timezoneOffset: {
            explanation: [
                '当前 UTC 偏移命中参考规则，与系统时区项目相关；多个国家使用 UTC+8，不能仅凭偏移判断异常。',
                'The current UTC offset matches the reference rule and overlaps with system timezone. ' +
                    'Many countries use UTC+8; an offset alone does not establish a fault.',
            ],
            steps: [
                [
                    '结合“系统时区”一起核对实际所在地、当地时间与 UTC 偏移；夏令时变化也会影响偏移。',
                    'Review the actual location, local time and UTC offset together with the system timezone. Daylight saving time can also change the offset.',
                ],
                [
                    '确实配置错误时调整系统时区或启用自动时区，不要通过手动拨快、拨慢系统时钟来降低分数。',
                    'Correct an incorrectly configured timezone or enable automatic timezone settings. Do ' +
                        'not move the clock forward or backward just to lower this score.',
                ],
            ],
            verify: [
                '重新检测系统时区和 UTC 偏移，确认当地时间正确；两项可能联动加减分，不应重复修改。',
                'Recheck system timezone and UTC offset and confirm local time is correct. Both scores may change together; repeated changes are unnecessary.',
            ],
        },
        emojiStyle: {
            explanation: [
                '本项仅依据系统标记推测表情风格，属于弱相关线索；网页没有检测实际表情字形。',
                'This weak signal estimates emoji style from OS markers. The webpage does not inspect actual emoji glyphs.',
            ],
            steps: [
                [
                    '优先处理语言、浏览器和真实连接异常等可核对项目；本项只能随系统风格线索变化，页面没有独立开关。',
                    'Prioritize reviewable language, browser and real connection issues. This item follows system-style markers and has no independent webpage setting.',
                ],
                [
                    '若表情确有乱码或显示异常，从官方渠道更新系统和浏览器后复查；显示正常时保留系统表情字体。',
                    'If emoji rendering is actually broken, update the OS and browser through official cha' +
                        'nnels and recheck. Retain system emoji fonts when rendering works.',
                ],
            ],
            verify: [
                '复查表情风格推测值并查看实际显示；单项加分不变不代表其他调整无效，也不代表账号危险。',
                'Review the estimated style and actual rendering. Unchanged points here do not invalidate other changes or establish account danger.',
            ],
        },
    };
    return checks.flatMap((check, index) => {
        const ratio = report.ratios[index];
        const points = report.contributions[index];
        const advice = guidance[check.id];
        if (!check.weight || ratio == null || points == null || points <= 0 || !advice) return [];
        return [
            {
                id: `regional-${check.id}`,
                kind: 'optimization' as const,
                tone: 'check' as const,
                scope: 'local' as const,
                related: [check.id],
                title: [`${check.title[0]}优化建议`, `${check.title[1]}: review options`] as Copy,
                evidence: [
                    `本项命中参考规则：+${points} 分（权重 ${check.weight} × ${Math.round(ratio * 100)}%，四舍五入）。`,
                    `This item matches the reference rule: +${points} points (weight ${check.weight} × ${Math.round(ratio * 100)}%, rounded).`,
                ] as Copy,
                ...advice,
            },
        ];
    });
}
export function diagnose(
    report: BrowserView | null,
    state: NetworkState,
    network: NetworkView | null,
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
                failure === 'rate'
                    ? ['网络查询过于频繁', 'Too many network lookups']
                    : failure === 'address'
                      ? ['当前连接没有可查询的公网 IP', 'No queryable public IP on this connection']
                      : failure === 'quota'
                        ? ['今日检测次数额度已用完', 'Today’s detection quota is used up']
                        : failure === 'provider'
                          ? ['网络信誉数据源暂不可用', 'Network reputation provider unavailable']
                          : ['网络资料暂未取得', 'Network details are unavailable'],
            evidence:
                failure === 'quota'
                    ? [
                          '网络查询返回“限额已用完”；当前 IP 类型与信誉无法确认。',
                          'The lookup returned a quota limit. Current IP type and reputation cannot be confirmed.',
                      ]
                    : [
                          '网络查询未成功；本地检测仍然有效。',
                          'The network lookup did not succeed. Local checks remain available.',
                      ],
            explanation: [
                '缺少网络结果不能解释成安全，也不代表你的电脑有故障。',
                'Missing network results do not indicate safety or a fault with your computer.',
            ],
            steps:
                failure === 'rate'
                    ? [
                          [
                              '等待一分钟后仅重试网络，避免连续重复点击。',
                              'Wait one minute before retrying the network; avoid repeated clicks.',
                          ],
                      ]
                    : failure === 'address'
                      ? [
                            [
                                '本地浏览器检测仍可使用；内网或本地开发地址不能用于公网 IP 信誉查询。',
                                'Local browser checks still work. Private or loopback addresses cannot be used for public IP reputation lookups.',
                            ],
                            [
                                '请在网站正式访问地址重试；如仍提示此问题，联系网站管理员核对反向代理来源地址配置。',
                                'Retry on the website’s normal public address. If the issue persists, ask its administ' +
                                    'rator to review trusted proxy address configuration.',
                            ],
                        ]
                      : failure === 'quota'
                        ? [
                              [
                                  '网络查询额度恢复后可重试；浏览器本地检测仍可使用，已有报告仍可查看。',
                                  'Today’s network lookup allowance is exhausted. Retry after it resets; browser checks and existing reports remain available.',
                              ],
                              [
                                  '无需修改电脑设置或付费解锁。持续无法查询时，可联系网站管理员核对数据源状态。',
                                  'No computer setting changes or paid unlock are needed. If lookups remain unavailable,' +
                                      ' ask the website administrator to review the data source.',
                              ],
                          ]
                        : failure === 'provider'
                          ? [
                                [
                                    '已取得的公网 IP 和位置信息仍可查看；信誉分、代理标记等缺失信息继续显示未知。',
                                    'Available public IP and location details remain visible. Missing reputation and proxy flags remain unknown.',
                                ],
                                [
                                    '稍后仅重试网络；仍失败时，请网站管理员检查数据源状态与额度，无需修改电脑设置。',
                                    'Retry only the network later. If unavailable, ask the website administrator to review' +
                                        ' provider status and allowance. No computer settings need changing.',
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
                `暂缺：${[
                    !network || network.type === 'unknown' ? '网络类型' : '',
                    !network || network.score === null ? '信誉分' : '',
                    !network || network.proxy === null ? '代理标记' : '',
                    !network || network.utcOffset === null || network.timezone === null ? '时区信息' : '',
                ]
                    .filter(Boolean)
                    .join('、')}。数据源未返回的信息保留为未知。`,
                `Unavailable: ${[
                    !network || network.type === 'unknown' ? 'network type' : '',
                    !network || network.score === null ? 'reputation score' : '',
                    !network || network.proxy === null ? 'proxy flag' : '',
                    !network || network.utcOffset === null || network.timezone === null
                        ? 'timezone details'
                        : '',
                ]
                    .filter(Boolean)
                    .join(', ')}. Fields not returned by the provider remain unknown.`,
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
                '核对查询时间、缓存标记及缺失字段；缓存结果或仍缺失的信息不能证明问题已解决。',
                'Review the lookup time, cache marker and missing fields. A cached result or still-missing information does not establish recovery.',
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
                    '数据源 ' +
                        String(network.source) +
                        '：信誉风险分 ' +
                        String(network.score ?? '—') +
                        '/100；代理标记：' +
                        String(network.proxy === null ? '未知' : network.proxy ? '是' : '否') +
                        '；查询时间 ' +
                        String(network.checkedAt.toLocaleTimeString('en-GB', { hour12: false })) +
                        '。',
                    'Provider ' +
                        String(network.source) +
                        ': reputation risk ' +
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
            report.facts.utcOffset !== null &&
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
            `检测已更新：${cleared} 项提示本次未再检出${current.length ? `，仍有 ${current.length} 项建议可查看` : ''}。请同时确认原来的使用问题是否恢复。`,
            'Updated: ' +
                String(cleared) +
                ' earlier finding' +
                String(cleared === 1 ? ' was' : 's were') +
                ' not detected' +
                String(
                    current.length
                        ? '; guidance remains for ' +
                              String(current.length) +
                              ' item' +
                              String(current.length === 1 ? '' : 's')
                        : '',
                ) +
                '. Also verify whether the original operation works.',
        ];
    if (current.length)
        return [
            previous
                ? `检测已更新，仍有 ${current.length} 项建议，请按实际情况核对。`
                : `检测完成，有 ${current.length} 项建议可查看。`,
            previous
                ? `Updated; guidance remains for ${current.length} item${current.length === 1 ? '' : 's'}. Review it for your situation.`
                : `Complete; guidance is available for ${current.length} item${current.length === 1 ? '' : 's'}.`,
        ];
    return [
        '本次可读取的项目未发现需要处理的问题，保持正常设置即可。',
        'No actionable findings in the available checks. Retain your normal settings.',
    ];
}
