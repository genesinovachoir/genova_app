import { describe, expect, it } from 'vitest';

import { isRichTextMeaningful, sanitizeRichText, stripHtmlTags } from '@/lib/richText';

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

  it('keeps internal links without forcing new tab', () => {
    const sanitized = sanitizeRichText('<p><a href="/repertuvar/softest-rains">sayfaya git</a></p>');

    expect(sanitized).toContain('href="/repertuvar/softest-rains"');
    expect(sanitized).not.toContain('target="_blank"');
  });

  it('returns a safe empty paragraph for empty content', () => {
    expect(sanitizeRichText('')).toBe('<p></p>');
    expect(sanitizeRichText(null)).toBe('<p></p>');
  });

  it('keeps empty paragraphs visible as blank lines', () => {
    const sanitized = sanitizeRichText('<p>satir 1</p><p></p><p>satir 2</p>');

    expect(sanitized).toBe('<p>satir 1</p><p><br /></p><p>satir 2</p>');
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

describe('stripHtmlTags', () => {
  it('returns simplified plain text from rich html', () => {
    const plainText = stripHtmlTags('<p>Merhaba&nbsp;<strong>dunya</strong><br/>Bugun &amp; yarin</p><p>Not: &#39;deneme&#39;</p>');

    expect(plainText).toBe("Merhaba dunya\nBugun & yarin\nNot: 'deneme'");
  });

  it('preserves intentional blank lines', () => {
    const plainText = stripHtmlTags('<p>satir1</p><p><br /></p><p>satir2</p>');

    expect(plainText).toBe('satir1\n\nsatir2');
  });
});
