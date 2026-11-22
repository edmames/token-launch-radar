(function(){
"use strict";
var D=window.RADAR;if(!D)return;
window.DATA=D;
var S={q:"",cat:"all",ch:"all",v:"all",noSkip:false,wl:false,tab:"radar",sort:"rank",dir:1,sel:null};
function getFarmSteps(r){
  var v={name:r.name,exec:r.exec_chain,min:"$"+r.k_min.toLocaleString("en-US"),gas:"$"+Number(r.c_hard).toFixed(2),hold:String(r.hold_days)};
  function sub(s){return String(s||"").replace(/{(\w+)}/g,function(_,k){return v[k]||"";});}
  if(r.verdict==="skip")return D.ft.s.map(function(s){return{text:sub(s[0]),cost:sub(s[1]),time:s[2]};});
  var g=(r.s2===2||r.s2===8)?0:(r.s2===1||r.s2===10)?1:2,f=D.ft.f;
  return[
    {text:sub(f[0][0]),cost:sub(f[0][1]),time:f[0][2]},
    {text:sub(f[1][0][r.s2]),cost:sub(f[1][0][r.s2]?f[1][1]:f[1][1]),time:f[1][2]},
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
  if(n==null||!isFinite(n))return"n/a";
  var a=Math.abs(n);
  return a>=1e9?"$"+(n/1e9).toFixed(2)+"B":a>=1e6?"$"+(n/1e6).toFixed(2)+"M":a>=1e3?"$"+Math.round(n/1e3)+"K":"$"+Math.round(n);
}
function fP(n){return n==null||!isFinite(n)?"—":(n>0?"+":"")+Number(n).toFixed(2)+"%";}
function fA(d){return d==null?"—":d>=365?(d/365).toFixed(1)+"y":Math.max(0,Math.round(d))+"d";}
function fC(c){return!c||!c.length?"EVM":c.length<=2?c.join(", "):c.slice(0,2).join(", ")+" +"+(c.length-2);}
function box(l,v,c){return'<div class="c-box"><div class="c-lbl">'+l+'</div><div class="c-val'+(c?' '+c:'')+'">'+v+'</div></div>';}
function bX(cls,a){return'<div class="'+cls+'">'+a.map(function(x){return box(x[0],x[1],x[2]);}).join('')+'</div>';}
function sec(h,c){return'<div class="d-sec"><div class="s-head">'+h+'</div>'+c+'</div>';}
function fN(n,d){return n!=null&&isFinite(n)?Number(n).toFixed(d):"—";}
function td(v,c){return'<td class="mono'+(c?' '+c:'')+'">'+v+'</td>';}
function gR(){
  var q=S.q.trim().toLowerCase(),k=S.sort,d=S.dir;
  return D.rows.filter(function(r){
    return(S.cat==="all"||r.category===S.cat)&&
      (S.ch==="all"||(r.chains&&r.chains.indexOf(S.ch)>=0))&&
      (S.v==="all"||r.verdict===S.v)&&
      (!S.noSkip||r.verdict!=="skip")&&
      (!S.wl||r.is_watchlist)&&
      (!q||(r.name+" "+r.slug+" "+(r.category||"")+" "+(r.chains||[]).join(" ")).toLowerCase().indexOf(q)>=0);
  }).sort(function(a,b){
    var av=k==="growth"?a.change_7d??-9999:k==="age"?a.age_days??9999:k==="name"?a.name.toLowerCase():a[k];
    var bv=k==="growth"?b.change_7d??-9999:k==="age"?b.age_days??9999:k==="name"?b.name.toLowerCase():b[k];
    return av<bv?-d:av>bv?d:a.slug<b.slug?-1:1;
  });
}
function wH(r){
  var l10=Math.log(Math.max(1,r.v10_usd)),l50=Math.log(Math.max(1,r.v50_usd)),l90=Math.log(Math.max(1,r.v90_usd));
  var p10=Math.max(0,Math.min(100,(l10-13.1)/12.2*100)),p50=Math.max(0,Math.min(100,(l50-13.1)/12.2*100)),p90=Math.max(0,Math.min(100,(l90-13.1)/12.2*100));
  return'<div class="w-wrap"><div class="w-trk"><div class="w-bar" style="left:'+p10+'%;width:'+(p90-p10)+'%"></div><div class="w-dot" style="left:'+p50+'%"></div></div><span class="w-val mono">'+fU(r.v50_usd)+'</span></div>';
}
function rT(rows){
  var cols=[["rank","Rank"],["name","Protocol"],["category","Category"],["tvl_usd","TVL"],["growth","7d Chg"],["age","Age"],["v50_usd","Valuation (P10-P50-P90)"],["p_launch","P(Launch)"],["y_airdrop_ann","Est. Yield"],["k_min","K_min"],["implied_value_usd","Implied Value"],["verdict","Verdict"]];
  var ths=cols.map(function(c){return'<th><button data-sort="'+c[0]+'">'+c[1]+(S.sort===c[0]?(S.dir===1?' ↑':' ↓'):'')+'</button></th>';}).join('');
  var trs=rows.map(function(r){
    var cls=r.change_7d==null?'':(r.change_7d>0?'pos':r.change_7d<0?'neg':'');
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
      td(r.y_airdrop_ann!=null?(r.y_airdrop_ann*100).toFixed(1)+'%':'—')+
      td('$'+r.k_min.toLocaleString("en-US"))+
      '<td class="mono" style="font-weight:700;color:#fff">'+fU(r.implied_value_usd)+'</td>'+
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
    return'<tr><td style="font-weight:600;color:#fff">'+(p.name||'—')+'</td><td>'+(p.category||'—')+'</td>'+
      td(fU(p.tvl_usd))+td(fU(p.mcap_usd))+
      td(fN(c[1],2)+'x')+td(fN(c[2],3))+'</tr>';
  }).join('');
  var terms=[["Intercept (β₀)",r.attr[0]],["ln(TVL) (β₁)",r.attr[1]],["ln(chains) (β₅)",r.attr[2]],["Macro-offset (α)",r.attr[3]],["Residual (med_r)",r.attr[4]]].map(function(t){
    var p=t[1]>=0,c=p?'pos':'neg',w=Math.min(50,Math.abs(t[1])*15);
    return'<div class="a-row"><span style="color:var(--m)">'+t[0]+'</span><div class="a-trk"><div class="a-mid"></div><div class="a-bar '+c+'" style="width:'+w+'%"></div></div><span class="mono '+c+'" style="text-align:right">'+(p?'+':'')+fN(t[1],2)+'</span></div>';
  }).join('');
  var steps=getFarmSteps(r).map(function(s,i){
    return'<div class="f-card"><div class="f-head"><span class="f-num">STEP '+(i+1)+'</span><span style="color:var(--m)">Cost: '+s.cost+' · Time: '+s.time+'</span></div><div class="f-txt">'+s.text+'</div></div>';
  }).join('');
  var wl=r.is_watchlist?'<span class="badge b-wl">WATCHLIST</span>':'';
  return'<dialog class="drawer" open><div class="d-head"><div><div style="display:flex;align-items:center;gap:6px;margin-bottom:2px"><span class="mono" style="color:var(--x);font-size:10px">#'+r.rank+'</span><span class="badge b-'+r.verdict+'">'+r.verdict+'</span>'+wl+'</div><div class="d-title">'+r.name+'</div><div class="d-sub">'+(r.category||"DeFi")+' · '+fC(r.chains)+' · '+fA(r.age_days)+' old</div></div><button class="d-close" data-act="close">✕ Close</button></div>'+
    sec("Valuation & Launch Probability",bX("g4",[["P10 Floor",fU(r.v10_usd)],["P50 Base",fU(r.v50_usd)],["P90 Ceiling",fU(r.v90_usd)],["Implied",fU(r.implied_value_usd),'pos']])+'<div style="font-size:10.5px;color:var(--m);font-family:var(--fm);margin-top:4px">P(Launch) = '+fN(r.p_launch,4)+' · Implied = max(1, round(P_launch × V50))</div>')+
    sec("Log-Valuation Attribution (ŷ + med_r)",terms)+
    sec("Costed Farm P&L Ledger",bX("g4",[["Exec Chain",r.exec_chain],["Hard Cost","$"+fN(r.c_hard,2)],["Total Time",r.total_min+" min"],["Gross Hold",r.gross_hold!=null?(r.gross_hold*100).toFixed(2)+'%':'—'],["Est. Yield/yr",r.y_airdrop_ann!=null?(r.y_airdrop_ann*100).toFixed(1)+'%':'—'],["Net Cash EV","$"+fN(r.net_cash_ev_10k,2),'pos'],["K_min Floor","$"+r.k_min.toLocaleString("en-US")],["α_circ (assumption)",r.alpha_circ*100+'%']]))+
    sec("3 Nearest Live Comps",'<table><thead><tr><th>Peer</th><th>Cat</th><th>TVL</th><th>MCap</th><th>MCap/TVL</th><th>Dist</th></tr></thead><tbody>'+comps+'</tbody></table>')+
    sec((r.verdict==="skip"?"Disqualification Log":"Farm Playbook"),'<div class="f-tl">'+steps+'</div>')+'</dialog>';
}
function rV(){
  var v=D.validation,pts=v.oof_scatter||[];
  function sx(x){return 24+(x-12)*19.428;}
  function sy(y){return 196-(y-12)*12.285;}
  var circs=pts.map(function(p){return'<circle cx="'+sx(p.actual_ln)+'" cy="'+sy(p.pred_ln)+'" r="2.5" fill="#f59e0b" fill-opacity="0.6"/>';}).join('');
  var diag='<line x1="'+sx(12)+'" y1="'+sy(12)+'" x2="'+sx(26)+'" y2="'+sy(26)+'" stroke="#55657d" stroke-dasharray="2,2"/>';
  var axes='<line x1="24" y1="196" x2="296" y2="196" stroke="#283344"/><line x1="24" y1="24" x2="24" y2="196" stroke="#283344"/>';
  var svgStr='<svg class="sc-svg" viewBox="0 0 320 220">'+diag+axes+circs+'</svg>';
  function tbl(t){
    return'<table><thead><tr><th>Model</th><th>RMSLE</th><th>MAE_log</th><th>Spearman</th><th>NDCG@20</th><th>ΔRMSLE</th><th>Kept</th></tr></thead><tbody>'+
      (t||[]).map(function(r){
        return'<tr><td class="mono" style="font-weight:600;color:#fff">'+r.model+'</td>'+
          [r.rmsle,r.mae_log,r.spearman_mean_fold,r.ndcg20,r.delta].map(function(x){return td(fN(x,4));}).join('')+
          '<td class="mono" style="color:'+(r.kept?'var(--gt)':'var(--m)')+'">'+(r.kept?'YES':'—')+'</td></tr>';
      }).join('')+'</tbody></table>';
  }
  var liveRows=D.live.map(function(l){
    var r=l.tvl_usd>0?(l.mcap_usd/l.tvl_usd).toFixed(2)+'x':'—';
    var cls=l.change_7d>0?'pos':l.change_7d<0?'neg':'';
    return'<tr><td style="font-weight:600;color:#fff">'+l.name+'</td><td>'+(l.category||"DeFi")+'</td><td>'+fC(l.chains)+'</td>'+td(fU(l.tvl_usd))+td(fU(l.mcap_usd))+td(r)+td(fP(l.change_7d),cls)+'</tr>';
  }).join('');
  var lastMatch=v.stage_a.match.table[v.stage_a.match.table.length-1]||{};
  var ffBeta=v.stage_a.final_fit.beta||[],ffAlpha=v.stage_a.final_fit.alpha||{};
  return'<div class="v-pan"><div class="g2">'+
    sec("OOF CV Scatter (n=93)",'<div class="sc-box">'+svgStr+'</div><div style="text-align:center;font-size:10.5px;color:var(--m);margin-top:4px;font-family:var(--fm)">Final fit RMSLE: '+fN(lastMatch.rmsle,4)+' · Coverage: '+fN(v.stage_a.match.conformal.coverage_pct,1)+'%</div>')+
    sec("Fit Parameters",bX("g2",[["Huber λ / m_shr",v.stage_a.final_fit.lambda+" / "+v.stage_a.final_fit.m_shr],["Beta Intercept β₀",fN(ffBeta[0],4)],["Beta ln(TVL) β₁",fN(ffBeta[1],4)],["Beta Free (x5)",fN(ffBeta[2],4)],["Trading / Credit α",fN(ffAlpha.Trading,3)+" / "+fN(ffAlpha.Credit,3)],["Vaults / Infra α",fN(ffAlpha.Vaults,3)+" / "+fN(ffAlpha.Infra,3)],["Conformal med_r",fN(v.stage_a.match.conformal.med_r,4)],["LOO Coverage",fN(v.stage_a.match.conformal.coverage_pct,1)+'%']]))+'</div>'+
    sec("Ablation: L_match (n=93)",tbl(v.stage_a.match.table))+
    sec("Ablation: L_all (n=119)",tbl(v.stage_a.all.table))+
    sec("Stage B Proof",bX("g4",[["Baseline B0 AUC/Brier",fN(v.stage_b.cv.b0.auc,3)+"/"+fN(v.stage_b.cv.b0.brier,3)],["Cure B1 AUC/Brier",fN(v.stage_b.cv.b1.auc,3)+"/"+fN(v.stage_b.cv.b1.brier,3)],["Service B2 AUC/Brier",fN(v.stage_b.cv.b2.auc,3)+"/"+fN(v.stage_b.cv.b2.brier,3)],["Final AUC / Brier / BSS",fN(v.stage_b.cv.final.auc,3)+"/"+fN(v.stage_b.cv.final.brier,3)+"/"+fN(v.stage_b.cv.final.bss,3)],["Cure (w0, tau, m)",v.stage_b.cure.w0+"/"+v.stage_b.cure.tau+"d/m="+v.stage_b.cure.m],["D_service Effect",fN(v.stage_b.d_service,4)],["Target & Baseline p0",v.stage_b.target+" ("+fN(v.stage_b.p0,3)+")"],["P_floor / Q75_implied",fN(v.verdicts.p_floor,3)+" / "+fU(v.verdicts.q75_implied)]]))+
    sec("24 Isolated Live Tokens (Peer Reference · Not Ranked on Pre-Token Board)",'<table><thead><tr><th>Protocol</th><th>Cat</th><th>Chains</th><th>TVL</th><th>MCap</th><th>MCap/TVL</th><th>7d Chg</th></tr></thead><tbody>'+liveRows+'</tbody></table>')+'</div>';
}
function uX(){
  var sorted=gR();
  var cnt=document.querySelector(".cnt");
  if(cnt)cnt.textContent=sorted.length+" of "+D.rows.length+" rows";
  var dyn=document.getElementById("dyn");
  if(!dyn)return;
  dyn.innerHTML=S.tab==="radar"?(rT(sorted)+(S.sel?rD():'')):rV();
}
function init(){
  var cats=[],chs=[],farmCount=0,skipCount=0,wlCount=0,totImplied=0;
  D.rows.forEach(function(r){
    if(r.category&&cats.indexOf(r.category)<0)cats.push(r.category);
    if(r.chains)r.chains.forEach(function(c){if(chs.indexOf(c)<0)chs.push(c);});
    if(r.verdict==="farm")farmCount++;else if(r.verdict==="skip")skipCount++;
    if(r.is_watchlist)wlCount++;
    totImplied+=r.implied_value_usd;
  });
  cats.sort();chs.sort();
  var cpCount=D.cp.length;
  var mkOpt=function(a){return a.map(function(c){return'<option value="'+c+'">'+c+'</option>';}).join('');};
  var app=document.getElementById("app");
  app.innerHTML='<div class="shell"><div class="top-bar"><div class="brand"><span>Token Launch Radar</span><span class="badge b-m">'+D.model_version+'</span></div><div class="stats-strip"><span>Snapshot: <b>'+D.as_of+'</b></span><span>Floor: <b>'+fU(D.floor_usd)+'</b></span><span>Watchlist: <b>'+wlCount+'/'+wlCount+'</b></span><span>Scored: <b>'+D.rows.length+'</b></span><span>Live: <b>'+D.live.length+'</b></span></div></div><section class="hero"><div><h1>Empirical Pre-Token Valuation & Execution Radar</h1><p>Huber power-law + macro-group EB + cure model + costed ROI.</p><div class="hero-note">* alpha_circ (0.20–0.25 of circulating MCap) is an empirical modeling assumption, not snapshot data.</div></div>'+bX("h-grid",[["Total Implied Value",fU(totImplied)],["FARM / SKIP Counts",farmCount+" / "+skipCount],["Watchlist Coverage","40/40 (100%)"],["Live Calibration Peers",String(cpCount)]])+'</section><div class="f-strip"><span>Implied = max(1, round(P_launch × V50)); V50 = exp(ŷ + med_r)</span><span>Calibrated against '+cpCount+' live peers</span></div><div class="ctrls"><input class="inp" id="qInp" placeholder="Search protocols, chains, categories..." value="'+S.q+'"><select class="sel" id="catSel"><option value="all">All Categories</option>'+mkOpt(cats)+'</select><select class="sel" id="chSel"><option value="all">All Chains</option>'+mkOpt(chs)+'</select><select class="sel" id="vSel"><option value="all">All Verdicts</option><option value="farm">FARM</option><option value="watch">WATCH</option><option value="skip">SKIP</option></select><label class="chk"><input type="checkbox" id="nsChk">Hide Skips</label><label class="chk"><input type="checkbox" id="wlChk">Watchlist Only</label><div class="t-grp"><button class="t-btn" data-tab="radar" aria-selected="true">Pre-Token Radar</button><button class="t-btn" data-tab="val" aria-selected="false">Validation & Live Comps</button></div><span class="cnt">'+D.rows.length+' of '+D.rows.length+' rows</span></div><div id="dyn"></div></div>';
  app.addEventListener("input",function(e){if(e.target.id==="qInp"){S.q=e.target.value;uX();}});
  app.addEventListener("change",function(e){
    var id=e.target.id;
    if(id==="catSel")S.cat=e.target.value;
    else if(id==="chSel")S.ch=e.target.value;
    else if(id==="vSel")S.v=e.target.value;
    else if(id==="nsChk")S.noSkip=e.target.checked;
    else if(id==="wlChk")S.wl=e.target.checked;
    uX();
  });
  app.addEventListener("click",function(e){
    var t=e.target,btn=t.closest("button");
    if(btn){
      var d=btn.dataset;
      if(d.sort){if(S.sort===d.sort)S.dir=-S.dir;else{S.sort=d.sort;S.dir=d.sort==="name"||d.sort==="rank"?1:-1;}uX();return;}
      if(d.tab){S.tab=d.tab;S.sel=null;app.querySelectorAll(".t-btn").forEach(function(b){b.setAttribute("aria-selected",b.dataset.tab===S.tab?"true":"false");});uX();return;}
      if(d.act==="close"){S.sel=null;uX();return;}
    }
    var tr=t.closest("tbody tr[data-slug]");
    if(tr&&S.tab==="radar"){var s=tr.getAttribute("data-slug");S.sel=S.sel===s?null:s;uX();return;}
    if(t.classList.contains("drawer")){S.sel=null;uX();}
  });
  window.addEventListener("keydown",function(e){if(e.key==="Escape"&&S.sel){S.sel=null;uX();}});
  uX();
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();