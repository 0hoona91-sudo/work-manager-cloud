// The production app runs in one JS realm. Node vm extraction does not: rebuild only
// plain data at the test transport boundary, retaining native SDK sentinels/references.
function sdkValue(value){
  if(Array.isArray(value))return value.map(sdkValue);
  if(value&&typeof value==='object'&&Object.getPrototypeOf(value)?.constructor?.name==='Object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,sdkValue(v)]));
  return value;
}
function writer(native){const out={};for(const method of ['set','update','delete'])out[method]=(...args)=>{native[method](args[0],...args.slice(1).map(sdkValue));return out;};if(native.get)out.get=ref=>native.get(ref);if(native.commit)out.commit=()=>native.commit();return out;}
function realmSdk(sdk){return {...sdk,runTransaction:(db,fn,...options)=>sdk.runTransaction(db,tx=>fn(writer(tx)),...options),writeBatch:db=>writer(sdk.writeBatch(db))};}
module.exports={sdkValue,realmSdk};
