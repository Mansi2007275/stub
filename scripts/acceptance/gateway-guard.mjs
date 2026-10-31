import {acceptanceWallet} from "./transaction-caps.mjs";
export function acceptanceGateway(wallet, store, client, manifest, abi) {
 return acceptanceWallet(wallet,"gateway",manifest,{
  preflight:async(request,operation)=>{
   const p=await client.readContract({address:manifest.escrow,abi,functionName:"getPurchase",args:[request.args[0]]});
   const block=await client.getBlock();
   if(p.status!==1||p.amount!==10000n||p.fulfiller.toLowerCase()!==manifest.gateway.toLowerCase()||p.payer.toLowerCase()!==manifest.buyer.toLowerCase()||block.timestamp>=p.deadline)throw new Error("acceptance_settlement_not_eligible");
   if(block.baseFeePerGas+1000000000n>35000000000n)throw new Error("acceptance_fee_cap_insufficient");
   const latest=await client.getTransactionCount({address:manifest.gateway});
   const pending=await client.getTransactionCount({address:manifest.gateway,blockTag:"pending"});
   if(latest!==request.nonce||pending!==request.nonce)throw new Error("acceptance_gateway_nonce_drift");
   const estimate=await client.estimateContractGas({...request,account:wallet.account});
   if(estimate>request.gas)throw new Error("acceptance_gateway_gas_cap_exceeded");
   if(operation==="fulfill"){
    const prior=JSON.parse(await store.get("send:refundEarly")??"null");
    if(!prior?.hash)throw new Error("acceptance_failure_test_not_completed");
    const failure=manifest.purchases.find(p=>p.kind==="early_refund");
    if(await client.readContract({address:manifest.escrow,abi,functionName:"statusOf",args:[failure.purchaseId]})!==3)throw new Error("acceptance_failure_test_not_refunded");
   }
  },
  reserve:async(request,operation)=>{
   if(!await store.set(`send:${operation}`,JSON.stringify({outcome:"reserved_unknown",nonce:request.nonce,purchaseId:request.args[0]}),{nx:true}))throw new Error("acceptance_gateway_operation_already_reserved");
  },
  record:async(hash,request,operation)=>{
   console.log(JSON.stringify({acceptanceTransaction:hash,operation,purchaseId:request.args[0],nonce:request.nonce}));
   await store.set(`send:${operation}`,JSON.stringify({outcome:"submitted",hash,nonce:request.nonce,purchaseId:request.args[0]}));
  }
 });
}
