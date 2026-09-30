import { Pack, Part, Procedure } from '../domain/pack';
import { SessionEvent, SessionEventType } from '../domain/session';

export const RouteKind = {
  command: 'command',
  notCommand: 'notCommand',
} as const;
export type RouteKind = (typeof RouteKind)[keyof typeof RouteKind];

export type RouteResult =
  | { readonly kind: typeof RouteKind.command; readonly event: SessionEvent }
  | { readonly kind: typeof RouteKind.notCommand };

const NOT_A_COMMAND: RouteResult = { kind: RouteKind.notCommand };

// Dropped from utterances and from names before comparing.
const FILLER_WORDS: ReadonlySet<string> = new Set([
  'the',
  'a',
  'an',
  'please',
  'now',
  'just',
  'ok',
  'okay',
  'hey',
  'go',
  'to',
  'can',
  'you',
  'could',
  'that',
]);

// Phrases are already normalised: lower case, no punctuation, no filler words.
const SIMPLE_PHRASES = {
  [SessionEventType.next]: ['next', 'next step', 'continue'],
  [SessionEventType.back]: ['back', 'previous', 'previous step', 'last step'],
  [SessionEventType.repeat]: ['repeat', 'repeat step', 'again', 'say again'],
  [SessionEventType.end]: [
    'stop',
    'end',
    'quit',
    'stop procedure',
    'end procedure',
  ],
} as const;

const START_TRIGGERS = ['start', 'begin'];
const SHOW_TRIGGERS = [
  'show me',
  'show',
  'where is',
  'wheres',
  'where are',
  'find',
];

export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(word => word !== '' && !FILLER_WORDS.has(word))
    .join(' ');
}

function afterTrigger(
  phrase: string,
  triggers: readonly string[],
): string | null {
  for (const trigger of triggers) {
    if (phrase.startsWith(`${trigger} `)) {
      return phrase.slice(trigger.length + 1);
    }
  }
  return null;
}

function partKeys(part: Part): string[] {
  return [part.name, part.id, ...part.aliases].map(normalize);
}

function matchPart(target: string, pack: Pack): Part | undefined {
  return pack.parts.find(part => partKeys(part).includes(target));
}

// An exact title or id wins; otherwise a spoken prefix of a title
// ("check the coolant") may pick a procedure if it picks only one.
function matchProcedure(target: string, pack: Pack): Procedure | undefined {
  const keys = (procedure: Procedure) => [
    normalize(procedure.title),
    normalize(procedure.id),
  ];
  const exact = pack.procedures.find(p => keys(p).includes(target));
  if (exact) {
    return exact;
  }
  const prefixed = pack.procedures.filter(p =>
    keys(p).some(key => key.startsWith(`${target} `)),
  );
  return prefixed.length === 1 ? prefixed[0] : undefined;
}

function command(event: SessionEvent): RouteResult {
  return { kind: RouteKind.command, event };
}

export function routeCommand(text: string, pack: Pack): RouteResult {
  const phrase = normalize(text);
  if (phrase === '') {
    return NOT_A_COMMAND;
  }
  for (const [type, phrases] of Object.entries(SIMPLE_PHRASES)) {
    if ((phrases as readonly string[]).includes(phrase)) {
      return command({ type } as SessionEvent);
    }
  }
  const procedureTarget = afterTrigger(phrase, START_TRIGGERS);
  if (procedureTarget !== null) {
    const procedure = matchProcedure(procedureTarget, pack);
    return procedure
      ? command({ type: SessionEventType.start, procedureId: procedure.id })
      : NOT_A_COMMAND;
  }
  const partTarget = afterTrigger(phrase, SHOW_TRIGGERS);
  if (partTarget !== null) {
    const part = matchPart(partTarget, pack);
    return part
      ? command({ type: SessionEventType.select, partId: part.id })
      : NOT_A_COMMAND;
  }
  return NOT_A_COMMAND;
}
