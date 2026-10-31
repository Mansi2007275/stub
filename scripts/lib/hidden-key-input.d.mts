import type { Readable, Writable } from "node:stream";
type HiddenInput = Readable & { isTTY?: boolean; isRaw?: boolean; setRawMode?: (raw: boolean) => unknown };
type HiddenOutput = Writable & { isTTY?: boolean };
export function readHiddenKey(input?: HiddenInput, output?: HiddenOutput): Promise<string | null>;
export function readHiddenKeyResult(input?: HiddenInput, output?: HiddenOutput): Promise<{ value: string | null; failureCategory: string | null }>;
