/** Common display options for every Channel. Legacy values keep their appearance. */
export const homepageVisualStyles = [
    { value: 'standard', label: '标准' },
    { value: 'colorful', label: '彩色卡片' },
] as const;

export const heroThemePresets = [
    { value: 'standard', label: '标准遮罩' },
    { value: 'warm', label: '暖色遮罩' },
    { value: 'bright', label: '清晰原图' },
] as const;

export function normalizedHomepageVisualStyle(value: unknown): 'standard' | 'colorful' {
    const normalized = String(value);
    return normalized === 'colorful' || normalized.endsWith('-colorful') || normalized.endsWith('-balanced')
        ? 'colorful'
        : 'standard';
}

export function normalizedHeroThemePreset(value: unknown): 'standard' | 'warm' | 'bright' {
    if (String(value).split('-').at(-1) === 'bright') return 'bright';
    return value === 'warm' ? 'warm' : 'standard';
}
