import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  AnswerKind,
  parseAnswer,
  type AnswerBlock,
} from '../../../features/instructor/answerFormat';
import type { WordRange } from '../../../features/instructor/voice/speechPresentation';
import { InterruptedLabel } from '../../../features/instructor/mode/modeCopy';
import { Color, HAIRLINE, Radius, Space, Type } from '../../../ui/theme';
import { useAnswerReveal } from './useAnswerReveal';
import { KaraokeText } from './InstructorMotion';
import { assistantBlocks } from '../assistant/repeatedContent';

const BULLET_SIZE = 4;

interface Props {
  id: string;
  reply: string;
  streaming: boolean;
  reducedMotion: boolean;
  speaking: boolean;
  word: WordRange | null;
  live: boolean;
  interrupted?: boolean;
  variant?: 'panel' | 'assistant';
  shownText?: readonly string[];
}

/** One answer owns its reveal; the thread and the splat do not render for each batch of characters. */
export function InstructorAnswer({
  id,
  reply,
  streaming,
  reducedMotion,
  speaking,
  word,
  live,
  interrupted = false,
  variant = 'panel',
  shownText = [],
}: Props) {
  const parsed = useMemo(
    () => parseAnswer(reply, streaming),
    [reply, streaming],
  );
  const answer = useMemo(
    () =>
      variant === 'assistant'
        ? {
            ...parsed,
            blocks: assistantBlocks(parsed.blocks, shownText, streaming),
          }
        : parsed,
    [variant, parsed, shownText, streaming],
  );
  const revealed = useAnswerReveal(answer.speech, streaming, reducedMotion);
  const style = live || variant === 'assistant' ? undefined : styles.earlier;
  const lastVisible = answer.blocks.length - 1;
  const textFor = (index: number) => {
    const block = answer.blocks[index];
    const text = block.text.slice(0, Math.max(0, revealed - block.location));
    let label = text;
    if (interrupted && index === lastVisible) {
      label = `${text} ${InterruptedLabel}`;
    }
    return (
      <KaraokeText
        id={
          answer.blocks.length === 1 && block.kind === AnswerKind.paragraph
            ? id
            : `${id}-item-${index + 1}`
        }
        text={text}
        accessibilityLabel={label}
        speaking={speaking}
        word={word}
        location={block.location}
        speechLength={answer.speech.length}
        leadLength={block.leadLength}
        style={style}
      />
    );
  };
  const blockFor = (block: AnswerBlock, index: number) => {
    if (block.location >= revealed) {
      return null;
    }
    if (block.kind === AnswerKind.paragraph) {
      return <View key={index}>{textFor(index)}</View>;
    }
    return (
      <View
        key={index}
        style={[
          styles.item,
          block.leadLength > 0 && variant !== 'assistant' && styles.card,
        ]}
      >
        {block.kind === AnswerKind.step ? (
          <Text
            accessible={false}
            style={[
              styles.number,
              !live && variant !== 'assistant' && styles.earlier,
            ]}
          >
            {block.number}
          </Text>
        ) : (
          <View accessible={false} style={styles.marker}>
            <View style={styles.bullet} />
          </View>
        )}
        <View style={styles.words}>{textFor(index)}</View>
      </View>
    );
  };
  const interruptedText = interrupted && (
    <Text accessible={lastVisible < 0} style={styles.interrupted}>
      {InterruptedLabel}
    </Text>
  );
  if (variant === 'assistant' && lastVisible < 0) {
    return interruptedText || null;
  }
  if (
    answer.blocks.length === 1 &&
    answer.blocks[0].kind === AnswerKind.paragraph
  ) {
    return (
      <>
        {textFor(0)}
        {interruptedText}
      </>
    );
  }
  return (
    <>
      <View testID={id} style={styles.answer}>
        {answer.blocks.map(blockFor)}
      </View>
      {interruptedText}
    </>
  );
}

const styles = StyleSheet.create({
  answer: { gap: Space.sm },
  interrupted: { ...Type.footnote, color: Color.muted, marginTop: Space.xs },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.sm },
  card: {
    padding: Space.sm,
    borderWidth: HAIRLINE,
    borderColor: Color.lineStrong,
    borderRadius: Radius.md,
    backgroundColor: Color.surface,
  },
  number: {
    ...Type.data,
    lineHeight: Type.body.lineHeight,
    minWidth: Space.lg,
    color: Color.text,
  },
  marker: {
    width: Space.sm,
    height: Type.body.lineHeight,
    justifyContent: 'center',
  },
  bullet: {
    width: BULLET_SIZE,
    height: BULLET_SIZE,
    backgroundColor: Color.accent,
  },
  words: { flex: 1 },
  earlier: { color: Color.secondaryText },
});
