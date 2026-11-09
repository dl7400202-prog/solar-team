/* Synthetic mechanical catalogue. No production assignments belong in public assets. */
module.exports=()=>({schema:1,source:{document:'Synthetic test fixture',revision:'1',date:'2026-01-01'},rows:[[10,'North','1',100],[11,'North','1',100],[20,'Mid','1',100],[30,'North','20',25]],templates:{
  '1':{page:1,tubes:[
    {colour:'Blue',lengthMm:11000,part:'TEST-N',driveFromNorthMm:null,bearings:[{kind:'bearing',fromNorthMm:2230},{kind:'fixed',fromNorthMm:8580}]},
    {colour:'Purple',lengthMm:11600,part:'TEST-GCS',driveFromNorthMm:6000,bearings:[{kind:'fixed',fromNorthMm:1000},{kind:'fixed',fromNorthMm:10000}]},
    {colour:'Green',lengthMm:10600,part:'TEST-S',driveFromNorthMm:null,bearings:[{kind:'fixed',fromNorthMm:2000},{kind:'bearing',fromNorthMm:8440}]}
  ]},
  '20':{page:2,tubes:[{colour:'Brown',lengthMm:10000,part:'TEST-SHORT',driveFromNorthMm:4000,bearings:[{kind:'bearing',fromNorthMm:1790},{kind:'fixed',fromNorthMm:6000},{kind:'bearing',fromNorthMm:9480}]}]}
}});
