/** Shared copy and reference weights. Raw observations are supplied by the live detector. */
export type Copy = readonly [zh: string, en: string];
export type CheckId =
    | 'timezone'
    | 'language'
    | 'languageVariant'
    | 'chineseFonts'
    | 'vendorFonts'
    | 'domesticBrowser'
    | 'domesticDevice'
    | 'intlLocale'
    | 'timezoneOffset'
    | 'emojiStyle'
    | 'browser'
    | 'device';
export type IconName =
    | 'globe'
    | 'location'
    | 'clock'
    | 'language'
    | 'typeface'
    | 'device'
    | 'browser'
    | 'sparkle'
    | 'shield'
    | 'network';
export interface CheckDefinition {
    id: CheckId;
    title: Copy;
    description: Copy;
    weight: number;
    icon: IconName;
    explanation: Copy;
    advice: Copy;
}

export const checks: readonly CheckDefinition[] = [
    {
        id: 'timezone',
        title: ['系统时区', 'System timezone'],
        weight: 26,
        icon: 'clock',
        description: [
            '读取浏览器获取的系统时区，识别中国大陆、港澳台及其他亚洲时区线索。',
            'Read the system timezone exposed to the browser and identify mainland Chinese, other Chinese-region and Asian timezone signals.',
        ],
        explanation: [
            '时区来自系统设置，不等于实际位置，也不会因为更换网络就自动改变。',
            'Timezone comes from system settings. It is not your physical location and does not necessarily change with your network.',
        ],
        advice: [
            '在系统的“日期与时间”设置中核对时区，确保与你实际使用的地区一致。',
            'Review Date & Time settings and make sure the timezone matches the region you actually use.',
        ],
    },
    {
        id: 'language',
        title: ['浏览器语言', 'Browser languages'],
        weight: 20,
        icon: 'language',
        description: [
            '检查浏览器首选语言与完整语言列表。中文是否排在首位，会影响本项风险加分。',
            'Check the preferred language and the complete browser language list. A Chinese first preference contributes more points.',
        ],
        explanation: [
            '首选语言决定网站通常优先显示哪种语言；它与当前页面手动选择的语言不同。',
            'Your first browser preference influences website language. It is separate from this page’s language selection.',
        ],
        advice: [
            '打开浏览器“语言”设置，核对首选顺序与仍需保留的语言，不必为了分数删除常用语言。',
            'Review language order in your browser settings. Keep the languages you need rather than removing them just to change a score.',
        ],
    },
    {
        id: 'languageVariant',
        title: ['语言文字特征', 'Language variants'],
        weight: 12,
        icon: 'language',
        description: [
            '识别简体、繁体及地区语言标记，例如 zh-CN、zh-Hans、zh-HK 和 zh-Hant。',
            'Identify simplified, traditional and regional language tags such as zh-CN, zh-Hans, zh-HK and zh-Hant.',
        ],
        explanation: [
            '语言标记反映文字与地区偏好；同为中文，也可能使用不同的文字变体。',
            'Language tags describe script and regional preferences. Chinese configurations can use different scripts.',
        ],
        advice: [
            '结合实际使用习惯检查浏览器和系统的语言设置，理解这些标记的来源。',
            'Check browser and system language settings to understand where these tags come from.',
        ],
    },
    {
        id: 'chineseFonts',
        title: ['字体地区特征', 'Regional fonts'],
        weight: 16,
        icon: 'typeface',
        description: [
            '比较字体排版宽度，识别微软雅黑、宋体、苹方及思源等常见简繁中文字体。',
            'Compare text widths to detect common Chinese fonts, including Microsoft YaHei, SimSun, PingFang and Source Han.',
        ],
        explanation: [
            '系统预装中文字体很常见。字体可见性也受浏览器隐私设置限制，结果只是环境线索。',
            'Chinese fonts are commonly preinstalled. Browser privacy settings can limit visibility, so font detection is only a signal.',
        ],
        advice: [
            '查看命中的字体清单即可，不建议为降低分数删除系统字体。',
            'Review the detected font list. Do not remove system fonts just to lower the score.',
        ],
    },
    {
        id: 'vendorFonts',
        title: ['厂商字体特征', 'Vendor fonts'],
        weight: 10,
        icon: 'typeface',
        description: [
            '检查小米、鸿蒙、OPPO、vivo 等厂商字体；命中数量会影响本项风险加分。',
            'Check fonts associated with Xiaomi, HarmonyOS, OPPO, vivo and other vendors. The number of matches affects the risk points.',
        ],
        explanation: [
            '厂商字体可能来自设备预装或自行安装，不能单凭一种字体判断设备归属。',
            'Vendor fonts may be preinstalled or added manually. One font alone does not identify a device manufacturer.',
        ],
        advice: [
            '如有命中，可核对字体来自系统还是自行安装的软件；没有命中时无需处理。',
            'For a match, review whether it came from the system or installed software. No match requires no action.',
        ],
    },
    {
        id: 'domesticBrowser',
        title: ['浏览器地区特征', 'Browser regional signals'],
        weight: 8,
        icon: 'browser',
        description: [
            '结合浏览器标识与品牌信息，识别微信、QQ、夸克、UC、华为及其他浏览器特征。',
            'Inspect browser identifiers and brand information for WeChat, QQ, Quark, UC, Huawei and other browser signals.',
        ],
        explanation: [
            '应用内置浏览器和独立浏览器可能暴露不同的标识；隐私保护也可能隐藏品牌信息。',
            'In-app and standalone browsers can expose different identifiers. Privacy features may hide brand information.',
        ],
        advice: [
            '遇到兼容性问题时，可在常用的独立浏览器中打开页面再比较结果。',
            'If you encounter compatibility issues, open the page in a standalone browser and compare the results.',
        ],
    },
    {
        id: 'domesticDevice',
        title: ['设备地区特征', 'Device regional signals'],
        weight: 6,
        icon: 'device',
        description: [
            '从设备和系统标记中寻找鸿蒙、华为、荣耀、小米、OPPO、vivo 等厂商线索。',
            'Look for HarmonyOS, Huawei, Honor, Xiaomi, OPPO, vivo and other vendor signals in device and system markers.',
        ],
        explanation: [
            '网页读取的是浏览器提供的标记，不是扫描电脑硬件；标记可能被简化或隐藏。',
            'The page reads browser-provided markers rather than scanning hardware. These markers may be reduced or hidden.',
        ],
        advice: [
            '把它作为设备兼容性参考，与下方系统信息一起查看，无需据此更换设备。',
            'Use it as a compatibility reference alongside system information. It is not a reason to replace your device.',
        ],
    },
    {
        id: 'intlLocale',
        title: ['系统区域格式', 'Regional format'],
        weight: 6,
        icon: 'globe',
        description: [
            '读取日期和数字格式所使用的区域，检查是否包含中文区域格式。',
            'Read the locale used to format dates and numbers and check for Chinese regional formats.',
        ],
        explanation: [
            '区域格式决定日期、数字和货币的显示习惯，可能与浏览器首选语言不同。',
            'Regional format controls date, number and currency conventions. It can differ from your preferred browser language.',
        ],
        advice: [
            '在系统“语言与地区”中核对区域格式，并与实际使用习惯保持一致。',
            'Review regional format under Language & Region and keep it consistent with your usage.',
        ],
    },
    {
        id: 'timezoneOffset',
        title: ['时区偏移', 'UTC offset'],
        weight: 4,
        icon: 'clock',
        description: [
            '检查当前时间相对 UTC 的偏移；UTC+8 及相近偏移按参考算法计入分数。',
            'Check the current offset from UTC. UTC+8 and nearby offsets contribute according to the reference algorithm.',
        ],
        explanation: [
            '多个国家共用 UTC+8。同一偏移不能证明在中国，也不能证明代理或异常。',
            'Many countries share UTC+8. An offset alone does not prove a location, proxy or anomaly.',
        ],
        advice: [
            '结合系统时区与网络位置理解结果，不要把正常的时差当成系统故障。',
            'Read this alongside system timezone and IP location. A normal time difference is not a system fault.',
        ],
    },
    {
        id: 'emojiStyle',
        title: ['表情符号风格', 'Emoji style'],
        weight: 4,
        icon: 'sparkle',
        description: [
            '根据浏览器提供的系统标记推测表情风格；不读取实际字形，仅作为弱相关信号。',
            'Estimate emoji style from operating-system markers. Actual glyphs are not inspected; this is a weak signal.',
        ],
        explanation: [
            '苹果、Windows 与安卓的表情绘制不同；本项仅按系统标记推测，不是实际渲染测试。',
            'Apple, Windows and Android draw emoji differently. This is an OS-based estimate, not a rendering test.',
        ],
        advice: [
            '通常无需处理，不建议仅为这一项改变系统或字体配置。',
            'Usually no action is needed. Do not change your system or fonts for this item alone.',
        ],
    },
    {
        id: 'browser',
        title: ['浏览器／应用环境', 'Browser and app'],
        weight: 0,
        icon: 'browser',
        description: [
            '展示当前浏览器及操作系统环境，帮助理解兼容性；本项不参与评分。',
            'Show the browser and operating-system environment for compatibility context. This item is not scored.',
        ],
        explanation: [
            '浏览器名称与版本有助于排查页面兼容性，不代表账号风险。',
            'Browser name and version help troubleshoot compatibility; they do not indicate account risk.',
        ],
        advice: [
            '如果页面功能异常，可先核对浏览器版本；本项只提供信息，不增加分数。',
            'If a page behaves unexpectedly, check your browser version. This informational item contributes no points.',
        ],
    },
    {
        id: 'device',
        title: ['设备／系统信息', 'Device and system'],
        weight: 0,
        icon: 'device',
        description: [
            '展示浏览器可提供的设备类型和系统线索；不会扫描文件、软件或后台进程。',
            'Show device type and system signals available to the browser. Files, installed apps and background processes are not scanned.',
        ],
        explanation: [
            '浏览器可能出于隐私原因隐藏或简化系统版本，所以不保证与系统设置完全一致。',
            'Browsers may hide or reduce OS version details for privacy, so these can differ from system settings.',
        ],
        advice: [
            '设备型号或系统版本不完整时，仍可查看其他检测结果；本项不参与评分。',
            'Other checks remain useful even when model or OS details are incomplete. This item is not scored.',
        ],
    },
];

export const scoreRationale: Record<CheckId, Copy> = {
    timezone: [
        '26 分是参考规则中的强区域线索权重。系统时区可自行设置，不能证明实际位置，也不构成故障。',
        'The reference gives timezone a strong regional weight of 26. It is user-configurable and proves neither physical location nor a fault.',
    ],
    language: [
        '20 分描述首选语言的区域特征。它与语言文字、区域格式相关，不应把三项相加解释成三个独立风险。',
        'The 20-point weight describes preferred-language signals. Language variant and regional format overlap with it; these are not three independent risks.',
    ],
    languageVariant: [
        '12 分补充简繁中文变体线索，与首选语言有重复，因此只用于参考站规则对比。',
        'The 12-point weight adds Chinese variant signals and overlaps with preferred language. It is retained for reference-rule comparison.',
    ],
    chineseFonts: [
        '16 分可能被正常预装字体触发。字体数量影响参考分，但没有证据表明删除字体能提升账号安全。',
        'Normal preinstalled fonts can trigger the 16 risk points. Font counts affect the reference score; removing fonts is not an established account-safety measure.',
    ],
    vendorFonts: [
        '10 分描述厂商字体线索；自行安装也会命中，不能据此认定设备产地或风险。',
        'The 10-point weight describes vendor-font signals. Manually installed fonts can match, so it does not establish device origin or risk.',
    ],
    domesticBrowser: [
        '8 分来自品牌标记。内置浏览器可提示兼容性检查，但品牌本身不能证明服务使用风险。',
        'The 8-point weight uses brand markers. An in-app browser can justify a compatibility check, but the brand itself does not establish service risk.',
    ],
    domesticDevice: [
        '6 分来自浏览器提供的厂商标记，可能被简化或隐藏；不能代替硬件识别。',
        'The 6-point weight uses browser-provided vendor markers, which may be reduced or hidden. It is not hardware identification.',
    ],
    intlLocale: [
        '6 分反映日期与数字显示习惯，与语言偏好相关；属于区域信息，不是异常。',
        'The 6-point weight reflects date and number conventions and overlaps with language preference. It is regional information, not a fault.',
    ],
    timezoneOffset: [
        '实际最高 4 分，与系统时区相关。多个国家共用 UTC+8，独立定位能力较弱。',
        'The actual maximum is 4 and overlaps with system timezone. Many countries share UTC+8, limiting its independent location value.',
    ],
    emojiStyle: [
        '4 分仅按系统标记推测，未检查实际字形，属于弱线索，不宜赋予安全含义。',
        'The 4-point weight estimates style from OS markers without inspecting glyphs. It is a weak signal with no established safety meaning.',
    ],
    browser: [
        '信息项不计分。名称与版本用于排查兼容性，避免重复计入品牌线索。',
        'Unscored information. Name and version support compatibility checks without counting brand signals again.',
    ],
    device: [
        '信息项不计分。用于解释采集环境，不扫描系统，也不额外增加风险加分。',
        'Unscored information. It explains the observed environment without scanning the system or adding points.',
    ],
};

export function scoreContributions(ratios: ReadonlyArray<number | null>) {
    const contributions = checks.map((check, index) => {
        const ratio = ratios[index];
        return !check.weight
            ? 0
            : ratio == null || !Number.isFinite(ratio)
              ? null
              : Math.round(check.weight * Math.max(0, Math.min(1, ratio)));
    });
    return {
        contributions,
        score: contributions.some(value => value === null)
            ? null
            : Math.min(
                  100,
                  contributions.reduce<number>((sum, value) => sum + (value ?? 0), 0),
              ),
    };
}

export const checkFollowUp: Record<CheckId, Copy> = {
    timezone: [
        '如有调整，重新检测并核对时区与设备显示的当地时间；时间正确即可保持。',
        'After a change, check again and compare the timezone with the local time shown on your device. Retain correct settings.',
    ],
    language: [
        '如有调整，重新检测并查看首选语言及完整列表；本页的中英文切换不会改变浏览器语言。',
        'After a change, check again and review the first language and full list. This page’s language switch does not change browser preferences.',
    ],
    languageVariant: [
        '重新检测可确认语言标记是否更新；仍符合你的使用习惯时无需更改。',
        'Check again to confirm updated language tags. No change is needed when they match your preferences.',
    ],
    chineseFonts: [
        '保留正常系统字体；如曾无法读取，可重试此项并查看是否出现字体清单。',
        'Retain normal system fonts. If the reading was unavailable, retry this item and check for a font list.',
    ],
    vendorFonts: [
        '重新检测可确认命中的字体清单；正常预装或常用字体不需要删除。',
        'Check again to confirm the matched font list. Normal preinstalled or useful fonts do not need removal.',
    ],
    domesticBrowser: [
        '换浏览器后重新检测，并实际重试原来失败的页面操作；标记消失不等于故障已修复。',
        'Check again after switching browsers and retry the operation that failed. A missing marker alone does not prove recovery.',
    ],
    domesticDevice: [
        '重新检测可确认设备标记；浏览器未提供的型号不能靠此页面补全。',
        'Check again to confirm device markers. The page cannot recover model details withheld by the browser.',
    ],
    intlLocale: [
        '如有调整，重新检测并查看区域格式；日期和数字显示符合习惯即可保持。',
        'After a change, check again and review regional format. Retain settings that display dates and numbers as you prefer.',
    ],
    timezoneOffset: [
        '重新检测并同时核对系统时区与当前 UTC 偏移；正常时差无需调整。',
        'Check again and compare system timezone and the current UTC offset. Normal time differences need no adjustment.',
    ],
    emojiStyle: [
        '本项仅由系统标记推测，不需要优化；重新检测也不能验证所有表情的实际字形。',
        'This OS-based estimate needs no optimization. A new check still cannot validate every rendered emoji.',
    ],
    browser: [
        '如有兼容性问题，更新或更换浏览器后重新检测，并确认原操作能否完成。',
        'For compatibility issues, check again after updating or switching browsers and verify the original operation.',
    ],
    device: [
        '如信息不完整，可重试；浏览器仍未提供时继续显示未知，不影响其他可用结果。',
        'Retry incomplete information. Details withheld again remain unknown; other available results remain useful.',
    ],
};

export const faqs: ReadonlyArray<{ question: Copy; answer: Copy }> = [
    {
        question: ['这个分数代表账号安全吗？', 'Does this score indicate account safety?'],
        answer: [
            '不代表。环境风险参考分只汇总本页列出的区域特征，不能预测 Claude 或其他平台的审核、限制或封号决定。它适合用来理解环境差异，不能作为账号安全保证。',
            'No. The environment risk reference score summarizes the regional signals listed here.' +
                ' It cannot predict Claude or another platform’s reviews, restrictions or account deci' +
                'sions. Use it to understand configuration differences, not as an account-safety guara' +
                'ntee.',
        ],
    },
    {
        question: ['环境风险参考分与IP 风险分有什么区别？', 'How do the environment and IP scores differ?'],
        answer: [
            '环境风险参考分由浏览器的 10 个评分细项汇总；IP 风险分来自外部 IP 数据源。它们反映不同的信息，独立显示，不混合计算。即使 IP 风险低，也可能检测到较多中文区域特征。',
            'The environment risk reference score combines ten scored browser signals. The IP risk' +
                ' score comes from an external data provider. They describe different information and ' +
                'are shown separately. A low IP risk does not imply few Chinese regional signals.',
        ],
    },
    {
        question: ['网页能检测整台电脑吗？', 'Can this page inspect my entire computer?'],
        answer: [
            '不能。网页只能读取浏览器允许访问的时区、语言、部分字体及设备标记。不会扫描电脑文件、已安装软件、后台进程或病毒，也不需要安装客户端。',
            'No. It only reads timezone, language, a limited font sample and device markers expose' +
                'd by the browser. It does not scan files, installed apps, background processes or mal' +
                'ware, and requires no installed client.',
        ],
    },
    {
        question: [
            '为什么时区、语言与 IP 位置不一致？',
            'Why can timezone, language and IP location differ?',
        ],
        answer: [
            '它们来自不同来源：时区和区域格式通常来自系统，语言来自浏览器设置，IP 位置来自网络数据库。旅行、远程办公、共享网络或数据源误差都可能导致差异，不能据此认定使用代理。',
            'They have different sources: system settings, browser preferences and network databas' +
                'es. Travel, remote work, shared networks and database errors can all cause difference' +
                's. A mismatch alone does not prove proxy use.',
        ],
    },
    {
        question: ['如何理解检测建议，需要修改所有设置吗？', 'Do I need to change every setting mentioned?'],
        answer: [
            '不需要。先查看每项实际采集值和说明，核对设置是否符合你的使用习惯。中文、亚洲时区和系统字体都可能是正常配置。不要仅为降低分数删除系统字体或改变常用语言。',
            'No. Review each observed value and its explanation, then check whether the settings m' +
                'atch your usage. Chinese languages, Asian timezones and system fonts can all be norma' +
                'l. Do not remove system fonts or change useful languages merely to lower a score.',
        ],
    },
    {
        question: ['网络检测会发送哪些信息？', 'What information does a network check send?'],
        answer: [
            '仅在点击检测后，浏览器连接 ipify 识别公网 IPv4／IPv6，优先查询 IPv4；网站使用该 IP 向 IP-DB、IP Guide、FreeIPAPI 和 IP' +
                'Whois 查询网络资料与近似邮编。本地语言、字体和设备信号不会随网络查询上传。IPv4 和 IPv6 是不同地址，不互相换算；来源确实没有邮编时仍显示未知，不同数据库的' +
                '邮编可能不同，不代表设备的精确地址。',
            'Only after you start a check, the browser contacts ipify to observe its public IPv4/I' +
                'Pv6; IPv4 is preferred. The site uses that IP with IP-DB, IP Guide, FreeIPAPI and IPW' +
                'hois for network information and an approximate postal code. Local language, font and' +
                ' device signals are not sent. IPv4 and IPv6 are distinct addresses, not conversions. ' +
                'Missing postal codes remain unknown. Postal estimates can vary between databases and ' +
                'do not locate the device precisely.',
        ],
    },
    {
        question: [
            '为什么有些信息显示未知或查询失败？',
            'Why can some information be unknown or unavailable?',
        ],
        answer: [
            '浏览器隐私限制、数据源缺失、超时或共享免费查询额度用完都可能影响网络结果。浏览器检测仍可使用，无需付费解锁；短时繁忙或额度恢复后可只重试网络。未知不会当作零分或安全。位置、邮编与坐标是 IP 估算结果，不代表设备的精确地址。',
            'Browser privacy restrictions, missing provider data, timeouts or the shared free allo' +
                'wance can affect network results. Browser checks remain available without a paid unlo' +
                'ck. Retry the network after temporary congestion or allowance resets. Unknown is not ' +
                'zero risk. Location, postal code and coordinates are IP estimates, not the device’s e' +
                'xact address.',
        ],
    },
    {
        question: [
            '刷新、返回或切换语言会再次检测吗？',
            'Do reload, navigation or language changes trigger a scan?',
        ],
        answer: [
            '不会自动检测。本功能在当前会话内按店铺和客户作用域保留内存报告，整页刷新后重新等待手动开始。切换语言只改变页面文案，已采集的原始结果保留；更换店铺、币种或客户身份后分别保存报告。',
            'No scans start automatically. This feature keeps a scoped, in-memory report during th' +
                'e session and waits for a new manual check after reload. Language changes translate t' +
                'he page while retaining raw readings. Reports are scoped separately by store, currenc' +
                'y and customer identity.',
        ],
    },
];
