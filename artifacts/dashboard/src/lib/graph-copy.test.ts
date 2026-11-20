import { describe, expect, it } from 'vitest';
import { graphEntityTypeLabel, graphRelationLabel } from './graph-copy';

describe('graph labels', () => {
  it('uses clear Arabic labels for known entity and relationship types', () => {
    expect(graphEntityTypeLabel('function')).toBe('دالة');
    expect(graphEntityTypeLabel('api')).toBe('نقطة API');
    expect(graphRelationLabel('depends_on')).toBe('اعتماد');
    expect(graphRelationLabel('calls')).toBe('استدعاء');
  });

  it('preserves unknown labels rather than inventing a translation', () => {
    expect(graphEntityTypeLabel('future_entity')).toBe('future_entity');
    expect(graphRelationLabel('future_relation')).toBe('future_relation');
  });
});
