import { fakePlatform } from '@tests/platform';
import {
  createReplyPolicy,
  ReplyFailure,
  ReplyTiming,
  type StreamedReply,
} from '../domain/turn/replyPolicy';

const { clock, timers } = fakePlatform().platform;

/** One streamed reply the test feeds, finishes or fails. */
function fakeReply() {
  let report!: (text: string) => void;
  let finish!: (text: string) => void;
  let fail!: (error: Error) => void;
  const cancel = jest.fn();
  const start = jest.fn((onText: (text: string) => void): StreamedReply => {
    report = onText;
    return {
      text: new Promise<string>((resolve, reject) => {
        finish = resolve;
        fail = reject;
      }),
      cancel,
    };
  });
  return {
    start,
    cancel,
    text: (text: string) => report(text),
    finish: (text: string) => finish(text),
    fail: (error: Error) => fail(error),
  };
}

let failures: jest.Mock;
let policy: ReturnType<typeof createReplyPolicy>;
beforeEach(() => {
  jest.useFakeTimers();
  failures = jest.fn();
  policy = createReplyPolicy({ clock, timers, onFailure: failures });
});
afterEach(() => jest.useRealTimers());

test('passes the streamed text through and resolves the full reply', async () => {
  const reply = fakeReply();
  const onText = jest.fn();
  const answered = policy.run(reply.start, onText);
  reply.text('It');
  reply.text('It supplies.');
  reply.finish('It supplies.');
  await expect(answered).resolves.toBe('It supplies.');
  expect(onText.mock.calls).toEqual([['It'], ['It supplies.']]);
  expect(failures).not.toHaveBeenCalled();
});

test('a failed reply is reported and makes the policy wait out the cool-off', async () => {
  const reply = fakeReply();
  const answered = policy.run(reply.start, jest.fn());
  reply.fail(new Error('overloaded'));
  await expect(answered).rejects.toThrow('overloaded');
  expect(failures).toHaveBeenCalledWith(ReplyFailure.failed);
  expect(policy.ready()).toBe(false);
  jest.advanceTimersByTime(ReplyTiming.COOL_OFF_MS);
  expect(policy.ready()).toBe(true);
});

test.each([undefined, '', ' '])(
  'gives up when no answer text arrives in time: %j',
  async delta => {
    const reply = fakeReply();
    const answered = policy.run(reply.start, jest.fn());
    if (delta !== undefined) {
      reply.text(delta);
    }
    jest.advanceTimersByTime(ReplyTiming.FIRST_TEXT_MS);
    expect(policy.ready()).toBe(false);
    await expect(answered).rejects.toThrow('no text in time');
    expect(reply.cancel).toHaveBeenCalled();
    expect(failures).toHaveBeenCalledWith(ReplyFailure.slowStart);
  },
);

test('first text stops the first-text deadline, not the total one', async () => {
  const reply = fakeReply();
  const answered = policy.run(reply.start, jest.fn());
  reply.text('It');
  jest.advanceTimersByTime(ReplyTiming.FIRST_TEXT_MS);
  expect(failures).not.toHaveBeenCalled();
  jest.advanceTimersByTime(ReplyTiming.TOTAL_MS - ReplyTiming.FIRST_TEXT_MS);
  await expect(answered).rejects.toThrow('too slow');
  expect(failures).toHaveBeenCalledWith(ReplyFailure.slowReply);
});

test('cancel rejects without a cool-off or a reported failure', async () => {
  const reply = fakeReply();
  const answered = policy.run(reply.start, jest.fn());
  policy.cancel();
  await expect(answered).rejects.toThrow('cancelled');
  expect(reply.cancel).toHaveBeenCalled();
  expect(policy.ready()).toBe(true);
  expect(failures).not.toHaveBeenCalled();
  expect(() => policy.cancel()).not.toThrow();
});

test('a new reply cancels the one before it and ignores its late text', async () => {
  const first = fakeReply();
  const onText = jest.fn();
  const answered = policy.run(first.start, onText);
  policy.run(fakeReply().start, jest.fn());
  await expect(answered).rejects.toThrow('cancelled');
  expect(first.cancel).toHaveBeenCalled();
  first.text('Late words.');
  expect(onText).not.toHaveBeenCalled();
  expect(policy.ready()).toBe(true);
});
