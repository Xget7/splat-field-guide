import { fixturePack } from '@tests/fixturePack';
import { fakePlatform, fakeAgentTransport } from '@tests/platform';
import { INITIAL_SESSION } from '../../guide';
import { openManualIndex, openPartVectorIndex } from '../../semantic';
import { createDeviceAnswerer } from '../data/answerers/deviceAnswerer';
import { createCloudAnswerer } from '../data/answerers/cloudAnswerer';
import { createProxyClient } from '../data/proxy/proxyClient';
import { createTurnRunner } from '../domain/turn/turnRunner';
import {
  createExchangeIds,
  TurnEventType,
  type TurnEvent,
} from '../domain/turn/exchange';
import { runAgentTool } from '../domain/agent/agentTools';
const pack = fixturePack();
const source = {
  id: 'kuka-fixture',
  title: 'Synthetic KUKA manual',
  edition: 'V1',
  issued: '2026-01-01',
  file: 'manual.pdf',
  sha256: 'a'.repeat(64),
  copyright: 'Synthetic notice',
  pages: 1,
};
const text =
  'The synthetic battery mounting torque is 12 test units. Confirm the installed model before service.';
const manuals = openManualIndex(
  {
    schemaVersion: 1,
    documents: [{ ...source, pages: [{ number: 1, text }] }],
  },
  [source],
);
const opened = openPartVectorIndex(
  pack.semantic!,
  new Float32Array([1, 0, 0, 0, 0.9, 0.1, 0, 0, 0, 0, 1, 0]),
);
if (!opened.ok) throw new Error(opened.error.message);
const knowledge = { manuals, vectors: opened.index };

test('offline Qwen receives complete-source excerpts with page and digest when pack specifications are absent', async () => {
  const fake = fakePlatform();
  jest.mocked(fake.model.availability).mockReturnValue('available');
  jest
    .mocked(fake.model.respond)
    .mockResolvedValue(
      'The synthetic torque is 12 test units, from V1 PDF page 1.',
    );
  const events: TurnEvent[] = [];
  const device = createDeviceAnswerer(fake.platform.languageModel);
  await createTurnRunner(
    [device],
    createExchangeIds(),
    async () => knowledge,
  ).ask(
    {
      question: 'What torque applies to the battery mounting?',
      state: INITIAL_SESSION,
      pack,
      history: [],
    },
    event => events.push(event),
  );
  expect(fake.model.respond).toHaveBeenCalled();
  const prompt = jest.mocked(fake.model.respond).mock.calls[0][1];
  expect(prompt).toContain(text);
  expect(prompt).toContain('PDF page 1');
  expect(prompt).toContain(source.sha256);
  expect(events.at(-1)).toMatchObject({
    type: TurnEventType.answer,
    answer: { reply: expect.stringContaining('12 test units') },
  });
});
test('without an available model the same complete-source passage remains readable offline', async () => {
  const events: TurnEvent[] = [];
  await createTurnRunner([], createExchangeIds(), async () => knowledge).ask(
    {
      question: 'What torque applies to the battery mounting?',
      state: INITIAL_SESSION,
      pack,
      history: [],
    },
    event => events.push(event),
  );
  expect(events.at(-1)).toMatchObject({
    answer: { reply: expect.stringContaining(text), event: null },
  });
});
test('online client tools query the same manual pages and supplied embeddings without scene mutations', () => {
  const search = runAgentTool(
    'search_manual',
    { query: 'battery mounting torque' },
    INITIAL_SESSION,
    pack,
    undefined,
    knowledge,
  );
  expect(search).toMatchObject({ ok: true, event: null });
  expect(JSON.parse(search.result).matches[0]).toMatchObject({
    sourceSha256: source.sha256,
    pdfPage: 1,
    text,
  });
  const page = runAgentTool(
    'get_manual_page',
    { document_id: source.id, pdf_page: 1 },
    INITIAL_SESSION,
    pack,
    undefined,
    knowledge,
  );
  expect(JSON.parse(page.result).text).toBe(text);
  const similar = runAgentTool(
    'find_similar_parts',
    { part_id: 'battery', kind: 'image' },
    INITIAL_SESSION,
    pack,
    undefined,
    knowledge,
  );
  expect(similar).toMatchObject({ ok: true, event: null });
  expect(JSON.parse(similar.result).matches[0].partId).toBe('engine');
  expect(JSON.parse(similar.result).qualification).toContain('not evidence');
});
test('cancelling while local knowledge loads cannot open a late paid session', async () => {
  const transport = fakeAgentTransport();
  const fake = fakePlatform({ socket: transport.connect });
  let loaded!: (value: typeof knowledge) => void;
  const pendingKnowledge = new Promise<typeof knowledge>(resolve => {
    loaded = resolve;
  });
  const answerer = createCloudAnswerer({
    ...fake.platform,
    proxy: createProxyClient('https://issuer', fake.platform),
    knowledge: () => pendingKnowledge,
  });
  const pending = answerer
    .respond(
      {
        question: 'Explain the battery',
        state: INITIAL_SESSION,
        pack,
        history: [],
        evidence: {
          manual: [],
          subject: null,
          procedure: null,
          onScreen: null,
          currentProcedure: null,
          currentStep: null,
          notes: [],
          safety: null,
          relations: [],
        },
      },
      jest.fn(),
    )
    .catch(error => error);
  answerer.cancel();
  loaded(knowledge);
  expect(await pending).toBeInstanceOf(Error);
  expect(transport.open).toBe(0);
});

test('offline and online relationship answers use the same directed source edge', async () => {
  for (const courseKnowledge of [false, true]) {
    const model = {
      courseKnowledge,
      isReady: () => true,
      prewarm() {},
      cancel() {},
      respond: jest.fn(async () => 'A guessed relationship.'),
    };
    const events: TurnEvent[] = [];
    await createTurnRunner(
      [model],
      createExchangeIds(),
      async () => knowledge,
    ).ask(
      {
        question: 'What feeds the engine?',
        state: INITIAL_SESSION,
        pack,
        history: [],
      },
      event => events.push(event),
    );
    expect(events.at(-1)).toMatchObject({
      answer: {
        reply: expect.stringContaining(
          'is fed by Coolant reservoir (Workshop manual, cooling)',
        ),
        part: 'engine',
      },
    });
    expect(model.respond).not.toHaveBeenCalled();
  }
});

test('offline scene selection honors an explicit assembly when component names repeat', async () => {
  const root = pack.parts.find(part => part.parent === null)!;
  const battery = pack.parts.find(part => part.id === 'battery')!;
  const scoped = {
    ...pack,
    parts: [
      { ...root, id: 'r02', name: 'Door-frame welder', aliases: [] },
      { ...root, id: 'r03', name: 'Roof welder', aliases: [] },
      {
        ...battery,
        id: 'r02-gun',
        name: 'Welding gun',
        aliases: [],
        parent: 'r02',
      },
      {
        ...battery,
        id: 'r03-gun',
        name: 'Welding gun',
        aliases: [],
        parent: 'r03',
      },
    ],
  };
  const events: TurnEvent[] = [];
  await createTurnRunner([], createExchangeIds()).ask(
    {
      question: 'Where is the R03 welding gun?',
      state: INITIAL_SESSION,
      pack: scoped,
      history: [],
    },
    event => events.push(event),
  );
  expect(events.at(-1)).toMatchObject({
    answer: { part: 'r03-gun', event: { type: 'select', partId: 'r03-gun' } },
  });
});
