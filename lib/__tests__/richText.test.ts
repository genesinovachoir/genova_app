import { describe, expect, it } from 'vitest';

import { isRichTextMeaningful, sanitizeRichText } from '@/lib/richText';

describe('sanitizeRichText', () => {
  it('keeps the allowlist and strips dangerous HTML', () => {
    const sanitized = sanitizeRichText(
      '<p onclick="alert(1)">Merhaba <strong>dunya</strong><script>alert(1)</script>' +
        '<a href="javascript:alert(1)">kotu</a>' +
        '<a href="https://example.com">iyi</a>' +
        '<img src="javascript:alert(1)" onerror="alert(1)" alt="kapak" /></p>',
    );

    expect(sanitized).toContain('<strong>dunya</strong>');
    expect(sanitized).toContain('href="https://example.com"');
    expect(sanitized).toContain('target="_blank"');
    expect(sanitized).not.toContain('<script');
    expect(sanitized).not.toContain('onclick');
    expect(sanitized).not.toContain('onerror');
    expect(sanitized).not.toContain('javascript:');
  });

  it('returns a safe empty paragraph for empty content', () => {
    expect(sanitizeRichText('')).toBe('<p></p>');
    expect(sanitizeRichText(null)).toBe('<p></p>');
  });
});

describe('isRichTextMeaningful', () => {
  it('treats empty markup as not meaningful', () => {
    expect(isRichTextMeaningful('<p>   </p>')).toBe(false);
  });

  it('treats image-only content as meaningful', () => {
    expect(isRichTextMeaningful('<img src="https://example.com/test.png" alt="kapak" />')).toBe(true);
  });
});
