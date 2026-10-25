import { isHex, size } from "viem";
import { getChain, STATUS } from "../../lib/server/chain.js";
import { handler, jsonSafe } from "../../lib/server/http.js";

/**
 * GET /api/purchase/:id — public on-chain status, so a buyer whose response was lost can see
 * what happened before doing anything else. The result itself is only returned by POST /api/call
 * with the payer's signature, so it is never exposed to strangers.
 */
export default handler(["GET"], async (req, res) => {
  const id = String(req.query.id ?? "");
  if (!isHex(id) || size(id) !== 32) return res.status(400).json({ error: "invalid_purchase_id" });

  const { client, escrow, abi } = getChain();
  const p = await client.readContract({ address: escrow, abi, functionName: "getPurchase", args: [id] });

  res.status(200).json(
    jsonSafe({
      purchaseId: id,
      status: STATUS[p.status],
      amount: p.amount,
      payer: p.payer,
      buyer: p.buyer,
      merchant: p.merchant,
      serviceId: p.serviceId,
      deadline: p.deadline,
      resultHash: p.status === 2 ? p.resultHash : null,
      next:
        p.status === 1
          ? "Locked: retry POST /api/call with the same purchaseId and input. Do not pay again."
          : p.status === 2
            ? "Released: POST /api/call again with your signature to re-download the result."
            : p.status === 3
              ? "Refunded."
              : "No purchase with this id.",
    }),
  );
});
