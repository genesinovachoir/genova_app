import React from 'react';

/**
 * WhatsApp-style text formatting:
 *   *bold*   → <strong>bold</strong>
 *   _italic_ → <em>italic</em>
 *   ~strike~ → <s>strike</s>
 *   Newlines → <br />
 */
export function formatWhatsApp(text: string): React.ReactNode[] {
  // Split by newlines first
  const lines = text.split('\n');
  const result: React.ReactNode[] = [];

  lines.forEach((line, lineIdx) => {
    if (lineIdx > 0) result.push(<br key={`br-${lineIdx}`} />);

    // Process inline formatting: *bold*, _italic_, ~strike~
    const regex = /(\*[^*]+\*)|(_[^_]+_)|(~[^~]+~)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let partIdx = 0;

    while ((match = regex.exec(line)) !== null) {
      // Push text before match
      if (match.index > lastIndex) {
        result.push(line.slice(lastIndex, match.index));
      }

      const raw = match[0];
      const inner = raw.slice(1, -1);
      const key = `${lineIdx}-${partIdx++}`;

      if (raw.startsWith('*')) {
        result.push(<strong key={key} className="font-bold">{inner}</strong>);
      } else if (raw.startsWith('_')) {
        result.push(<em key={key} className="italic">{inner}</em>);
      } else if (raw.startsWith('~')) {
        result.push(<s key={key}>{inner}</s>);
      }

      lastIndex = match.index + raw.length;
    }

    // Remaining text
    if (lastIndex < line.length) {
      result.push(line.slice(lastIndex));
    }
  });

  return result;
}
