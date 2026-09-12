export const CATALOG_UNIT_PRESET_GROUPS = [
    {
        label: '常用计件',
        units: ['个', '件', '只', '支', '条', '张', '片', '粒', '颗'],
    },
    {
        label: '常用包装',
        units: ['瓶', '罐', '听', '杯', '盒', '包', '袋', '箱', '桶', '提', '打'],
    },
    {
        label: '组合与物流',
        units: ['组', '套', '卷', '板', '托', '筐', '盘'],
    },
    {
        label: '重量与容量',
        units: ['克', '千克', '斤', '毫升', '升'],
    },
] as const;

export const CATALOG_UNIT_PRESETS = CATALOG_UNIT_PRESET_GROUPS.flatMap(group => group.units);
