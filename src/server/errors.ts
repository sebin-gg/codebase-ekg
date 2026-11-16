/** Bad patient details: reported to the client as fatal, never retried. */
export class InputError extends Error {}

export const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
