import {
  AnswerKind,
  parseAnswer,
  type AnswerBlock,
} from '../../../features/instructor/answerFormat';

const SENTENCE = /\S[\s\S]*?(?:[.!?](?=\s|$)|$)/g;

function normalized(text: string) {
  return parseAnswer(text)
    .speech.toLowerCase()
    .replace(/[.!?]+$/, '')
    .trim();
}

/** Compare display words without changing the offsets used by speech highlighting. */
export function shownWordsFor(shown: readonly string[]): readonly string[] {
  return [
    ...new Set(
      shown.flatMap(value => {
        const speech = parseAnswer(value).speech;
        return [
          speech,
          ...Array.from(speech.matchAll(SENTENCE), match => match[0]),
        ]
          .map(normalized)
          .filter(Boolean);
      }),
    ),
  ];
}

export function isRepeatedText(
  text: string,
  shown: readonly string[],
  streaming = false,
) {
  const words = normalized(text);
  return (
    words !== '' &&
    shown.some(
      displayed =>
        displayed === words || (streaming && displayed.startsWith(words)),
    )
  );
}

/** Keep native speech locations when an answer includes both familiar and new sentences. */
export function assistantBlocks(
  blocks: readonly AnswerBlock[],
  shown: readonly string[],
  streaming: boolean,
): readonly AnswerBlock[] {
  return blocks.flatMap(block => {
    if (isRepeatedText(block.text, shown, streaming)) {
      return [];
    }
    if (block.kind !== AnswerKind.paragraph) {
      return [block];
    }
    const sentences = Array.from(block.text.matchAll(SENTENCE));
    const visible = sentences.filter(
      (sentence, index) =>
        !isRepeatedText(
          sentence[0],
          shown,
          streaming && index === sentences.length - 1,
        ),
    );
    if (visible.length === sentences.length) {
      return [block];
    }
    return visible.map(sentence => ({
      ...block,
      text: sentence[0],
      location: block.location + sentence.index,
    }));
  });
}
