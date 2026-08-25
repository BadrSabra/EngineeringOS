import { useRef } from 'react';

/**
 * Keep the newest server-confirmed value visible when a reconnect or refresh
 * delivers an older snapshot after a newer one. The revision is owned by the
 * server (usually an updatedAt watermark), not by request arrival time.
 */
export function useMonotonicData<T>(
  data: T | undefined,
  revision: string | number | undefined,
): T | undefined {
  const latest = useRef<{ revision: string; data: T } | undefined>(undefined);
  if (data !== undefined && revision !== undefined) {
    const nextRevision = String(revision);
    if (!latest.current || nextRevision >= latest.current.revision) {
      latest.current = { revision: nextRevision, data };
    }
  }
  return latest.current?.data ?? data;
}

export function newestUpdatedAt(items: Array<{ updatedAt?: string | Date | null }> | undefined): string | undefined {
  const values = (items ?? [])
    .map((item) => item.updatedAt ? new Date(item.updatedAt).getTime() : Number.NaN)
    .filter(Number.isFinite);
  return values.length ? new Date(Math.max(...values)).toISOString() : undefined;
}