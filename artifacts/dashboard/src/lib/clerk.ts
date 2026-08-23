import { shadcn } from '@clerk/themes';
import { publishableKeyFromHost } from '@clerk/react/internal';

export const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

/**
 * Resolve the host-aware key only after checking the public build
 * configuration. Clerk's helper intentionally synthesizes a host key when
 * its fallback is absent; that is useful for custom domains, but would turn a
 * missing VITE_CLERK_PUBLISHABLE_KEY into a confusing script-load failure.
 */
export function resolveClerkPublishableKey(
  hostname: string,
  configuredKey: string | undefined,
): string {
  const key = configuredKey?.trim();
  if (!key) {
    throw new Error(
      'Clerk is not configured for this dashboard build. Set VITE_CLERK_PUBLISHABLE_KEY (or provision Clerk and restart the dashboard).',
    );
  }
  return publishableKeyFromHost(hostname, key);
}

// Clerk passes full paths to routerPush/routerReplace, but wouter's
// setLocation prepends the base — strip it to avoid doubling.
export function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || '/'
    : path;
}

// Colors mirror the CSS variables in index.css (dark "engineering command
// center" theme) so the Clerk UI feels native to the rest of the dashboard.
export const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: '#0da2e7',
    colorForeground: '#f8fafc',
    colorMutedForeground: '#94a3b8',
    colorDanger: '#ef4343',
    colorBackground: '#0b111e',
    colorInput: '#1d283a',
    colorInputForeground: '#f8fafc',
    colorNeutral: '#1d283a',
    fontFamily: "'Outfit', sans-serif",
    borderRadius: '0.25rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-card rounded-2xl w-[440px] max-w-full overflow-hidden border border-border',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-foreground',
    headerSubtitle: 'text-muted-foreground',
    socialButtonsBlockButtonText: 'text-foreground',
    formFieldLabel: 'text-foreground',
    footerActionLink: 'text-primary',
    footerActionText: 'text-muted-foreground',
    dividerText: 'text-muted-foreground',
    identityPreviewEditButton: 'text-primary',
    formFieldSuccessText: 'text-emerald-500',
    alertText: 'text-foreground',
    logoBox: 'flex justify-center mb-2',
    logoImage: 'w-10 h-10 rounded-md',
    socialButtonsBlockButton: 'border border-border bg-secondary text-foreground',
    formButtonPrimary:
      'bg-primary text-primary-foreground border border-primary-border hover:opacity-90',
    formFieldInput: 'bg-input border border-border text-foreground',
    footerAction: 'text-muted-foreground',
    dividerLine: 'bg-border',
    alert: 'border border-border bg-secondary',
    otpCodeFieldInput: 'bg-input border border-border text-foreground',
    formFieldRow: '',
    main: '',
  },
};
