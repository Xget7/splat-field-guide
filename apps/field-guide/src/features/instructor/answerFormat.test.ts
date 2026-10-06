import { AnswerKind, parseAnswer } from './answerFormat';

test('numbered steps keep short leads and speech offsets without reading the markers', () => {
  expect(
    parseAnswer('1. **Check:** Read the label\n2. Keep sparks away.'),
  ).toEqual({
    blocks: [
      {
        kind: AnswerKind.step,
        text: 'Check: Read the label',
        leadLength: 6,
        number: '1',
        location: 0,
      },
      {
        kind: AnswerKind.step,
        text: 'Keep sparks away.',
        leadLength: 0,
        number: '2',
        location: 23,
      },
    ],
    speech: 'Check: Read the label. Keep sparks away.',
  });
});

test('partial lines and unfinished leads show words, and unfinished markers stay hidden', () => {
  for (const partial of ['-', '1', '1.']) {
    expect(parseAnswer(partial, true).blocks).toEqual([]);
  }
  const partial = parseAnswer('- **Check:** Read the label.\n- **Why', true);
  expect(partial.blocks.map(block => [block.kind, block.text])).toEqual([
    [AnswerKind.bullet, 'Check: Read the label.'],
    [AnswerKind.bullet, 'Why'],
  ]);
  expect(parseAnswer('- Check the bat', true).blocks[0].text).toBe(
    'Check the bat',
  );
  expect(parseAnswer('- Check the bat', true).speech).toBe('Check the bat');
  expect(parseAnswer('- Check the battery.\n-', true).blocks).toHaveLength(1);
});

test('unsupported markup becomes plain words without losing specifications', () => {
  expect(
    parseAnswer('## **Read** the `label`\n> Use [the guide](manual).').speech,
  ).toBe('Read the label Use the guide.');
  const answer = parseAnswer('Use 12.0 volts.\n+ Keep *sparks* away.');
  expect(answer.blocks).toHaveLength(1);
  expect(answer.blocks[0].kind).toBe(AnswerKind.paragraph);
  expect(answer.speech).toBe('Use 12.0 volts. Keep sparks away.');
});
