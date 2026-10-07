import {
  hasSpokenWord,
  isUnfinished,
} from '../apps/field-guide/src/features/instructor/utterance';

describe('heard speech', () => {
  it.each(['.', 'uh', 'Hmm.', ''])('takes "%s" for noise', heard =>
    expect(hasSpokenWord(heard)).toBe(false),
  );

  it('hears a spoken word', () => {
    expect(hasSpokenWord('Next.')).toBe(true);
  });

  it.each(['Where is the', 'And what about my', 'Check the coolant and'])(
    'waits for the rest of "%s"',
    heard => expect(isUnfinished(heard)).toBe(true),
  );

  it.each([
    'Where is the battery?',
    'Where the fuse box is',
    'What is it for',
    'Next',
  ])('takes "%s" as said in full', heard =>
    expect(isUnfinished(heard)).toBe(false),
  );
});
