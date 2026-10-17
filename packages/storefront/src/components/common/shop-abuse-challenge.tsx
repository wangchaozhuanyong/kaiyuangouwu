import { type ComponentType, useEffect, useRef, useState } from 'react';

import { type ShopAbuseClient } from '../../shop-abuse';
import { shopAbuseFailure } from '../../shop-abuse-failure';
import { type StorefrontLanguage } from '../../types';

import {
    type ShopAbuseChallengeController,
    type ShopAbuseChallengeControlProps,
    type ShopAbuseChallengeState,
} from './shop-abuse-challenge-contracts';

type Implementation = typeof import('./shop-abuse-challenge-implementation');
type Controller = ShopAbuseChallengeController & { View?: ComponentType<ShopAbuseChallengeControlProps> };

/** Normal requests stay on the light path. A rejected operation is never replayed after loading. */
export function useShopAbuseChallenge(
    client: Partial<ShopAbuseClient>,
    language: StorefrontLanguage,
): Controller {
    const [state, setState] = useState<ShopAbuseChallengeState | null>(null);
    const owner = useRef<{
        live: boolean;
        version: number;
        engine: ReturnType<Implementation['createShopAbuseChallengeEngine']> | null;
        View?: Controller['View'];
    }>({ live: true, version: 0, engine: null }).current;
    function reset() {
        owner.version++;
        owner.engine?.dispose();
        owner.engine = null;
        if (owner.live) setState(null);
    }
    useEffect(() => {
        owner.live = true;
        reset();
        return () => {
            owner.live = false;
            reset();
        };
    }, [client, language]);
    const execute: Controller['execute'] = async (action, target, work) => {
        if (owner.engine) return owner.engine.execute(action, target, work);
        const version = owner.version;
        const isCurrent = () => owner.live && version === owner.version;
        try {
            const value = await work(undefined);
            if (isCurrent()) reset();
            return { executed: true, value };
        } catch (error) {
            if (!isCurrent() || !shopAbuseFailure(error)) throw error;
            let module: Implementation;
            try {
                module = await import('./shop-abuse-challenge-implementation');
            } catch {
                if (isCurrent())
                    setState({
                        action,
                        target,
                        answer: '',
                        loading: false,
                        feedbackOnly: true,
                        error:
                            language === 'zh'
                                ? '安全验证暂时无法加载，请稍后重新提交。'
                                : 'The security check could not load. Submit again later.',
                    });
                return { executed: false };
            }
            if (!isCurrent()) return { executed: false };
            owner.View = module.ShopAbuseChallengeView;
            const engineVersion = ++owner.version;
            owner.engine = module.createShopAbuseChallengeEngine(client, language, value => {
                if (owner.live && engineVersion === owner.version) setState(value);
            });
            await owner.engine.reject(action, target, error);
            return { executed: false };
        }
    };
    return {
        state,
        execute,
        reset,
        View: owner.View,
        setAnswer: answer => owner.engine?.setAnswer(answer),
        refresh: () => owner.engine?.refresh(),
    };
}

export function ShopAbuseChallengeControl(
    props: Omit<ShopAbuseChallengeControlProps, 'challenge'> & { challenge: Controller },
) {
    if (!props.challenge.state) return null;
    const View = props.challenge.View;
    return View ? <View {...props} /> : <p role="status">{props.challenge.state.error}</p>;
}
