import { describe, expect, it, vi } from 'vitest';
import {
  getSendMessagePreflightNotice,
  resolveSendMessagePreflight,
  type SendMessagePreflightInput,
} from './send-message-preflight';

function input(overrides: Partial<SendMessagePreflightInput> = {}): SendMessagePreflightInput {
  return {
    message: 'Inspect the project',
    hasProject: true,
    isResume: false,
    requiresProjectConfirmation: false,
    detectProjectScan: () => false,
    hasActiveProvider: true,
    providerConfigured: true,
    providerSendBlocked: false,
    isSending: false,
    ...overrides,
  };
}

describe('resolveSendMessagePreflight', () => {
  it('preserves blank, project, and confirmation guard order', () => {
    const detectProjectScan = vi.fn(() => false);
    expect(resolveSendMessagePreflight(input({
      message: '  ',
      hasProject: false,
      detectProjectScan,
    }))).toBe('EMPTY_MESSAGE');
    expect(resolveSendMessagePreflight(input({
      hasProject: false,
      requiresProjectConfirmation: true,
      detectProjectScan,
    }))).toBe('PROJECT_REQUIRED');
    expect(resolveSendMessagePreflight(input({
      requiresProjectConfirmation: true,
      hasActiveProvider: false,
      detectProjectScan,
    }))).toBe('PROJECT_CONFIRMATION_REQUIRED');
    expect(detectProjectScan).not.toHaveBeenCalled();
  });

  it('allows resumes to bypass new-project confirmation', () => {
    expect(resolveSendMessagePreflight(input({
      isResume: true,
      requiresProjectConfirmation: true,
    }))).toBeNull();
  });

  it('allows scan requests without provider configuration but still respects busy state', () => {
    const detectProjectScan = vi.fn(() => true);
    expect(resolveSendMessagePreflight(input({
      detectProjectScan,
      hasActiveProvider: false,
      providerConfigured: false,
      providerSendBlocked: true,
    }))).toBeNull();
    expect(resolveSendMessagePreflight(input({
      detectProjectScan,
      hasActiveProvider: false,
      providerConfigured: false,
      providerSendBlocked: true,
      isSending: true,
    }))).toBe('BUSY');
  });

  it('reports provider readiness and send-lock failures in their existing order', () => {
    expect(resolveSendMessagePreflight(input({
      hasActiveProvider: false,
      providerConfigured: false,
      providerSendBlocked: true,
      isSending: true,
    }))).toBe('PROVIDER_CHECKING');
    expect(resolveSendMessagePreflight(input({
      providerConfigured: false,
      providerSendBlocked: true,
      isSending: true,
    }))).toBe('PROVIDER_UNCONFIGURED');
    expect(resolveSendMessagePreflight(input({
      providerSendBlocked: true,
      isSending: true,
    }))).toBe('PROVIDER_BLOCKED');
    expect(resolveSendMessagePreflight(input({ isSending: true }))).toBe('BUSY');
  });
});

describe('getSendMessagePreflightNotice', () => {
  it('keeps silent guards silent and maps visible refusals to their established notices', () => {
    expect(getSendMessagePreflightNotice(null)).toBeNull();
    expect(getSendMessagePreflightNotice('EMPTY_MESSAGE')).toBeNull();
    expect(getSendMessagePreflightNotice('BUSY')).toBeNull();
    expect(getSendMessagePreflightNotice('PROJECT_REQUIRED')).toMatchObject({
      title: 'اختر مشروعًا للمحادثة',
      variant: 'destructive',
    });
    expect(getSendMessagePreflightNotice('PROVIDER_CHECKING')).toMatchObject({
      title: 'جارٍ التحقق من إعداد المساعد',
      variant: 'default',
    });
    expect(getSendMessagePreflightNotice('PROVIDER_BLOCKED')).toMatchObject({
      title: 'الإرسال متوقف بسبب حالة المزود',
      variant: 'destructive',
    });
  });
});
