// Minimal QR Code generator (byte mode, error correction L or M, versions 1-10). No dependencies.
// qrSvg(text) returns an SVG string. Used to show the phone-approval link on the consent step.
const ECC_PER_BLOCK={L:[7,10,15,20,26,18,20,24,30,18],M:[10,16,26,18,24,16,18,22,22,26]};
const NUM_BLOCKS={L:[1,1,1,1,1,2,2,2,2,4],M:[1,1,1,2,2,4,4,4,5,5]};
const FORMAT_BITS={L:1,M:0};
const rawModules=v=>{let r=(16*v+128)*v+64;if(v>=2){const n=Math.floor(v/7)+2;r-=(25*n-10)*n-55;if(v>=7)r-=36}return r};
const mul=(x,y)=>{let z=0;for(let i=7;i>=0;i--){z=(z<<1)^((z>>>7)*0x11D);z^=((y>>>i)&1)*x}return z};
const divisor=n=>{const r=new Array(n).fill(0);r[n-1]=1;let root=1;for(let i=0;i<n;i++){for(let j=0;j<n;j++){r[j]=mul(r[j],root);if(j+1<n)r[j]^=r[j+1]}root=mul(root,2)}return r};
const remainder=(data,div)=>{const r=div.map(()=>0);for(const b of data){const f=b^r.shift();r.push(0);div.forEach((c,i)=>{r[i]^=mul(c,f)})}return r};

function build(text,ecl){
  const bytes=[...new TextEncoder().encode(text)];
  let ver=0,cap=0;
  for(let v=1;v<=10;v++){
    const total=Math.floor(rawModules(v)/8),dataCw=total-ECC_PER_BLOCK[ecl][v-1]*NUM_BLOCKS[ecl][v-1];
    const need=4+(v<10?8:16)+8*bytes.length;
    if(need<=dataCw*8){ver=v;cap=dataCw;break}
  }
  if(!ver)return null;
  const bits=[];const put=(val,len)=>{for(let i=len-1;i>=0;i--)bits.push((val>>>i)&1)};
  put(4,4);put(bytes.length,ver<10?8:16);bytes.forEach(b=>put(b,8));
  put(0,Math.min(4,cap*8-bits.length));while(bits.length%8)bits.push(0);
  const data=[];for(let i=0;i<bits.length;i+=8)data.push(parseInt(bits.slice(i,i+8).join(''),2));
  for(let pad=0xEC;data.length<cap;pad^=0xEC^0x11)data.push(pad);
  // error correction + interleave
  const nb=NUM_BLOCKS[ecl][ver-1],el=ECC_PER_BLOCK[ecl][ver-1],raw=Math.floor(rawModules(ver)/8);
  const shortBlocks=nb-raw%nb,shortLen=Math.floor(raw/nb),div=divisor(el),blocks=[];
  for(let i=0,k=0;i<nb;i++){
    const d=data.slice(k,k+shortLen-el+(i<shortBlocks?0:1));k+=d.length;
    const e=remainder(d,div);if(i<shortBlocks)d.push(0);blocks.push(d.concat(e));
  }
  const all=[];
  for(let i=0;i<blocks[0].length;i++)blocks.forEach((b,j)=>{if(i!==shortLen-el||j>=shortBlocks)all.push(b[i])});
  // matrix
  const size=ver*4+17,mod=Array.from({length:size},()=>new Array(size).fill(false)),fn=Array.from({length:size},()=>new Array(size).fill(false));
  const setFn=(x,y,v)=>{mod[y][x]=v;fn[y][x]=true};
  for(let i=0;i<size;i++){setFn(6,i,i%2===0);setFn(i,6,i%2===0)}
  const finder=(x,y)=>{for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){const d=Math.max(Math.abs(dx),Math.abs(dy)),xx=x+dx,yy=y+dy;if(xx>=0&&xx<size&&yy>=0&&yy<size)setFn(xx,yy,d!==2&&d!==4)}};
  finder(3,3);finder(size-4,3);finder(3,size-4);
  const na=ver===1?0:Math.floor(ver/7)+2;const pos=[];
  if(na){const step=Math.floor((ver*8+na*3+5)/(na*4-4))*2;pos.push(6);for(let p=size-7;pos.length<na;p-=step)pos.splice(1,0,p)}
  for(let i=0;i<na;i++)for(let j=0;j<na;j++){
    if((i===0&&j===0)||(i===0&&j===na-1)||(i===na-1&&j===0))continue;
    for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)setFn(pos[i]+dx,pos[j]+dy,Math.max(Math.abs(dx),Math.abs(dy))!==1);
  }
  const format=mask=>{
    const d=(FORMAT_BITS[ecl]<<3)|mask;let r=d;for(let i=0;i<10;i++)r=(r<<1)^((r>>>9)*0x537);
    const b=((d<<10)|r)^0x5412,bit=i=>((b>>>i)&1)!==0;
    for(let i=0;i<=5;i++)setFn(8,i,bit(i));setFn(8,7,bit(6));setFn(8,8,bit(7));setFn(7,8,bit(8));
    for(let i=9;i<15;i++)setFn(14-i,8,bit(i));
    for(let i=0;i<8;i++)setFn(size-1-i,8,bit(i));
    for(let i=8;i<15;i++)setFn(8,size-15+i,bit(i));
    setFn(8,size-8,true);
  };
  format(0);
  if(ver>=7){
    let r=ver;for(let i=0;i<12;i++)r=(r<<1)^((r>>>11)*0x1F25);
    const b=(ver<<12)|r;
    for(let i=0;i<18;i++){const c=((b>>>i)&1)!==0,a=size-11+i%3,bb=Math.floor(i/3);setFn(a,bb,c);setFn(bb,a,c)}
  }
  let idx=0;
  for(let right=size-1;right>=1;right-=2){
    if(right===6)right=5;
    for(let vert=0;vert<size;vert++)for(let j=0;j<2;j++){
      const x=right-j,up=((right+1)&2)===0,y=up?size-1-vert:vert;
      if(!fn[y][x]&&idx<all.length*8){mod[y][x]=((all[idx>>>3]>>>(7-(idx&7)))&1)!==0;idx++}
    }
  }
  const applyMask=m=>{for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const inv=[(x+y)%2===0,y%2===0,x%3===0,(x+y)%3===0,(Math.floor(x/3)+Math.floor(y/2))%2===0,x*y%2+x*y%3===0,(x*y%2+x*y%3)%2===0,((x+y)%2+x*y%3)%2===0][m];
    if(!fn[y][x]&&inv)mod[y][x]=!mod[y][x]}};
  const penalty=()=>{
    let p=0;const rows=mod.map(r=>r.map(v=>v?'1':'0').join('')),cols=[];
    for(let x=0;x<size;x++)cols.push(mod.map(r=>r[x]?'1':'0').join(''));
    for(const line of [...rows,...cols]){
      for(const m of line.matchAll(/0{5,}|1{5,}/g))p+=m[0].length-2;
      p+=40*((line.match(/10111010000/g)||[]).length+(line.match(/00001011101/g)||[]).length);
    }
    for(let y=0;y<size-1;y++)for(let x=0;x<size-1;x++){const c=mod[y][x];if(c===mod[y][x+1]&&c===mod[y+1][x]&&c===mod[y+1][x+1])p+=3}
    const dark=mod.flat().filter(Boolean).length,total=size*size;
    p+=(Math.ceil(Math.abs(dark*20-total*10)/total)-1)*10;
    return p;
  };
  let best=0,bestP=Infinity;
  for(let m=0;m<8;m++){applyMask(m);format(m);const p=penalty();if(p<bestP){bestP=p;best=m}applyMask(m)}
  applyMask(best);format(best);
  return mod;
}

export function qrSvg(text,{ecl='M',scale=1}={}){
  const m=build(String(text),ecl)||build(String(text),'L');
  if(!m)throw new Error('QR text is too long.');
  const n=m.length,q=4;let d='';
  for(let y=0;y<n;y++)for(let x=0;x<n;x++)if(m[y][x])d+=`M${x+q},${y+q}h1v1h-1z`;
  const s=(n+q*2)*scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n+q*2} ${n+q*2}" width="${s}" height="${s}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
