import { fakePlatform } from '@tests/platform';
import {
  AgentRetry,
  createAgentReconnect,
} from '../domain/agent/agentReconnect';
import { GrpcBackoff } from '../../../platform/connectivity/backoff';
import { NetworkQuality } from '../../../platform/connectivity/networkStatus';

const { timers, random } = fakePlatform().platform;

let ready: boolean;
let reconnect: jest.Mock;
let agent: ReturnType<typeof createAgentReconnect>;
beforeEach(() => {
  jest.useFakeTimers();
  ready = true;
  reconnect = jest.fn();
  agent = createAgentReconnect({
    timers,
    random,
    canReconnect: () => ready,
    reconnect,
  });
});
afterEach(() => {
  agent.cancel();
  jest.useRealTimers();
});

test('a fallback retries the agent after a backoff that grows until the agent connects', () => {
  agent.fellBack();
  jest.advanceTimersByTime(AgentRetry.initialMs - 1);
  expect(reconnect).not.toHaveBeenCalled();
  jest.advanceTimersByTime(1);
  expect(reconnect).toHaveBeenCalledTimes(1);
  agent.fellBack();
  const grown = AgentRetry.initialMs * GrpcBackoff.MULTIPLIER;
  jest.advanceTimersByTime(grown - 1);
  expect(reconnect).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(1);
  expect(reconnect).toHaveBeenCalledTimes(2);
  agent.connected();
  agent.fellBack();
  jest.advanceTimersByTime(AgentRetry.initialMs);
  expect(reconnect).toHaveBeenCalledTimes(3);
});

test('a retry that falls due during a turn waits for idle, and is dropped when the agent cannot start', () => {
  agent.setIdle(false);
  agent.fellBack();
  jest.advanceTimersByTime(AgentRetry.initialMs);
  expect(reconnect).not.toHaveBeenCalled();
  agent.setIdle(true);
  expect(reconnect).toHaveBeenCalledTimes(1);
  ready = false;
  agent.fellBack();
  jest.advanceTimersByTime(AgentRetry.maxMs);
  ready = true;
  agent.setIdle(true);
  expect(reconnect).toHaveBeenCalledTimes(1);
});

test('a new good route reconnects at once, but the first route is not a change', () => {
  agent.networkChanged(NetworkQuality.good);
  expect(reconnect).not.toHaveBeenCalled();
  agent.fellBack();
  agent.networkChanged(NetworkQuality.weak);
  expect(reconnect).not.toHaveBeenCalled();
  agent.networkChanged(NetworkQuality.good);
  expect(reconnect).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(AgentRetry.maxMs);
  expect(reconnect).toHaveBeenCalledTimes(1);
});

test('cancel drops a pending retry', () => {
  agent.fellBack();
  agent.cancel();
  jest.advanceTimersByTime(AgentRetry.maxMs);
  expect(reconnect).not.toHaveBeenCalled();
});
