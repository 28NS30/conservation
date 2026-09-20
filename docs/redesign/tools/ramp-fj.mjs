const lin=c=>{c/=255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4};
const hex2=h=>{h=h.replace('#','');return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16))};
const Lr=([r,g,b])=>0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b);
const cr=(x,y)=>((Math.max(x,y)+0.05)/(Math.min(x,y)+0.05));
const toHex=a=>'#'+a.map(v=>Math.round(v).toString(16).padStart(2,'0')).join('');
const anchors=['#77a372','#518257','#326140','#19412b','#092316'].map(hex2);
const at=t=>{const s=t*(anchors.length-1);const i=Math.min(Math.floor(s),anchors.length-2);const f=s-i;return anchors[i].map((v,k)=>v+(anchors[i+1][k]-v)*f)};
const land=Lr(hex2('#fbfaf6')),water=Lr(hex2('#e2e8e4'));
const lo=3.05,hi=15.9,n=6;const f=(hi/lo)**(1/(n-1));
let prev=null;
for(let i=0;i<n;i++){const target=lo*f**i;let a=0,b=1;for(let k=0;k<40;k++){const m=(a+b)/2;cr(Lr(at(m)),land)<target?a=m:b=m;}const c=at((a+b)/2);const h=toHex(c);const l=Lr(hex2(h));console.log(h,'land',cr(l,land).toFixed(2),'water',cr(l,water).toFixed(2),prev?('prev '+cr(l,prev).toFixed(2)):'','sun',((l*1000+716)/(land*1000+716)).toFixed(2));prev=l;}
