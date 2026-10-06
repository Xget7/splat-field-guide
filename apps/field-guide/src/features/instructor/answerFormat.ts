export const AnswerKind = {
  paragraph: 'paragraph',
  bullet: 'bullet',
  step: 'step',
} as const;
export type AnswerKind = (typeof AnswerKind)[keyof typeof AnswerKind];

export const MAX_LEAD_WORDS = 3;

export interface AnswerBlock {
  readonly kind: AnswerKind;
  readonly text: string;
  readonly leadLength: number;
  readonly number: string | null;
  /** The start of this block in the text sent to speech, in UTF-16. */
  readonly location: number;
}

export interface FormattedAnswer {
  readonly blocks: readonly AnswerBlock[];
  readonly speech: string;
}

function plainText(text: string): string {
  return text
    .replace(/!?\[([^\]]*)(?:\](?:\([^)]*(?:\)|$))?)?/g, '$1')
    .replace(/^\s*(?:[-+]\s+|>\s*|\d+\)\s+)/, '')
    .replace(/[*#`_~|[\]]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Only paragraphs, dash bullets and numbered steps carry structure; other markup becomes words. */
export function parseAnswer(text: string, streaming = false): FormattedAnswer {
  const blocks: AnswerBlock[] = [];
  let speech = '';
  let paragraph = false;
  const lines = text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (trimmed === '') {
      paragraph = false;
      continue;
    }
    // A marker split across chunks carries no instruction until its words arrive.
    if (
      /^(?:[-*+]|\d+\.)$/.test(trimmed) ||
      /^(?:[-*_]\s*){3,}$/.test(trimmed) ||
      (streaming && index === lines.length - 1 && /^\d+$/.test(trimmed))
    ) {
      continue;
    }
    const bullet = /^-\s+(.+)$/.exec(trimmed);
    const step = /^([1-3])\.\s+(.+)$/.exec(trimmed);
    const kind = bullet
      ? AnswerKind.bullet
      : step
      ? AnswerKind.step
      : AnswerKind.paragraph;
    const content = bullet?.[1] ?? step?.[2] ?? trimmed;
    const words = plainText(content);
    if (words === '') {
      continue;
    }
    const lead =
      kind !== AnswerKind.paragraph && /^\*\*([^*]+)\*\*/.exec(content);
    const leadText = lead ? plainText(lead[1]) : '';
    const leadLength =
      leadText !== '' && leadText.split(' ').length <= MAX_LEAD_WORDS
        ? leadText.length
        : 0;
    const previous = blocks[blocks.length - 1];
    if (kind === AnswerKind.paragraph && paragraph && previous) {
      blocks[blocks.length - 1] = {
        ...previous,
        text: `${previous.text} ${words}`,
      };
    } else {
      blocks.push({
        kind,
        text: words,
        leadLength,
        number: step?.[1] ?? null,
        location: speech.length + (speech === '' ? 0 : 1),
      });
    }
    const sentence =
      kind !== AnswerKind.paragraph &&
      !(streaming && index === lines.length - 1) &&
      !/[.!?:;]$/.test(words)
        ? `${words}.`
        : words;
    speech += `${speech === '' ? '' : ' '}${sentence}`;
    paragraph = kind === AnswerKind.paragraph;
  }
  return { blocks, speech };
}

/** Keeps the supported format in stored replies, without exposing unsupported markup. */
export function formatBlock(block: AnswerBlock, text = block.text): string {
  if (block.kind === AnswerKind.paragraph) {
    return text;
  }
  const content =
    block.leadLength > 0
      ? `**${text.slice(0, block.leadLength)}**${text.slice(block.leadLength)}`
      : text;
  const marker = block.kind === AnswerKind.bullet ? '-' : `${block.number}.`;
  return `${marker} ${content}`;
}
