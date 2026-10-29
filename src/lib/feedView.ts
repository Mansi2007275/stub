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

/** `feeBps` is the live contract rate; pass it so a still-locked ticket can show the real
 * expected split instead of a dash. Nothing is assumed when it is absent. */
export function ticketOf(item: FeedItem, feeBps?: number): TicketData {
  return {
    feeBps,
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
