import sanitizeHtml from 'sanitize-html';

const ALLOWED_TAGS = ['p', 'br', 'strong', 'em', 's', 'ul', 'ol', 'li', 'a', 'img'];
const ALLOWED_ATTRIBUTES: sanitizeHtml.IOptions['allowedAttributes'] = {
  a: ['href', 'target', 'rel'],
  img: ['src', 'alt'],
};

export function sanitizeRichText(html: string | null | undefined): string {
  const sanitized = sanitizeHtml(html ?? '', {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedSchemes: ['http', 'https'],
    allowedSchemesByTag: {
      img: ['http', 'https'],
      a: ['http', 'https'],
    },
    nonTextTags: ['style', 'script', 'textarea', 'noscript'],
    transformTags: {
      a: (tagName, attribs) => {
        const href = attribs.href?.trim() ?? '';
        const isInternal = href.startsWith('/') && !href.startsWith('//');
        const nextAttribs: Record<string, string> = {};

        if (href) {
          nextAttribs.href = href;
        }

        if (!isInternal && href) {
          nextAttribs.target = '_blank';
          nextAttribs.rel = 'noopener noreferrer';
        }

        return {
          tagName,
          attribs: nextAttribs,
        };
      },
    },
  }).trim();

  const withVisibleEmptyParagraphs = sanitized
    .replace(/<p>(?:\s|&nbsp;)*<\/p>/gi, '<p><br /></p>')
    .replace(/<p>(?:\s|&nbsp;)*(<br\s*\/?>)(?:\s|&nbsp;)*<\/p>/gi, '<p><br /></p>');

  return withVisibleEmptyParagraphs || '<p></p>';
}

export function isRichTextMeaningful(html: string | null | undefined) {
  const sanitized = sanitizeRichText(html);
  const plainText = sanitized
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .trim();

  return plainText.length > 0 || /<img\b/i.test(sanitized);
}

export function stripHtmlTags(html: string | null | undefined): string {
  if (!html) return '';

  const withSeparators = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|blockquote|h[1-6]|tr)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' ');

  return decodeHtmlEntities(withSeparators)
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, '\'')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      const parsed = Number.parseInt(hex, 16);
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : '';
    })
    .replace(/&#([0-9]+);/g, (_, decimal: string) => {
      const parsed = Number.parseInt(decimal, 10);
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : '';
    });
}
