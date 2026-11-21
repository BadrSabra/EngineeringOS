import { describe, expect, it } from 'vitest';
import { clerkLocalization } from './clerk-localization';

describe('Clerk Arabic localization', () => {
  it('uses Arabic copy and form labels for account access', () => {
    expect(clerkLocalization.locale).toBe('ar-SA');
    expect(clerkLocalization.signIn.start.title).toBe('مرحبًا بعودتك');
    expect(clerkLocalization.signIn.start.subtitle).toContain('مشاريعك');
    expect(clerkLocalization.signUp.start.title).toBe('أنشئ حسابك');
    expect(clerkLocalization.signUp.start.subtitle).toContain('هدف مشروعك');
    expect(clerkLocalization.formFieldLabel__emailAddress).toBe('العنوان الإلكتروني');
    expect(clerkLocalization.formFieldLabel__password).toBe('كلمة المرور');
    expect(clerkLocalization.formFieldInputPlaceholder__emailAddress).toBe('أدخل بريدك الإلكتروني');
    expect(clerkLocalization.formFieldInputPlaceholder__password).toBe('أدخل كلمة المرور');
    expect(clerkLocalization.formFieldInputPlaceholder__signUpPassword).toBe('أنشئ كلمة مرور');
  });
});
