/**
 * Deck Builder — a separate consumer app that buys a pitch brief from Stub and turns it into a deck.
 * It plays the role ComputeQuest had in the original plan: Stub is its upstream supplier, paid in USDC
 * from a bounded agent budget. With USE_STUB=false it still works, generating straight from the idea.
 */
import { z } from "zod";
import type { Hex } from "viem";
import type { BuyResult, PitchBrief, StubClient } from "../../../packages/sdk/src/index";

export type Slide = { title: string; bullets: string[]; notes: string };
export type Deck = { title: string; slides: Slide[] };

export type JobStatus = "queued" | "buying_brief" | "generating" | "done" | "failed";
export type Job = {
  id: string;
  idea: string;
  status: JobStatus;
  useStub: boolean;
  createdAt: number;
  updatedAt: number;
  deck?: Deck;
  error?: string;
  /** Evidence of the upstream purchase. Only USDC on Arc — never mixed with any app-internal credits. */
  stub?: { purchaseId: Hex; lockTx?: Hex; fulfillTx?: Hex; resultHash: Hex; resumed: boolean; brief: PitchBrief };
};

export interface JobStore {
  get(id: string): Promise<Job | null>;
  put(job: Job): Promise<void>;
}

export function memoryJobs(): JobStore {
  const m = new Map<string, Job>();
  return { get: async (id) => (m.has(id) ? structuredClone(m.get(id)!) : null), put: async (j) => void m.set(j.id, structuredClone(j)) };
}

/** Turns (idea, optional purchased brief) into a deck. Injected so tests and offline runs need no AI key. */
export type DeckGenerator = (idea: string, brief: PitchBrief | null) => Promise<Deck>;

const DeckSchema = z.object({
  title: z.string().min(1).max(80),
  slides: z.array(z.object({ title: z.string().min(1).max(80), bullets: z.array(z.string().min(1).max(200)).min(1).max(6), notes: z.string().max(600) })).min(5).max(10),
});

/** Gemini deck generator. When a brief is supplied it is the primary source of truth for the deck. */
export function geminiDeck(apiKey: string, model: string, timeoutMs = 30_000): DeckGenerator {
  return async (idea, brief) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const context = brief
      ? `Use this analyst brief as the factual basis. Do not contradict it:\n${JSON.stringify(brief)}`
      : "No analyst brief is available. Work only from the idea and say where data is missing.";
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        signal: ctrl.signal,
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: `Write an 8-slide seed pitch deck as JSON {title, slides:[{title, bullets[], notes}]}. Plain language, no invented numbers.\n${context}` }],
          },
          contents: [{ role: "user", parts: [{ text: `<<<IDEA\n${idea}\nIDEA>>>` }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.5, maxOutputTokens: 3000 },
        }),
      });
      if (!res.ok) throw new Error(`deck_gemini_http_${res.status}`);
      const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      return DeckSchema.parse(JSON.parse(body.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}"));
    } finally {
      clearTimeout(t);
    }
  };
}

/** Deterministic, offline deck. Built directly from the brief when one was purchased. */
export const templateDeck: DeckGenerator = async (idea, brief) => {
  if (!brief) {
    return {
      title: idea.slice(0, 60),
      slides: [
        { title: "The idea", bullets: [idea], notes: "Generated without an analyst brief." },
        { title: "Problem", bullets: ["To be validated with customer interviews"], notes: "" },
        { title: "Solution", bullets: ["Describe the product in one sentence"], notes: "" },
        { title: "Customer", bullets: ["Who pays, and why now"], notes: "" },
        { title: "Next steps", bullets: ["Talk to 10 customers", "Size the market bottom-up"], notes: "" },
      ],
    };
  }
  return {
    title: brief.title,
    slides: [
      { title: brief.title, bullets: [brief.oneLiner], notes: "Title slide." },
      { title: "Problem", bullets: [brief.problem], notes: "" },
      { title: "Customer", bullets: [brief.customer], notes: "" },
      { title: "Solution", bullets: [brief.solution], notes: "" },
      { title: "Market", bullets: [brief.market], notes: "" },
      { title: "Business model", bullets: [brief.businessModel], notes: "" },
      { title: "Why we win", bullets: [brief.moat], notes: "" },
      { title: "Risks we're tackling", bullets: brief.risks, notes: "" },
      ...brief.slides.map((s) => ({ title: s.title, bullets: s.bullets, notes: "From the purchased Stub brief." })),
    ]
      .filter((s, i, all) => all.findIndex((o) => o.title.toLowerCase() === s.title.toLowerCase()) === i)
      .slice(0, 10),
  };
};

export type DeckBuilder = {
  /** Create or resume a job. Same jobId never buys twice and never regenerates a finished deck. */
  run(jobId: string, idea: string): Promise<Job>;
};

export function createDeckBuilder(cfg: {
  jobs: JobStore;
  generate: DeckGenerator;
  /** Feature flag. When false, Stub is never called and no USDC moves. */
  useStub: boolean;
  stub?: StubClient;
  serviceId?: bigint;
  /** Hard cap per brief, in USDC base units (6 decimals). Defaults to 0.10 USDC. */
  maxPrice?: bigint;
}): DeckBuilder {
  return {
    async run(jobId, idea) {
      const now = () => Date.now();
      let job = await cfg.jobs.get(jobId);
      if (job?.status === "done") return job;
      if (!job) job = { id: jobId, idea, status: "queued", useStub: cfg.useStub, createdAt: now(), updatedAt: now() };
      if (job.idea !== idea) throw new Error("job_idea_mismatch");

      try {
        let brief: PitchBrief | null = job.stub?.brief ?? null;
        if (job.useStub && !brief) {
          if (!cfg.stub) throw new Error("stub_not_configured");
          job.status = "buying_brief";
          job.updatedAt = now();
          await cfg.jobs.put(job);
          // The SDK persists the purchase before paying, so a retry of this job resumes, never re-pays.
          const bought: BuyResult = await cfg.stub.buy({ serviceId: cfg.serviceId ?? 1n, input: idea, maxPrice: cfg.maxPrice ?? 100_000n });
          brief = bought.result;
          job.stub = {
            purchaseId: bought.purchaseId,
            lockTx: bought.lockTx,
            fulfillTx: bought.fulfillTx,
            resultHash: bought.resultHash,
            resumed: bought.resumed,
            brief,
          };
          await cfg.jobs.put(job);
        }

        job.status = "generating";
        job.updatedAt = now();
        await cfg.jobs.put(job);
        job.deck = await cfg.generate(idea, brief);
        job.status = "done";
        job.error = undefined;
      } catch (e) {
        job.status = "failed";
        job.error = (e as { code?: string }).code ?? (e as Error).message;
      }
      job.updatedAt = now();
      await cfg.jobs.put(job);
      return job;
    },
  };
}

/** Standalone HTML rendering of a finished deck, with the purchase evidence on the last slide. */
export function renderDeckHtml(job: Job, explorer: string): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const slides = (job.deck?.slides ?? [])
    .map((s, i) => `<section><span class="n">${i + 1}</span><h2>${esc(s.title)}</h2><ul>${s.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul></section>`)
    .join("");
  const ev = job.stub
    ? `<section class="ev"><h2>Brief purchased on Arc</h2><dl>
        <dt>Purchase</dt><dd>${job.stub.purchaseId}</dd>
        ${job.stub.lockTx ? `<dt>Locked</dt><dd><a href="${explorer}/tx/${job.stub.lockTx}">${job.stub.lockTx}</a></dd>` : ""}
        ${job.stub.fulfillTx ? `<dt>Released</dt><dd><a href="${explorer}/tx/${job.stub.fulfillTx}">${job.stub.fulfillTx}</a></dd>` : ""}
        <dt>Result hash</dt><dd>${job.stub.resultHash}</dd></dl></section>`
    : `<section class="ev"><h2>Generated without Stub</h2><p>USE_STUB was off for this job.</p></section>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(job.deck?.title ?? "Deck")}</title>
<style>
body{margin:0;background:#e8ecef;color:#0e1a2b;font:16px/1.5 system-ui,sans-serif;padding:24px}
h1{max-width:960px;margin:0 auto 20px;font-size:28px;letter-spacing:-.02em}
section{position:relative;max-width:960px;margin:0 auto 18px;aspect-ratio:16/9;background:#f6f8f9;border:1.5px solid #0e1a2b;border-radius:14px;padding:40px 48px;box-sizing:border-box;overflow:hidden}
h2{font-size:34px;letter-spacing:-.03em;margin:0 0 18px}li{font-size:20px;margin:8px 0;max-width:60ch}
.n{position:absolute;right:20px;top:16px;color:#6b7a8d;font-size:13px}
.ev dl{display:grid;grid-template-columns:max-content 1fr;gap:8px 18px;font:13px ui-monospace,monospace;word-break:break-all}.ev dt{color:#6b7a8d}.ev a{color:#2775ca}
@media(max-width:700px){section{aspect-ratio:auto;padding:24px}h2{font-size:24px}li{font-size:16px}}
</style></head><body><h1>${esc(job.deck?.title ?? "")}</h1>${slides}${ev}</body></html>`;
}
