/**
 * Vision Frames v1 - Provider Failure Categories
 *
 * Adapters translate provider and transport failures into one of these kinds so the
 * engine can apply a single accounting policy (docs/DECISIONS.md P-05). Messages are
 * internal diagnostics and are never shown to the user.
 */

export type ProviderFailureKind =
  /** Credentials missing, invalid, or not permitted */
  | 'auth'
  /** Billing or quota exhausted */
  | 'quota'
  /** Request was malformed or the model/config is not accepted */
  | 'bad_request'
  /** The run's abort signal fired */
  | 'cancelled'
  /** Transient throttling */
  | 'rate_limit'
  /** Request took longer than the adapter's timeout */
  | 'timeout'
  /** Connection could not be made or was cut */
  | 'network'
  /** Provider-side 5xx */
  | 'server'
  /** Provider declined to produce output for safety or policy reasons */
  | 'refusal'
  /** Response completed but contained no image */
  | 'no_image'
  /** Response could not be parsed into the expected contract */
  | 'invalid_response'
  /** Anything unrecognised, including programming errors */
  | 'unknown';

/**
 * Failures where trying again inside the same run cannot help, or would spend money
 * that should not be spent. The run ends on these.
 */
export const FATAL_FAILURE_KINDS: ReadonlySet<ProviderFailureKind> = new Set<ProviderFailureKind>([
  'auth',
  'quota',
  'bad_request',
  'cancelled',
  'unknown',
]);

export class ProviderError extends Error {
  readonly kind: ProviderFailureKind;
  readonly status?: number;

  constructor(kind: ProviderFailureKind, message: string, options?: { status?: number; cause?: unknown }) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;
    this.status = options?.status;
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

export function failureKindOf(error: unknown): ProviderFailureKind {
  return error instanceof ProviderError ? error.kind : 'unknown';
}
