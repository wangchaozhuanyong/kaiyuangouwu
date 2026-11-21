import { ArrowUpRight, Check, Copy, LockKeyhole, LogIn, ShieldCheck, UserRound } from 'lucide-react';
import { useId, useState } from 'react';

import { type StorefrontLanguage } from '../../types';

import { rechargeCopy, rechargeFaq } from './copy';
import './gpt-recharge-guide.css';

const CHATGPT_URL = 'https://chatgpt.com/';
export const CHATGPT_SESSION_URL = 'https://chatgpt.com/api/auth/session';

function BrowserIllustration({
    language,
    session = false,
}: {
    language: StorefrontLanguage;
    session?: boolean;
}) {
    const t = rechargeCopy(language);
    const example = JSON.stringify(
        {
            user: { id: 'demo-user-invalid', email: 'demo@example.com' },
            accessToken: t('[演示凭据已遮蔽]', '[DEMO REDACTED]'),
            expires: '2099-01-01T00:00:00Z',
        },
        null,
        2,
    );
    return (
        <figure className="gpt-guide-illustration">
            <div
                className="gpt-guide-browser"
                role="img"
                aria-label={
                    session
                        ? t(
                              '演示图：在账号资料页面选中从左花括号到右花括号的完整 JSON，访问凭据已遮蔽。',
                              'Example: select the complete JSON on the session page. Access credentials are redacted.',
                          )
                        : t(
                              '演示图：打开 ChatGPT 账号菜单，核对当前登录邮箱。图中为虚构账号。',
                              'Example: open the ChatGPT account menu and check the signed-in email. The account shown is fictional.',
                          )
                }
            >
                <div className="gpt-guide-browser-bar" aria-hidden="true">
                    <span className="gpt-guide-browser-dots">
                        <i />
                        <i />
                        <i />
                    </span>
                    <span className="gpt-guide-browser-address">
                        <LockKeyhole size={12} />
                        {session ? '/api/auth/session' : 'chatgpt.com'}
                    </span>
                </div>
                <div className="gpt-guide-browser-body" aria-hidden="true">
                    <span className="gpt-guide-demo-label">
                        {t('操作演示 · 非真实账号', 'Illustration · fictional account')}
                    </span>
                    {session ? (
                        <>
                            <pre className="gpt-guide-json">
                                <code>{example}</code>
                            </pre>
                            <div className="gpt-guide-diagram-note">
                                <Copy size={16} />
                                {t('全选完整内容，再复制', 'Select all, then copy')}
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="gpt-guide-account">
                                <span className="gpt-guide-avatar">
                                    <UserRound size={26} />
                                </span>
                                <div>
                                    <span>{t('当前登录账号', 'Signed-in account')}</span>
                                    <strong>demo@example.com</strong>
                                </div>
                                <Check size={20} />
                            </div>
                            <div className="gpt-guide-account-lines">
                                <span />
                                <span />
                                <span />
                            </div>
                            <div className="gpt-guide-diagram-note">
                                <Check size={16} />
                                {t('确认是你要充值的账号', 'Check this is the account to recharge')}
                            </div>
                        </>
                    )}
                </div>
            </div>
            <figcaption>
                {session
                    ? t(
                          '图 2 · 复制完整 JSON；示例凭据无效，请使用自己页面的原文。',
                          'Figure 2 · Copy the entire JSON. This redacted example cannot be used for recharge.',
                      )
                    : t(
                          '图 1 · 先核对账号，再获取该账号的资料。',
                          'Figure 1 · Check the account before getting its session data.',
                      )}
            </figcaption>
        </figure>
    );
}

/** Instructions for partner-issued codes on the independent redemption site. */
export function PartnerRechargeGuide({
    language,
    onRecharge,
    onQuery,
}: {
    language: StorefrontLanguage;
    onRecharge: () => void;
    onQuery: () => void;
}) {
    const t = rechargeCopy(language);
    const steps = [
        [
            t('核对兑换套餐', 'Check the plan'),
            t(
                '在自助充值页输入发码方提供的 RA 兑换码，核对显示的套餐。',
                'Enter the RA code from your provider on the recharge page and check the plan shown.',
            ),
        ],
        [
            t('授权目标账号', 'Authorize the account'),
            t(
                '生成授权链接，在打开的授权页确认要充值的账号，然后返回这里。',
                'Create an authorization link, follow it to confirm the target account, then return here.',
            ),
        ],
        [
            t('用原码查进度', 'Track the original request'),
            t(
                '打开兑换码查询，输入同一个兑换码查看进度。已受理的任务无需再次提交。',
                'Open Code lookup and enter the same code to check its progress. An accepted request only needs to be submitted once.',
            ),
        ],
    ];
    return (
        <article className="gpt-recharge-guide-content">
            <header className="gpt-guide-intro">
                <h2>{t('使用合作方兑换码', 'Redeeming a partner code')}</h2>
                <p>
                    {t(
                        '新充值使用 RA 兑换码。普通码请联系发码方办理，已有任务也可在这里查询。',
                        'Use an RA code for a new recharge. For a standard code, contact its issuer or look up an existing task here.',
                    )}
                </p>
            </header>
            <ol className="gpt-guide-recharge-steps">
                {steps.map(([title, body], index) => (
                    <li key={title}>
                        <span className="gpt-guide-step-number" aria-hidden="true">
                            {index + 1}
                        </span>
                        <div>
                            <h3>{title}</h3>
                            <p>{body}</p>
                        </div>
                    </li>
                ))}
            </ol>
            <div className="gpt-recharge-partner-guide-actions">
                <button type="button" className="primary-action" onClick={onRecharge}>
                    {t('开始充值', 'Start recharge')}
                </button>
                <button type="button" className="secondary-action" onClick={onQuery}>
                    {t('查询进度', 'Check progress')}
                </button>
            </div>
        </article>
    );
}

export function GptRechargeGuide({
    language,
    onRecharge,
    onQuery,
}: {
    language: StorefrontLanguage;
    onRecharge: () => void;
    onQuery: () => void;
}) {
    const t = rechargeCopy(language);
    const titleId = useId();
    const urlId = useId();
    const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle');
    const rechargeSteps = [
        [
            t('验证兑换码', 'Verify the code'),
            t('输入购买的兑换码，确认绑定的套餐。', 'Enter your purchased code and check its plan.'),
        ],
        [
            t('确认账号', 'Confirm your account'),
            t(
                '普通码按提示填写账号资料；合作方兑换码通过 ID 系统的授权链接继续。',
                'For a standard code, follow the account data instructions below. For a partner code, use the ID system authorization link.',
            ),
        ],
        [
            t('核对并提交', 'Check and submit'),
            t(
                '在对应页面核对目标账号与绑定套餐，再确认提交。',
                'Check the target account and the plan bound to the code before confirming.',
            ),
        ],
        [
            t('查看充值结果', 'Check the result'),
            t(
                '等待处理；离开页面后可用原兑换码查询。',
                'Wait for processing. Use the original code to check progress later.',
            ),
        ],
    ];
    const sessionSteps = [
        [
            t('登录并核对账号', 'Sign in and check'),
            t(
                '在当前浏览器打开 ChatGPT，确认登录的是需要充值的账号。',
                'Open ChatGPT in this browser and check that the correct account is signed in.',
            ),
        ],
        [
            t('打开账号资料页', 'Open the session page'),
            t(
                '保持同一浏览器和登录窗口，在新标签页打开下方资料地址。',
                'Use the same browser and signed-in window. Open the session URL in a new tab.',
            ),
        ],
        [
            t('全选并复制 JSON', 'Select and copy all JSON'),
            t(
                '复制从开头 { 到结尾 } 的完整内容，不要只复制某个字段或页面网址。',
                'Copy everything from the first { to the final }. Do not copy only one field or the page URL.',
            ),
        ],
        [
            t('返回充值页粘贴', 'Return and paste'),
            t(
                '粘贴到账号资料输入框。识别的邮箱应与目标账号一致；套餐以兑换码为准。',
                'Paste into the account data field. Check the identified email; the code determines the plan.',
            ),
        ],
    ];
    async function copySessionUrl() {
        if (copyState === 'copying') return;
        setCopyState('copying');
        try {
            await navigator.clipboard.writeText(CHATGPT_SESSION_URL);
            setCopyState('copied');
        } catch {
            setCopyState('failed');
        }
    }
    return (
        <article className="gpt-recharge-guide-content" aria-labelledby={titleId}>
            <header className="gpt-guide-intro">
                <h2 id={titleId}>{t('如何完成充值', 'How to recharge')}</h2>
                <p>
                    {t(
                        '准备好兑换码和目标账号，按下面的步骤操作。',
                        'Have your redemption code and target account ready, then follow these steps.',
                    )}
                </p>
            </header>
            <div className="gpt-guide-overview">
                <section className="gpt-guide-section" aria-label={t('充值四步', 'Four steps to recharge')}>
                    <ol className="gpt-guide-recharge-steps">
                        {rechargeSteps.map(([title, body], index) => (
                            <li key={title}>
                                <span className="gpt-guide-step-number">{index + 1}</span>
                                <div>
                                    <h3>{title}</h3>
                                    <p>{body}</p>
                                </div>
                            </li>
                        ))}
                    </ol>
                </section>
                <section className="gpt-guide-section gpt-guide-faq">
                    <h2>{t('常见问题', 'Common questions')}</h2>
                    {rechargeFaq(language).map(([title, body], index) => (
                        <details key={title}>
                            <summary>{title}</summary>
                            <p>
                                {index === 0 && <code>{'{}'} </code>}
                                {body}
                                {index === 0 &&
                                    t(
                                        ' 若仍为空，请确认登录未失效后重新获取，不要提交空对象。',
                                        ' If it is still empty, check that you are still signed in and get fresh data. Do not submit an empty object.',
                                    )}
                            </p>
                        </details>
                    ))}
                </section>
            </div>
            <section className="gpt-guide-section">
                <div className="gpt-guide-session-heading">
                    <div className="gpt-guide-section-heading">
                        <h2>{t('如何获取账号资料', 'How to get your session JSON')}</h2>
                        <p>
                            {t(
                                '在同一浏览器登录 ChatGPT，再打开账号资料页。',
                                'Sign in to ChatGPT, then open your session page in the same browser.',
                            )}
                        </p>
                    </div>
                    <div className="gpt-guide-links">
                        <a
                            href={CHATGPT_URL}
                            target="_blank"
                            rel="noreferrer noopener"
                            aria-label={t('登录账号（ChatGPT）', 'Sign in to ChatGPT')}
                        >
                            <LogIn size={17} aria-hidden="true" />
                            {t('登录账号', 'Sign in')}
                        </a>
                        <a
                            className="gpt-guide-open-session"
                            aria-label={t(
                                '打开资料页，查看账号资料',
                                'Open page for your ChatGPT session data',
                            )}
                            href={CHATGPT_SESSION_URL}
                            target="_blank"
                            rel="noreferrer noopener"
                        >
                            <ArrowUpRight size={17} aria-hidden="true" />
                            {t('打开资料页', 'Open page')}
                        </a>
                        <button
                            type="button"
                            onClick={() => void copySessionUrl()}
                            disabled={copyState === 'copying'}
                        >
                            {copyState === 'copied' ? (
                                <Check size={17} aria-hidden="true" />
                            ) : (
                                <Copy size={17} aria-hidden="true" />
                            )}
                            {copyState === 'copied'
                                ? t('已复制', 'Copied')
                                : copyState === 'copying'
                                  ? t('复制中…', 'Copying…')
                                  : t('复制地址', 'Copy URL')}
                        </button>
                    </div>
                </div>
                <div className="gpt-guide-url">
                    <label htmlFor={urlId}>{t('账号资料页面地址', 'Session page URL')}</label>
                    <input
                        id={urlId}
                        type="url"
                        readOnly
                        value={CHATGPT_SESSION_URL}
                        onFocus={event => event.currentTarget.select()}
                        autoComplete="off"
                        spellCheck={false}
                    />
                    <p role="status">
                        {copyState === 'failed'
                            ? t(
                                  '无法自动复制，请选中上方网址后手动复制。这是公开页面地址，不是你的账号资料。',
                                  'Automatic copying failed. Select the URL above and copy it manually. This is a public page address, not your account data.',
                              )
                            : copyState === 'copied'
                              ? t(
                                    '已复制公开页面地址；打开后仍需复制自己的完整 JSON。',
                                    'Public page URL copied. Open it, then copy your own complete JSON.',
                                )
                              : t(
                                    '这里复制的只是公开网址，不包含你的账号或凭据。',
                                    'This copies only the public URL, with no account details or credentials.',
                                )}
                    </p>
                </div>
                <div className="gpt-guide-illustrations">
                    <BrowserIllustration language={language} />
                    <BrowserIllustration language={language} session />
                </div>
                <ol className="gpt-guide-session-steps">
                    {sessionSteps.map(([title, body], index) => (
                        <li key={title}>
                            <span className="gpt-guide-step-number">{index + 1}</span>
                            <div>
                                <h3>{title}</h3>
                                <p>{body}</p>
                            </div>
                        </li>
                    ))}
                </ol>
                <dl className="gpt-guide-shortcuts">
                    <div>
                        <dt>Windows</dt>
                        <dd>
                            <kbd>Ctrl + A</kbd>
                            {t(' 全选，再按 ', ' to select all, then ')}
                            <kbd>Ctrl + C</kbd>
                            {t(' 复制', ' to copy')}
                        </dd>
                    </div>
                    <div>
                        <dt>Mac</dt>
                        <dd>
                            <kbd>⌘ + A</kbd>
                            {t(' 全选，再按 ', ' to select all, then ')}
                            <kbd>⌘ + C</kbd>
                            {t(' 复制', ' to copy')}
                        </dd>
                    </div>
                    <div>
                        <dt>{t('手机', 'Mobile')}</dt>
                        <dd>
                            {t(
                                '长按页面文字，选择“全选”，再点“复制”；不要只选中一行。',
                                'Long-press the text, choose Select all, then Copy. Do not select only one line.',
                            )}
                        </dd>
                    </div>
                </dl>
                <p className="gpt-guide-helper">
                    {t(
                        '完整资料需要包含 user.id、user.email，以及 accessToken 或 access_token。若有效期已过，请重新获取；图中演示凭据已遮蔽，不能用于充值。',
                        'Complete data needs user.id, user.email, and accessToken or access_token. ' +
                            'Get fresh data if expired. The illustration has redacted, invalid credentials.',
                    )}
                </p>
            </section>
            <aside className="gpt-guide-safety">
                <ShieldCheck size={20} />
                <div>
                    <h3>{t('保护好你的账号资料', 'Protect your account data')}</h3>
                    <p>
                        {t(
                            'Session JSON 包含账号访问凭据，仅提交到本网站的充值表单。不要截图、转发、发给客服或粘贴到其他查询网站。',
                            'Session JSON contains account access credentials. Submit it only through this website’s recharge form. ' +
                                'Do not screenshot it, share it with support, or paste it into another lookup website.',
                        )}
                    </p>
                    <p>
                        {t(
                            '处理中、断网或结果待核对不等于充值失败。保留原兑换码查询，不要重复提交或再次付款。',
                            'Processing, a lost connection, or a result awaiting review does not mean failure. ' +
                                'Keep the original code and check its status. Do not resubmit or pay again.',
                        )}
                    </p>
                </div>
            </aside>
            <footer className="gpt-guide-footer">
                <div>
                    <h3>{t('充值后在哪里确认订阅？', 'Where can I confirm my subscription?')}</h3>
                    <p>
                        {t(
                            '本网站查询充值任务；实际订阅状态请在目标 ChatGPT 账号内确认。',
                            'This website shows the recharge task. Confirm the actual subscription in the target ChatGPT account.',
                        )}
                    </p>
                </div>
                <div className="gpt-guide-footer-actions">
                    <a href={CHATGPT_URL} target="_blank" rel="noreferrer noopener">
                        {t('前往 ChatGPT 查看订阅', 'Open ChatGPT to check your subscription')}
                        <ArrowUpRight size={16} />
                    </a>
                    <button className="secondary-action" type="button" onClick={onQuery}>
                        {t('查询充值结果', 'Check recharge result')}
                    </button>
                    <button className="primary-action" type="button" onClick={onRecharge}>
                        {t('开始充值', 'Start recharge')}
                    </button>
                </div>
            </footer>
        </article>
    );
}
