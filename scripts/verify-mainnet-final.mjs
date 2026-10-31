// Final read-only verification. No wallets, env writes, deployment or signed/purchase requests.
import fs from "node:fs";
import {createPublicClient,http,erc20Abi,keccak256} from "viem";
const escrow="0xf294eCC15b52A5c7Ab7466885b8a033CB92C85c1";
const buyer="0x075FF540a0F8e9340a4813EF96C609Dc203A3041";
const gateway="0x499b7494b08163d867286b31fF25Fcd1038e03Ae";
const usdc="0x3600000000000000000000000000000000000000";
const c=createPublicClient({transport:http("https://rpc.mainnet.arc.io",{timeout:20000,retryCount:0})});
const artifact=JSON.parse(fs.readFileSync("out/StubEscrow.sol/StubEscrow.json","utf8"));
const chainId=await c.getChainId();if(chainId!==5042)throw new Error("Wrong chain");
const block=await c.getBlock();const settings={};
for(const functionName of ["owner","feeRecipient","usdc","feeBps","paused","totalLocked","serviceCount"])settings[functionName]=await c.readContract({address:escrow,abi:artifact.abi,functionName});
const service=await c.readContract({address:escrow,abi:artifact.abi,functionName:"services",args:[1n]});
const code=await c.getCode({address:escrow});let local=artifact.deployedBytecode.object.slice(2),actual=code?.slice(2);
for(const refs of Object.values(artifact.deployedBytecode.immutableReferences??{}))for(const {start,length} of refs){local=local.slice(0,start*2)+"0".repeat(length*2)+local.slice((start+length)*2);actual=actual?.slice(0,start*2)+"0".repeat(length*2)+actual?.slice((start+length)*2);}
const historical=JSON.parse(fs.readFileSync("docs/mainnet-phase-b-results.json","utf8"));
const purchases=[];for(const entry of historical.purchases)purchases.push({kind:entry.kind,purchaseId:entry.purchaseId,purchase:await c.readContract({address:escrow,abi:artifact.abi,functionName:"getPurchase",args:[entry.purchaseId]})});
const receipts=[];for(const t of historical.transactions){const r=await c.getTransactionReceipt({hash:t.hash});receipts.push({hash:t.hash,status:r.status,block:r.blockNumber,gasUsed:r.gasUsed,effectiveGasPrice:r.effectiveGasPrice});}
const phaseA=JSON.parse(fs.readFileSync("docs/mainnet-phase-a-refund.json","utf8"));
const timeoutStatus=await c.readContract({address:escrow,abi:artifact.abi,functionName:"statusOf",args:[phaseA.purchaseId]});
const explorer={addressUrl:`https://explorer.arc.io/address/${escrow}`,sourceUrl:`https://explorer.arc.io/address/${escrow}?tab=contract`};
for(const endpoint of [`/api/v2/addresses/${escrow}`,`/api/v2/smart-contracts/${escrow}`]){
 try{const r=await fetch("https://explorer.arc.io"+endpoint,{signal:AbortSignal.timeout(20000)});const b=await r.json().catch(()=>null);if(endpoint.includes("addresses")){explorer.addressHttpStatus=r.status;explorer.isVerified=b?.is_verified??null;}else{explorer.sourceHttpStatus=r.status;explorer.sourceAvailable=r.status===200?typeof b?.source_code==="string"&&b.source_code.length>0:null;explorer.compilerVersion=b?.compiler_version??null;}}
 catch{explorer.requestFailed=true;}
}
const anonymous={};for(const route of ["/","/api/health"]){const r=await fetch("https://stub-mainnet.vercel.app"+route,{redirect:"manual",signal:AbortSignal.timeout(20000)});anonymous[route]={status:r.status,contentType:r.headers.get("content-type")};}
const remainingAllowance=await c.readContract({address:usdc,abi:erc20Abi,functionName:"allowance",args:[buyer,escrow]});
const report={checkedAt:new Date().toISOString(),block:block.number,chainId,escrow,settings,serviceId:"1",service,remainingAllowance,runtimeBytecodeMatches:local===actual,codeHash:code?keccak256(code):null,configurationMatches:settings.owner.toLowerCase()===buyer.toLowerCase()&&settings.feeRecipient.toLowerCase()===buyer.toLowerCase()&&settings.usdc.toLowerCase()===usdc.toLowerCase()&&settings.feeBps===300&&!settings.paused&&service[0].toLowerCase()===buyer.toLowerCase()&&service[1].toLowerCase()===gateway.toLowerCase()&&service[2]===10000n&&service[3]===600&&service[4],purchases,phaseATimeoutStatus:timeoutStatus,phaseBReceiptRechecks:receipts,explorer,anonymousProduction:anonymous,transactionsSent:0,signaturesRequested:0};
const text=JSON.stringify(report,(_,v)=>typeof v==="bigint"?v.toString():v,2);fs.writeFileSync("docs/mainnet-final-verification.json",text+"\n");console.log(text);
