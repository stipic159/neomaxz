import type { MessageElement, MessageElementType } from "../types/message.js";

export interface ParsedFormattedText {
  text: string;
  elements: MessageElement[];
}

/**
 * Parses markdown syntax into plain text and MAX protocol `elements` array.
 * Supports:
 *  - *bold*
 *  - _italic_
 *  - ~strikethrough~
 *  - ||spoiler||
 *  - ```code block```
 *  - `inline code`
 *  - [text](url)
 *  - @mention
 */
export function parseMarkdown(input: string): ParsedFormattedText {
  if (!input) {
    return { text: '', elements: [] };
  }

  const elements: MessageElement[] = [];

  // Token definition list in order of matching priority
  // Pre blocks -> inline code -> links -> spoiler -> bold -> italic -> strikethrough -> mention
  const tokens: Array<{
    type: MessageElementType;
    regex: RegExp;
    extract: (match: RegExpExecArray) => { inner: string; url?: string; userId?: string };
  }> = [
    {
      type: 'PRE',
      regex: /```([\s\S]*?)```/g,
      extract: (m) => ({ inner: m[1] }),
    },
    {
      type: 'CODE',
      regex: /`([^`\n]+)`/g,
      extract: (m) => ({ inner: m[1] }),
    },
    {
      type: 'LINK',
      regex: /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      extract: (m) => ({ inner: m[1], url: m[2] }),
    },
    {
      type: 'SPOILER',
      regex: /\|\|([\s\S]+?)\|\|/g,
      extract: (m) => ({ inner: m[1] }),
    },
    {
      type: 'BOLD',
      regex: /\*([^*\n]+)\*/g,
      extract: (m) => ({ inner: m[1] }),
    },
    {
      type: 'ITALIC',
      regex: /_([^_\n]+)_/g,
      extract: (m) => ({ inner: m[1] }),
    },
    {
      type: 'STRIKETHROUGH',
      regex: /~([^~\n]+)~/g,
      extract: (m) => ({ inner: m[1] }),
    },
    {
      type: 'MENTION',
      regex: /@([a-zA-Z0-9_]+)/g,
      extract: (m) => ({
        inner: `@${m[1]}`,
        userId: /^\d+$/.test(m[1]) ? m[1] : undefined,
      }),
    },
  ];

  // We perform an iterative token extraction
  interface Segment {
    content: string;
    isFormatted: boolean;
    element?: MessageElement;
  }

  let segments: Segment[] = [{ content: input, isFormatted: false }];

  for (const token of tokens) {
    const nextSegments: Segment[] = [];

    for (const segment of segments) {
      if (segment.isFormatted) {
        nextSegments.push(segment);
        continue;
      }

      let lastIndex = 0;
      token.regex.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = token.regex.exec(segment.content)) !== null) {
        const matchStart = match.index;
        const matchEnd = token.regex.lastIndex;

        if (matchStart > lastIndex) {
          nextSegments.push({
            content: segment.content.slice(lastIndex, matchStart),
            isFormatted: false,
          });
        }

        const extracted = token.extract(match);
        nextSegments.push({
          content: extracted.inner,
          isFormatted: true,
          element: {
            type: token.type,
            offset: 0, // will calculate in final pass
            length: extracted.inner.length,
            url: extracted.url,
            userId: extracted.userId,
          },
        });

        lastIndex = matchEnd;
      }

      if (lastIndex < segment.content.length) {
        nextSegments.push({
          content: segment.content.slice(lastIndex),
          isFormatted: false,
        });
      }
    }

    segments = nextSegments;
  }

  // Final assembly: build clean text and assign correct offsets
  let cleanText = '';
  for (const seg of segments) {
    const offset = cleanText.length;
    cleanText += seg.content;

    if (seg.isFormatted && seg.element) {
      elements.push({
        ...seg.element,
        offset,
        length: seg.content.length,
      });
    }
  }

  return {
    text: cleanText,
    elements,
  };
}
