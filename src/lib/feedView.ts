/**
 * Maps a FeedItem (from the event feed) to the display types used by EscrowTicket.
 */
import type { FeedItem } from "../../shared/feed";
import type { TicketPhase } from "../components/EscrowTicket";
import type { TicketData } from "../components/EscrowTicket";

export function phaseOf(item: FeedItem): TicketPhase {
  if (item.status === "Released") return "released";
  if (item.status === "Refunded") return "refunded";
  return "locked";
}

export function ticketOf(item: FeedItem): TicketData {
  return {
    purchaseId: item.purchaseId,
    payer: item.payer,
    inputHash: item.inputHash,
    resultHash: item.resultHash,
    amount: item.amount !== undefined ? BigInt(item.amount) : undefined,
    merchantAmount: item.merchantAmount !== undefined ? BigInt(item.merchantAmount) : undefined,
    feeAmount: item.feeAmount !== undefined ? BigInt(item.feeAmount) : undefined,
    deadline: item.deadline !== undefined ? BigInt(item.deadline) : undefined,
  };
}
