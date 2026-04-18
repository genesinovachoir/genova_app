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

  return sanitized || '<p></p>';
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
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
