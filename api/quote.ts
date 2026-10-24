import { getChain } from "../lib/server/chain";
import { handler } from "../lib/server/http";
import { processQuote } from "../lib/server/quoteCore";

/** POST /api/quote { serviceId, buyer } → fresh purchaseId + current price. */
export default handler(["POST"], async (req, res) => {
  const { client, escrow } = getChain();
  const out = await processQuote(client, escrow, req.body);
  res.status(out.status).json(out.body);
});
