import { nextExchangeId, TurnEventType } from '../turn';
import { createModelInstructor } from '../models/modelInstructor';
import { INITIAL_SESSION } from '../../guide/session';
import { fixturePack } from '../../../testing/fixturePack';

test('device instructors and agent exchanges share increasing thread ids', async () => {
  const firstAgentId = nextExchangeId();
  const ids: number[] = [firstAgentId];
  for (const instructor of [
    createModelInstructor([]),
    createModelInstructor([]),
  ]) {
    await instructor.ask(
      {
        question: 'next',
        state: INITIAL_SESSION,
        pack: fixturePack(),
        history: [],
      },
      event => {
        if (event.type === TurnEventType.begin) {
          ids.push(event.exchange.id);
        }
      },
    );
  }
  ids.push(nextExchangeId());
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids).toEqual([...ids].sort((a, b) => a - b));
});
