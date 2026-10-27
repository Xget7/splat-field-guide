import { INITIAL_SESSION } from '../../guide';
import { fixturePack } from '@tests/fixturePack';
import { answerAbout } from '../domain/grounding';
import { answerFor, NOT_COVERED_REPLY } from '../domain/instructor';
import { TurnEventType } from '../domain/turn/exchange';
import { createTurnRunner } from '../domain/turn/turnRunner';
import { type Answerer } from '../domain/turn/answerer';
import { createExchangeIds } from '../domain/turn/exchange';
import { createCloudAnswerer } from '../data/answerers/cloudAnswerer';
import { createProxyClient } from '../data/proxy/proxyClient';
import { fakePlatform, fakeTextStreams } from '@tests/platform';

const runner = (answerers: readonly Answerer[]) =>
  createTurnRunner(answerers, createExchangeIds());
let instructor = runner([]);
const pack = fixturePack();
const battery = pack.parts.find(part => part.id === 'battery')!;
const QUESTION = 'What does the battery do?';

const fakeAnswerer = (
  respond: Answerer['respond'],
  ready = true,
): Answerer => ({
  isReady: jest.fn(() => ready),
  prewarm: jest.fn(),
  respond: jest.fn(respond),
  cancel: jest.fn(),
});
const replies = (text: string) => async () => text;
const fails = async (): Promise<string> => {
  throw new Error('down');
};
async function ask(
  onPartial = jest.fn(),
  owner = instructor,
  question = QUESTION,
) {
  let answer;
  await owner.ask(
    { question, state: INITIAL_SESSION, pack, history: [] },
    event => {
      if (event.type === TurnEventType.partial && event.exchange.reply !== '') {
        onPartial({ reply: event.exchange.reply, part: event.exchange.part });
      }
      if (event.type === TurnEventType.answer) {
        answer = event.answer;
      }
    },
  );
  return answer!;
}

test('the cloud answers first when it can', async () => {
  const cloud = fakeAnswerer(replies('It starts the engine.'));
  const local = fakeAnswerer(replies('Local.'));
  instructor = runner([cloud, local]);
  expect(await ask()).toEqual(answerAbout('It starts the engine.', battery));
  expect(local.respond).not.toHaveBeenCalled();
  expect(cloud.respond).toHaveBeenCalledWith(
    expect.objectContaining({
      question: QUESTION,
      state: INITIAL_SESSION,
      pack,
      history: [],
    }),
    expect.any(Function),
  );
});

test('a failed or empty model hands the same resolved evidence to the next one', async () => {
  for (const first of [fails, replies('  ')]) {
    const preferred = fakeAnswerer(first);
    const fallback = fakeAnswerer(replies('It supplies the starter.'));
    instructor = runner([preferred, fallback]);
    expect(await ask()).toEqual(
      answerAbout('It supplies the starter.', battery),
    );
    const evidence = jest.mocked(preferred.respond).mock.calls[0][0].evidence;
    expect(jest.mocked(fallback.respond).mock.calls[0][0].evidence).toBe(
      evidence,
    );
    expect(evidence.subject?.id).toBe('battery');
    expect(evidence.safety?.text).toBe('Keep sparks away from the terminals.');
  }
});

test('a model that is not ready is skipped', async () => {
  const cloud = fakeAnswerer(replies('Cloud.'), false);
  instructor = runner([cloud, fakeAnswerer(replies('Local.'))]);
  expect((await ask()).reply).toBe('Local.');
  expect(cloud.respond).not.toHaveBeenCalled();
});

test('the script answers when every model fails', async () => {
  instructor = runner([fakeAnswerer(fails), fakeAnswerer(fails)]);
  expect(await ask()).toEqual(answerFor(QUESTION, INITIAL_SESSION, pack));
});

test('partials are shaped and carry the subject the answer will highlight', async () => {
  const onPartial = jest.fn();
  instructor = runner([
    fakeAnswerer(async (_request, onText) => {
      onText(' ');
      onText('It **supplies**');
      onText('It holds 9 litres');
      return 'It supplies the starter.';
    }),
  ]);
  await ask(onPartial);
  expect(onPartial.mock.calls).toEqual([
    [{ reply: 'It supplies', part: 'battery' }],
    [{ reply: NOT_COVERED_REPLY, part: null }],
  ]);
});

test('a guessed number in the final text is never shown', async () => {
  instructor = runner([fakeAnswerer(replies('Use 5W-30.'))]);
  expect(await ask()).toEqual(answerAbout(NOT_COVERED_REPLY, battery));
});

test('cancel stops the chain and silences late partials', async () => {
  const onPartial = jest.fn();
  let finish: (text: string) => void = () => {};
  const local = fakeAnswerer(replies('Local.'));
  instructor = runner([
    fakeAnswerer((_request, onText) => {
      return new Promise<string>((_resolve, reject) => {
        finish = text => {
          onText(text);
          reject(new Error('cancelled'));
        };
      });
    }),
    local,
  ]);
  const answer = ask(onPartial);
  instructor.cancel();
  finish('Late words.');
  await answer;
  expect(onPartial).not.toHaveBeenCalled();
  expect(local.respond).not.toHaveBeenCalled();
});

test('commands stay synchronous and questions with no ready model use the script', async () => {
  const model = fakeAnswerer(replies('Cloud.'));
  instructor = runner([model]);
  const changed = jest.fn();
  const done = instructor.ask(
    { question: 'next', state: INITIAL_SESSION, pack, history: [] },
    changed,
  );
  expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({
    type: TurnEventType.answer,
  });
  await done;
  expect(model.respond).not.toHaveBeenCalled();
  instructor = runner([fakeAnswerer(replies('Cloud.'), false)]);
  expect(await ask()).toEqual(answerFor(QUESTION, INITIAL_SESSION, pack));
});

test('prewarm reaches only ready models and cancel reaches all', () => {
  const ready = fakeAnswerer(replies(''));
  const idle = fakeAnswerer(replies(''), false);
  instructor = runner([ready, idle]);
  instructor.prewarm(pack);
  expect(ready.prewarm).toHaveBeenCalledWith(pack);
  expect(idle.prewarm).not.toHaveBeenCalled();
  instructor.cancel();
  expect(ready.cancel).toHaveBeenCalled();
  expect(idle.cancel).toHaveBeenCalled();
});

test('cancelling one instructor leaves another pending answer active', async () => {
  const onPartial = jest.fn();
  let finish: () => void = () => {};
  const firstModel = fakeAnswerer(replies('First.'));
  const secondModel = fakeAnswerer((_request, onText) => {
    return new Promise<string>(resolve => {
      finish = () => {
        onText('It supplies the starter.');
        resolve('It supplies the starter.');
      };
    });
  });
  const first = runner([firstModel]);
  const second = runner([secondModel]);
  const pending = ask(onPartial, second);

  first.cancel();
  finish();

  expect(await pending).toEqual(
    answerAbout('It supplies the starter.', battery),
  );
  expect(onPartial).toHaveBeenCalledWith({
    reply: 'It supplies the starter.',
    part: 'battery',
  });
  expect(firstModel.cancel).toHaveBeenCalled();
  expect(secondModel.cancel).not.toHaveBeenCalled();
});

test('a battery voltage does not ground a coolant capacity', async () => {
  instructor = runner([
    fakeAnswerer(replies('Coolant capacity is 12 litres.')),
  ]);
  const answer = await ask(
    jest.fn(),
    instructor,
    'Explain the coolant reservoir',
  );
  expect(answer.reply).toBe(NOT_COVERED_REPLY);
  expect(answer.event).toBeNull();
});

test('late words from a failed model cannot replace the fallback model in the same turn', async () => {
  let late!: (text: string) => void;
  let nextText!: (text: string) => void;
  let finish!: (text: string) => void;
  instructor = runner([
    fakeAnswerer((_request, onText) => {
      late = onText;
      return Promise.reject(new Error('failed'));
    }),
    fakeAnswerer((_request, onText) => {
      nextText = onText;
      return new Promise<string>(resolve => {
        finish = resolve;
      });
    }),
  ]);
  const changed = jest.fn();
  const pending = instructor.ask(
    { question: QUESTION, state: INITIAL_SESSION, pack, history: [] },
    changed,
  );
  await Promise.resolve();
  nextText('It supplies the starter.');
  const streaming = changed.mock.calls.at(-1)?.[0];
  late('Discarded remote words.');
  expect(changed.mock.calls.at(-1)?.[0]).toBe(streaming);
  finish('It supplies the starter.');
  await pending;
  expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({
    type: TurnEventType.answer,
    answer: { reply: 'It supplies the starter.' },
  });
});

test.each(['error', 'missing done'])(
  'a streamed remote %s falls back to the next answerer',
  async failure => {
    const requests = fakeTextStreams();
    const { platform } = fakePlatform({ streamText: requests.streamText });
    const cloud = createCloudAnswerer({
      ...platform,
      proxy: createProxyClient('https://proxy.example', platform),
    });
    const changed = jest.fn();
    const answered = runner([
      cloud,
      fakeAnswerer(replies('It supplies the starter.')),
    ]).ask(
      { question: QUESTION, state: INITIAL_SESSION, pack, history: [] },
      changed,
    );
    requests.last.receive('{"text":"Provisional reply."}\n');
    if (failure === 'error') {
      requests.last.receive('{"error":"cut off"}\n');
    } else {
      requests.last.end();
    }
    await answered;
    expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({
      type: TurnEventType.answer,
      answer: { reply: 'It supplies the starter.' },
    });
  },
);
