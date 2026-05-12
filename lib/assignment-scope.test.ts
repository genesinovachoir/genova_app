import { describe, expect, it } from 'vitest';

import { formatAssignmentScopeLabel } from '@/lib/assignment-scope';

describe('formatAssignmentScopeLabel', () => {
  it('uses explicit target member voice groups before the legacy assignment field', () => {
    expect(
      formatAssignmentScopeLabel({
        targetVoiceGroup: null,
        targetVoiceGroups: ['Tenor', 'Tenor'],
      }),
    ).toBe('Tenor Partisi');
  });

  it('falls back to the legacy assignment voice group when explicit targets are unavailable', () => {
    expect(formatAssignmentScopeLabel({ targetVoiceGroup: 'Alto' })).toBe('Alto Partisi');
  });

  it('uses the provided all-choir label when no scope can be derived', () => {
    expect(formatAssignmentScopeLabel({ allChoirLabel: 'Toplam Koro' })).toBe('Toplam Koro');
  });

  it('keeps all known voice groups as an all-choir scope', () => {
    expect(formatAssignmentScopeLabel({ targetVoiceGroups: ['Bass', 'Tenor', 'Soprano', 'Alto'] })).toBe('Tüm Koro');
  });

  it('labels partial multi-part assignments as mixed', () => {
    expect(formatAssignmentScopeLabel({ targetVoiceGroups: ['Soprano', 'Tenor'] })).toBe('Karma Partiler');
  });
});
