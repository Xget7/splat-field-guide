import {
  chunkDurationMs,
  createWordTimeline,
} from '../apps/field-guide/src/features/instructor/agent/wordTimeline';

test('chunk offsets, word gaps and the end control highlighting', () => {
  const timeline = createWordTimeline();
  timeline.add(
    {
      chars: ['H', 'i', ' '],
      startsMs: [0, 20, 40],
      durationsMs: [20, 20, 10],
    },
    0,
  );
  timeline.add(
    {
      chars: ['t', 'h', 'e', 'r', 'e'],
      startsMs: [0, 20, 40, 60, 80],
      durationsMs: [20, 20, 20, 20, 20],
    },
    100,
  );
  expect(timeline.text()).toBe('Hi there');
  expect(timeline.wordAt(30)).toEqual({ location: 0, length: 2 });
  expect(timeline.wordAt(150)).toEqual({ location: 3, length: 5 });
  expect(timeline.wordAt(70)).toBeNull();
  expect(timeline.wordAt(200)).toBeNull();
});
test('words split across chunks and UTF-16 characters stay inside the spoken text', () => {
  const timeline = createWordTimeline();
  timeline.add(
    { chars: ['A', '😀'], startsMs: [0, 10], durationsMs: [10, 10] },
    0,
  );
  timeline.add(
    {
      chars: ['B', ' ', 'C'],
      startsMs: [0, 10, 20],
      durationsMs: [10, 10, 10],
    },
    20,
  );
  expect(timeline.text()).toBe('A😀B C');
  expect(timeline.wordAt(25)).toEqual({ location: 0, length: 4 });
  for (let time = 0; time <= 60; time++) {
    const word = timeline.wordAt(time);
    if (word) {
      expect(word.location + word.length).toBeLessThanOrEqual(
        timeline.text().length,
      );
    }
  }
  expect(timeline.wordAt(-1)).toBeNull();
});
test('PCM16 duration accounts for base64 padding', () => {
  expect(chunkDurationMs('AAA=', 16000)).toBe(0.0625);
  expect(chunkDurationMs('AAAA', 24000)).toBe(0.0625);
  expect(chunkDurationMs('', 16000)).toBe(0);
});
