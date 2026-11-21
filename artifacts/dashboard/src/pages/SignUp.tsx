import { SignUp } from '@clerk/react';
import { basePath } from '@/lib/clerk';

export default function SignUpPage() {
  return (
    <main dir="rtl" lang="ar" className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in`}
      />
    </main>
  );
}
