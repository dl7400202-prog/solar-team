const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const fixture=require('./fixtures/tube-catalogue.cjs');
const load=name=>import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(path.join(__dirname,'..',name),'utf8')).toString('base64'));
const plan=(rowNumber=10,field='North',rowType='#1',panelCount=100)=>({id:field+':'+rowNumber,field,rowNumber,rowType,panelCount});
test('source tubes and couplers preserve order, extreme distances and outward bearing numbering',async()=>{
  const {createTubePlans}=await load('tube-plans.js'),data=fixture(),before=structuredClone(data),f=createTubePlans(data),r=f.get(plan());
  assert.equal(r.available,true);assert.deepEqual(r.tubes.map(t=>t.part),['TEST-N','TEST-GCS','TEST-S']);assert.equal(r.joins.length,2);
  assert.equal(r.northOverhangMm,2230);assert.equal(r.southOverhangMm,2160);assert.deepEqual(r.drive,{tube:2,fromNorthMm:6000});
  assert.deepEqual(r.bearings.filter(b=>b.kind==='fixed').map(b=>b.code).sort(),['N1','N2','S1','S2']);
  assert.equal(r.bearings.find(b=>b.code==='N1').tube,2);assert.equal(r.bearings.find(b=>b.code==='S1').tube,2);
  assert.equal((f.render(plan()).match(/data-tube-joint=/g)||[]).length,2);
  assert.match(f.render(plan(),'ends',{locale:'ru'}),/2,23/);assert.match(f.render(plan(),'ends',{locale:'ru'}),/2,16/);assert.deepEqual(data,before);
});
test('short configurations use their own fixed bearing count and exclude GCS from end measurements',async()=>{
  const {createTubePlans}=await load('tube-plans.js'),r=createTubePlans(fixture()).get(plan(30,'North','#20',25));
  assert.equal(r.northOverhangMm,1790);assert.equal(r.southOverhangMm,520);assert.equal(r.tubes.length,1);assert.equal(r.joins.length,0);
  assert.deepEqual(r.bearings.filter(b=>b.kind==='fixed').map(b=>b.code),['S1']);assert.equal(r.bearings.length,3);
});
test('scope, conflicts, malformed templates and asynchronous catalogue replacement fail closed',async()=>{
  const {createTubePlans}=await load('tube-plans.js');let data=null;const f=createTubePlans(()=>data);
  assert.equal(f.get(plan()).available,false);data=fixture();assert.equal(f.get(plan()).available,true);
  assert.equal(f.get(plan(10,'South')).reason,'scope');assert.equal(f.get(plan(9999)).reason,'unknown-row');
  assert.equal(f.get(plan(10,'North','#4N')).reason,'row-type');assert.equal(f.get(plan(10,'North','#1',75)).reason,'panel-count');assert.equal(f.get(plan(10,'North','1')).available,true);
  data=fixture();data.templates['1'].tubes[0].bearings=[];assert.equal(f.get(plan()).reason,'invalid-template');
  data=fixture();data.templates['1'].tubes[0].driveFromNorthMm=100;assert.equal(f.get(plan()).reason,'invalid-template');data=fixture();assert.equal(f.get(plan()).available,true);
});
test('viewer opens tubes from Work, preserves the view across rows and leaves shared records unchanged',async()=>{
  const {createTubePlans}=await load('tube-plans.js'),{createRowPlansFeature}=await load('row-plans.js');
  const rows=[plan(),plan(11),plan(20,'Mid'),plan(50,'South')].map(p=>({...p,panelGroups:[],dampers:[],pallets:[],source:{},status:'needs_review',panelsKnown:true,dampersKnown:true,damperCount:4}));
  const db={fields:['North','Mid','South'],rowPlans:rows,panelTypes:[],tubeInstallation:fixture()},before=structuredClone(db),storage=new Map();let html='',screen='',feature;
  const api={getDb:()=>db,tubes:createTubePlans(()=>db.tubeInstallation),getLanguage:()=> 'ru',canEdit:()=>false,esc:String,header:title=>'<h1>'+title+'</h1>',btn:(label,action,cls,id)=>'<button data-action="'+action+'" data-id="'+(id||'')+'">'+label+'</button>',draw:s=>{html=s;},navigate:s=>{screen=s;feature.render(s);},storage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},markDirty:()=>assert.fail('viewing marked data dirty'),change:()=>assert.fail('viewing attempted a write')};
  feature=createRowPlansFeature(api);await feature.handleAction('plan-hub');await feature.handleAction('plan-work-mode','tubes');assert.doesNotMatch(html,/value="South"|data-id="South:50"/);assert.match(html,/Couplers/);
  await feature.handleAction('plan-row','North:10');assert.equal(screen,'rowPlan');assert.match(html,/data-tube-joint="2"/);assert.doesNotMatch(html,/Needs review|Edit installation plan|Motor: after panel/);
  await feature.handleAction('plan-tube-view','ends');assert.match(html,/2,23/);assert.match(html,/2,16/);await feature.handleAction('plan-browse-next');assert.match(html,/Row 11/);assert.match(html,/2,23/);assert.doesNotMatch(html,/data-tube-index=/);
  await feature.handleAction('plan-browse-next');assert.match(html,/Row 11/);await feature.handleAction('plan-fullscreen');assert.match(html,/plan-work-fullscreen/);await feature.handleAction('plan-fullscreen');
  await feature.handleAction('plan-section','panels');assert.match(html,/plan-diagram/);await feature.handleAction('plan-section','tubes');assert.match(html,/Extreme bearings/);assert.deepEqual(db,before);assert.equal(storage.get('solar-team-work-mode-v1'),'tubes');
});
