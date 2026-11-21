import { arSA } from '@clerk/localizations';

const signIn = arSA.signIn;
const signUp = arSA.signUp;

if (!signIn?.start || !signUp?.start) {
  throw new Error('Clerk Arabic localization is missing sign-in or sign-up copy.');
}

export const clerkLocalization = {
  ...arSA,
  formFieldInputPlaceholder__emailAddress: 'أدخل بريدك الإلكتروني',
  formFieldInputPlaceholder__password: 'أدخل كلمة المرور',
  formFieldInputPlaceholder__signUpPassword: 'أنشئ كلمة مرور',
  signIn: {
    ...signIn,
    start: {
      ...signIn.start,
      title: 'مرحبًا بعودتك',
      subtitle: 'سجّل الدخول للعودة إلى مشاريعك ومتابعة أهدافك.',
      subtitleCombined: 'سجّل الدخول للعودة إلى مشاريعك ومتابعة أهدافك.',
    },
  },
  signUp: {
    ...signUp,
    start: {
      ...signUp.start,
      title: 'أنشئ حسابك',
      titleCombined: 'أنشئ حسابك',
      subtitle: 'أنشئ حسابك لتصف هدف مشروعك وتتابع تقدمه.',
      subtitleCombined: 'أنشئ حسابك لتصف هدف مشروعك وتتابع تقدمه.',
    },
  },
};
