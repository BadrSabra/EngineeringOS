import { z } from "zod";

export const CapabilityProbeClaimIdSchema = z.enum([
  "C1",
  "C2",
  "C3",
  "C4",
  "C5",
  "C6",
  "C7",
]);
export type CapabilityProbeClaimId = z.infer<typeof CapabilityProbeClaimIdSchema>;

export const CapabilityProbeClaimSchema = z
  .object({
    status: z.enum(["PASS", "FAIL"]),
    evidenceId: z.string().min(1).max(80),
    answer: z.string().min(1).max(1_500),
  })
  .strict();
export type CapabilityProbeClaim = z.infer<typeof CapabilityProbeClaimSchema>;

export const CapabilityProbeClaimsSchema = z
  .object({
    C1: CapabilityProbeClaimSchema,
    C2: CapabilityProbeClaimSchema,
    C3: CapabilityProbeClaimSchema,
    C4: CapabilityProbeClaimSchema,
    C5: CapabilityProbeClaimSchema,
    C6: CapabilityProbeClaimSchema,
    C7: CapabilityProbeClaimSchema,
  })
  .strict();
export type CapabilityProbeClaims = z.infer<typeof CapabilityProbeClaimsSchema>;

/**
 * The model-facing contract is deliberately smaller than the public report.
 * The model selects a server-issued evidence ID and writes a short answer;
 * the server owns source paths, fragments, runtime claims, and scoring.
 */
export const CapabilityProbeResponseSchema = z
  .object({
    claims: CapabilityProbeClaimsSchema,
    overallScore: z.string().regex(/^\d+\/7$/, "overallScore must use N/7 form"),
  })
  .strict();
export type CapabilityProbeResponse = z.infer<typeof CapabilityProbeResponseSchema>;