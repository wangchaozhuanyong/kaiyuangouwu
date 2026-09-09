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
