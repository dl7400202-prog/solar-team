const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const moduleUrl = 'data:text/javascript;base64,'+Buffer.from(fs.readFileSync(path.join(__dirname,'../row-plans.js'),'utf8')).toString('base64');
const load = () => import(moduleUrl);
const yellow={id:'yellow',name:'Yellow',color:'#f3cf35',description:'LR8-66HYD-650M',currentClass:'H',configured:true};
const panelTypes=[yellow,...Array.from({length:6},(_,i)=>({id:'type-'+(i+2),name:'Type '+(i+2),color:null,description:'',currentClass:'',configured:false}))];
const plan = (overrides={}) => ({id:'South-901',field:'South',rowNumber:901,rowType:'A',panelTypeId:'yellow',panelCount:100,panelsKnown:true,panelGroups:[{quantity:25,positiveSide:'N',typeId:'yellow',sourceToken:'650H'},{quantity:25,positiveSide:'N',typeId:'yellow',sourceToken:'650H'},{quantity:25,positiveSide:'S',typeId:'yellow',sourceToken:'650H'},{quantity:25,positiveSide:'S',typeId:'yellow',sourceToken:'650H'}],dampersKnown:true,damperCount:4,dampers:[{post:2,side:'E'},{post:4,side:'W'},{post:12,side:'E'},{post:13,side:'W'}],slope:0.01,lowerBearingSide:null,motorAfterPanel:null,pallets:[],status:'verified',notes:'',source:{panels:'Photo 1',dampers:'Photo 2'},revision:3,...overrides});
function harness(create, rows=[plan()]) {
  const db={fields:['North','South'],panelTypes:structuredClone(panelTypes),rowPlans:structuredClone(rows)};
  const events=[], state={html:'',screen:'',feedback:''};let feature;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const api={getDb:()=>db,esc,header:(title)=>'<h1>'+esc(title)+'</h1>',draw:html=>{state.html=html},btn:(label,action,cls='secondary',id='')=>'<button data-action="'+action+'" data-id="'+esc(id)+'">'+label+'</button>',feedback:msg=>{state.feedback=msg},toast:msg=>events.push({toast:msg}),navigate:(screen)=>{state.screen=screen;feature.render(screen)},markDirty:()=>events.push({dirty:true}),confirm:()=>true,newId:()=> 'new-plan',change:async(kind,item,expected)=>{events.push({kind,item:structuredClone(item),expected:structuredClone(expected)});if(kind==='row_plan_save'){const index=db.rowPlans.findIndex(p=>p.id===item.id);if(index<0)db.rowPlans.push({...item,revision:1});else db.rowPlans[index]={...item,revision:item.revision+1};}return true}};
  feature=create(api);return {feature,state,events,db,api};
}
function editForm(p) {
  const f=new FormData(), put=(key,value)=>{if(value!==null&&value!==undefined)f.set(key,String(value))};
  for(const key of ['field','rowNumber','rowType','panelTypeId','panelCount','damperCount','slope','lowerBearingSide','motorAfterPanel','status','notes'])put(key,p[key]);
  if(p.panelsKnown)put('panelsKnown','on');if(p.dampersKnown)put('dampersKnown','on');
  put('panelSource',p.source.panels);put('damperSource',p.source.dampers);
  p.panelGroups.forEach((g,i)=>{put('groupQuantity_'+i,g.quantity);put('groupSide_'+i,g.positiveSide);put('groupType_'+i,g.typeId);put('groupToken_'+i,g.sourceToken)});
  p.dampers.forEach((d,i)=>{put('damperPost_'+i,d.post);put('damperSide_'+i,d.side)});
  p.pallets.forEach((p,i)=>{put('palletPanels_'+i,p.panels);put('palletAfter_'+i,p.afterPanel);put('palletRow_'+i,p.adjacentRow)});
  return f;
}
test('known instructions validate group totals, post-side uniqueness and motor bounds',async()=>{
  const {validateRowPlan}=await load();
  assert.equal(validateRowPlan(plan(),['South'],panelTypes),'');
  assert.match(validateRowPlan(plan({panelCount:75}),['South'],panelTypes),/exceed/);
  assert.match(validateRowPlan(plan({panelCount:125}),['South'],panelTypes),/matching/);
  assert.match(validateRowPlan(plan({dampers:[{post:2,side:'E'},{post:2,side:'E'}]}),['South'],panelTypes),/twice/);
  assert.match(validateRowPlan(plan({motorAfterPanel:101}),['South'],panelTypes),/within/);
  assert.match(validateRowPlan(plan({rowNumber:1.5}),['South'],panelTypes),/whole row/);
});
test('unknown sections are null rather than zero; partial instructions have a distinct state',async()=>{
  const {validateRowPlan,createRowPlansFeature}=await load();
  const p=plan({panelCount:null,panelsKnown:false,panelGroups:[],status:'partial'});
  assert.equal(validateRowPlan(p,['South'],panelTypes),'');
  assert.match(validateRowPlan({...p,status:'verified'},['South'],panelTypes),/complete panel/);
  const h=harness(createRowPlansFeature,[p]);await h.feature.handleAction('plan-row',p.id);
  assert.match(h.state.html,/Awaiting information/);
  assert.doesNotMatch(h.state.html,/0 panels/);
});
test('ambiguous group direction stays reviewable and cannot become verified or partial',async()=>{
  const {validateRowPlan}=await load(),p=plan();p.panelGroups[3].positiveSide=null;p.status='needs_review';
  assert.equal(validateRowPlan(p,['South'],panelTypes),'');
  assert.match(validateRowPlan({...p,status:'verified'},['South'],panelTypes),/confirmed directions/);
  assert.match(validateRowPlan({...p,status:'partial'},['South'],panelTypes),/uncertain/);
});
test('Description + Current Class identifies a type independently of colour',async()=>{
  const {validatePanelType}=await load();
  assert.match(validatePanelType({...yellow,id:'type-2',name:'Another',color:'#112233'},panelTypes),/already belongs/);
  assert.equal(validatePanelType({...yellow,id:'type-2',currentClass:'M'},panelTypes),'');
  assert.match(validatePanelType({...yellow,description:''},panelTypes),/needs colour/);
  assert.equal(validatePanelType(panelTypes[1],panelTypes),'');
});
test('schematic preserves North-to-South group order and does not invent motor or pallet locations',async()=>{
  const {createRowPlansFeature}=await load(),h=harness(createRowPlansFeature);
  await h.feature.handleAction('plan-row','South-901');await h.feature.handleAction('plan-tab','diagram');
  assert.match(h.state.html,/1–25/);assert.match(h.state.html,/26–50/);assert.match(h.state.html,/51–75/);assert.match(h.state.html,/76–100/);
  assert.match(h.state.html,/↑ \+ North/);assert.match(h.state.html,/↓ \+ South/);
  assert.match(h.state.html,/Motor position has not been supplied/);assert.doesNotMatch(h.state.html,/Motor after panel 46/);
  await h.feature.handleAction('plan-mode','dampers');assert.match(h.state.html,/Post numbers from north/);assert.match(h.state.html,/>13<\/text>/);
  await h.feature.handleAction('plan-mode','pallets');assert.match(h.state.html,/Pallet placement has not been supplied/);assert.doesNotMatch(h.state.html,/36 panels/);
  assert.equal(h.events.filter(e=>e.kind).length,0);
});
test('saving a constructor draft carries the original revision and source metadata without completion writes',async()=>{
  const {createRowPlansFeature}=await load(),h=harness(createRowPlansFeature),edited=plan({notes:'Check marking'});
  await h.feature.handleAction('plan-edit','South-901');await h.feature.handleForm('plan-save',editForm(edited));
  const write=h.events.find(e=>e.kind);assert.equal(write.kind,'row_plan_save');assert.deepEqual(write.expected,{revision:3});
  assert.deepEqual(write.item.panelGroups,edited.panelGroups);assert.deepEqual(write.item.source,edited.source);assert.equal(write.item.notes,'Check marking');
  assert.equal(h.state.screen,'rowPlan');assert.equal(h.events.some(e=>e.kind?.includes('team')),false);
});
test('JSON import previews before mutation and protects every reviewed revision',async()=>{
  const {createRowPlansFeature}=await load(),h=harness(createRowPlansFeature),p=plan({rowNumber:902,id:'South-902',revision:0});
  await h.feature.handleAction('plan-import');const form=new FormData();form.set('json',JSON.stringify({plans:[plan(),p]}));await h.feature.handleForm('plan-import-preview',form);
  assert.equal(h.events.filter(e=>e.kind).length,0);assert.match(h.state.html,/1 new · 1 updates/);
  await h.feature.handleAction('plan-import-apply');const write=h.events.find(e=>e.kind);assert.equal(write.kind,'row_plan_import');assert.deepEqual(write.expected,{revisions:{'South-901':3,'South-902':null}});
});
test('JSON import rejects duplicate identities and ID reuse across rows',async()=>{
  const {createRowPlansFeature}=await load(),h=harness(createRowPlansFeature);await h.feature.handleAction('plan-import');const f=new FormData();
  f.set('json',JSON.stringify([plan(),plan()]));await h.feature.handleForm('plan-import-preview',f);assert.match(h.state.feedback,/repeats/);
  f.set('json',JSON.stringify([plan({rowNumber:904})]));await h.feature.handleForm('plan-import-preview',f);assert.match(h.state.feedback,/different row/);
  await h.feature.handleAction('plan-import-apply');assert.equal(h.events.filter(e=>e.kind).length,0);
});
test('team context returns to the owning team; Settings type directory resets it',async()=>{
  const {createRowPlansFeature}=await load(),h=harness(createRowPlansFeature);h.feature.openTeam({id:'team-4',number:4,field:'South',work:'Solar panel installation',from:901});
  assert.deepEqual(h.feature.back('rowPlans'),{screen:'team',id:'team-4'});assert.equal(h.feature.navDestination('rowPlans'),'today');
  await h.feature.handleAction('plan-types','settings');assert.deepEqual(h.feature.back('panelTypes'),{screen:'settings',id:null});assert.equal(h.feature.navDestination('panelTypes'),'settings');
});
test('rendered labels escape source text and disregard unsafe colour strings',async()=>{
  const {createRowPlansFeature}=await load(),h=harness(createRowPlansFeature,[plan({notes:'<script>alert(1)</script>'})]);h.db.panelTypes[0].color='red;background:url(https://bad.example)';
  await h.feature.handleAction('plan-row','South-901');assert.match(h.state.html,/&lt;script&gt;/);assert.doesNotMatch(h.state.html,/<script>/);assert.doesNotMatch(h.state.html,/bad\.example/);
});
test('conflict reload resets the editor baseline to the latest revision and source',async()=>{
  const {createRowPlansFeature}=await load(),h=harness(createRowPlansFeature);
  await h.feature.handleAction('plan-edit','South-901');
  h.api.change=async(kind,item,expected)=>{h.events.push({kind,item:structuredClone(item),expected:structuredClone(expected)});return false};
  await h.feature.handleForm('plan-save',editForm(plan({notes:'Unsaved local draft'})));
  assert.deepEqual(h.events.find(e=>e.kind).expected,{revision:3});assert.equal(h.state.screen,'rowPlanEdit');
  const latest=plan({revision:7,notes:'Reviewed on another device',source:{panels:'Updated photo table',dampers:'Confirmed damper source'}});h.db.rowPlans=[latest];
  h.feature.reload('rowPlanEdit');h.feature.render('rowPlanEdit');
  assert.match(h.state.html,/Reviewed on another device/);assert.doesNotMatch(h.state.html,/Unsaved local draft/);
  await h.feature.handleForm('plan-save',editForm(latest));
  const write=h.events.filter(e=>e.kind).at(-1);assert.deepEqual(write.expected,{revision:7});assert.deepEqual(write.item.source,latest.source);
});
test('loading latest invalidates a stale import preview before apply',async()=>{
  const {createRowPlansFeature}=await load(),h=harness(createRowPlansFeature);await h.feature.handleAction('plan-import');const form=new FormData();form.set('json',JSON.stringify([plan()]));
  await h.feature.handleForm('plan-import-preview',form);h.feature.reload('rowPlanImport');h.feature.render('rowPlanImport');
  assert.doesNotMatch(h.state.html,/Apply reviewed import/);await h.feature.handleAction('plan-import-apply');assert.equal(h.events.filter(e=>e.kind).length,0);
  assert.match(h.state.html,/Photo 1/);
});
