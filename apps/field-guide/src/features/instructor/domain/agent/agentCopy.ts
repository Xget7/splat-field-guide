export const AgentOpening = {
  resumed: 'Back online.',
  exploration: (title: string) =>
    `What would you like to check on the ${title}?`,
  step: (title: string, number: number, text: string) =>
    `${title}. Step ${number}: ${text}`,
} as const;

export const AgentToolCopy = {
  unknown: 'That tool is unknown.',
  part: 'That part is not in this guide.',
  procedure: 'That procedure is not in this guide.',
  step: 'That step number is outside the open procedure.',
  closed: 'Open a procedure before changing its step.',
  parameters: 'Tool parameters must be an object.',
  failed: 'The guide could not apply that tool.',
  noProcedure: 'No guided check is open.',
  shownPart: (name: string) => `Showing the ${name}.`,
  shownStep: (number: number, total: number, title: string, text: string) =>
    `Step ${number} of ${total} in ${title}: ${text}`,
} as const;

export const AgentContextCopy = {
  screen: (sentence: string) => `The screen now shows: ${sentence}`,
  exchange: (question: string, reply: string) =>
    `Earlier question: ${question}\nEarlier answer: ${reply}`,
} as const;
