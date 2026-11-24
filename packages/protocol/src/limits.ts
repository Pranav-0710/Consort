// Size and shape bounds for commands (rule H10, stress H04).
//
// PROVISIONAL. These values are placeholders chosen to be generous for the hackathon slice.
// #58 measures real usage and #69 sets the launch values. Do not treat them as capacity claims.

/** True while the values below are placeholders. #69 flips it when real limits are set. */
export const LIMITS_ARE_PROVISIONAL = true;

export const LIMITS = {
  /** Whole command, as UTF-8 JSON. */
  commandBytes: 64 * 1024,
  /** The payload alone, as UTF-8 canonical JSON. */
  payloadBytes: 48 * 1024,
  /** Containers (objects and arrays) nested inside the command, counting the command itself. */
  maxDepth: 12,
  /** Every value in the command: objects, arrays and primitives. */
  maxNodes: 5000,

  /** Titles, labels, check names. */
  shortTextChars: 200,
  /** Reasons for a decision, blockers, concerns. */
  reasonChars: 2000,
  /** Question, answer, discussion and proposal bodies. */
  textChars: 8000,

  /** Requirements, criteria, references and other lists. */
  listItems: 50,
  /** Steps in one published plan. */
  planSteps: 100,
  /** Text of one plan step. */
  planStepChars: 1000,
  /** Shared-contract versions named in one command. */
  contractPins: 20,
} as const;
