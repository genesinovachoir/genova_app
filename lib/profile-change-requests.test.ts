import { describe, expect, it } from 'vitest';

import {
  haveOverlappingProfileChangeKeys,
  haveSameProfileChangeKeys,
  removeUnchangedProfileValues,
  sanitizeProfileChanges,
} from '@/lib/profile-change-requests';

describe('profile change request helpers', () => {
  it('sanitizes allowed profile fields and treats empty strings as cleared values', () => {
    expect(
      sanitizeProfileChanges({
        email: ' korist@example.com ',
        birth_date: '',
        role: 'Şef',
        photo_url: null,
      }),
    ).toEqual({
      email: 'korist@example.com',
      birth_date: null,
      photo_url: null,
    });
  });

  it('detects exact field-set matches independently from values', () => {
    expect(
      haveSameProfileChangeKeys(
        { birth_date: '2000-01-01', photo_url: 'old-photo' },
        { birth_date: '2001-01-01', photo_url: 'new-photo' },
      ),
    ).toBe(true);

    expect(
      haveSameProfileChangeKeys(
        { birth_date: '2000-01-01', photo_url: 'old-photo' },
        { birth_date: '2001-01-01' },
      ),
    ).toBe(false);
  });

  it('detects overlapping field sets for queued review gating', () => {
    expect(
      haveOverlappingProfileChangeKeys(
        { birth_date: '2000-01-01', photo_url: 'photo' },
        { birth_date: '2001-01-01' },
      ),
    ).toBe(true);

    expect(
      haveOverlappingProfileChangeKeys(
        { instagram_url: 'https://instagram.com/a' },
        { birth_date: '2001-01-01' },
      ),
    ).toBe(false);
  });

  it('drops submitted values that match the current profile snapshot', () => {
    expect(
      removeUnchangedProfileValues(
        { email: 'same@example.com', phone: null, birth_date: '2000-01-01' },
        { email: 'same@example.com', phone: null, birth_date: '1999-01-01' },
      ),
    ).toEqual({ birth_date: '2000-01-01' });
  });
});
