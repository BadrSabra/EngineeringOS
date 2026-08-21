import { describe, expect, it } from 'vitest';
import storedMissionCorrelationReport from './fixtures/stored-mission-correlation-report.json';
import {
  assertSupportedMissionCorrelationReportVersion,
  readStoredMissionCorrelationReport,
  SUPPORTED_MISSION_CORRELATION_REPORT_VERSION,
} from './mission-correlation-report';

describe('stored mission correlation report reader', () => {
  it('reads a provider-free persisted report fixture', () => {
    const report = readStoredMissionCorrelationReport(storedMissionCorrelationReport);

    expect(report.kind).toBe('mission-correlation-report');
    expect(report.version).toBe(SUPPORTED_MISSION_CORRELATION_REPORT_VERSION);
    expect(report.redacted).toBe(true);
  });

  it('rejects an incompatible persisted report with the producer action', () => {
    expect(() =>
      assertSupportedMissionCorrelationReportVersion({
        ...storedMissionCorrelationReport,
        version: SUPPORTED_MISSION_CORRELATION_REPORT_VERSION + 1,
      }),
    ).toThrow(
      'Unsupported mission correlation report version: expected 1, got 2. ' +
        'Update the report reader before changing the producer version.',
    );
  });
});