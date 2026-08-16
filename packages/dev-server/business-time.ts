export const BUSINESS_TIME_ZONE = 'Asia/Shanghai';

export function configureBusinessTimeZone(env: NodeJS.ProcessEnv): string {
    const configuredTimeZone = env.TZ?.trim();
    if (env.NODE_ENV === 'production' && configuredTimeZone !== BUSINESS_TIME_ZONE) {
        throw new Error(`TZ must be ${BUSINESS_TIME_ZONE} in production`);
    }
    env.TZ = BUSINESS_TIME_ZONE;
    return BUSINESS_TIME_ZONE;
}

configureBusinessTimeZone(process.env);
