import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.105.0';

const supabase = createClient('https://oimiygdkrnsjzlivwafs.supabase.co','sb_publishable_WKPV0lAUCl1Lr53UujCR3g_zlQay4DS');
const day = new Date().toISOString().slice(0,10);
const key = 'solar-team-online-v1';
const seed = {people:['Ivan Petrov','Alex Smith','Peter Ivanov','John Brown','Mark Wilson','Oleg Sidorov','Sergey Volkov','Denis Orlov','Artem Kozlov','Max Morozov','Andrey Lebedev','Viktor Smirnov','Nikolai Popov','Dmitry Antonov','Pavel Fedorov'].map((name,i)=>({id:'p'+(i+1),name,role:i===8?'Foreman':'Installer',availability:'ON_SITE',active:true})),fields:['North','South'],workTypes:['A','B','C'],teams:[{id:'t1',date:day,number:1,members:['p1','p2','p3'],field:'North',work:'A',from:120,to:155,done:36,status:'COMPLETED',note:'All good. No issues.',closed:true},{id:'t2',date:day,number:2,members:['p4','p5'],field:'South',work:'B',from:420,to:445,done:18,status:'IN_PROGRESS',note:'',closed:false},{id:'t3',date:day,number:3,members:['p6'],field:'North',work:'C',from:500,to:540,done:0,status:'NOT_STARTED',note:'',closed:false},{id:'h1',date:'2026-09-18',number:1,members:['p1','p4','p7','p8','p9','p10'],field:'South',work:'B',from:210,to:260,done:42,status:'PARTIALLY_COMPLETED',note:'Weather interruption',closed:true}]};
let db=structuredClone(seed),user=null,screen='today',selected=null,saving=false,ready=false,version=-1,accessMessage='',members=[];
function readLocal(){try{return normalise(JSON.parse(localStorage.getItem(key))||seed)}catch{return normalise(seed)}}
function normalise(data){const next={...seed,...(data||{})};next.people=Array.isArray(next.people)?next.people:seed.people;next.fields=Array.isArray(next.fields)?next.fields:seed.fields;next.workTypes=Array.isArray(next.workTypes)?next.workTypes:seed.workTypes;next.teams=Array.isArray(next.teams)?next.teams:seed.teams;next.people.forEach(p=>p.availability||(p.availability='ON_SITE'));return next}
function esc(v){return String(v||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function acceptRow(row){db=normalise(row.data);version=row.version;ready=true;accessMessage='';}
async function change(kind,item,expected={}){
  if(!ready||saving)return false;
  saving=true; const actor=user.id;
  try{
    const {data,error}=await supabase.rpc('solar_change',{kind,item,expected});
    if(error)throw error;
    if(user?.id!==actor)return false;
    acceptRow(data); return true;
  }catch(error){toast(error.code==='40001'?'A colleague changed this record. Copy your note, refresh and try again.':('Not saved: '+error.message));return false}
  finally{saving=false}
}
async function loadCloud(currentUser){
  user=currentUser;ready=false;accessMessage='Loading Solar Team…';render();
  try{
    const {data,error}=await supabase.from('solar_shared').select('*').eq('id',1).maybeSingle();
    if(error)throw error;
    if(!data){accessMessage='Access is by invitation. Ask a colleague to add '+user.email+' in Settings → Team access.';render();return}
    let row=data;
    if(!row.initialized){
      const result=await supabase.rpc('solar_change',{kind:'initialize',item:readLocal(),expected:{}});
      if(result.error)throw result.error;
      row=result.data;
    }
    acceptRow(row);render();
  }catch(error){accessMessage='Could not load Solar Team: '+error.message;render()}
}
async function refreshShared(){
  if(!user||!ready||saving||document.hidden)return;
  // Do not replace an active form or a person's pending change.
  if(!['today','people','history','settings'].includes(screen)||document.activeElement?.matches('input,textarea,select'))return;
  const actor=user.id;
  const {data,error}=await supabase.from('solar_shared').select('*').eq('id',1).maybeSingle();
  if(user?.id!==actor||saving||!['today','people','history','settings'].includes(screen))return;
  if(error){setSyncLabel('Connection lost — retrying');return}
  if(!data){ready=false;accessMessage='Access to Solar Team is not available.';db=structuredClone(seed);render();return}
  if(document.activeElement?.matches('input,textarea,select'))return;
  if(data.version>version){acceptRow(data);render()}
  setSyncLabel('Shared with your team · updated automatically');
}
function setSyncLabel(text){const label=document.getElementById('sync-status');if(label)label.textContent=text}
setInterval(refreshShared,5000);
window.addEventListener('focus',refreshShared);
window.addEventListener('online',refreshShared);
const labels={NOT_STARTED:'Not started',IN_PROGRESS:'In progress',COMPLETED:'Completed',PARTIALLY_COMPLETED:'Partially completed',PROBLEM:'Problem',NOT_COMPLETED:'Not completed'};
const $=s=>document.querySelector(s), planned=t=>t.to-t.from+1, percent=t=>Math.max(0,Math.min(100,Math.round(t.done/planned(t)*100))), person=id=>db.people.find(p=>p.id===id);
function statusClass(s){return {NOT_STARTED:'notstarted',IN_PROGRESS:'inprogress',COMPLETED:'completed',PARTIALLY_COMPLETED:'partial',PROBLEM:'problem',NOT_COMPLETED:'notcompleted'}[s]||'notstarted'}
function availabilityText(s){return s==='SICK'?'Sick':s==='OFF'?'Off':'On site'}
function availabilityClass(s){return s==='SICK'?'problem':s==='OFF'?'notstarted':'completed'}
function initials(p){return p.name.split(' ').map(x=>x[0]).join('').slice(0,2)}
function header(title,back){return '<header class="top">'+(back?'<button class="back" onclick="goToday()" aria-label="Back">‹</button>':'<div class="brand"><span>☀</span> SOLAR TEAM</div>')+'<div class="date">'+new Intl.DateTimeFormat('en',{weekday:'short',day:'numeric',month:'short'}).format(new Date(day+'T12:00:00'))+'</div></header>'+(title?'<h1>'+title+'</h1>':'')}
function nav(){return '<nav class="bottom"><button class="'+(screen==='today'?'active':'')+'" onclick="goToday()"><b>▣</b>Today</button><button class="'+(screen==='people'?'active':'')+'" onclick="goPeople()"><b>♙</b>People</button><button class="'+(screen==='history'?'active':'')+'" onclick="goHistory()"><b>◷</b>History</button><button class="'+(screen==='settings'?'active':'')+'" onclick="goSettings()"><b>⚙</b>Settings</button></nav>'}
function card(t){const people=t.members.map(person).filter(Boolean);return '<button class="card team-card" onclick="openTeam(\''+t.id+'\')"><div class="row"><h3>Team '+t.number+'</h3><span class="tag '+statusClass(t.status)+'">'+labels[t.status]+'</span></div><div class="members">'+people.slice(0,4).map(p=>'<span class="avatar">'+initials(p)+'</span>').join('')+'<span class="more">'+people.map(p=>esc(p.name.split(' ')[0])).join(' · ')+'</span></div><div class="facts"><span>⌖ '+esc(t.field)+'</span><span>⚒ Work '+esc(t.work)+'</span><span>☷ '+t.from+'–'+t.to+'</span></div><div class="progress-head">'+t.done+' / '+planned(t)+' rows <b style="float:right">'+percent(t)+'%</b></div><div class="bar '+(t.status==='COMPLETED'?'green':'')+'"><i style="width:'+percent(t)+'%"></i></div></button>'}
function auth(){return '<header class="top"><div class="brand"><span>☀</span> SOLAR TEAM</div><div class="date">Shared workspace</div></header><section class="card"><h1>Sign in to your team</h1><p class="sub">Sign in with your own account. Invited colleagues share all teams, people and progress with equal editing rights.</p><form onsubmit="login(event)"><label>Email<input name="email" type="email" required autocomplete="email" placeholder="you@example.com"></label><label>Password<input name="password" type="password" required minlength="6" autocomplete="current-password" placeholder="At least 6 characters"></label><button class="primary">Sign in</button></form><p class="sub" style="text-align:center;margin:14px 0 0">New here?</p><button class="secondary" onclick="signup()">Create account</button></section>'}
function draw(html){$('#app').innerHTML=html+'<p id="sync-status" class="sub" style="margin-top:16px">Shared with your team · updated automatically</p>'+nav()}
function render(){if(!user){$('#app').innerHTML=auth();return}if(!ready){$('#app').innerHTML=header('Solar Team')+'<div class="card"><p>'+esc(accessMessage)+'</p><button class="primary" onclick="retryAccess()">Check access</button><button class="secondary" onclick="logout()">Sign out</button></div>';return}if(screen==='today')drawToday();else if(screen==='people')drawPeople();else if(screen==='history')drawHistory();else if(screen==='settings')drawSettings();else if(screen==='form')drawForm();else if(screen==='team')drawTeam();else if(screen==='person')drawPerson()}
function drawToday(){const teams=db.teams.filter(t=>t.date===day),rows=teams.reduce((n,t)=>n+t.done,0),count=new Set(teams.flatMap(t=>t.members)).size;draw(header('')+'<p class="sub">Work smart. Build tomorrow.</p><div class="tabs"><button class="active">Today</button><button onclick="goPeople()">People</button><button onclick="goHistory()">History</button></div><h1>Today’s Teams</h1><p class="sub">'+teams.length+' teams · '+count+' people · '+rows+' rows</p><section class="team-list">'+(teams.map(card).join('')||'<div class="empty">No teams yet.</div>')+'</section><button class="primary" onclick="newTeam()">＋ New Team</button>')}
function drawForm(){const people=db.people.filter(p=>p.active&&p.availability==='ON_SITE');draw(header('Create Team',true)+'<form onsubmit="createTeam(event)"><h2>Select team members</h2><p class="sub">People marked Off or Sick are hidden.</p><div class="chips">'+people.map(p=>'<label class="chip"><input type="checkbox" name="member" value="'+p.id+'"> '+esc(p.name.split(' ')[0])+'</label>').join('')+'</div><h2>Work details</h2><label>Field<select name="field">'+db.fields.map(f=>'<option>'+esc(f)+'</option>').join('')+'</select></label><label>Work type<select name="work">'+db.workTypes.map(w=>'<option>'+esc(w)+'</option>').join('')+'</select></label><div class="grid2"><label>From<input name="from" type="number" required min="0"></label><label>To<input name="to" type="number" required min="0"></label></div><button class="primary">Save Team</button></form>')}
function drawTeam(){const t=db.teams.find(x=>x.id===selected);if(!t){goToday();return}draw(header('Team '+t.number,true)+'<p class="sub">'+t.members.length+' people</p><div class="card"><div class="facts"><span>⌖ '+esc(t.field)+'</span><span>⚒ Work '+esc(t.work)+'</span><span>☷ '+t.from+'–'+t.to+'</span></div><h2>Progress</h2><b>'+t.done+' / '+planned(t)+' rows</b><div class="bar"><i style="width:'+percent(t)+'%"></i></div></div><form onsubmit="saveResult(event,\''+t.id+'\')"><label>Completed rows<input name="done" type="number" min="0" max="'+planned(t)+'" value="'+t.done+'"></label><h2>Status</h2><select name="status">'+Object.keys(labels).map(s=>'<option value="'+s+'" '+(s===t.status?'selected':'')+'>'+labels[s]+'</option>').join('')+'</select><label>Note<textarea name="note">'+esc(t.note)+'</textarea></label><button class="primary">Save Changes</button>'+(!t.closed?'<button type="button" class="danger" onclick="closeTeam(\''+t.id+'\')">Close Team</button>':'<p class="sub">This team is closed and preserved in history.</p>')+'</form>')}
function peopleRows(list){return list.filter(p=>p.active).map(p=>'<button class="person" onclick="openPerson(\''+p.id+'\')"><span class="avatar">'+initials(p)+'</span><span><b>'+esc(p.name)+'</b><br><small class="sub">'+esc(p.role)+'</small></span><span class="tag '+availabilityClass(p.availability)+'">'+availabilityText(p.availability)+'</span></button>').join('')||'<div class="empty">No people found.</div>'}
function drawPeople(){draw(header('People')+'<input class="search" placeholder="⌕ Search people…" oninput="searchPeople(this.value)"><div class="card list-card" id="personList">'+peopleRows(db.people)+'</div><button class="primary" onclick="addPerson()">＋ Add person</button>')}
function drawPerson(){const p=person(selected);if(!p){goPeople();return}const team=db.teams.find(t=>t.date===day&&t.members.includes(p.id));draw(header('Person Details',true)+'<div class="card"><div class="row"><span><h3>'+esc(p.name)+'</h3><p class="sub">'+esc(p.role)+'</p></span><span class="tag '+availabilityClass(p.availability)+'">'+availabilityText(p.availability)+'</span></div><label>Availability<select onchange="setAvailability(\''+p.id+'\',this.value)"><option value="ON_SITE" '+(p.availability==='ON_SITE'?'selected':'')+'>On site</option><option value="OFF" '+(p.availability==='OFF'?'selected':'')+'>Off</option><option value="SICK" '+(p.availability==='SICK'?'selected':'')+'>Sick</option></select></label></div>'+(team?card(team):'<div class="empty">No assignment for today.</div>'))}
function drawHistory(){const groups={};db.teams.forEach(t=>(groups[t.date]??=[]).push(t));draw(header('History')+'<div class="card list-card">'+Object.keys(groups).sort().reverse().map(d=>'<button class="history" onclick="showHistory(\''+d+'\')"><div class="row"><b>'+d+'</b><span>›</span></div><p class="sub">'+groups[d].length+' teams · '+groups[d].reduce((n,t)=>n+t.done,0)+' rows</p></button>').join('')+'</div>')}
function drawSettings(){draw(header('Settings')+'<div class="card settings"><button>⌖ <span><b>Fields</b><br><small class="sub">'+db.fields.map(esc).join(', ')+'</small></span></button><button>⚒ <span><b>Work types</b><br><small class="sub">'+db.workTypes.map(esc).join(', ')+'</small></span></button><button onclick="goPeople()">♙ <span><b>Manage people</b><br><small class="sub">Availability, roles</small></span></button></div><section class="card"><h2>Solar Team — shared workspace</h2><p class="sub">Everyone has the same rights to create teams and update all work.</p><p>Signed in: '+esc(user.email)+'</p><button class="secondary" onclick="showAccess()">Team access</button><div id="access-panel"></div></section><button class="secondary" onclick="logout()">Sign out</button>')}
window.showAccess=async()=>{
 const {data,error}=await supabase.from('solar_members').select('email').order('added_at');
 if(error){toast(error.message);return}
 members=data;
 const panel=$('#access-panel');if(!panel)return;
 panel.innerHTML='<h2>People with access</h2>'+members.map(m=>'<p>'+esc(m.email)+' · Full access</p>').join('')+'<form onsubmit="inviteColleague(event)"><label>Colleague’s email<input name="email" type="email" required autocomplete="off"></label><button class="primary">Grant equal access</button></form><p class="sub" style="margin-top:12px">After adding their email, share this site link yourself. They create an account with that email and confirm it. No invitation email is sent automatically.</p>';
};
window.inviteColleague=async e=>{
 e.preventDefault();const email=new FormData(e.target).get('email').trim().toLowerCase();
 const {error}=await supabase.from('solar_members').insert({email});
 if(error){toast(error.code==='23505'?'This person already has access.':error.message);return}
 toast('Access granted. Share the app link with your colleague.');await showAccess();
};
window.retryAccess=()=>loadCloud(user);
window.goToday=()=>{screen='today';selected=null;render()};window.goPeople=()=>{screen='people';selected=null;render()};window.goHistory=()=>{screen='history';selected=null;render()};window.goSettings=()=>{screen='settings';selected=null;render()};window.newTeam=()=>{screen='form';render()};window.openTeam=id=>{selected=id;screen='team';render()};window.openPerson=id=>{selected=id;screen='person';render()};
window.createTeam=async e=>{
 e.preventDefault();if(saving)return;const f=new FormData(e.target),from=Number(f.get('from')),to=Number(f.get('to')),ids=f.getAll('member');
 if(!ids.length||!Number.isInteger(from)||!Number.isInteger(to)||from<0||from>to){toast('Choose people and a valid row range.');return}
 const t={id:crypto.randomUUID(),date:day,members:ids,field:f.get('field'),work:f.get('work'),from,to,done:0,status:'NOT_STARTED',note:'',closed:false};
 if(await change('add_team',t))openTeam(t.id);
};
async function saveTeamResult(id,close){
 if(saving)return;
 const t=db.teams.find(x=>x.id===id),f=new FormData($('form'));
 const patch={done:Math.min(planned(t),Math.max(0,Number(f.get('done')))),status:f.get('status'),note:f.get('note')};
 if(close){patch.closed=true;if(['NOT_STARTED','IN_PROGRESS'].includes(patch.status))patch.status=patch.done>=planned(t)?'COMPLETED':'PARTIALLY_COMPLETED'}
 const item={id},expected={};for(const [k,v] of Object.entries(patch)){if(t[k]!==v){item[k]=v;expected[k]=t[k]}}
 if(Object.keys(item).length===1){toast('No changes');return}
 if(await change('team_patch',item,expected)){render();toast('Saved for everyone')}
}
window.saveResult=(e,id)=>{e.preventDefault();return saveTeamResult(id,false)};
window.closeTeam=id=>saveTeamResult(id,true);
window.setAvailability=async(id,value)=>{
 const previous=person(id).availability;
 if(await change('person_patch',{id,availability:value},{availability:previous}))render();
 else {const select=$('select');if(select)select.value=previous}
};
window.searchPeople=q=>{$('#personList').innerHTML=peopleRows(db.people.filter(p=>p.name.toLowerCase().includes(q.toLowerCase())))};
window.addPerson=async()=>{if(saving)return;const name=prompt('Full name');if(!name?.trim())return;const item={id:crypto.randomUUID(),name:name.trim(),role:'Installer',availability:'ON_SITE',active:true};if(await change('add_person',item))render()};
window.showHistory=date=>{screen='historyDetail';draw(header('History',true)+'<h1>'+date+'</h1><section class="team-list">'+db.teams.filter(t=>t.date===date).map(card).join('')+'</section>')};
window.login=async e=>{e.preventDefault();const f=new FormData(e.target),{data,error}=await supabase.auth.signInWithPassword({email:f.get('email').trim(),password:f.get('password')});if(error){toast(error.message);return}await loadCloud(data.user);if(ready)toast('Solar Team loaded')};
window.signup=async()=>{const f=new FormData($('#app form')),email=f.get('email').trim(),password=f.get('password');if(!email||!password){toast('Enter email and password first');return}const {data,error}=await supabase.auth.signUp({email,password,options:{emailRedirectTo:'https://dl7400202-prog.github.io/solar-team/'}});if(error){toast(error.message);return}if(data.session){await loadCloud(data.user);toast('Account created')}else toast('Check your email to confirm the account, then sign in.')};
window.logout=async()=>{
 if(saving){toast('Please wait for the current save.');return}
 const {error}=await supabase.auth.signOut();if(error){toast(error.message);return}
 user=null;ready=false;version=-1;db=structuredClone(seed);screen='today';selected=null;members=[];render()
};
function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),8000)}

(async()=>{const {data:{session}}=await supabase.auth.getSession();if(session)await loadCloud(session.user);else render()})();
