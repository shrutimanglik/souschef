import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts } from '@/constants/theme';

/**
 * Renders an assistant reply from the recipe chat (see
 * app/recipe-chat/[recipeId].tsx) as native SousChef typography instead of
 * raw Markdown text — the system prompt (ai/recipe-conversation.ts)
 * deliberately invites the model to use light Markdown (bold, bullet/
 * numbered lists, a short heading) when it clarifies an answer, so this
 * component parses and renders that small subset intentionally rather
 * than regex-stripping the syntax and losing the structure.
 *
 * Deliberately not a general-purpose Markdown renderer: no tables, links,
 * or real code blocks — those aren't things a cooking answer needs, and
 * the prompt asks the model not to use them. A fenced ``` block is only
 * handled defensively (the fence markers are dropped, the content inside
 * is treated as plain text) so a stray one never leaks raw backticks onto
 * the screen.
 */

type InlineSegment = { text: string; bold?: boolean; italic?: boolean; code?: boolean };

type MessageBlock =
  | { type: 'heading'; segments: InlineSegment[] }
  | { type: 'paragraph'; segments: InlineSegment[] }
  | { type: 'bullet-list'; items: InlineSegment[][] }
  | { type: 'numbered-list'; items: InlineSegment[][] }
  | { type: 'divider' };

const HEADING = /^#{1,6}\s+(.+)$/;
const BULLET = /^[-*•]\s+(.+)$/;
const NUMBERED = /^\d+[.)]\s+(.+)$/;
// A line of only dashes/asterisks/underscores is Markdown's thematic
// break — distinct from "* item" (has trailing content) and from "***bold
// italic***" (wraps text rather than standing alone on its own line).
const THEMATIC_BREAK = /^(-{3,}|\*{3,}|_{3,})$/;
const FENCE = /^```/;

// Ordered so the widest markers win when several patterns could match the
// same span: "***" before "**"/"*", "__" before "_".
const INLINE_MARKUP = /\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|__(.+?)__|_(.+?)_|`(.+?)`/g;

function parseInline(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let lastIndex = 0;
  INLINE_MARKUP.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_MARKUP.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index) });
    }
    if (match[1] !== undefined) segments.push({ text: match[1], bold: true, italic: true });
    else if (match[2] !== undefined) segments.push({ text: match[2], bold: true });
    else if (match[3] !== undefined) segments.push({ text: match[3], italic: true });
    else if (match[4] !== undefined) segments.push({ text: match[4], bold: true });
    else if (match[5] !== undefined) segments.push({ text: match[5], italic: true });
    else if (match[6] !== undefined) segments.push({ text: match[6], code: true });
    lastIndex = INLINE_MARKUP.lastIndex;
  }
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex) });
  }
  return segments.length > 0 ? segments : [{ text }];
}

/**
 * Line-by-line block parser — exported for testability. Pure string in,
 * data out; doesn't touch React Native itself, even though it lives
 * alongside the renderer below.
 */
export function parseAssistantMarkdown(text: string): MessageBlock[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: MessageBlock[] = [];
  let paragraphLines: string[] = [];
  let inFence = false;

  const flushParagraph = () => {
    if (paragraphLines.length === 0) {
      return;
    }
    blocks.push({ type: 'paragraph', segments: parseInline(paragraphLines.join(' ')) });
    paragraphLines = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      if (line) paragraphLines.push(line);
      continue;
    }

    if (line === '') {
      flushParagraph();
      continue;
    }

    if (THEMATIC_BREAK.test(line)) {
      flushParagraph();
      blocks.push({ type: 'divider' });
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      flushParagraph();
      blocks.push({ type: 'heading', segments: parseInline(heading[1].trim()) });
      continue;
    }

    const bullet = line.match(BULLET);
    if (bullet) {
      flushParagraph();
      const item = parseInline(bullet[1].trim());
      const last = blocks[blocks.length - 1];
      if (last?.type === 'bullet-list') {
        last.items.push(item);
      } else {
        blocks.push({ type: 'bullet-list', items: [item] });
      }
      continue;
    }

    const numbered = line.match(NUMBERED);
    if (numbered) {
      flushParagraph();
      const item = parseInline(numbered[1].trim());
      const last = blocks[blocks.length - 1];
      if (last?.type === 'numbered-list') {
        last.items.push(item);
      } else {
        blocks.push({ type: 'numbered-list', items: [item] });
      }
      continue;
    }

    paragraphLines.push(line);
  }
  flushParagraph();

  return blocks;
}

type Palette = typeof Colors.light;

function InlineText({ segments, colors }: { segments: InlineSegment[]; colors: Palette }) {
  return (
    <>
      {segments.map((segment, index) => (
        <Text
          key={index}
          style={[
            segment.bold && styles.bold,
            segment.italic && styles.italic,
            // A quiet inline highlight rather than a monospace font — the
            // app has no monospace typeface, and a cooking answer's
            // "code" is realistically a called-out quantity or term, not
            // literal code.
            segment.code && { backgroundColor: colors.surface },
          ]}>
          {segment.text}
        </Text>
      ))}
    </>
  );
}

function renderBlock(block: MessageBlock, key: number, colors: Palette) {
  switch (block.type) {
    case 'heading':
      return (
        <Text key={key} style={[styles.heading, { color: colors.text, fontFamily: Fonts.serif }]}>
          <InlineText segments={block.segments} colors={colors} />
        </Text>
      );
    case 'paragraph':
      return (
        <Text key={key} style={[styles.paragraph, { color: colors.text }]}>
          <InlineText segments={block.segments} colors={colors} />
        </Text>
      );
    case 'divider':
      return <View key={key} style={[styles.divider, { backgroundColor: colors.border }]} />;
    case 'bullet-list':
      return (
        <View key={key} style={styles.list}>
          {block.items.map((item, itemIndex) => (
            <View key={itemIndex} style={styles.bulletRow}>
              <Text style={[styles.bulletMarker, { color: colors.textMuted }]}>{'•'}</Text>
              <Text style={[styles.listText, { color: colors.text }]}>
                <InlineText segments={item} colors={colors} />
              </Text>
            </View>
          ))}
        </View>
      );
    case 'numbered-list':
      return (
        <View key={key} style={styles.list}>
          {block.items.map((item, itemIndex) => (
            <View key={itemIndex} style={styles.numberedRow}>
              <Text style={[styles.numberedMarker, { color: colors.textMuted, fontFamily: Fonts.serif }]}>
                {`${itemIndex + 1}.`}
              </Text>
              <Text style={[styles.listText, { color: colors.text }]}>
                <InlineText segments={item} colors={colors} />
              </Text>
            </View>
          ))}
        </View>
      );
  }
}

export function AssistantMessage({ content }: { content: string }) {
  const colors = Colors.light;
  const blocks = useMemo(() => parseAssistantMarkdown(content), [content]);

  return <View style={styles.container}>{blocks.map((block, index) => renderBlock(block, index, colors))}</View>;
}

const styles = StyleSheet.create({
  // Vertical rhythm between blocks lives here (flex gap) rather than as
  // per-block margins, so the first block never carries an extra top gap
  // against the "SousChef" label above it.
  container: { gap: 10 },
  heading: {
    fontSize: 16,
    lineHeight: 21,
  },
  paragraph: {
    fontSize: 15,
    lineHeight: 22,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  list: {
    gap: 6,
  },
  bulletRow: {
    flexDirection: 'row',
    gap: 8,
  },
  bulletMarker: {
    width: 14,
    fontSize: 15,
    lineHeight: 22,
  },
  numberedRow: {
    flexDirection: 'row',
    gap: 8,
  },
  numberedMarker: {
    width: 20,
    fontSize: 15,
    lineHeight: 22,
  },
  listText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
  },
  bold: {
    fontWeight: '600',
  },
  italic: {
    fontStyle: 'italic',
  },
});
