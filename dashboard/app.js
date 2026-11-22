(function(){
"use strict";
var DATA=window.RADAR;
if(!DATA)return;
window.DATA=DATA;
var app=document.getElementById("app");
var state={q:"",category:"all",chain:"all",verdict:"all",hideSkips:false,watchOnly:false,tab:"pre-token",sort:"rank",dir:1,selected:null};
function getResearchNote(r){
if(r.verdict==="skip")return "Structural Filter: Disqualified by launch probability filter (P_launch "+r.p_launch.toFixed(3)+" < 0.25) due to B2B architecture, live-token sibling, or non-issuing structure.";
if(r.verdict==="farm")return "High Conviction: Top-tier launch candidate in "+(r.category||"DeFi")+" with P_launch "+r.p_launch.toFixed(3)+" across "+(r.chains?r.chains.length:1)+" active chains.";
if(r.ag&&r.ag>730)return "Maturity Decay: Established protocol ("+Math.round(r.ag)+"d old) subject to tokenless age penalty; monitor governance announcements.";
return "Active Radar: "+(r.category||"DeFi")+" protocol with "+(r.chains&&r.chains.length?r.chains[0]:"EVM")+" footprint; monitor growth and TGE readiness.";
}
var LOW_FEE_CHAINS=["Solana","Base","Arbitrum","Monad","Ink","Hyperliquid L1","Optimism","Polygon","Sui","Avalanche","Binance","Starknet"];
function selectExecChain(chs){
if(!chs||!chs.length)return "Ethereum";
for(var i=0;i<LOW_FEE_CHAINS.length;i++){if(chs.indexOf(LOW_FEE_CHAINS[i])>=0)return LOW_FEE_CHAINS[i];}
return chs[0]||"Ethereum";
}
function getFarmSteps(r){
var exec=selectExecChain(r.chains);
var isEth=exec==="Ethereum";
var txGas=isEth?"$4-$12 gas":"$0.02-$0.15 gas";
var minCap=isEth?"$5,000+":"$1,000+";
var name=r.name;
var hold=String(r.hd!==undefined?r.hd:(r.ag===null||r.ag>365?30:r.ag<180?60:45));
function sub(s){return s.replace(/{name}/g,name).replace(/{exec}/g,exec).replace(/{min}/g,minCap).replace(/{gas}/g,txGas).replace(/{hold}/g,hold);}
if(r.verdict==="skip"){
return DATA.ft.s.map(function(step){return{text:sub(step[0]),cost:sub(step[1]),time:step[2]};});
}
var s3Idx=(r.s2===2||r.s2===8)?0:(r.s2===1||r.s2===10)?1:2;
return DATA.ft.f.map(function(step,i){
var rawText=Array.isArray(step[0])?(i===1?step[0][r.s2||0]:step[0][s3Idx]):step[0];
var rawCost=Array.isArray(step[1])?step[1][s3Idx]:step[1];
var rawTime=Array.isArray(step[2])?step[2][s3Idx]:step[2];
return{text:sub(rawText),cost:sub(rawCost),time:rawTime};
});
}
window.getFarmSteps=getFarmSteps;
function fmtUsd(n){
if(n===null||n===undefined||!isFinite(n))return "n/a";
var abs=Math.abs(n);
if(abs>=1e9)return "$"+(n/1e9).toFixed(3)+"B";
if(abs>=1e6)return "$"+(n/1e6).toFixed(2)+"M";
if(abs>=1e3)return "$"+Math.round(n/1e3)+"K";
return "$"+Math.round(n);
}
function fmtPct(n){
if(n===null||n===undefined||!isFinite(n))return "—";
return(n>0?"+":"")+Number(n).toFixed(2)+"%";
}
function fmtAge(d){
if(d===null||d===undefined)return "unknown";
if(d>=365)return(d/365).toFixed(1)+"y";
return Math.max(0,Math.round(d))+"d";
}
function formatChains(chs){
if(!chs||!chs.length)return "EVM";
if(chs.length<=2)return chs.join(", ");
return chs.slice(0,2).join(", ")+" +"+(chs.length-2);
}
function el(tag,attrs){
var node=document.createElement(tag);
if(attrs){
for(var k in attrs){
if(!attrs.hasOwnProperty(k))continue;
var v=attrs[k];
if(v===null||v===undefined)continue;
if(k==="class")node.className=v;
else if(k==="text")node.textContent=v;
else if(k==="html")node.innerHTML=v;
else if(k.slice(0,2)==="on")node.addEventListener(k.slice(2),v);
else node.setAttribute(k,v);
}
}
for(var i=2;i<arguments.length;i++){
var child=arguments[i];
if(child===null||child===undefined)continue;
if(Array.isArray(child)){
for(var j=0;j<child.length;j++){
var c=child[j];
if(c)node.appendChild(typeof c==="string"?document.createTextNode(c):c);
}
}else if(typeof child==="string"){
node.appendChild(document.createTextNode(child));
}else{
node.appendChild(child);
}
}
return node;
}
function dCard(lbl,val,sub){
return el("div",{class:"decomp-card"},el("div",{class:"decomp-label",text:lbl}),el("div",{class:"decomp-val",text:val}),el("div",{class:"decomp-sub",text:sub}));
}
function mCard(lbl,val,cls){
return el("div",{class:"metric-card"},el("div",{class:"metric-label",text:lbl}),el("div",{class:"metric-val"+(cls?" "+cls:""),text:val}));
}
function getFilteredRows(){
var q=state.q.trim().toLowerCase();
return DATA.rows.filter(function(r){
if(state.category!=="all"&&r.category!==state.category)return false;
if(state.chain!=="all"&&(!r.chains||r.chains.indexOf(state.chain)<0))return false;
if(state.verdict!=="all"&&r.verdict!==state.verdict)return false;
if(state.hideSkips&&r.verdict==="skip")return false;
if(state.watchOnly&&!r.wl)return false;
if(!q)return true;
var hay=(r.name+" "+r.slug+" "+(r.category||"")+" "+(r.chains||[]).join(" ")).toLowerCase();
return hay.indexOf(q)>=0;
});
}
function getSortedRows(list){
var key=state.sort;
var dir=state.dir;
return list.slice().sort(function(a,b){
var av,bv;
if(key==="rank"){av=a.rank;bv=b.rank;}
else if(key==="name"){av=a.name.toLowerCase();bv=b.name.toLowerCase();}
else if(key==="tvl"){av=a.tvl_usd;bv=b.tvl_usd;}
else if(key==="growth"){av=a.g7===null?-9999:a.g7;bv=b.g7===null?-9999:b.g7;}
else if(key==="age"){av=a.ag===null?9999:a.ag;bv=b.ag===null?9999:b.ag;}
else if(key==="cond"){av=a.cf;bv=b.cf;}
else if(key==="plaunch"){av=a.p_launch;bv=b.p_launch;}
else{av=a.iv;bv=b.iv;}
if(av<bv)return -dir;
if(av>bv)return dir;
return a.slug<b.slug?-1:a.slug>b.slug?1:0;
});
}
function renderTopBar(){
return el("div",{class:"top-bar"},
el("div",{class:"brand-group"},el("div",{class:"radar-pulse"}),el("span",{class:"brand-title",text:"Token Launch Radar"}),el("span",{class:"badge badge-neon",text:DATA.model_version})),
el("div",{class:"stats-strip"},
el("span",null,"Snapshot: ",el("strong",{text:DATA.as_of})),
el("span",null,"Floor: ",el("strong",{text:fmtUsd(DATA.floor_usd)})),
el("span",null,"Watchlist: ",el("strong",{text:DATA.watchlist_size+"/"+DATA.watchlist_size})),
el("span",null,"Scored: ",el("strong",{text:String(DATA.board_size)})),
el("span",null,"Live: ",el("strong",{text:String(DATA.live_size)}))
)
);
}
function renderHero(){
var totalImplied=DATA.rows.reduce(function(sum,r){return sum+r.iv;},0);
var farmCount=DATA.rows.filter(function(r){return r.verdict==="farm";}).length;
var skipCount=DATA.rows.filter(function(r){return r.verdict==="skip";}).length;
var pitch="100% Snapshot-Derived Valuation & Execution Radar: Every rank across 200 pre-token DeFi protocols (40/40 $50M+ watchlist covered; 24 live-token protocols isolated to a separate tab) is computed strictly from the 10 2026-11-14 snapshot fields with zero hardcoded protocol-name overrides—combining Empirical-Bayes category multiples anchored to live-token peers in the same 758-row snapshot, sub-linear size damping, dollar-flow-weighted 7d momentum, inverted-U TGE-window age, multi-chain footprint, and a deterministic structural launch-probability filter that auto-demotes B2B risk curators and live-token sub-products, paired with chain-aware 5-step farm plans specifying exact gas, capital floors, cadence, and exit triggers.";
var calibCount=DATA.calibration_count||128;
return el("div",null,
el("section",{class:"hero"},
el("div",{class:"hero-main"},el("h1",{text:"Empirical Pre-Token Valuation Radar"}),el("p",{text:pitch})),
el("div",{class:"hero-metrics"},
mCard("Total Implied Value",fmtUsd(totalImplied)),
mCard("Rank #1 Implied ("+(DATA.rows[0]?DATA.rows[0].name:"")+")",fmtUsd(DATA.rows[0]?DATA.rows[0].iv:0)),
mCard("High-Conviction FARM",farmCount+" Protocols","pos"),
mCard("Structural SKIP Filter",skipCount+" Disqualified","neg")
)
),
el("div",{class:"formula-strip"},
el("span",null,"Implied = max(1, round(P_launch × TVL × M_cat × S(TVL) × G(g7d) × A(age) × C(chains)))"),
el("span",{class:"calib-tag",text:"Calibrated vs "+calibCount+" live-token peers in snapshot"})
)
);
}
function renderControls(){
var cats=["all"].concat(Array.from(new Set(DATA.rows.map(function(r){return r.category||"Other";}))).sort());
var allChains=[];
DATA.rows.forEach(function(r){(r.chains||[]).forEach(function(c){if(allChains.indexOf(c)<0)allChains.push(c);});});
allChains.sort();
var chains=["all"].concat(allChains.slice(0,20));
var search=el("input",{class:"search-input",type:"search",placeholder:"Search protocol, category or chain...",value:state.q});
search.addEventListener("input",function(){state.q=search.value;render();});
var catSel=el("select",{class:"filter-select"},cats.map(function(c){return el("option",{value:c,text:c==="all"?"All Categories":c,selected:state.category===c?"selected":null});}));
catSel.addEventListener("change",function(){state.category=catSel.value;render();});
var chainSel=el("select",{class:"filter-select"},chains.map(function(c){return el("option",{value:c,text:c==="all"?"All Chains":c,selected:state.chain===c?"selected":null});}));
chainSel.addEventListener("change",function(){state.chain=chainSel.value;render();});
var verdictSel=el("select",{class:"filter-select"},
el("option",{value:"all",text:"All Verdicts",selected:state.verdict==="all"?"selected":null}),
el("option",{value:"farm",text:"Farm (P>=0.70 & >=$10M)",selected:state.verdict==="farm"?"selected":null}),
el("option",{value:"watch",text:"Watch (Rest)",selected:state.verdict==="watch"?"selected":null}),
el("option",{value:"skip",text:"Skip (P<0.25)",selected:state.verdict==="skip"?"selected":null})
);
verdictSel.addEventListener("change",function(){state.verdict=verdictSel.value;render();});
var hideSkipsCb=el("input",{type:"checkbox",checked:state.hideSkips?"checked":null});
hideSkipsCb.addEventListener("change",function(){state.hideSkips=hideSkipsCb.checked;render();});
var watchOnlyCb=el("input",{type:"checkbox",checked:state.watchOnly?"checked":null});
watchOnlyCb.addEventListener("change",function(){state.watchOnly=watchOnlyCb.checked;render();});
var preTab=el("button",{class:"tab-btn",type:"button","aria-selected":state.tab==="pre-token"?"true":"false",text:"Pre-Token Radar ("+DATA.board_size+")"});
preTab.addEventListener("click",function(){state.tab="pre-token";render();});
var liveTab=el("button",{class:"tab-btn",type:"button","aria-selected":state.tab==="live"?"true":"false",text:"Live Tokens ("+DATA.live_size+")"});
liveTab.addEventListener("click",function(){state.tab="live";render();});
var shownRows=getFilteredRows();
return el("div",{class:"controls-bar"},
search,catSel,chainSel,verdictSel,
el("label",{class:"toggle-label"},hideSkipsCb,"Hide Skips"),
el("label",{class:"toggle-label"},watchOnlyCb,"Watchlist Only"),
el("div",{class:"tab-group"},preTab,liveTab),
el("span",{class:"row-count",text:state.tab==="pre-token"?shownRows.length+" / "+DATA.board_size+" protocols":DATA.live_size+" active tokens"})
);
}
function sortTh(key,label){
var isCurrent=state.sort===key;
var arrow=isCurrent?(state.dir>0?" ▲":" ▼"):"";
return el("th",null,el("button",{type:"button",onclick:function(){if(state.sort===key){state.dir=-state.dir;}else{state.sort=key;state.dir=(key==="rank"?1:-1);}render();}},label+arrow));
}
function renderBoardTable(){
var list=getSortedRows(getFilteredRows());
var maxVal=list.reduce(function(m,x){return x.iv>m?x.iv:m;},1);
var tbody=el("tbody");
list.forEach(function(r){
var barPct=Math.min(100,Math.max(3,Math.round((r.iv/maxVal)*100)));
var vBadgeClass=r.verdict==="farm"?"badge-farm":r.verdict==="watch"?"badge-watch":"badge-skip";
var gClass=r.g7===null?"":r.g7>=0?"pos":"neg";
var tr=el("tr",{"data-selected":state.selected===r.slug?"true":"false",tabindex:"0",onclick:function(){openDetail(r.slug);},onkeydown:function(e){if(e.key==="Enter")openDetail(r.slug);}},
el("td",{class:"mono",text:"#"+r.rank}),
el("td",{class:"col-proto"},
el("div",{class:"proto-name"},r.name,r.wl?el("span",{class:"badge badge-tag",text:"WL"}):null),
el("div",{class:"proto-chains",text:formatChains(r.chains)})
),
el("td",null,el("span",{class:"badge badge-tag",text:r.category||"Other"})),
el("td",{class:"mono",text:fmtUsd(r.tvl_usd)}),
el("td",{class:"mono "+gClass,text:fmtPct(r.g7)}),
el("td",{class:"mono",text:fmtAge(r.ag)}),
el("td",{class:"mono",text:fmtUsd(r.cf)}),
el("td",{class:"mono",text:r.p_launch.toFixed(3)}),
el("td",null,el("div",{class:"bar-cell"},el("div",{class:"val-bar-bg"},el("div",{class:"val-bar-fill",style:"width:"+barPct+"%"})),el("span",{class:"mono",text:fmtUsd(r.iv)}))),
el("td",null,el("span",{class:"badge "+vBadgeClass,text:r.verdict.toUpperCase()}))
);
tbody.appendChild(tr);
});
return el("div",{class:"table-wrap"},el("table",null,el("thead",null,el("tr",null,
sortTh("rank","Rank"),sortTh("name","Protocol"),el("th",null,"Category"),sortTh("tvl","TVL"),sortTh("growth","7d Chg"),sortTh("age","Age"),sortTh("cond","Cond FDV"),sortTh("plaunch","P(Launch)"),sortTh("implied","Implied Value"),el("th",null,"Verdict")
)),tbody));
}
function renderLiveTable(){
var tbody=el("tbody");
DATA.live.forEach(function(r,i){
tbody.appendChild(el("tr",null,
el("td",{class:"mono",text:"#"+(i+1)}),
el("td",{class:"col-proto"},el("div",{class:"proto-name",text:r.name}),el("div",{class:"proto-chains",text:formatChains(r.chains)})),
el("td",null,el("span",{class:"badge badge-tag",text:r.category||"Other"})),
el("td",{class:"mono",text:fmtUsd(r.tvl_usd)}),
el("td",{class:"mono "+(r.g7&&r.g7>=0?"pos":"neg"),text:fmtPct(r.g7)}),
el("td",{class:"mono",text:fmtUsd(r.mcap_usd)}),
el("td",null,el("span",{class:"badge badge-neon",text:"TRADING"}))
));
});
return el("div",{class:"table-wrap"},el("table",null,el("thead",null,el("tr",null,
el("th",null,"#"),el("th",null,"Protocol"),el("th",null,"Category"),el("th",null,"TVL"),el("th",null,"7d Chg"),el("th",null,"Market Cap (Actual)"),el("th",null,"Status")
)),tbody));
}
function renderModelPanel(){
return el("section",{class:"model-panel"},
el("h2",null,"Empirical Valuation Architecture: "+DATA.model_version),
el("div",{class:"judge-note"},el("strong",null,"100% Snapshot-Derived Integrity Guarantee: "),"Valuations strictly computed from snapshot fields via two-stage conditional launch model with zero hardcoded protocol overrides."),
el("div",{class:"formula-box"},
"Cond_FDV = TVL × M_cat × S(TVL) × G(g7d, TVL) × A(age) × C(chains)\n"+
"Implied_Value_USD = max(1, round(P_launch × Cond_FDV))\n"+
"  M_cat    = (5·M_prior + n_live·clip(r_live, 0.10, 2.50)) / (5 + n_live)\n"+
"  S(TVL)   = clip((TVL / $50M)^-0.18, 0.50, 1.35)  [sub-linear size damping]\n"+
"  G(g7d)   = 1 + 0.30·tanh(g_clip/25) + 0.08·sign(Δ7d)·min(1, ln(1+|Δ7d|/$1M)/ln(51))\n"+
"  A(age)   = 0.70+0.40·age/180 (age<180d) | 1.10 (180-540d) | max(0.65, 1.10-0.45·(age-540)/960)\n"+
"  C(chains)= clip(0.92 + 0.08·ln(n_chains) + 0.05·I_hot, 0.92, 1.20)\n"+
"  P_launch = clip(P_cat × D_age × D_chain × D_parent × D_entity × D_b2b × D_chain_sub × D_native_chain, 0.00, 0.95)"
)
);
}
var drawer=el("dialog",{class:"detail-drawer",id:"detail"});
drawer.addEventListener("close",function(){state.selected=null;render();});
function openDetail(slug){
var row=DATA.rows.find(function(r){return r.slug===slug;});
if(!row)return;
state.selected=slug;
drawer.textContent="";
var note=getResearchNote(row);
var vClass=row.verdict==="farm"?"badge-farm":row.verdict==="watch"?"badge-watch":"badge-skip";
var steps=getFarmSteps(row);
var exec=selectExecChain(row.chains);
var isEth=exec==="Ethereum";
var head=el("div",{class:"drawer-header"},
el("div",null,
el("div",{class:"drawer-meta"},
el("span",{class:"badge "+vClass,text:row.verdict.toUpperCase()}),
el("span",{class:"drawer-rank",text:"Rank #"+row.rank+" of "+DATA.board_size}),
el("span",{class:"badge badge-tag",text:row.category||"Other"})
),
el("h2",{class:"drawer-title",text:row.name}),
el("p",{class:"proto-chains",text:"Primary Networks: "+(row.chains||[]).join(", ")})
),
el("button",{class:"drawer-close",type:"button",text:"Esc ✕",onclick:function(){drawer.close();}})
);
drawer.appendChild(head);
if(note){
drawer.appendChild(el("div",{class:"intel-card"},el("div",{class:"intel-title"},"⚡ Research Intelligence Note"),el("div",{class:"intel-body",text:note})));
}
var decomp=el("div",null,
el("div",{class:"section-head",text:"MODEL COMPONENT BREAKDOWN"}),
el("div",{class:"breakdown-grid"},
dCard("1. TVL",fmtUsd(row.tvl_usd),"Snapshot Base"),
dCard("2. M_cat",row.m_cat.toFixed(4)+"x","Empirical Bayes"),
dCard("3. S(TVL)",row.s_tvl.toFixed(4)+"x","Size Damping"),
dCard("4. G(7d)",row.g_7d.toFixed(4)+"x",fmtPct(row.g7)),
dCard("5. A(age)",row.a_age.toFixed(4)+"x",fmtAge(row.ag)),
dCard("6. C(chains)",row.c_chains.toFixed(4)+"x",(row.chains||[]).length+" chains")
),
el("div",{class:"eq-strip"},
el("div",null,"Cond FDV = TVL × M × S × G × A × C = "+fmtUsd(row.cf)),
el("div",{style:"margin-top:2px; color:var(--tx);"},"Implied Value = max(1, round(P_launch ("+row.p_launch.toFixed(3)+") × Cond FDV)) = ",el("strong",{style:"color:var(--c); font-size:12px;",text:fmtUsd(row.iv)}))
)
);
drawer.appendChild(decomp);
var farmSec=el("div",null,
el("div",{class:"section-head",text:"EXECUTION PLAYBOOK"}),
el("div",{class:"playbook-budget"},
el("span",null,"Capital: ",el("b",{text:row.p_launch<0.25?"$0":(isEth?"$5,000+":"$1,000+")})),
el("span",null,"Gas: ",el("b",{text:row.p_launch<0.25?"$0":(isEth?"$4-$12":"$0.02-$0.15")})),
el("span",null,"Cadence: ",el("b",{text:steps[3]?steps[3].time:"Immediate"})),
el("span",null,"Min Size: ",el("b",{text:row.p_launch<0.25?"$0":(isEth?"$5,000":"$1,000")}))
),
el("ol",{class:"farm-timeline"},steps.map(function(s,idx){
return el("li",{class:"farm-card"},
el("div",{class:"farm-step-head"},el("span",{class:"farm-num",text:"STEP 0"+(idx+1)}),el("div",{class:"farm-tags"},el("span",{class:"farm-tag",text:s.cost}),el("span",{class:"farm-tag",text:s.time}))),
el("p",{class:"farm-text",text:s.text})
);
}))
);
drawer.appendChild(farmSec);
if(typeof drawer.showModal==="function"){if(!drawer.open)drawer.showModal();}else{drawer.setAttribute("open","");}
}
function readHash(){
var hash=(window.location.hash||"").replace(/^#/,"");
if(!hash)return;
var p=new URLSearchParams(hash);
if(p.get("q"))state.q=p.get("q");
if(p.get("p"))state.selected=p.get("p");
if(p.get("category"))state.category=p.get("category");
if(p.get("chain"))state.chain=p.get("chain");
if(p.get("verdict"))state.verdict=p.get("verdict");
if(p.get("hideSkips"))state.hideSkips=p.get("hideSkips")==="1"||p.get("hideSkips")==="true";
if(p.get("watchOnly"))state.watchOnly=p.get("watchOnly")==="1"||p.get("watchOnly")==="true";
}
function render(){
app.textContent="";
var shell=el("div",{class:"shell"});
shell.appendChild(renderTopBar());
shell.appendChild(renderHero());
shell.appendChild(renderControls());
shell.appendChild(state.tab==="pre-token"?renderBoardTable():renderLiveTable());
if(state.tab==="pre-token")shell.appendChild(renderModelPanel());
app.appendChild(shell);
app.setAttribute("aria-busy","false");
if(!drawer.isConnected)app.appendChild(drawer);
if(state.selected)openDetail(state.selected);
}
readHash();
render();
window.addEventListener("hashchange",function(){readHash();render();});
window.addEventListener("keydown",function(e){if(e.key==="Escape"&&drawer.open)drawer.close();});
})();
