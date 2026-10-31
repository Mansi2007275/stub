import { Redis } from "@upstash/redis";

/** Minimal KV contract the gateway needs. Upstash in production, in-memory in tests. */
export interface Store {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts?: { nx?: boolean; ex?: number }): Promise<boolean>;
  del(key: string): Promise<void>;
  incr(key: string, ttlSeconds: number): Promise<number>;
}

export function upstashStore(url: string, token: string): Store {
  const r = new Redis({ url, token, automaticDeserialization: false, signal: () => AbortSignal.timeout(2_000), retry: { retries: 0 } });
  return {
    get: async (k) => ((await r.get<string>(k)) as string | null) ?? null,
    set: async (k, v, o) => {
      const res = o?.nx ? await r.set(k, v, o.ex ? { nx: true, ex: o.ex } : { nx: true }) : await r.set(k, v, o?.ex ? { ex: o.ex } : undefined);
      return res === "OK";
    },
    del: async (k) => {
      await r.del(k);
    },
    incr: async (k, ttl) => {
      const n = await r.incr(k);
      if (n === 1) await r.expire(k, ttl);
      return n;
    },
  };
}

export function memoryStore(): Store {
  const m = new Map<string, { v: string; exp?: number }>();
  const live = (k: string) => {
    const e = m.get(k);
    if (e?.exp && e.exp < Date.now()) m.delete(k);
    return m.get(k);
  };
  return {
    get: async (k) => live(k)?.v ?? null,
    set: async (k, v, o) => {
      if (o?.nx && live(k)) return false;
      m.set(k, { v, exp: o?.ex ? Date.now() + o.ex * 1000 : undefined });
      return true;
    },
    del: async (k) => {
      m.delete(k);
    },
    incr: async (k, ttl) => {
      const e = live(k);
      const n = (e ? Number(e.v) : 0) + 1;
      m.set(k, { v: String(n), exp: e?.exp ?? Date.now() + ttl * 1000 });
      return n;
    },
  };
}

export const keys = {
  result: (id: string) => `stub:result:${id}`,
  lock: (id: string) => `stub:lock:${id}`,
  failed: (id: string) => `stub:failed:${id}`,
  settlement: (id: string) => `stub:settlement:${id}`,
  rate: (ip: string) => `stub:rate:${ip}`,
};
