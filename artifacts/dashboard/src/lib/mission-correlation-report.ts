export const SUPPORTED_MISSION_CORRELATION_REPORT_VERSION = 1;

export type StoredMissionCorrelationReport = {
  kind?: unknown;
  version?: unknown;
  [key: string]: unknown;
};

/**
 * Stored reports are read by the dashboard after the producer has finished.
 * Keep this check at the read boundary so an older dashboard never attempts
 * to interpret a newer report shape.
 */
export function assertSupportedMissionCorrelationReportVersion<T extends StoredMissionCorrelationReport>(
  report: T,
): T {
  if (report?.version !== SUPPORTED_MISSION_CORRELATION_REPORT_VERSION) {
    throw new Error(
      `Unsupported mission correlation report version: expected ${SUPPORTED_MISSION_CORRELATION_REPORT_VERSION}, ` +
        `got ${report?.version ?? 'missing'}. Update the report reader before changing the producer version.`,
    );
  }
  return report;
}

export function readStoredMissionCorrelationReport(
  report: unknown,
): StoredMissionCorrelationReport {
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    throw new Error('Stored mission correlation report is not an object.');
  }
  return assertSupportedMissionCorrelationReportVersion(
    report as StoredMissionCorrelationReport,
  );
}