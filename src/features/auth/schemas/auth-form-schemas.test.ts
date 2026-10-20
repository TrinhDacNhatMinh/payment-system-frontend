import { describe, expect, it } from 'vitest';

import { loginFormSchema, registerFormSchema } from './auth-form-schemas';

const registration = {
  fullName: 'Member',
  email: 'member@example.com',
  phone: '123',
  password: '123456',
};

describe('auth form validation', () => {
  it('preserves passwords and does not add a phone-number format requirement', () => {
    const values = { ...registration, password: '  secret  ', phone: 'any nonblank phone' };
    expect(registerFormSchema.parse(values)).toEqual(values);
  });

  it.each(['fullName', 'phone', 'password'] as const)('rejects a blank %s', (field) => {
    expect(registerFormSchema.safeParse({ ...registration, [field]: '      ' }).success).toBe(
      false,
    );
  });

  it('requires six characters only for registration', () => {
    expect(registerFormSchema.safeParse({ ...registration, password: '12345' }).success).toBe(
      false,
    );
    expect(loginFormSchema.safeParse({ email: registration.email, password: 'x' }).success).toBe(
      true,
    );
  });

  it.each(['', 'not-an-email'])('rejects an invalid email', (email) => {
    expect(loginFormSchema.safeParse({ email, password: 'secret' }).success).toBe(false);
  });
});
