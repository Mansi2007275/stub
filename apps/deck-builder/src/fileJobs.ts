import type { Job, JobStore } from "./deck";

export async function fileJobs(path: string): Promise<JobStore> {
  const fs = await import("node:fs/promises");
  const read = async (): Promise<Record<string, Job>> => {
    try {
      return JSON.parse(await fs.readFile(path, "utf8")) as Record<string, Job>;
    } catch {
      return {};
    }
  };
  return {
    get: async (id) => (await read())[id] ?? null,
    put: async (job) => {
      const d = await read();
      d[job.id] = job;
      await fs.writeFile(`${path}.tmp`, JSON.stringify(d, null, 2));
      await fs.rename(`${path}.tmp`, path);
    },
  };
}
