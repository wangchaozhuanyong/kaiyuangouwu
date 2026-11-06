// organize-imports-ignore -- Preserve ESLint type groups.
import type { CleanupCommand } from './proxy-cleanup-content';
import type { StorefrontLanguage } from '../../types';
import { Check, Copy, Download } from 'lucide-react';
import { useState } from 'react';

import { Sheet } from '../../storefront-ui/page-shell';

import relayBilling from './illustrations/relay-billing.png';
import themeSelection from './illustrations/theme-selection.png';
import { proxyCleanupPlatforms } from './proxy-cleanup-content';

function CopyCommand({ command, language }: { command: CleanupCommand; language: StorefrontLanguage }) {
    const zh = language === 'zh';
    const [status, setStatus] = useState<'copied' | 'error'>();
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(command.value);
            setStatus('copied');
        } catch {
            setStatus('error');
        }
    };
    return (
        <>
            <div className="environment-proxy-command">
                <pre tabIndex={0}>
                    <code>{command.value}</code>
                </pre>
                <button
                    className="environment-text-button type-action"
                    type="button"
                    aria-label={command.label[zh ? 0 : 1]}
                    onClick={() => void copy()}
                >
                    {status === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                    {status === 'copied' ? (zh ? '已复制' : 'Copied') : zh ? '复制' : 'Copy'}
                </button>
            </div>
            <span role="status" className="type-helper">
                {status === 'copied' && (zh ? '命令已复制到剪贴板。' : 'Command copied.')}
                {status === 'error' &&
                    (zh ? '无法自动复制，请选中命令手动复制。' : 'Select the command to copy it manually.')}
            </span>
        </>
    );
}

export function ProxyCleanupGuide({
    language,
    onClose,
}: {
    language: StorefrontLanguage;
    onClose: () => void;
}) {
    const locale = language === 'zh' ? 0 : 1;
    const t = (zh: string, en: string) => [zh, en][locale];
    return (
        <Sheet
            className="environment-proxy-sheet"
            title={t('删除中转 API 变量', 'Remove relay API variables')}
            language={language}
            onClose={onClose}
            initialFocus="dialog"
        >
            <div className="environment-proxy-guide">
                <h3 className="type-section">
                    {t('1. 第一步，删除中转API变量', '1. Remove relay API variables')}
                </h3>
                <p className="type-body">
                    {t(
                        '如果之前有使用过中转API，参考下面windows或者mac的方法，先把原来的中转API全部环境变量删除',
                        'If you used an API relay before, follow the Windows or Mac steps below to clear its environment variables.',
                    )}
                </p>
                <ul className="environment-proxy-notes type-body">
                    <li>
                        {t(
                            'setting.json 之类的都检查一下',
                            'Check configuration files such as settings.json.',
                        )}
                    </li>
                    <li>
                        {t(
                            'claude.json 有关是不是第一次登录，计费这些记录都删了',
                            'Clear the previous onboarding and billing records in claude.json.',
                        )}
                    </li>
                    <li>
                        {t(
                            '建议可以让其他AI编程工具帮你找这些变量参数，比如cursor、antigravity等',
                            'You can ask another AI coding tool, such as Cursor or Antigravity, to help find the variables.',
                        )}
                    </li>
                </ul>
                <p className="environment-proxy-warning type-helper">
                    {t(
                        '运行提示：原版脚本会直接修改配置，可能重置 Claude 或 Codex 登录，并在终端显示密钥。',
                        'Before running: the original scripts edit settings, may reset Claude or Codex sign-in, and can print keys. ' +
                            'Keep terminal output containing credentials private.',
                    )}
                </p>
                <h3 className="type-section">
                    {t('1.1 根据windows或者mac电脑流程操作', '1.1 Follow the Windows or Mac instructions')}
                </h3>
                {proxyCleanupPlatforms.map(platform => (
                    <section className="environment-proxy-platform" key={platform.name}>
                        <h4 className="type-section">{platform.heading[locale]}</h4>
                        {platform.steps.map((step, index) => (
                            <div className="environment-proxy-step" key={step.title[0]}>
                                <h5 className="type-action">{step.title[locale]}</h5>
                                {step.content.map(part =>
                                    'value' in part ? (
                                        <CopyCommand command={part} language={language} key={part.label[0]} />
                                    ) : (
                                        <p className="type-body" key={part[0]}>
                                            {part[locale]}
                                        </p>
                                    ),
                                )}
                                {index === 0 && (
                                    <a
                                        className="environment-text-button type-action"
                                        href={`/tools/claude-proxy/${platform.file}`}
                                        download={platform.file}
                                        aria-label={t(
                                            `下载 ${platform.name} 脚本`,
                                            `Download ${platform.name} script`,
                                        )}
                                    >
                                        <Download aria-hidden="true" />
                                        {platform.file}
                                        <span className="type-meta">{platform.size}</span>
                                    </a>
                                )}
                            </div>
                        ))}
                        <h5 className="type-action">{platform.issuesHeading[locale]}</h5>
                        <ul className="environment-proxy-notes type-body">
                            {platform.issues.map(issue => (
                                <li key={issue[0]}>{issue[locale]}</li>
                            ))}
                        </ul>
                    </section>
                ))}
                <section className="environment-proxy-platform">
                    <h3 className="type-section">
                        {t('1.2 怎么样算干净', '1.2 How to tell if cleanup worked')}
                    </h3>
                    <p className="type-body">
                        {t(
                            '清理后执行 /logout，再关掉窗口，重新打开一个终端并运行 claude。对照下面的图，可以查看自己登录界面窗口是否删除干净。',
                            'After cleanup, run /logout, close the window, then run claude in a new terminal. ' +
                                'Compare your sign-in screen with the examples below.',
                        )}
                    </p>
                    <CopyCommand
                        language={language}
                        command={{ label: ['复制退出命令', 'Copy sign-out command'], value: '/logout' }}
                    />
                    <div className="environment-proxy-examples">
                        <figure>
                            <strong className="type-action">{t('❌ 未删除干净', '❌ Not cleared')}</strong>
                            <img
                                src={relayBilling}
                                alt={t(
                                    'Claude Code 界面中框出的 API Usage Billing',
                                    'Claude Code screen with API Usage Billing highlighted',
                                )}
                                width={1280}
                                height={660}
                            />
                            <figcaption className="type-helper">
                                {t(
                                    '还有 API Usage Billing 这个信息，就检查是否还有旧中转设置。',
                                    'If API Usage Billing is still visible, check for remaining relay settings.',
                                )}
                            </figcaption>
                        </figure>
                        <figure>
                            <strong className="type-action">{t('✅ 已删除干净', '✅ Cleared')}</strong>
                            <img
                                src={themeSelection}
                                alt={t(
                                    'Claude Code 首次启动的配色选择画面',
                                    'Claude Code first-run theme picker',
                                )}
                                width={1280}
                                height={1219}
                            />
                            <figcaption className="type-helper">
                                {t(
                                    '进入首次启动的配色选择画面后，选颜色模式进入下一步。',
                                    'At the first-run theme picker, choose a theme to continue.',
                                )}
                            </figcaption>
                        </figure>
                    </div>
                    <p className="type-meta">
                        {t(
                            '以上是界面对照图，是否清理干净以旧中转变量是否仍存在为准。',
                            'These are screen examples. Confirm the old relay variables are gone.',
                        )}
                    </p>
                </section>
            </div>
        </Sheet>
    );
}
