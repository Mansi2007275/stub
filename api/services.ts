import { getChain } from "../lib/server/chain";
import { handler, jsonSafe } from "../lib/server/http";

/** GET /api/services — every registered service, read straight from the escrow contract. */
export default handler(["GET"], async (_req, res) => {
  const { client, escrow, abi } = getChain();
  const count = await client.readContract({ address: escrow, abi, functionName: "serviceCount" });
  const ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i + 1));

  const rows = await Promise.all(
    ids.map(async (id) => {
      const [merchant, fulfiller, price, timeout, active, metadataHash] = await client.readContract({
        address: escrow,
        abi,
        functionName: "services",
        args: [id],
      });
      return { id, merchant, fulfiller, price, priceUsdc: Number(price) / 1e6, timeout, active, metadataHash };
    }),
  );

  res.status(200).json(jsonSafe({ services: rows }));
});
