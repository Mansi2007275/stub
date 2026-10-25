import { z } from "zod";
import { encodePacked, isAddress, keccak256, toHex, type Address, type PublicClient } from "viem";
import { randomBytes } from "node:crypto";
import { escrowAbi } from "./escrowAbi.js";

export const QuoteBody = z.object({
  serviceId: z.coerce.bigint().positive(),
  buyer: z.string().refine(isAddress),
});

export type Quote = {
  purchaseId: `0x${string}`;
  serviceId: string;
  price: string;
  maxAmount: string;
  timeoutSeconds: number;
  escrow: Address;
  chainId: number;
};

/** Fresh single-use purchaseId + current price. Nothing is stored: a purchase only exists once locked on-chain. */
export async function processQuote(
  client: PublicClient,
  escrow: Address,
  raw: unknown,
): Promise<{ status: number; body: Quote | { error: string } }> {
  const parsed = QuoteBody.safeParse(raw);
  if (!parsed.success) return { status: 400, body: { error: "invalid_body" } };
  const { serviceId, buyer } = parsed.data;

  const [merchant, , price, timeout, active] = await client.readContract({ address: escrow, abi: escrowAbi, functionName: "services", args: [serviceId] });
  if (merchant === "0x0000000000000000000000000000000000000000") return { status: 404, body: { error: "unknown_service" } };
  if (!active) return { status: 409, body: { error: "service_inactive" } };

  const nonce = toHex(randomBytes(32));
  const purchaseId = keccak256(encodePacked(["address", "uint256", "bytes32"], [buyer as Address, serviceId, nonce]));
  return {
    status: 200,
    body: {
      purchaseId,
      serviceId: serviceId.toString(),
      price: price.toString(),
      maxAmount: price.toString(),
      timeoutSeconds: timeout,
      escrow,
      chainId: await client.getChainId(),
    },
  };
}
