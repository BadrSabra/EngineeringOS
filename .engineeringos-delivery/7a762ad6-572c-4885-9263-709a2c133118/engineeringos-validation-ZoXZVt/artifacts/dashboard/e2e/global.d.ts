import type { BrowserContext, Page } from '@playwright/test';

declare global {
  /**
   * Replit's browser runner injects signInClerkUser into the action scope.
   * Keeping this adapter global makes the journey runnable there while the
   * Playwright project remains independent from Clerk's UI and credentials.
   */
  var signInClerkUser:
    | ((options: {
        firstName: string;
        lastName?: string;
        email: string;
        ttl?: number;
        basePath?: string;
      }) => Promise<string>)
    | undefined;

  var __ENGINEERINGOS_SIGN_IN_CLERK_USER__:
    | typeof signInClerkUser
    | undefined;
}

export {};