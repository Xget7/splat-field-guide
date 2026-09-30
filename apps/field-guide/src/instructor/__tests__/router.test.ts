import { SessionEvent, SessionEventType } from '../../domain/session';
import { fixturePack } from '../../domain/testing/fixturePack';
import { normalize, routeCommand, RouteKind } from '../router';

const pack = fixturePack();

const eventFor = (text: string): SessionEvent | null => {
  const route = routeCommand(text, pack);
  return route.kind === RouteKind.command ? route.event : null;
};

describe('routeCommand', () => {
  it.each([
    ['next', SessionEventType.next],
    ['Next!', SessionEventType.next],
    ['  next step, please ', SessionEventType.next],
    ['go to the next step', SessionEventType.next],
    ['continue', SessionEventType.next],
    ['back', SessionEventType.back],
    ['go back', SessionEventType.back],
    ['previous step', SessionEventType.back],
    ['repeat', SessionEventType.repeat],
    ['can you repeat that please', SessionEventType.repeat],
    ['say again', SessionEventType.repeat],
    ['stop', SessionEventType.end],
    ['end procedure', SessionEventType.end],
    ['STOP.', SessionEventType.end],
  ])('routes "%s" to %s (R14)', (text, type) => {
    expect(eventFor(text)).toEqual({ type });
  });

  it.each([
    ['start check the coolant level', 'check-coolant'],
    ['please start check the brake fluid level', 'check-brake-fluid'],
    ['begin check-power-steering-fluid', 'check-power-steering-fluid'],
    ['start check the coolant', 'check-coolant'],
    ['start check the power steering fluid', 'check-power-steering-fluid'],
  ])('routes "%s" to starting %s', (text, procedureId) => {
    expect(eventFor(text)).toEqual(
      procedureId ? { type: SessionEventType.start, procedureId } : null,
    );
  });

  it('refuses an ambiguous procedure prefix', () => {
    expect(eventFor('start check')).toBeNull();
  });

  it('refuses start with no or an unknown procedure', () => {
    expect(eventFor('start')).toBeNull();
    expect(eventFor('start the oil change')).toBeNull();
  });

  it.each([
    ['show me the battery', 'battery'],
    ['Show me the BATTERY, please!', 'battery'],
    ['where is the fuse box', 'fuse-box'],
    ["where's the fuse box?", 'fuse-box'],
    ['where is the fuses', 'fuse-box'],
    ['show me the expansion tank', 'coolant-reservoir'],
    ['show me the Coolant Tank', 'coolant-reservoir'],
    ['show me brake-fluid-reservoir', 'brake-fluid-reservoir'],
    ['where is the engine', 'engine'],
    ['show me the valve cover', 'valve-cover'],
    ['where is the intake manifold', 'intake-manifold'],
  ])('routes "%s" to selecting %s', (text, partId) => {
    expect(eventFor(text)).toEqual({ type: SessionEventType.select, partId });
  });

  it('ignores accents in what was said', () => {
    expect(eventFor('show me the bättery')).toEqual({
      type: SessionEventType.select,
      partId: 'battery',
    });
  });

  it.each([
    'show me the flux capacitor',
    'show me',
    'where is',
    'what does this do',
    'how much coolant should there be',
    'what is the next step after this one',
    'next please tell me about the battery',
    'the',
    '',
    '   ',
    '!!!',
  ])('sends "%s" on to the instructor', text => {
    expect(routeCommand(text, pack)).toEqual({ kind: RouteKind.notCommand });
  });
});

describe('normalize', () => {
  it('lower-cases, strips punctuation and filler, collapses spaces', () => {
    expect(normalize('  Please, SHOW me   the  Battery!! ')).toBe(
      'show me battery',
    );
  });
});
