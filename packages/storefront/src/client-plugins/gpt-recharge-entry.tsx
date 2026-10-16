import { KeyRound } from 'lucide-react';

import { type ClientPluginComponentProps } from './client-plugin-registry';

export default function GptRechargeEntryPlugin({
    onNavigate,
    language,
}: Readonly<ClientPluginComponentProps>) {
    return (
        <button
            type="button"
            className="category-client-plugin"
            onClick={() => onNavigate({ name: 'gpt-recharge' })}
        >
            <span className="category-client-plugin-icon">
                <KeyRound />
            </span>
            <span className="category-client-plugin-copy">
                <strong>{language === 'zh' ? 'GPT自助充值' : 'GPT self-service recharge'}</strong>
                <span>
                    {language === 'zh'
                        ? '验证兑换码，为你的 ChatGPT 账号充值并查询结果'
                        : 'Redeem your code and check your recharge status'}
                </span>
            </span>
            <span className="category-client-plugin-action">
                {language === 'zh' ? '进入充值' : 'Recharge'}
            </span>
        </button>
    );
}
