export type BenchmarkFixtureRepairAuthorizationContext = {
  rootPath: string | undefined;
  projectId: string | undefined;
  caseId: string;
  scopedFindingStatus: string | undefined;
  planRootPath: string | undefined;
  planPaths: readonly string[];
  approvedPaths: readonly string[];
  executionPaths: readonly string[];
  approvedValidationProfiles: readonly string[];
};

/**
 * An in-process, server-created capability for one disposable benchmark case.
 * This is never accepted from a provider response or an HTTP request.
 */
export type BenchmarkFixtureRepairAuthorization = {
  readonly caseId: string;
  authorize: (
    context: BenchmarkFixtureRepairAuthorizationContext,
  ) => boolean | Promise<boolean>;
};