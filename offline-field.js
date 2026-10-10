/* Only explicitly downloaded field instructions are persisted. Never auth, HR or GPS. */
export const FIELD_BUILD='panel-instructions-20261010d';
const DB_NAME='solar-team-field',STORE='packages',KEY='park';
const pick=(value,keys)=>Object.fromEntries(keys.filter(k=>value?.[k]!==undefined).map(k=>[k,structuredClone(value[k])]));
const plansKeys=['id','field','notes','slope','source','status','dampers','pallets','rowType','revision','rowNumber','panelCount','damperCount','panelGroups','panelTypeId','panelsKnown','dampersKnown','motorAfterPanel','lowerBearingSide'];
const rowKeys=['rowNumber','field','pilePlanRow','panelCount','north','south','drive','motor','posts','groups'];
const imageryKeys=['path','bounds','crs','sha256','bytes','year','attribution','license','sourceUrl'];
function fieldData(db){return {fields:structuredClone(db.fields||[]),panelTypes:(db.panelTypes||[]).map(t=>pick(t,['id','name','color','configured','description','currentClass'])),rowPlans:(db.rowPlans||[]).map(p=>pick(p,plansKeys)),siteMap:{...pick(db.siteMap,['schemaVersion','crs','source']),...(db.siteMap?.offlineImagery?{offlineImagery:pick(db.siteMap.offlineImagery,imageryKeys)}:{}),rows:(db.siteMap?.rows||[]).map(r=>pick(r,rowKeys))}};}
function complete(data){
  if(!data||!Array.isArray(data.fields)||!Array.isArray(data.panelTypes)||!Array.isArray(data.rowPlans)||!data.rowPlans.length||!Array.isArray(data.siteMap?.rows)||!data.siteMap.rows.length||!['EPSG:25832','EPSG:32632'].includes(data.siteMap.crs))return false;
  const key=r=>r.field+'\0'+r.rowNumber,plans=new Set(data.rowPlans.map(key)),seen=new Set();
  return data.siteMap.rows.every(r=>{const k=key(r),ok=Number.isSafeInteger(r.rowNumber)&&typeof r.field==='string'&&plans.has(k)&&!seen.has(k)&&[r.north,r.south].every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite));seen.add(k);return ok;});
}
async function digestBytes(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');}
async function digest(data){return digestBytes(new TextEncoder().encode(JSON.stringify(data)));}
export function validParkImagery(meta){const b=meta?.bounds;return /^map-assets\/nagbol-ortho-\d{4}-[a-f0-9]{12}\.jpg$/.test(meta?.path||'')&&meta.crs==='EPSG:25832'&&/^[a-f0-9]{64}$/.test(meta.sha256||'')&&Number.isSafeInteger(meta.bytes)&&meta.bytes>0&&meta.bytes<=8*1048576&&Number.isSafeInteger(meta.year)&&meta.year>=2020&&meta.year<=2100&&meta.attribution==='© GeoDanmark'&&meta.license==='CC BY 4.0'&&b&&['minE','maxE','minN','maxN'].every(k=>Number.isFinite(b[k]))&&b.maxE>b.minE&&b.maxN>b.minN&&b.maxE-b.minE<=5000&&b.maxN-b.minN<=5000;}
async function validImageryBlob(meta,blob){return validParkImagery(meta)&&blob instanceof Blob&&blob.type==='image/jpeg'&&blob.size===meta.bytes&&await digestBytes(await blob.arrayBuffer())===meta.sha256;}
export function createParkImagery({fetch=globalThis.fetch,url=globalThis.URL}={}){
  let cached=null,pending=null,epoch=0;
  async function open(meta,localBlob,allowFetch=true){
    if(!validParkImagery(meta))throw Error('Aerial photo configuration is unavailable.');
    if(cached?.meta.sha256===meta.sha256)return cached;
    if(pending?.hash===meta.sha256)return pending.promise;
    const token=++epoch;
    const promise=(async()=>{let blob=localBlob;
      if(!blob){if(!allowFetch)throw Error('This device has no saved aerial photo. Connect and download the park.');const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),30000);try{const response=await fetch('./'+meta.path,{signal:controller.signal,cache:'no-store'});if(!response.ok)throw Error('Aerial photo download failed. Try again with a connection.');blob=await response.blob();}finally{clearTimeout(timeout);}}
      if(!await validImageryBlob(meta,blob))throw Error('Aerial photo download is incomplete. Retry with a connection.');
      if(token!==epoch)throw Error('Aerial photo download cancelled.');
      if(cached)url.revokeObjectURL(cached.url);cached={blob,meta:structuredClone(meta),url:url.createObjectURL(blob)};return cached;
    })();pending={hash:meta.sha256,promise};try{return await promise;}finally{if(pending?.promise===promise)pending=null;}
  }
  return {open,clear:()=>{epoch++;pending=null;if(cached)url.revokeObjectURL(cached.url);cached=null;}};
}
export async function buildFieldPackage(db,version,savedAt=Date.now(),image=null){
  const data=fieldData(db);if(!complete(data))throw Error('Incomplete row data or coordinate geometry. Connect and reload the park.');
  const meta=data.siteMap.offlineImagery;if(meta&&!await validImageryBlob(meta,image))throw Error('A complete aerial photo is required before saving the park.');
  return {key:KEY,schema:2,build:FIELD_BUILD,version,savedAt,bytes:new TextEncoder().encode(JSON.stringify(data)).length+(image?.size||0),data,image:meta?image:null,hash:await digest(data)};
}
export async function validFieldPackage(value){try{return value?.schema===2&&Number.isFinite(value.savedAt)&&Number.isSafeInteger(value.version)&&complete(value.data)&&value.hash===await digest(value.data)&&(!value.data.siteMap.offlineImagery||await validImageryBlob(value.data.siteMap.offlineImagery,value.image));}catch{return false;}}
export function fieldDataBytes(db){try{return new TextEncoder().encode(JSON.stringify(fieldData(db))).length+(db.siteMap?.offlineImagery?.bytes||0);}catch{return 0;}}
export function createFieldStore(indexedDB=globalThis.indexedDB){
  let opening;
  function open(){if(!indexedDB)return Promise.reject(Error('This browser cannot save an offline park.'));return opening||=(new Promise((resolve,reject)=>{const request=indexedDB.open(DB_NAME,1);request.onupgradeneeded=()=>request.result.createObjectStore(STORE,{keyPath:'key'});request.onerror=()=>{opening=null;reject(request.error)};request.onblocked=()=>{opening=null;reject(Error('Close other Solar Team tabs and try again.'))};request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();opening=null};resolve(db)}}));}
  async function transaction(mode,action){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,mode);let result;const request=action(tx.objectStore(STORE));request.onsuccess=()=>{result=request.result};tx.oncomplete=()=>resolve(result??null);tx.onerror=tx.onabort=()=>reject(tx.error||request.error||Error('Offline storage failed.'));});}
  return {get:()=>transaction('readonly',s=>s.get(KEY)),put:value=>transaction('readwrite',s=>s.put(value)),remove:()=>transaction('readwrite',s=>s.delete(KEY))};
}
export async function fieldShellStatus({navigator=globalThis.navigator,MessageChannel=globalThis.MessageChannel}={}){
  if(!navigator?.serviceWorker||!MessageChannel)return false;
  const registration=await navigator.serviceWorker.getRegistration('./');const worker=registration?.active;if(!worker)return false;
  return new Promise(resolve=>{const channel=new MessageChannel(),timeout=setTimeout(()=>{channel.port1.close();resolve(false)},5000);channel.port1.onmessage=event=>{clearTimeout(timeout);channel.port1.close();resolve(event.data?.build===FIELD_BUILD&&event.data.ready===true)};worker.postMessage({type:'FIELD_SHELL_STATUS'},[channel.port2]);});
}
async function prepareFieldShell(){
  if(!globalThis.navigator?.serviceWorker)throw Error('Offline download needs HTTPS and browser storage.');
  await navigator.serviceWorker.register('./service-worker.js');
  await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('App download timed out. Retry with a connection.')),15000))]);
  if(!await fieldShellStatus())throw Error('The app is still updating. Reload this page, then save the park again.');
  return true;
}
export function createOfflineField({store=createFieldStore(),prepareShell=prepareFieldShell,checkShell=fieldShellStatus,getImagery=async()=>null,onChange=()=>{}}={}){
  let available=false,saved=null,busy=false,error='',epoch=0;
  const state=()=>({available,saved:saved&&{version:saved.version,savedAt:saved.savedAt,bytes:saved.bytes,rows:saved.data.rowPlans.length},busy,error});
  const notify=()=>onChange(state());
  async function read(){try{const value=await store.get();available=await validFieldPackage(value)&&await checkShell();saved=available?value:null;return saved&&structuredClone(saved);}catch{available=false;saved=null;return null;}}
  async function save(db,version){
    if(busy)throw Error('A download is already running.');const token=++epoch;busy=true;error='';notify();
    try{const image=db.siteMap?.offlineImagery?await getImagery(db.siteMap.offlineImagery):null,next=await buildFieldPackage(db,version,Date.now(),image);await prepareShell();if(token!==epoch)throw Error('Download cancelled.');await store.put(next);saved=next;available=true;try{void globalThis.navigator?.storage?.persist?.().catch(()=>{});}catch{}return structuredClone(next);}
    catch(e){error=e?.name==='QuotaExceededError'?'Not enough storage. Free space and try again. Your previous download is kept.':e.message||'Download failed. Your previous download is kept.';throw e;}
    finally{busy=false;notify();}
  }
  async function remove(){epoch++;await store.remove();available=false;saved=null;error='';notify();}
  return {state,read,save,remove,cancel:()=>{epoch++},bytes:fieldDataBytes,image:()=>saved?.image||null};
}
