import { createNdjsonEvents } from '../data/proxy/ndjsonEvents';

test('streams text across chunk boundaries and ends on done', () => {
  const events = createNdjsonEvents();
  expect(events.feed('{"text":"It sup')).toEqual([]);
  expect(events.feed('plies"}\n\n{"text":" the starter."}\n')).toEqual([
    { type: 'text', text: 'It supplies' },
    { type: 'text', text: ' the starter.' },
  ]);
  expect(events.feed('{"done":true}\n')).toEqual([{ type: 'done' }]);
});
