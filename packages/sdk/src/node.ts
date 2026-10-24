import type { Pending, PendingStore } from "./index";

/** Node-only crash-safe pending store backed by a JSON file. */
export async function filePending(path: string): Promise<PendingStore> {
  const fs = await import("node:fs/promises");
  const read = async (): Promise<Record<string, Pending>> => {
    try {
      return JSON.parse(await fs.readFile(path, "utf8")) as Record<string, Pending>;
    } catch {
      return {};
    }
  };
  const write = async (d: Record<string, Pending>) => {
    const tmp = `${path}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(d, null, 2));
    await fs.rename(tmp, path); // atomic replace
  };
  return {
    get: async (k) => (await read())[k] ?? null,
    set: async (k, v) => write({ ...(await read()), [k]: v }),
    delete: async (k) => {
      const d = await read();
      delete d[k];
      await write(d);
    },
  };
}
