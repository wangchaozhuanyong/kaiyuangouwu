import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CustomerEditForm } from './CustomersModule';
import { validateCustomerEmail, validateCustomerPhoneNumber } from './customer-validation';

vi.mock('@apollo/client/react', () => ({ useMutation: () => [vi.fn(), { loading: false }] }));

const baseForm = {
    title: '',
    firstName: 'QA',
    lastName: 'Simulation',
    emailAddress: '',
    phoneNumber: '',
};

function renderForm(emailAddress: string, phoneNumber = '') {
    return renderToStaticMarkup(
        <CustomerEditForm
            form={{ ...baseForm, emailAddress, phoneNumber }}
            setForm={vi.fn()}
            pending={false}
            onCancel={vi.fn()}
            onSave={vi.fn()}
        />,
    );
}

describe('customer email validation', () => {
    it.each(['not-an-email', 'a@@example.test', 'a b@example.test', 'a@example'])(
        'rejects invalid customer email: %s',
        email => {
            expect(validateCustomerEmail(email)).toBe('请输入有效的邮箱地址');
        },
    );

    it.each(['qa@example.test', ' qa+test@example.test '])('accepts a valid customer email: %s', email => {
        expect(validateCustomerEmail(email)).toBe('');
    });

    it('requires an email address', () => {
        expect(validateCustomerEmail('  ')).toBe('邮箱不能为空');
    });

    it('shows an inline error and disables save for invalid email', () => {
        const html = renderForm('not-an-email');
        expect(html).toContain('role="alert"');
        expect(html).toContain('请输入有效的邮箱地址');
        expect(html).toContain('disabled=""');
    });

    it('enables save for a valid email', () => {
        const html = renderForm('qa@example.test');
        expect(html).not.toContain('role="alert"');
        expect(html).not.toContain('disabled=""');
    });

    it('keeps save disabled when email is missing', () => {
        const html = renderForm('');
        expect(html).not.toContain('role="alert"');
        expect(html).toContain('disabled=""');
    });

    it.each(['abc', '123456', '1234567890123456', '0000000000'])(
        'rejects invalid optional customer phone numbers: %s',
        phoneNumber => {
            expect(validateCustomerPhoneNumber(phoneNumber)).toBe('请输入有效的手机号');
        },
    );

    it.each(['', '0182945844', '+60 18-294-5844'])(
        'accepts blank or valid customer phone numbers: %s',
        phoneNumber => {
            expect(validateCustomerPhoneNumber(phoneNumber)).toBe('');
        },
    );

    it('shows an inline error and disables save for an invalid optional phone number', () => {
        const html = renderForm('qa@example.test', 'abc');
        expect(html).toContain('role="alert"');
        expect(html).toContain('请输入有效的手机号');
        expect(html).toContain('disabled=""');
    });

    it('allows saving a customer with a valid email and no optional phone number', () => {
        const html = renderForm('qa@example.test');
        expect(html).not.toContain('role="alert"');
        expect(html).not.toContain('disabled=""');
    });
});

// The business fixtures own mocked data; lifecycle behavior is tested with real Apollo.
vi.mock('../../hooks/use-admin-query', () => import('../../test/admin-query-mock'));
