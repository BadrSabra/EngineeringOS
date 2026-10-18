export type ProofAwareFlightDeckState =
  | 'BUILDING'
  | 'VALIDATING'
  | 'REPAIRING'
  | 'READY_FOR_REVIEW'
  | 'BLOCKED'
  | 'APPLIED'
  | 'COMMITTED'
  | 'PUSHED'
  | 'CANCELLED'
  | 'COMPLETED';

export type ProofAwareEvidenceVerdict =
  | 'PROVEN'
  | 'PARTIAL'
  | 'UNAVAILABLE'
  | 'BLOCKED'
  | 'CLAIM_UNCLOSED'
  | 'NOT_RECORDED';

export type ExecutionProofPresentationInput = {
  proofRequired?: boolean;
  flightState?: string | null;
  operationEvidence?: {
    proof?: {
      verdict?: string | null;
      accepted?: boolean | null;
    } | null;
  } | null;
};

export type ExecutionProofPresentation = {
  evidenceVerdict: ProofAwareEvidenceVerdict;
  flightState?: ProofAwareFlightDeckState;
};

const PROOF_GATED_FLIGHT_STATES = new Set<ProofAwareFlightDeckState>([
  'APPLIED',
  'COMMITTED',
  'PUSHED',
  'COMPLETED',
]);

const FLIGHT_DECK_STATES = new Set<ProofAwareFlightDeckState>([
  'BUILDING',
  'VALIDATING',
  'REPAIRING',
  'READY_FOR_REVIEW',
  'BLOCKED',
  'APPLIED',
  'COMMITTED',
  'PUSHED',
  'CANCELLED',
  'COMPLETED',
]);

const EVIDENCE_VERDICTS = new Set<ProofAwareEvidenceVerdict>([
  'PROVEN',
  'PARTIAL',
  'UNAVAILABLE',
  'BLOCKED',
  'CLAIM_UNCLOSED',
  'NOT_RECORDED',
]);

function toEvidenceVerdict(value: string | null | undefined): ProofAwareEvidenceVerdict | undefined {
  if (value === 'INCOMPLETE') return 'BLOCKED';
  return value && EVIDENCE_VERDICTS.has(value as ProofAwareEvidenceVerdict)
    ? value as ProofAwareEvidenceVerdict
    : undefined;
}

export function resolveExecutionProofPresentation(
  input: ExecutionProofPresentationInput | null | undefined,
): ExecutionProofPresentation {
  const proof = input?.operationEvidence?.proof;
  const currentProofAccepted = proof?.accepted === true && proof.verdict === 'PROVEN';
  const currentProofVerdict = toEvidenceVerdict(proof?.verdict);
  const evidenceVerdict = currentProofAccepted
    ? 'PROVEN'
    : proof
      ? currentProofVerdict && currentProofVerdict !== 'PROVEN'
        ? currentProofVerdict
        : 'BLOCKED'
      : 'UNAVAILABLE';
  const flightState = input?.flightState && FLIGHT_DECK_STATES.has(input.flightState as ProofAwareFlightDeckState)
    ? input.flightState as ProofAwareFlightDeckState
    : undefined;

  return {
    evidenceVerdict,
    flightState: input?.proofRequired
      && !currentProofAccepted
      && flightState
      && PROOF_GATED_FLIGHT_STATES.has(flightState)
      ? 'BLOCKED'
      : flightState,
  };
}
