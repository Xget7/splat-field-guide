import { NoteTopic } from '../../../../../apps/field-guide/src/domain/pack';
import { INITIAL_SESSION } from '../../../../../apps/field-guide/src/domain/session';
import { fixturePack } from '../../../fixtures/fixturePack';
import {
  pointsAtScreen,
  subjectOf,
  topicsFor,
} from '../../../../../apps/field-guide/src/modules/instructor/domain/context';

const pack = fixturePack();
const onScreen = (id: string) => ({ ...INITIAL_SESSION, selectedPart: id });

describe('instructor context', () => {
  test('pointing words refer to the screen, part words do not', () => {
    expect(pointsAtScreen('What is that thing?')).toBe(true);
    expect(pointsAtScreen('What does the battery do?')).toBe(false);
  });

  test('topics put what the question asks for before what a part is and does', () => {
    expect(topicsFor('Is it safe to touch?')).toEqual([
      NoteTopic.safety,
      NoteTopic.identity,
      NoteTopic.purpose,
    ]);
    expect(topicsFor('Why does it keep going flat?')[0]).toBe(NoteTopic.faults);
    expect(topicsFor('Tell me about it')).toEqual([
      NoteTopic.identity,
      NoteTopic.purpose,
    ]);
  });

  test('a named part is the subject whatever is on screen', () => {
    expect(
      subjectOf('Where is the battery?', onScreen('fuse-box'), pack)?.id,
    ).toBe('battery');
  });

  test('the part on screen is the subject of a question that points at it or asks about something', () => {
    expect(subjectOf('What is that?', onScreen('fuse-box'), pack)?.id).toBe(
      'fuse-box',
    );
    expect(
      subjectOf(
        "OK, so what's the purpose?",
        onScreen('power-steering-reservoir'),
        pack,
      )?.id,
    ).toBe('power-steering-reservoir');
    expect(
      subjectOf("What's the weather like?", onScreen('fuse-box'), pack),
    ).toBeNull();
  });

  test('without a name or pointing, the notes that share the most words decide', () => {
    expect(
      subjectOf('Why does the car keep going flat?', INITIAL_SESSION, pack)?.id,
    ).toBe('battery');
  });

  test('the engine in a condition is when, not what', () => {
    expect(
      subjectOf(
        'Can I open the coolant tank when the engine is hot?',
        INITIAL_SESSION,
        pack,
      )?.id,
    ).toBe('coolant-reservoir');
    expect(subjectOf('Is the engine hot?', INITIAL_SESSION, pack)?.id).toBe(
      'engine',
    );
  });
});
