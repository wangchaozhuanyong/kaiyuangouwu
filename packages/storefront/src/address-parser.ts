export interface ParsedAddress {
    fullName: string;
    phoneNumber: string;
    province: string;
    city: string;
    postalCode: string;
    streetLine1: string;
    countryCode?: string;
}

/**
 * 智能解析粘贴的收货地址文本
 * 例如："张三，13800138000，广东省深圳市南山区高新南九道科技园 518000"
 * 或 "John Doe, 123 Main St, New York, NY 10001, +1 555-0199"
 */
export function smartParseAddressText(rawText: string): ParsedAddress {
    let text = rawText.trim();
    if (!text) {
        return { fullName: '', phoneNumber: '', province: '', city: '', postalCode: '', streetLine1: '' };
    }

    // 1. 提取电话号码 (包括 +86, 11位手机号, 带横杠座机号等)
    let phoneNumber = '';
    const phoneRegex = /(?:\+?\d{1,4}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{4}/;
    const phoneMatch = text.match(phoneRegex);
    if (phoneMatch) {
        phoneNumber = phoneMatch[0].trim();
        text = text.replace(phoneMatch[0], ' ');
    }

    // 2. 提取邮政编码 (连续 5-6 位数字)
    let postalCode = '';
    const postalRegex = /\b\d{5,6}\b/;
    const postalMatch = text.match(postalRegex);
    if (postalMatch) {
        postalCode = postalMatch[0].trim();
        text = text.replace(postalMatch[0], ' ');
    }

    // 统一分隔符 (中英文逗号、分号、换行等替换为空格)
    text = text
        .replace(/[，,;；\n\r\t]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    let province = '';
    let city = '';
    let streetLine1 = '';
    let fullName = '';

    // 3. 中文省市区正则匹配
    const isMunicipality = (name: string) => /^(北京|上海|天津|重庆)/.test(name);

    const provinces =
        '北京市|天津市|上海市|重庆市|河北省|山西省|辽宁省|吉林省|黑龙江省|江苏省|浙江省|安徽省|福建省|江西省|' +
        '山东省|河南省|湖北省|湖南省|广东省|海南省|四川省|贵州省|云南省|陕西省|甘肃省|青海省|台湾省|内蒙古自治区|' +
        '广西壮族自治区|西藏自治区|宁夏回族自治区|新疆维吾尔自治区|香港特别行政区|澳门特别行政区|北京|天津|上海|' +
        '重庆|河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|' +
        '陕西|甘肃|青海|台湾|内蒙古|广西|西藏|宁夏|新疆|香港|澳门';

    const cnRegionRegex = new RegExp(
        `(?:(${provinces}))\\s*(?:([^\\s省市区县]+?[市|州|盟|地区]))?\\s*(?:([^\\s省市区县]+?[区|县|市|旗]))?`,
        'i',
    );

    const cnMatch = text.match(cnRegionRegex);
    if (cnMatch) {
        province = cnMatch[1] ?? '';
        const rawCity = cnMatch[2] ?? '';
        const rawDistrict = cnMatch[3] ?? '';

        if (isMunicipality(province)) {
            city = province.endsWith('市') ? province : `${province}市`;
        } else {
            city = rawCity;
        }

        // 分割匹配区域前后的内容（前面是姓名，后面是详细街道地址）
        const regionIndex = text.indexOf(cnMatch[0]);
        const beforeRegion = text.slice(0, regionIndex).trim();
        const afterRegion = text.slice(regionIndex + cnMatch[0].length).trim();

        fullName = beforeRegion;
        const districtPrefix = isMunicipality(province) ? rawCity || rawDistrict : rawDistrict;
        streetLine1 = [districtPrefix, afterRegion].filter(Boolean).join('').trim();
    } else {
        // 英文或无特定省份标识的格式
        const parts = text.split(/\s+/).filter(Boolean);
        if (parts.length >= 3) {
            fullName = parts.slice(0, 2).join(' ');
            streetLine1 = parts.slice(2).join(' ');
        } else if (parts.length === 2) {
            fullName = parts[0];
            streetLine1 = parts[1];
        } else {
            streetLine1 = text;
        }
    }

    return {
        fullName: fullName.trim(),
        phoneNumber: phoneNumber.trim(),
        province: province.trim(),
        city: city.trim(),
        postalCode: postalCode.trim(),
        streetLine1: streetLine1.trim(),
    };
}
