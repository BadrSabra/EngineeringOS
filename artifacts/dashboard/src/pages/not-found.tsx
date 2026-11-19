import React from 'react';
import { Link } from 'wouter';
import { AlertCircle, ArrowRight, Home } from 'lucide-react';

export default function NotFound() {
  return (
    <main
      dir="rtl"
      lang="ar"
      className="flex min-h-screen w-full items-center justify-center bg-background px-4"
    >
      <section
        aria-labelledby="not-found-title"
        className="mx-4 w-full max-w-md rounded-xl border border-border bg-card p-8 text-center"
      >
        <div className="flex justify-center mb-4">
          <AlertCircle aria-hidden="true" className="h-10 w-10 text-destructive" />
        </div>
        <bdi dir="ltr" className="text-xs font-mono text-muted-foreground">404</bdi>
        <h1 id="not-found-title" className="mt-2 text-2xl font-bold text-foreground">
          لم نعثر على هذه الصفحة
        </h1>
        <p className="mb-6 mt-2 text-sm leading-6 text-muted-foreground">
          قد يكون الرابط غير صحيح أو لم يعد متاحًا. يمكنك العودة إلى مشاريعك ومتابعة العمل.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link
            href="/projects"
            data-testid="link-not-found-projects"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
            المشاريع
          </Link>
          <Link
            href="/"
            data-testid="link-not-found-home"
            className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground transition hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <Home aria-hidden="true" className="h-4 w-4" />
            الصفحة الرئيسية
          </Link>
        </div>
      </section>
    </main>
  );
}
