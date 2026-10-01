export function validateCustomerEmail(emailAddress: string): string {
    const email = emailAddress.trim();
    if (!email) return '邮箱不能为空';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) return '请输入有效的邮箱地址';
    return '';
}

export function validateCustomerPhoneNumber(phoneNumber: string): string {
    const phone = phoneNumber.trim();
    if (!phone) return '';
    if (!/^\+?[\d\s().-]*\d$/u.test(phone)) return '请输入有效的手机号';
    const digits = phone.replace(/\D/gu, '');
    if (digits.length < 7 || digits.length > 15 || /^(\d)\1+$/u.test(digits)) {
        return '请输入有效的手机号';
    }
    return '';
}
