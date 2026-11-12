import test from 'node:test';
import assert from 'node:assert/strict';
import {createScannedPageReader,enhanceScannedPixels} from '../web/scanned-ocr.js';

test('on-device scanned-page reader reuses its worker and never silently includes text',async()=>{
 let created=0,terminated=0,lastOptions,recognized=0;
 const reader=createScannedPageReader({load:async()=>({default:{
   createWorker:async(_lang,_oem,options)=>{
     created++;lastOptions=options;
     return {recognize:async()=>{
       recognized++;options.logger({status:'recognizing text',progress:.4});
       return {data:{text:'  The merchant renews this subscription every year.  ',confidence:98}};
     },terminate:async()=>terminated++};
   }
 }})});
 const canvas={width:900,height:640};
 let progress=[];
 const first=await reader.read(canvas,p=>progress.push(p));
 assert.equal(first.text,'The merchant renews this subscription every year.');
 assert.equal(first.confidence,98);
 assert.deepEqual(progress,[40]);
 assert.equal(lastOptions.workerBlobURL,false);
 assert.equal(lastOptions.workerPath,'/vendor/tesseract/worker.min.js');
 assert.equal(lastOptions.langPath,'/vendor/tesseract/lang');
 assert.equal(lastOptions.corePath,'/vendor/tesseract/core');
 assert.equal((await reader.read(canvas)).text,first.text);
 assert.equal(created,1);assert.equal(recognized,2);
 await reader.terminate();
 assert.equal(terminated,1);
 await reader.read(canvas);
 assert.equal(created,2);
 await reader.terminate();
 assert.equal(terminated,2);
});

test('blank OCR result needs original-page typing and invalid images are not processed',async()=>{
 let loads=0;
 const reader=createScannedPageReader({load:async()=>{
   loads++;return {default:{createWorker:async()=>({recognize:async()=>({data:{text:'\n'}}),terminate:async()=>{}})}};
 }});
 await assert.rejects(reader.read({width:0,height:640}),/original PDF image/);
 assert.equal(loads,0);
 await assert.rejects(reader.read({width:300,height:200}),/No words were recognized/);
 assert.equal(loads,1);
 await reader.terminate();
});

test('sideways pages recover original wording and report the rotation for the displayed page',async()=>{
 const original={width:900,height:640},rotated=[];
 const makeCanvas=()=>{
   const canvas={width:0,height:0,angle:0};
   canvas.getContext=()=>({
     fillRect:()=>{},translate:()=>{},drawImage:()=>{},
     rotate:radians=>{canvas.angle=radians}
   });
   rotated.push(canvas);return canvas;
 };
 let recognized=0;
 const worker={recognize:async image=>{
   recognized++;
   if(image===original)return {data:{text:'S 6 3 3\\no 2 =',confidence:72}};
   assert.equal(image.width,640);assert.equal(image.height,900);
   assert.equal(image.angle,-Math.PI/2);
   return {data:{text:'Cancellation requires written notice. Refunds close five days after renewal.',confidence:95}};
 },terminate:async()=>{}};
 const reader=createScannedPageReader({
   load:async()=>({createWorker:async()=>worker}),
   makeCanvas,
   allowRotation:true
 });
 const result=await reader.read(original);
 assert.match(result.text,/Refunds close five days after renewal/);
 assert.equal(result.rotation,270);
 assert.equal(result.confidence,95);
 assert.equal(recognized,2,'stop retrying when the original is readable');
 assert.equal(rotated[0].width,0,'release temporary rotated image memory');
 await reader.terminate();
});

test('legible upright pages retain their original orientation without extra OCR passes',async()=>{
 const image={width:1200,height:1600};
 let calls=0;
 const reader=createScannedPageReader({
   load:async()=>({createWorker:async()=>({
     recognize:async()=>{calls++;return {data:{text:'Annual subscription renews each year. Cancellation requires written notice.',confidence:96}}},
     terminate:async()=>{}
   })}),
   makeCanvas:()=>{throw Error('clear upright document must not be rotated')},
   allowRotation:true
 });
 const result=await reader.read(image);
 assert.equal(result.rotation,0);
 assert.equal(calls,1);
 await reader.terminate();
});


test('local tone recovery restores faint dark strokes on uneven paper without altering the source',()=>{
 const width=120,height=60,raw=new Uint8ClampedArray(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const paper=90+Math.round(140*x/(width-1));
   const ink=y>=21&&y<=23&&((x>=24&&x<=30)||(x>=78&&x<=84));
   const v=ink?paper-18:paper,i=(y*width+x)*4;
   raw[i]=raw[i+1]=raw[i+2]=v;raw[i+3]=255;
 }
 const before=raw.slice();
 const tone=enhanceScannedPixels(raw,width,height);
 const binary=enhanceScannedPixels(raw,width,height,'binary');
 const value=(image,x,y)=>image[(y*width+x)*4];
 assert.ok(value(tone,27,22)<195,'shaded left text should darken');
 assert.ok(value(tone,81,22)<195,'bright right text should darken');
 assert.ok(value(tone,48,10)>245,'paper should become white');
 assert.equal(value(binary,27,22),0);
 assert.equal(value(binary,48,10),255);
 assert.deepEqual(raw,before,'the original PDF pixels cannot be changed by recognition');
 assert.throws(()=>enhanceScannedPixels(raw,119,height),/Invalid scanned image/);
});
