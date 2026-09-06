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
    return ['colorful', 'damatong-colorful', 'damatong-balanced'].includes(String(value))
        ? 'colorful'
        : 'standard';
}

export function normalizedHeroThemePreset(value: unknown): 'standard' | 'warm' | 'bright' {
    if (['bright', 'cloudbridge-bright', 'marketplace-bright'].includes(String(value))) return 'bright';
    return value === 'warm' ? 'warm' : 'standard';
}
