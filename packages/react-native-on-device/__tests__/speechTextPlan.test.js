const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'build/tests/SpeechPlanProbe');
const nativeSuite = process.platform === 'darwin' ? describe : describe.skip;

nativeSuite('native speech text ranges', () => {
  beforeAll(() => {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    execFileSync('swiftc', [
      path.join(root, 'ios/SpeechTextPlan.swift'),
      path.join(__dirname, 'SpeechPlanProbe.swift'),
      '-o',
      output,
    ]);
  }, 30000);

  const plan = text =>
    JSON.parse(execFileSync(output, [text], { encoding: 'utf8' }));
  const words = (text, sentences) =>
    sentences.flatMap(sentence =>
      sentence.words.map(word =>
        text.slice(word.location, word.location + word.length),
      ),
    );

  test('reports UTF-16 offsets after a surrogate pair and keeps contractions intact', () => {
    const text = '🔧 Check the coolant. Don’t open a hot cap!';
    const sentences = plan(text);
    expect(words(text, sentences)).toEqual([
      'Check',
      'the',
      'coolant',
      'Don’t',
      'open',
      'a',
      'hot',
      'cap',
    ]);
    expect(sentences[0].words[0].location).toBe(3);
    expect(sentences).toHaveLength(2);
  });

  test('bounds a long sentence without losing or duplicating words', () => {
    const text = Array(100).fill('reservoir').join(' ') + '.';
    const sentences = plan(text);
    expect(sentences.length).toBeGreaterThan(1);
    expect(sentences.every(sentence => sentence.text.length <= 180)).toBe(true);
    expect(words(text, sentences)).toEqual(Array(100).fill('reservoir'));
    for (const sentence of sentences) {
      expect(
        text.slice(sentence.location, sentence.location + sentence.length),
      ).toBe(sentence.text);
    }
  });

  test('cuts a long first sentence at a clause so the voice starts sooner', () => {
    const lead = 'Locate the translucent coolant reservoir on the left,';
    const text = `${lead} behind the headlight and next to the strut tower in the engine bay.`;
    const sentences = plan(text);
    expect(sentences[0].text).toBe(lead);
    expect(words(text, sentences).join(' ')).toBe(
      text.replace(/[,.]/g, '').split(' ').join(' '),
    );
  });

  test('preserves original number ranges rather than normalized spoken text', () => {
    const text = 'Check 3.14 liters, then the 2nd line.';
    const sentences = plan(text);
    for (const word of sentences.flatMap(sentence => sentence.words)) {
      expect(word.location).toBeGreaterThanOrEqual(0);
      expect(word.location + word.length).toBeLessThanOrEqual(text.length);
    }
    expect(words(text, sentences).join(' ')).toContain('3.14');
    expect(words(text, sentences).join(' ')).toContain('2nd');
  });

  test('handles silence without an audio sentence', () => {
    expect(plan('')).toEqual([]);
    expect(plan(' \n\t ')).toEqual([]);
  });
});

nativeSuite('native conversation', () => {
  const conversationOutput = path.join(root, 'build/tests/ConversationProbe');
  beforeAll(() => {
    fs.mkdirSync(path.dirname(conversationOutput), { recursive: true });
    execFileSync('swiftc', [
      path.join(root, 'ios/OnDeviceAudioLevel.swift'),
      path.join(root, 'ios/OnDeviceConversation.swift'),
      path.join(__dirname, 'ConversationProbe.swift'),
      '-o',
      conversationOutput,
    ]);
  }, 30000);

  const conversation = scenario => JSON.parse(
    execFileSync(conversationOutput, [scenario], { encoding: 'utf8' }),
  );

  test('keeps steady speech in one turn until the speaker pauses', () => {
    const events = conversation('sustained');
    expect(events[0]).toBe('partial:Check coolant');
    expect(events.filter(event => event.startsWith('voice:true'))).toHaveLength(1);
    const ended = events.filter(event => event.startsWith('voice:false'));
    expect(ended).toHaveLength(1);
    expect(Number(ended[0].split(':')[2])).toBeGreaterThanOrEqual(214);
    expect(events.at(-1)).toBe('turn:Check coolant:229');
  });

  test('stops on audio loss once, rejects late results and can restart listening', () => {
    const events = conversation('loss');
    expect(events.filter(event => event.startsWith('stopped:'))).toEqual([
      'stopped:Audio session interrupted',
    ]);
    expect(events).not.toContain('partial:stale');
    expect(events.at(-1)).toBe('partial:Restarted');
  });

  test('explicit cancellation rejects late results without a spontaneous stop', () => {
    const events = conversation('cancel');
    expect(events.filter(event => event.startsWith('stopped:'))).toEqual([]);
    expect(events).not.toContain('partial:stale');
    expect(events.at(-1)).toBe('partial:Restarted');
  });
});
