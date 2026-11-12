// Generates icons/icon{16,32,48,128}.png with Node built-ins only: `node make-icons.mjs`
import {deflateSync} from 'node:zlib';
import {writeFileSync,mkdirSync} from 'node:fs';
const crcT=new Int32Array(256).map((_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c});
const crc=b=>{let c=-1;for(const x of b)c=crcT[(c^x)&255]^(c>>>8);return(c^-1)>>>0};
const chunk=(t,d)=>{const b=Buffer.alloc(12+d.length);b.writeUInt32BE(d.length,0);b.write(t,4,'ascii');d.copy(b,8);b.writeUInt32BE(crc(b.subarray(4,8+d.length)),8+d.length);return b};
const dist=(px,py,ax,ay,bx,by)=>{const dx=bx-ax,dy=by-ay,t=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy)));return Math.hypot(px-ax-t*dx,py-ay-t*dy)};
function icon(n){
  const S=4,raw=Buffer.alloc((n*4+1)*n);
  for(let y=0;y<n;y++){raw[y*(n*4+1)]=0;for(let x=0;x<n;x++){
    let r=0,g=0,b=0,a=0;
    for(let sy=0;sy<S;sy++)for(let sx=0;sx<S;sx++){
      const u=(x+(sx+.5)/S)/n,v=(y+(sy+.5)/S)/n;
      // rounded square, dark
      const rad=.22,cx=Math.min(Math.max(u,rad),1-rad),cy=Math.min(Math.max(v,rad),1-rad);
      if(Math.hypot(u-cx,v-cy)>rad)continue;
      let c=[17,17,17];
      // yellow check mark
      const w=.075;
      if(dist(u,v,.27,.53,.43,.69)<w||dist(u,v,.43,.69,.74,.33)<w)c=[244,198,61];
      r+=c[0];g+=c[1];b+=c[2];a++;
    }
    const o=y*(n*4+1)+1+x*4,k=S*S;
    raw[o]=a?Math.round(r/a):0;raw[o+1]=a?Math.round(g/a):0;raw[o+2]=a?Math.round(b/a):0;raw[o+3]=Math.round(255*a/k);
  }}
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(n,0);ihdr.writeUInt32BE(n,4);ihdr[8]=8;ihdr[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
mkdirSync(new URL('./icons/',import.meta.url),{recursive:true});
for(const n of [16,32,48,128])writeFileSync(new URL(`./icons/icon${n}.png`,import.meta.url),icon(n));
