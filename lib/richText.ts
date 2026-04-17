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
      a: sanitizeHtml.simpleTransform('a', {
        target: '_blank',
        rel: 'noopener noreferrer',
      }),
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
