import type { WordRange } from '../voice/speechPresentation';
import type { Alignment } from './agentProtocol';

const BASE64_CHAR_BYTES = 3 / 4;
const PCM16_BYTES = 2;
const MS_PER_SECOND = 1000;
export function chunkDurationMs(base64: string, sampleRate: number): number {
  const encoded = base64.replace(/\s/g, '');
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  const bytes = encoded.length * BASE64_CHAR_BYTES - padding;
  return sampleRate > 0
    ? (bytes / PCM16_BYTES / sampleRate) * MS_PER_SECOND
    : 0;
}
export interface WordTimeline {
  add(alignment: Alignment, offsetMs: number): void;
  text(): string;
  wordAt(ms: number): WordRange | null;
}
interface TimedRange extends WordRange {
  readonly start: number;
  readonly end: number;
}
export function createWordTimeline(): WordTimeline {
  let text = '';
  const characters: TimedRange[] = [];
  let words: TimedRange[] = [];
  return {
    add(alignment, offsetMs) {
      alignment.chars.forEach((char, index) => {
        characters.push({
          location: text.length,
          length: char.length,
          start: offsetMs + alignment.startsMs[index],
          end:
            offsetMs + alignment.startsMs[index] + alignment.durationsMs[index],
        });
        text += char;
      });
      words = [...text.matchAll(/\S+/g)].map(match => {
        const location = match.index!;
        const length = match[0].length;
        const spans = characters.filter(
          char =>
            char.location < location + length &&
            char.location + char.length > location,
        );
        return {
          location,
          length,
          start: Math.min(...spans.map(span => span.start)),
          end: Math.max(...spans.map(span => span.end)),
        };
      });
    },
    text: () => text,
    wordAt(ms) {
      const word = words.find(value => ms >= value.start && ms < value.end);
      return word ? { location: word.location, length: word.length } : null;
    },
  };
}
