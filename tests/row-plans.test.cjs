const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const moduleUrl = 'data:text/javascript;base64,'+Buffer.from(fs.readFileSync(path.join(__dirname,'../row-plans.js'),'utf8')).toString('base64');
const load = () => import(moduleUrl);

test('map navigation exposes source IDs while leaving plans and viewer data unchanged',async()=>{
  const {createRowPlansFeature}=await load(),h=harness(createRowPlansFeature);let callbacks,selected,hides=0;
  h.db.siteMap={rows:[{rowNumber:901,field:'South',pilePlanRow:12,motor:{post:8,id:5008},posts:[{post:2,id:5002,side:'E'}],groups:[{first:1,last:25,id:'STRING-A',crossesDrive:false}]}]};
  h.api.createMap=api=>{callbacks=api;return {matches:(row,q)=>String(row.motor?.id)===q,html:()=>'<section class="site-map">Source map</section>',selectRow:row=>selected=row,hide:()=>hides++}};
  await h.feature.handleAction('plan-row','South-901');assert.match(h.state.html,/Pile ID 5002/);assert.match(h.state.html,/String ID STRING-A/);assert.doesNotMatch(h.state.html,/Inverter/);
  await h.feature.handleAction('plan-show-map','South-901');assert.match(h.state.html,/Source map/);assert.equal(selected.rowNumber,901);
  callbacks.openRow('South-901',true);assert.match(h.state.html,/Automatic pallet layout/);assert.ok(hides>0);
  h.feature.suspendIfHidden(null);assert.ok(hides>1);assert.equal(h.events.filter(e=>e.kind).length,0);
});
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

test('Rows hub limits the initial list, expands it and prioritizes an exact row number',async()=>{
  const {createRowPlansFeature}=await load();
  const rows=Array.from({length:75},(_,i)=>plan({id:'North-'+(100+i),field:'North',rowNumber:100+i}));
  rows.push(plan({id:'South-10',rowNumber:10}));
  const h=harness(createRowPlansFeature,rows),count=()=>(h.state.html.match(/class="card plan-row-card"/g)||[]).length;
  await h.feature.handleAction('plan-hub');assert.equal(count(),60);assert.equal(h.feature.navDestination('rowPlans'),'rows');assert.deepEqual(h.feature.back('rowPlans'),{screen:'today',id:null});
  await h.feature.handleAction('plan-more');assert.equal(count(),76);
  const search=new FormData();search.set('query','10');await h.feature.handleForm('plan-filter',search);
  assert.ok(h.state.html.indexOf('data-id="South-10"')<h.state.html.indexOf('data-id="North-100"'));
  await h.feature.handleAction('plan-reset');assert.equal(count(),60);assert.equal(h.events.filter(e=>e.kind).length,0);
});

test('row schemes open directly and preserve the paired pallet calculation',async()=>{
  const {createRowPlansFeature}=await load();
  const h=harness(createRowPlansFeature,[plan({motorAfterPanel:46}),plan({id:'South-902',rowNumber:902,panelCount:75,motorAfterPanel:21,panelGroups:plan().panelGroups.slice(0,3)})]);
  await h.feature.handleAction('plan-row','South-901');
  await h.feature.handleAction('plan-section','dampers');assert.match(h.state.html,/Post numbers from north/);
  await h.feature.handleAction('plan-section','pallets');assert.equal((h.state.html.match(/class="svg-auto-pallet"/g)||[]).length,5);
  await h.feature.handleAction('plan-section','instructions');assert.match(h.state.html,/Panel sequence/);assert.match(h.state.html,/Damper positions/);
  assert.equal(h.events.filter(e=>e.kind).length,0);
});
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
test('schematic preserves North-to-South order and waits for a second row before automatic pallets',async()=>{
  const {createRowPlansFeature}=await load(),h=harness(createRowPlansFeature);
  await h.feature.handleAction('plan-row','South-901');await h.feature.handleAction('plan-tab','diagram');
  assert.match(h.state.html,/1–25/);assert.match(h.state.html,/26–50/);assert.match(h.state.html,/51–75/);assert.match(h.state.html,/76–100/);
  assert.match(h.state.html,/↑ \+ North/);assert.match(h.state.html,/↓ \+ South/);
  assert.match(h.state.html,/Motor position has not been supplied/);assert.doesNotMatch(h.state.html,/Motor after panel 46/);
  await h.feature.handleAction('plan-mode','dampers');assert.match(h.state.html,/Post numbers from north/);assert.match(h.state.html,/>13<\/text>/);
  await h.feature.handleAction('plan-mode','pallets');assert.match(h.state.html,/Automatic pallet layout is awaiting row information/);assert.doesNotMatch(h.state.html,/36 panels/);
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

test('saved manual positions stay separate from the automatic forklift layout',async()=>{
  const {createRowPlansFeature}=await load(),p=plan({pallets:[{panels:36,afterPanel:75,adjacentRow:902},{panels:24,afterPanel:25,adjacentRow:902}]}),right=plan({id:'right',rowNumber:902}),h=harness(createRowPlansFeature,[p,right]);
  await h.feature.handleAction('plan-row',p.id);
  assert.match(h.state.html,/<section class="card plan-pallet-section"/);
  assert.match(h.state.html,/6 pallets/);
  assert.match(h.state.html,/100 \+ 100 = 200 panels/);
  await h.feature.handleAction('plan-pallets');
  assert.match(h.state.html,/Automatic pallet placement between rows 901 and 902/);
  assert.equal((h.state.html.match(/class="svg-auto-pallet"/g)||[]).length,6);
  assert.deepEqual(h.db.rowPlans[0].pallets,p.pallets);
  assert.equal(h.events.filter(e=>e.kind).length,0);
});
test('pallet instructions persist exact manually supplied positions and appear in a separate constructor card',async()=>{
  const {createRowPlansFeature}=await load(),p=plan({pallets:[{panels:36,afterPanel:25,adjacentRow:902}]}),h=harness(createRowPlansFeature,[p]);
  await h.feature.handleAction('plan-edit',p.id);
  assert.match(h.state.html,/<section class="card plan-pallet-constructor"/);
  await h.feature.handleForm('plan-save',editForm(p));
  const write=h.events.find(e=>e.kind);assert.deepEqual(write.item.pallets,p.pallets);
  assert.deepEqual(write.expected,{revision:3});assert.equal(h.events.some(e=>e.kind?.includes('team')),false);
});

test('automatic pair count uses 36 per pallet with no carryover',async()=>{
  const {automaticPalletLayout}=await load();
  const pair=(a,b)=>automaticPalletLayout(plan({panelCount:a}),plan({id:'right',rowNumber:902,panelCount:b}));
  for(const [left,right,count] of [[100,100,6],[75,75,5],[100,75,5],[50,50,3],[25,25,2],[36,36,2],[0,0,0],[100,0,3]]){
    const layout=pair(left,right);assert.equal(layout.error,'');assert.equal(layout.pallets.length,count);
    assert.equal(layout.totalPanels,left+right);assert.equal(layout.capacity,36);
    assert.ok(layout.pallets.every(p=>p.panels===36));
  }
  assert.equal(pair(100,100).pallets.length,6);assert.equal(pair(100,100).pallets.length,6);
});

test('unequal pallet rows align their motors and shift the shorter north end south',async()=>{
  const {createRowPlansFeature}=await load(),left=plan({motorAfterPanel:46}),right=plan({id:'right',rowNumber:902,panelCount:75,motorAfterPanel:21,panelGroups:[{quantity:75,positiveSide:'S',typeId:'yellow',sourceToken:''}]}),h=harness(createRowPlansFeature,[left,right]);
  await h.feature.handleAction('plan-row',left.id);await h.feature.handleAction('plan-pallets');
  const motors=[...h.state.html.matchAll(/<path d="M(?:41|253) ([\d.]+)H(?:107|319)" stroke="#ae3042"/g)].map(m=>Number(m[1]));
  assert.equal(motors.length,2);assert.equal(motors[0],motors[1],'Both motor marks must lie on one horizontal line');
  assert.equal(h.events.filter(e=>e.kind).length,0);
});

test('pallets use shifted row ordinals for destinations, types and positive direction',async()=>{
  const {automaticPalletLayout}=await load(),left=plan({motorAfterPanel:46}),right=plan({id:'right',rowNumber:902,panelCount:75,motorAfterPanel:21,panelGroups:[{quantity:25,positiveSide:'N',typeId:'yellow',sourceToken:''},{quantity:25,positiveSide:'N',typeId:'yellow',sourceToken:''},{quantity:25,positiveSide:'S',typeId:'yellow',sourceToken:''}]}),before=JSON.stringify([left,right]),layout=automaticPalletLayout(left,right);
  assert.equal(layout.alignment,'motor');assert.equal(layout.span,100);
  assert.deepEqual(layout.rows.map(r=>r.offset),[0,25]);assert.deepEqual(layout.rows.map(r=>r.end),[1,1]);
  assert.equal(layout.rows[0].motorPosition,layout.rows[1].motorPosition);
  assert.deepEqual(layout.pallets.map(p=>p.position),[.175,.3875,.5625,.7375,.9125]);
  assert.deepEqual(layout.pallets.map(p=>p.nearPanels.map(n=>n.panel)),[[18],[39,14],[57],[49],[92,67]]);
  assert.deepEqual(layout.pallets.map(p=>p.forRows),[[901],[901,902],[901],[902],[901,902]]);
  assert.deepEqual(layout.pallets.map(p=>p.labelSide),['left','left','right','left','right']);
  const differentType=structuredClone(right);differentType.panelGroups[0].typeId='type-2';
  const changed=automaticPalletLayout(left,differentType);assert.deepEqual(changed.pallets[1].forRows,[902]);assert.equal(changed.pallets[1].typeId,'type-2');
  assert.equal(JSON.stringify([left,right]),before);
});

test('motor alignment works in either row order and unknown motors leave offsets unconfirmed',async()=>{
  const {automaticPalletLayout}=await load(),left=plan({motorAfterPanel:46}),right=plan({id:'right',rowNumber:902,panelCount:75,motorAfterPanel:21});
  const forward=automaticPalletLayout(left,right),reverse=automaticPalletLayout(right,left);
  assert.deepEqual(reverse.rows.map(r=>r.offset),[25,0]);assert.deepEqual(reverse.pallets.map(p=>p.position),forward.pallets.map(p=>p.position));
  const equalCounts=automaticPalletLayout(left,plan({id:'right',rowNumber:902,motorAfterPanel:71}));
  assert.equal(equalCounts.span,125);assert.deepEqual(equalCounts.rows.map(r=>r.offset),[25,0]);assert.equal(equalCounts.rows[0].motorPosition,equalCounts.rows[1].motorPosition);
  for(const motorAfterPanel of [null,undefined,76,-1,1.5]){
    const unknown=automaticPalletLayout(left,{...right,motorAfterPanel});
    assert.equal(unknown.alignment,'north');assert.deepEqual(unknown.rows.map(r=>r.offset),[0,0]);assert.equal(unknown.pallets.length,5);
  }
});
test('automatic placement follows north to south and label left relative to plus',async()=>{
  const {automaticPalletLayout}=await load(),left=plan(),right=plan({id:'right',rowNumber:902}),before=JSON.stringify([left,right]),result=automaticPalletLayout(left,right);
  assert.equal(result.pallets.length,6);
  assert.deepEqual(result.pallets.map(p=>p.positiveSide),['N','N','N','S','S','S']);
  assert.deepEqual(result.pallets.map(p=>p.labelSide),['left','left','left','right','right','right']);
  assert.deepEqual(result.pallets.map(p=>p.nearPanel),[9,25,42,59,75,92]);
  assert.ok(result.pallets.every((p,i,a)=>p.position>0&&p.position<1&&(!i||p.position>a[i-1].position)));
  assert.equal(JSON.stringify([left,right]),before);
});
test('unknown counts, different fields and missing neighbours do not produce an automatic layout',async()=>{
  const {automaticPalletLayout}=await load();
  for(const right of [null,plan({id:'right',rowNumber:902,field:'North'}),plan(),plan({id:'right',rowNumber:902,panelCount:null}),plan({id:'right',rowNumber:902,panelCount:-1})]){
    const result=automaticPalletLayout(plan(),right);assert.ok(result.error);assert.equal(result.pallets.length,0);
  }
});
test('opposite row directions identify the destination and unknown plus never guesses a label',async()=>{
  const {automaticPalletLayout}=await load(),all=(side,typeId='yellow')=>[{quantity:100,positiveSide:side,typeId,sourceToken:''}];
  const p=plan({panelGroups:all('N')}),r=plan({id:'right',rowNumber:902,panelGroups:all('S','type-2')});
  const result=automaticPalletLayout(p,r);
  assert.deepEqual(result.pallets.map(x=>x.forRows),[[901],[902],[901],[902],[901],[902]]);
  assert.deepEqual(result.pallets.map(x=>x.labelSide),['left','right','left','right','left','right']);
  assert.deepEqual(result.pallets.map(x=>x.typeId),['yellow','type-2','yellow','type-2','yellow','type-2']);
  const unknown=automaticPalletLayout(plan({panelGroups:all(null)}),plan({id:'right',rowNumber:902,panelGroups:all(null)}));
  assert.ok(unknown.pallets.every(x=>x.positiveSide===null&&x.labelSide===null));
});
test('row cards automatically open a known pair and recalculate on right-row selection without writes',async()=>{
  const {createRowPlansFeature}=await load(),p=plan(),r=plan({id:'right',rowNumber:902}),short=plan({id:'short',rowNumber:903,panelCount:75,panelGroups:[{quantity:75,positiveSide:'N',typeId:'yellow',sourceToken:''}]}),h=harness(createRowPlansFeature,[p,r,short]);
  await h.feature.handleAction('plan-row',p.id);assert.match(h.state.html,/6 pallets/);assert.match(h.state.html,/100 \+ 100 = 200 panels/);
  await h.feature.handleAction('plan-pallets');assert.match(h.state.html,/Automatic pallet placement between rows 901 and 902/);
  assert.equal((h.state.html.match(/class="svg-auto-pallet"/g)||[]).length,6);
  const select={dataset:{palletNeighbor:''},value:'short'};
  h.feature.handleInput(select);assert.match(h.state.html,/5 pallets/);assert.match(h.state.html,/rows 901 and 903/);
  h.feature.handleInput({...select,value:''});assert.match(h.state.html,/Choose the row on your right/);assert.doesNotMatch(h.state.html,/class="svg-auto-pallet"/);
  assert.equal(h.events.filter(e=>e.kind).length,0);
});



test('viewer can filter rows and choose a pallet neighbour, but cannot open editors or submit changes',async()=>{
 const {createRowPlansFeature}=await load(),p=plan(),right=plan({id:'right',rowNumber:902}),h=harness(createRowPlansFeature,[p,right]);h.api.canEdit=()=>false;
 await h.feature.handleAction('plan-row',p.id);await h.feature.handleAction('plan-pallets');assert.match(h.state.html,/6 pallets/);
 await h.feature.handleAction('plan-edit',p.id);assert.match(h.state.feedback,/read-only/);assert.notEqual(h.state.screen,'rowPlanEdit');
 await h.feature.handleForm('plan-save',editForm(p));assert.equal(h.events.filter(e=>e.kind).length,0);
 await h.feature.handleAction('plan-types','settings');assert.equal((h.state.html.match(/class="card plan-type-card"/g)||[]).length,7);assert.doesNotMatch(h.state.html,/data-action="plan-type-edit"/);
});


