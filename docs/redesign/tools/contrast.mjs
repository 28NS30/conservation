const lin=c=>{c/=255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4};
const L=h=>{h=h.replace('#','');const [r,g,b]=[0,2,4].map(i=>parseInt(h.slice(i,i+2),16));return 0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b)};
const cr=(a,b)=>{const x=L(a),y=L(b);return ((Math.max(x,y)+0.05)/(Math.min(x,y)+0.05))};
// veiling glare: 1000-nit panel, 716 cd/m2 veil
const glare=(a,b)=>{const x=L(a)*1000+716,y=L(b)*1000+716;return Math.max(x,y)/Math.min(x,y)};
const show=(label,a,b)=>console.log(label.padEnd(52),cr(a,b).toFixed(2),' sun',glare(a,b).toFixed(2));
const paper='#faf7f0',plate='#ece2cd',field='#112c1e',f800='#1a3d2b',f700='#2a5a41',water='#0b1410';
const ink9='#16241c',ink7='#2f4a3a',ink6='#435b4c',e7='#9a4e22',e8='#7d3e1a',e4='#e08a4f',p50='#f6efe0',p200='#d8cbb0',p300='#b8ab94',p400='#9d9179',moss7='#4a6835',alert7='#8f2d1f',scale8='#514426';
console.log('--- text on light');
for (const [n,c] of [['ink-900',ink9],['ink-700',ink7],['ink-600',ink6],['ember-700',e7],['ember-800',e8],['moss-700',moss7],['moss-800 #3c552b','#3c552b'],['alert-700',alert7],['scale-800',scale8]]) {show(n+' on paper-50',c,paper);show(n+' on plate',c,plate);}
console.log('--- text on field');
for (const [n,c] of [['parchment-50',p50],['parchment-200',p200],['parchment-300',p300],['parchment-400',p400],['ember-400',e4]]) {show(n+' on field-900',c,field);show(n+' on field-800',c,f800);show(n+' on bark-950',c,water);}
console.log('--- buttons');
show('paper-50 label on ember-700',paper,e7);show('paper-50 label on ember-800 hover',paper,e8);show('field-900 label on ember-400',field,e4);show('parchment-50 label on field-900',p50,field);
show('ember-700 fill vs paper (non-text)',e7,paper);show('ember-700 fill vs plate',e7,plate);show('field-900 fill vs plate',field,plate);show('ember-400 fill vs field-900',e4,field);
show('ink-600 border vs paper',ink6,paper);show('ink-600 border vs plate',ink6,plate);
show('focus ember-700 on paper',e7,paper);show('focus ember-700 on plate',e7,plate);show('focus ember-400 on field',e4,field);show('focus ember-400 on bark-950',e4,water);
console.log('--- blocks');
show('plate vs paper',plate,paper);show('field vs paper',field,paper);show('field vs plate',field,plate);show('land field-900 vs water bark-950',field,water);show('roads field-700 vs land',f700,field);show('coast field-600 #3b7356 vs water','#3b7356',water);show('coast #3b7356 vs land','#3b7356',field);
console.log('--- ramp candidates on land / water / vs prev');
const ramps={A:['#4f8264','#6f9a62','#93b375','#bccb8a','#e0dca6','#f6efe0'],B:['#4f8264','#74a05f','#9dbb7c','#c6cf8c','#e6dfae','#f6efe0']};
for(const [k,r] of Object.entries(ramps)){console.log('ramp',k);r.forEach((h,i)=>console.log('  ',h,'land',cr(h,field).toFixed(2),'water',cr(h,water).toFixed(2),i?('prev '+cr(h,r[i-1]).toFixed(2)):'','sun-land',glare(h,field).toFixed(2)));}
console.log('--- type mode');
show('roadkill ember-400 vs land',e4,field);show('invasive parchment-50 vs land',p50,field);show('sighting ring moss-300 #a8c48a vs land','#a8c48a',field);show('ember-400 vs parchment-50',e4,p50);show('ember-400 vs moss-300',e4,'#a8c48a');
show('selected ring ember-400 vs cream dot',e4,p50);show('halo bark-950 vs cream dot',water,p50);show('halo bark-950 vs ember-400',water,e4);
