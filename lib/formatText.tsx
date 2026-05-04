import React from 'react';

/**
 * WhatsApp-style text formatting:
 *   *bold*   → <strong>bold</strong>
 *   _italic_ → <em>italic</em>
 *   ~strike~ → <s>strike</s>
 *   URLs      → <a href="...">...</a> (http/https, www.*, plain domain)
 *   Lists     → - item, * item, • item, 1. item
 *   Newlines → <br />
 */
export function formatWhatsApp(
  text: string,
  options?: { linkClassName?: string; listClassName?: string }
): React.ReactNode[] {
  const linkClassName = options?.linkClassName ?? 'underline';
  const listClassName = options?.listClassName ?? 'inline-flex items-start gap-1.5';
  const pattern =
    /((?:https?:\/\/|www\.)[^\s<>"'`]+|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d{2,5})?(?:[/?#][^\s<>"'`]*)?)|(\*[^*]+\*)|(_[^_]+_)|(~[^~]+~)/gi;
  const domainRegex =
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d{2,5})?(?:[/?#][^\s<>"'`]*)?$/i;

  const normalizeUrlToken = (rawUrl: string) => {
    const trimmedUrl = rawUrl.replace(/[),.;!?]+$/g, '');
    const trailing = rawUrl.slice(trimmedUrl.length);
    const href = /^https?:\/\//i.test(trimmedUrl)
      ? trimmedUrl
      : domainRegex.test(trimmedUrl)
        ? `https://${trimmedUrl}`
        : null;
    return { display: trimmedUrl, href, trailing };
  };

  const parseInline = (line: string, keyPrefix: string): React.ReactNode[] => {
    const parsed: React.ReactNode[] = [];
    pattern.lastIndex = 0;

    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let partIdx = 0;

    while ((match = pattern.exec(line)) !== null) {
      if (match.index > lastIndex) {
        parsed.push(line.slice(lastIndex, match.index));
      }

      const raw = match[0];
      const inner = raw.slice(1, -1);
      const key = `${keyPrefix}-${partIdx++}`;

      if (match[1]) {
        const { display, href, trailing } = normalizeUrlToken(raw);
        if (!href) {
          parsed.push(raw);
          lastIndex = match.index + raw.length;
          continue;
        }
        parsed.push(
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={linkClassName}
          >
            {display}
          </a>
        );
        if (trailing) parsed.push(trailing);
      } else if (raw.startsWith('*')) {
        parsed.push(<strong key={key} className="font-bold">{inner}</strong>);
      } else if (raw.startsWith('_')) {
        parsed.push(<em key={key} className="italic">{inner}</em>);
      } else if (raw.startsWith('~')) {
        parsed.push(<s key={key}>{inner}</s>);
      }

      lastIndex = match.index + raw.length;
    }

    if (lastIndex < line.length) {
      parsed.push(line.slice(lastIndex));
    }

    return parsed;
  };

  const parseListLine = (line: string): { marker: string; content: string } | null => {
    const unordered = line.match(/^\s*[-*•]\s+(.+)$/);
    if (unordered) return { marker: '•', content: unordered[1] };

    const ordered = line.match(/^\s*(\d+)[.)]\s+(.+)$/);
    if (ordered) return { marker: `${ordered[1]}.`, content: ordered[2] };

    return null;
  };

  // Split by newlines first
  const lines = text.split('\n');
  const result: React.ReactNode[] = [];

  lines.forEach((line, lineIdx) => {
    if (lineIdx > 0) result.push(<br key={`br-${lineIdx}`} />);
    const listLine = parseListLine(line);
    if (listLine) {
      result.push(
        <span key={`list-${lineIdx}`} className={listClassName}>
          <span className="mt-[1px] shrink-0">{listLine.marker}</span>
          <span>{parseInline(listLine.content, `list-${lineIdx}`)}</span>
        </span>
      );
      return;
    }

    result.push(...parseInline(line, `line-${lineIdx}`));
  });

  return result;
}
