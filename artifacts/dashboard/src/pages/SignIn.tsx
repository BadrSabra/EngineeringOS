import { SignIn } from '@clerk/react';
import { basePath } from '@/lib/clerk';

export default function SignInPage() {
  return (
    <main dir="rtl" lang="ar" className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
      />
    </main>
  );
}
