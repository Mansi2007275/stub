import fs from "node:fs";
import {describe,it,expect,vi} from "vitest";
import {acceptanceGateway} from "../scripts/acceptance/gateway-guard.mjs";
// Historical cap rehearsal only: mocked wallets, never current spending authority.
const manifest={...JSON.parse(fs.readFileSync("docs/mainnet-acceptance-manifest.json","utf8")),phaseBApproved:true};
const failure=manifest.purchases.find((p:{kind:string})=>p.kind==="early_refund");
function setup(){
 const data=new Map<string,string>();
 const store={get:async(k:string)=>data.get(k)??null,set:async(k:string,v:string,o?:{nx?:boolean})=>{if(o?.nx&&data.has(k))return false;data.set(k,v);return true;}};
 const wallet={account:{address:manifest.gateway},chain:{id:5042},writeContract:vi.fn(async(_request: unknown)=>"0x"+"1".repeat(64))};
 const client={readContract:vi.fn(async()=>({status:1,amount:10000n,fulfiller:manifest.gateway,payer:manifest.buyer,deadline:600n})),getBlock:async()=>({timestamp:1n,baseFeePerGas:20000000000n}),getTransactionCount:async()=>1,estimateContractGas:vi.fn(async()=>80829n)};
 const request={address:manifest.escrow,functionName:"refundEarly",args:[failure.purchaseId]};
 return {data,store,wallet,client,request};
}
describe("private gateway durable send guards",()=>{
 it("records a submitted hash and rejects duplicate writes across runtime instances",async()=>{
  const s=setup();await acceptanceGateway(s.wallet,s.store,s.client,manifest,[]).writeContract(s.request);
  expect(JSON.parse(s.data.get("send:refundEarly")!).hash).toMatch(/^0x1/);
  await expect(acceptanceGateway(s.wallet,s.store,s.client,manifest,[]).writeContract(s.request)).rejects.toThrow("already_reserved");
  expect(s.wallet.writeContract).toHaveBeenCalledTimes(1);
 });
 it("retains durable reservation after an ambiguous send without resending",async()=>{
  const s=setup();s.wallet.writeContract.mockRejectedValue(new Error("unknown_send"));
  await expect(acceptanceGateway(s.wallet,s.store,s.client,manifest,[]).writeContract(s.request)).rejects.toThrow("unknown_send");
  await expect(acceptanceGateway(s.wallet,s.store,s.client,manifest,[]).writeContract(s.request)).rejects.toThrow("already_reserved");
  expect(s.wallet.writeContract).toHaveBeenCalledTimes(1);
 });
 it("rejects over-cap estimates before reserving or sending",async()=>{
  const s=setup();s.client.estimateContractGas.mockResolvedValue(100001n);
  await expect(acceptanceGateway(s.wallet,s.store,s.client,manifest,[]).writeContract(s.request)).rejects.toThrow("gas_cap_exceeded");
  expect(s.data.size).toBe(0);expect(s.wallet.writeContract).not.toHaveBeenCalled();
 });
});
