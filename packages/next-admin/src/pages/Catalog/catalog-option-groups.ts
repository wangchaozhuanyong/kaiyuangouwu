export const SYSTEM_IMPORT_OPTION_GROUP_CODE_PREFIX = 'import-sku-';

export const isSystemImportOptionGroup = (group: { code: string }) =>
    group.code.startsWith(SYSTEM_IMPORT_OPTION_GROUP_CODE_PREFIX);

export const findUnusedSystemOptionGroupIds = (
    groups: Array<{ id: string; code: string; options: Array<{ id: string }> }>,
    variants: Array<{ optionIds: string[] }>,
) => {
    const usedOptionIds = new Set(variants.flatMap(variant => variant.optionIds));
    return groups
        .filter(
            group =>
                isSystemImportOptionGroup(group) &&
                group.options.every(option => !usedOptionIds.has(option.id)),
        )
        .map(group => group.id);
};

export const splitOptionValues = (value: string): string[] =>
    value
        .split(/[，,\n]/)
        .map(item => item.trim())
        .filter((item, index, all) => item.length > 0 && all.indexOf(item) === index);

export const toOptionGroupCode = (value: string, prefix = 'option-group', index = 0): string => {
    const normalized = value
        .trim()
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return normalized || `${prefix}-${Date.now().toString(36)}${index ? `-${index + 1}` : ''}`;
};
