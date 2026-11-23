(function(){
"use strict";
var D=window.RADAR;if(!D)return;
window.DATA=D;
var S={q:"",cat:"all",ch:"all",v:"all",noSkip:false,wl:false,tab:"radar",sort:"rank",dir:1,sel:null};
function getFarmSteps(r){
var GT={"Solana":[0.005,0.5],"Sui":[0.005,0.5],"Aptos":[0.005,0.5],"Stellar":[0.005,0.5],"Starknet":[0.25,2.5],"Scroll":[0.25,2.5],"Linea":[0.25,2.5],"zkSync":[0.25,2.5],"zkSync Era":[0.25,2.5],"Ethereum":[7.5,9],"Bitcoin":[2.5,6],"Core":[2.5,6],"BSquared":[2.5,6],"Bitlayer":[2.5,6],"Citrea":[2.5,6],"Hemi":[2.5,6]};
var gp=GT[r.exec_chain]||[0.08,1.5];
var gas=gp[0],bridge=gp[1];
var tx=r.alpha_circ===0.25?18:r.alpha_circ===0.22?10:6;
var total_c=Math.round(r.c_hard*100);
var s1=Math.round((bridge+gas)*100);
var s2=Math.round(2*gas*100);
var s3=Math.round((tx-5)*gas*100);
var s5=Math.round(2*gas*100);
s3+=total_c-(s1+s2+s3+s5);
function fmt(c){return "$"+(c/100).toFixed(2);}
var g1=fmt(s1),g2=fmt(s2),g3=fmt(s3),g4="$0.00",g5=fmt(s5);
var v={name:r.name,exec:r.exec_chain,min:"$"+r.k_min.toLocaleString("en-US"),gas:"$"+Number(r.c_hard).toFixed(2),total_hard:"$"+Number(r.c_hard).toFixed(2),hold:String(r.hold_days),g1:g1,g2:g2,g3:g3,g4:g4,g5:g5};
function sub(s){return String(s||"").replace(/{(\w+)}/g,function(_,k){return v[k]||"";});}
if(r.verdict==="skip")return D.ft.s.map(function(s){return{text:sub(s[0]),cost:sub(s[1]),time:s[2]};});
var g=(r.s2===2||r.s2===8)?0:(r.s2===1||r.s2===10)?1:2,f=D.ft.f;
return[
{text:sub(r.exec_chain==="Ethereum"?f[0][1]:f[0][0]),cost:sub(f[0][2]),time:f[0][3]},
{text:sub(f[1][0][r.s2]),cost:sub(f[1][1]),time:f[1][2]},
{text:sub(f[2][0][g]),cost:sub(f[2][1]),time:f[2][2]},
{text:sub(f[3][0][g]),cost:sub(f[3][1]),time:f[3][2][g]},
{text:sub(f[4][0][g]),cost:sub(f[4][1]),time:f[4][2]}
];
}
window.getFarmSteps=getFarmSteps;
function stepText(s){
var t=s.text+" Cost: "+s.cost+". Time: "+s.time+".";
return t.length>600?t.slice(0,596)+"...":t.length<20?t+" Maintain position per protocol schedule.":t;
}
window.stepText=stepText;
function fU(n){
if(n==null)return"n/a";var a=Math.abs(n);
return"$"+(a>=1e9?(n/1e9).toFixed(2)+"B":a>=1e6?(n/1e6).toFixed(2)+"M":a>=1e3?Math.round(n/1e3)+"K":Math.round(n));
}
function fP(n){return n!=null?(n>0?"+":"")+(+n).toFixed(2)+"%":"—";}
function fA(d){return d==null?"—":d>=365?(d/365).toFixed(1)+"y":Math.round(d)+"d";}
function fC(c){return!c||!c[0]?"EVM":c.length<=2?c.join(", "):c[0]+", "+c[1]+" +"+(c.length-2);}
function bX(c,a){return'<div class="'+c+'">'+a.map(function(x){return'<div class="c-box"><div class="c-lbl">'+x[0]+'</div><div class="c-val '+(x[2]||'')+'">'+x[1]+'</div></div>';}).join('')+'</div>';}
function sec(h,c){return'<div class="d-sec"><div class="s-head">'+h+'</div>'+c+'</div>';}
function fN(n,d){return n!=null?(+n).toFixed(d):"—";}
function td(v,c){return'<td class="'+(c||'')+'">'+v+'</td>';}
function gR(){
var q=S.q.trim().toLowerCase(),k=S.sort,d=S.dir;
function vl(x){return k==="growth"?x.change_7d??-9999:k==="age"?x.age_days??9999:k==="name"?x.name.toLowerCase():x[k];}
return D.rows.filter(function(r){
return(S.cat==="all"||r.category===S.cat)&&
(S.ch==="all"||(r.chains&&r.chains.includes(S.ch)))&&
(S.v==="all"||r.verdict===S.v)&&
(!S.noSkip||r.verdict!=="skip")&&
(!S.wl||r.is_watchlist)&&
(!q||(r.name+" "+r.slug+" "+(r.category||"")+" "+(r.chains||[]).join(" ")).toLowerCase().includes(q));
}).sort(function(a,b){
var av=vl(a),bv=vl(b);
return av<bv?-d:av>bv?d:a.slug<b.slug?-1:1;
});
}
function wH(r){
function p(n){return Math.max(0,Math.min(100,(Math.log(n)-13.1)*8.2|0));}
var a=p(r.v10_usd),b=p(r.v50_usd),c=p(r.v90_usd);
return'<div class="w-wrap"><div class="w-trk"><div class="w-bar" style="left:'+a+'%;width:'+(c-a)+'%"></div><div class="w-dot" style="left:'+b+'%"></div></div><span class="w-val mono">'+fU(r.v50_usd)+'</span></div>';
}
function rT(rows){
var cols=[["rank","#"],["name","Protocol"],["category","Cat"],["tvl_usd","TVL"],["growth","7d"],["age","Age"],["v50_usd","Valuation"],["p_launch","P(Launch)"],["y_airdrop_ann","Yield"],["k_min","K_min"],["implied_value_usd","Implied"],["verdict","Verdict"]];
var ths=cols.map(function(c){return'<th><button data-sort="'+c[0]+'">'+c[1]+(S.sort===c[0]?(S.dir===1?' ▲':' ▼'):'')+'</button></th>';}).join('');
var trs=rows.map(function(r){
var cls=r.change_7d>0?'pos':r.change_7d<0?'neg':'';
var wl=r.is_watchlist?'<span class="badge b-wl">WL</span>':'';
return'<tr data-slug="'+r.slug+'"'+(S.sel===r.slug?' data-selected="true"':'')+'>'+
td('#'+r.rank)+
'<td><div class="p-cell"><span class="p-name">'+r.name+wl+'</span><span class="p-sub">'+fC(r.chains)+'</span></div></td>'+
'<td>'+(r.category||"DeFi")+'</td>'+
td(fU(r.tvl_usd))+
td(fP(r.change_7d),cls)+
td(fA(r.age_days))+
'<td>'+wH(r)+'</td>'+
td(fN(r.p_launch,3))+
td(r.y_airdrop_ann?fN(r.y_airdrop_ann*100,1)+'%':'—')+
td('$'+r.k_min.toLocaleString())+
td(fU(r.implied_value_usd))+
'<td><span class="badge b-'+r.verdict+'">'+r.verdict+'</span></td></tr>';
}).join('');
return'<div class="t-wrap"><table><thead><tr>'+ths+'</tr></thead><tbody>'+trs+'</tbody></table></div>';
}
function rD(){
if(!S.sel)return'';
var r=D.rows.find(function(x){return x.slug===S.sel;});
if(!r)return'';
var comps=r.comps.map(function(c){
var p=D.cp[c[0]]||{};
return'<tr><td>'+(p.name||'—')+'</td><td>'+(p.category||'—')+'</td>'+
td(fU(p.tvl_usd))+td(fU(p.mcap_usd))+
td(fN(c[1],2)+'x')+td(fN(c[2],3))+'</tr>';
}).join('');
var terms=[["β₀",r.attr[0]],["β₁ ln(TVL)",r.attr[1]],["β₅ ln(chains)",r.attr[2]],["α Macro",r.attr[3]],["Residual med_r",r.attr[4]]].map(function(t){
var p=t[1]>=0,c=p?'pos':'neg',w=Math.min(50,Math.abs(t[1])*15|0);
return'<div class="a-row"><span>'+t[0]+'</span><div class="a-trk"><div class="a-mid"></div><div class="a-bar '+c+'" style="width:'+w+'%"></div></div><span class="mono '+c+'" style="text-align:right">'+(p?'+':'')+fN(t[1],2)+'</span></div>';
}).join('');
var steps=getFarmSteps(r).map(function(s,i){
return'<div class="f-card"><div class="f-head"><span class="f-num">STEP '+(i+1)+'</span><span style="color:var(--m)">Cost: '+s.cost+' · Time: '+s.time+'</span></div><div class="f-txt">'+s.text+'</div></div>';
}).join('');
var wl=r.is_watchlist?'<span class="badge b-wl">WL</span>':'';
return'<dialog class="drawer"><div class="d-head"><div><div style="display:flex;align-items:center;gap:6px;margin-bottom:2px"><span class="mono" style="color:var(--x);font-size:10px">#'+r.rank+'</span><span class="badge b-'+r.verdict+'">'+r.verdict+'</span>'+wl+'</div><div class="d-title">'+r.name+'</div><div class="d-sub">'+(r.category||"DeFi")+' · '+fC(r.chains)+' · '+fA(r.age_days)+'</div></div><button class="d-close" data-act="close">✕ Close</button></div>'+
sec("Valuation & Launch Probability",bX("g4",[["P10 Floor",fU(r.v10_usd)],["P50 Base",fU(r.v50_usd)],["P90 Ceiling",fU(r.v90_usd)],["Implied",fU(r.implied_value_usd),'pos']])+'<div style="font-size:10px;color:var(--m);margin-top:3px">P(Launch) = '+fN(r.p_launch,4)+'</div>')+
sec("Valuation Attribution",terms)+
sec("Costed Farm P&L",bX("g4",[["Chain",r.exec_chain],["Hard Cost","$"+fN(r.c_hard,2)],["Time",r.total_min+"m"],["Gross Hold",r.gross_hold?fN(r.gross_hold*100,2)+'%':'—'],["Est. Yield",r.y_airdrop_ann?fN(r.y_airdrop_ann*100,1)+'%':'—'],["Net Cash EV (@$10k)",(r.net_cash_ev_10k<0?"-$":"$")+Math.abs(r.net_cash_ev_10k).toFixed(2),r.net_cash_ev_10k>=0?"pos":"neg"],["K_min","$"+r.k_min.toLocaleString()],["α_circ",r.alpha_circ*100+'%']]))+
sec("3 Nearest Comps",'<table><thead><tr><th>Peer</th><th>Cat</th><th>TVL</th><th>MCap</th><th>MCap/TVL</th><th>Dist</th></tr></thead><tbody>'+comps+'</tbody></table>')+
sec((r.verdict==="skip"?"Disqualification Log":"Farm Playbook"),'<div class="f-tl">'+steps+'</div>')+'</dialog>';
}
function rV(){
var v=D.validation,pts=v.oof_scatter||[];
var lo=99,hi=0;pts.forEach(function(p){lo=Math.min(lo,p.actual_ln,p.pred_ln);hi=Math.max(hi,p.actual_ln,p.pred_ln);});lo-=0.5;hi+=0.5;
var mid=(lo+hi)/2;
function sx(x){return 30+(x-lo)/(hi-lo)*278|0;}
function sy(y){return 128-(y-lo)/(hi-lo)*118|0;}
var tk='<g font-size="7.5" fill="#55657d">';
[lo,mid,hi].forEach(function(x){var s=x.toFixed(1);tk+='<text x="'+sx(x)+'" y="139" text-anchor="middle">'+s+'</text><text x="26" y="'+(sy(x)+3)+'" text-anchor="end">'+s+'</text>';});
tk+='</g><g font-size="8" fill="#8fa0b5" text-anchor="middle"><text x="169" y="150">Actual ln(MCap)</text><text x="-69" y="9" transform="rotate(-90)">OOF Pred ln(MCap)</text></g>';
var circs=pts.map(function(p){return'<circle cx="'+sx(p.actual_ln)+'" cy="'+sy(p.pred_ln)+'" r="2" fill="#f59e0b99"/>';}).join('');
var diag='<line x1="'+sx(lo)+'" y1="'+sy(lo)+'" x2="'+sx(hi)+'" y2="'+sy(hi)+'" stroke="#55657d" stroke-dasharray="2,2"/>';
var axes='<path d="M30 10v118h278" stroke="#283344" fill="none"/>';
var svgStr='<svg class="sc-svg" viewBox="0 0 320 155">'+diag+axes+tk+circs+'</svg>';
function tbl(t){
return'<table><thead><tr><th>Model</th><th>RMSLE</th><th>MAE</th><th>Spearman</th><th>ΔRMSLE</th><th>Kept</th></tr></thead><tbody>'+
(t||[]).map(function(r){
return'<tr>'+td(r.model)+
[r.rmsle,r.mae_log,r.spearman_mean_fold,r.delta].map(function(x){return td(fN(x,4));}).join('')+
td(r.kept?'YES':'—',r.kept?'pos':'')+'</tr>';
}).join('')+'</tbody></table>';
}
var liveRows=D.live.map(function(l){
var r=l.tvl_usd>0?(l.mcap_usd/l.tvl_usd).toFixed(2)+'x':'—',c=l.change_7d>0?'pos':l.change_7d<0?'neg':'';
return'<tr><td>'+l.name+'</td><td>'+(l.category||"DeFi")+'</td><td>'+fC(l.chains)+'</td>'+td(fU(l.tvl_usd))+td(fU(l.mcap_usd))+td(r)+td(fP(l.change_7d),c)+'</tr>';
}).join('');
var a=v.stage_a,ff=a.final_fit,al=ff.alpha||{},fb=ff.beta||[],lm=a.match.table.filter(function(r){return r.kept;}).pop()||{};
var freeTerm=(a.match.kept_free||[]).filter(function(x){return x!=="x1";}).join(",")||"—";
var sb=v.stage_b,b=sb.cv;function ab(x){return fN(x.auc,3)+"/"+fN(x.brier,3);}
return'<div class="v-pan"><div class="g2">'+
sec("OOF CV Scatter (n="+a.match.n+")",'<div class="sc-box">'+svgStr+'</div><div style="text-align:center;font-size:10px;color:var(--m);margin-top:2px">RMSLE: '+fN(lm.rmsle,4)+' · Cov: '+fN(a.match.conformal.coverage_pct,1)+'%</div>')+
sec("Fit Parameters",bX("g2",[["Huber λ/m",ff.lambda+"/"+ff.m_shr],["β₀",fN(fb[0],4)],["β₁ ln(TVL)",fN(fb[1],4)],["Beta Free ("+freeTerm+")",fN(fb[2],4)],["Trade/Credit α",fN(al.Trading,3)+"/"+fN(al.Credit,3)],["Vault/Infra α",fN(al.Vaults,3)+"/"+fN(al.Infra,3)],["med_r",fN(a.match.conformal.med_r,4)],["Coverage",fN(a.match.conformal.coverage_pct,1)+'%']]))+'</div>'+
'<div class="g2">'+
sec("Ablation: L_match (n="+a.match.n+")",tbl(a.match.table))+
sec("Ablation: L_all (n="+a.all.n+")",tbl(a.all.table))+
'</div>'+
sec("Stage B Proof",bX("g4",[["B0 Naive",ab(b.b0)],["B1 Cat π_c",ab(b.b1)],["B2 +Cure F(t)",ab(b.b2)],["B3 +D_svc (Final)",ab(b.final)+"/"+fN(b.final.bss,3)],["Cure",sb.cure.w0+"/"+sb.cure.tau+"d/m="+sb.cure.m],["D_service",fN(sb.d_service,4)],["Target/p0",sb.target+" ("+fN(sb.p0,3)+")"],["P_floor/Q75",fN(v.verdicts.p_floor,3)+" / "+fU(v.verdicts.q75_implied)]]))+
sec(D.live.length+" Isolated Live Tokens (Peer Reference · Not Ranked on Pre-Token Board)",'<table><thead><tr><th>Protocol</th><th>Cat</th><th>Chains</th><th>TVL</th><th>MCap</th><th>MCap/TVL</th><th>7d</th></tr></thead><tbody>'+liveRows+'</tbody></table>')+'</div>';
}
function uX(){
var sorted=gR(),cnt=document.querySelector(".cnt"),c=document.querySelector(".ctrls"),dyn=document.getElementById("dyn");
if(cnt)cnt.textContent=sorted.length+" of "+D.rows.length+" rows";
if(c)c.classList.toggle("v-mode",S.tab==="val");
if(!dyn)return;
dyn.innerHTML=S.tab==="radar"?(rT(sorted)+(S.sel?rD():'')):rV();
if(S.sel){var d=document.querySelector('dialog.drawer');if(d&&!d.open){try{d.showModal();}catch(e){d.setAttribute('open','');}}}
}
function init(){
var cats=[],chs=[],farmCount=0,skipCount=0,wlCount=0,totImplied=0;
D.rows.forEach(function(r){
r.category&&!cats.includes(r.category)&&cats.push(r.category);
(r.chains||[]).forEach(function(c){!chs.includes(c)&&chs.push(c);});
farmCount+=r.verdict==="farm";
skipCount+=r.verdict==="skip";
wlCount+=r.is_watchlist?1:0;
totImplied+=r.implied_value_usd;
});
cats.sort();chs.sort();
var mkOpt=function(a){return a.map(function(c){return'<option>'+c+'</option>';}).join('');};
var v=D.validation,mt=v.stage_a.match.table,lm=mt.filter(function(r){return r.kept;}).pop()||mt[mt.length-1],d=((lm.rmsle-mt[0].rmsle)/mt[0].rmsle*100).toFixed(1);
var app=document.getElementById("app");
app.innerHTML='<div class="shell"><div class="top-bar"><div class="brand"><span>Token Launch Radar</span><span class="badge b-m">'+D.model_version+'</span></div><div class="stats-strip"><span>Snapshot: <b>'+D.as_of+'</b></span><span>Floor: <b>'+fU(D.floor_usd)+'</b></span><span>Watchlist: <b>'+wlCount+'/'+D.watchlist_size+'</b></span><span>Scored: <b>'+D.rows.length+'</b></span><span>Live: <b>'+D.live.length+'</b></span></div></div><section class="hero"><div><h1>Pre-Token Valuation Radar</h1><p>Power-law + EB + cure</p><div class="hero-note">* α_circ assumption.</div></div>'+bX("h-grid",[["Total Implied",fU(totImplied)],["FARM / SKIP",farmCount+" / "+skipCount],["Watchlist",wlCount+"/"+D.watchlist_size+" ("+Math.round(wlCount/D.watchlist_size*100)+"%)"],["Live Peers",D.cp.length]])+'</section>'+bX("g4 hero-kpi",[["Blind CV RMSLE",fN(lm.rmsle,3)+" ("+(d>0?"+":"")+d+"% vs Naive)"],["80% CI / Stage B",fN(v.stage_a.match.conformal.coverage_pct,1)+"% Cov · AUC "+fN(v.stage_b.cv.final.auc,3)],["Watchlist / Live",wlCount+"/"+D.watchlist_size+" WL · "+D.live.length+" Live"],["Actionable FARM",farmCount+" FARM / "+skipCount+" SKIP"]])+'<div class="f-strip"><span>Implied = max(1, round(P_launch × V50))</span><span>'+D.cp.length+' live peers</span></div><div class="ctrls"><input class="inp" id="qInp" placeholder="Search..." value="'+S.q+'"><select class="sel" id="catSel"><option value="all">All Categories</option>'+mkOpt(cats)+'</select><select class="sel" id="chSel"><option value="all">All Chains</option>'+mkOpt(chs)+'</select><select class="sel" id="vSel"><option value="all">All Verdicts</option><option value="farm">FARM</option><option value="watch">WATCH</option><option value="skip">SKIP</option></select><label class="chk"><input type="checkbox" id="nsChk">Hide Skips</label><label class="chk"><input type="checkbox" id="wlChk">Watchlist</label><div class="t-grp"><button class="t-btn" data-tab="radar" aria-selected="true">Pre-Token Radar</button><button class="t-btn" data-tab="val" aria-selected="false">Validation & Live Comps</button></div><span class="cnt">'+D.rows.length+' of '+D.rows.length+' rows</span></div><div id="dyn"></div></div>';
app.addEventListener("input",function(e){if(e.target.id==="qInp"){S.q=e.target.value;uX();}});
app.addEventListener("change",function(e){
var t=e.target,i=t.id,v=t.value,c=t.checked;
if(i==="catSel")S.cat=v;else if(i==="chSel")S.ch=v;else if(i==="vSel")S.v=v;else if(i==="nsChk")S.noSkip=c;else if(i==="wlChk")S.wl=c;
uX();
});
app.addEventListener("click",function(e){
var t=e.target,btn=t.closest("button");
if(btn){
var d=btn.dataset;
if(d.sort){if(S.sort===d.sort)S.dir=-S.dir;else{S.sort=d.sort;S.dir=d.sort==="name"||d.sort==="rank"?1:-1;}uX();return;}
if(d.tab){S.tab=d.tab;S.sel=null;app.querySelectorAll(".t-btn").forEach(function(b){b.setAttribute("aria-selected",b.dataset.tab===S.tab);});uX();return;}
if(d.act==="close"){S.sel=null;uX();return;}
}
var tr=t.closest("tbody tr[data-slug]");
if(tr&&S.tab==="radar"){var s=tr.dataset.slug;S.sel=S.sel===s?null:s;uX();return;}
if(t.classList.contains("drawer")){S.sel=null;uX();}
});
window.addEventListener("keydown",function(e){if(e.key==="Escape"&&S.sel){S.sel=null;uX();}});
uX();
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();