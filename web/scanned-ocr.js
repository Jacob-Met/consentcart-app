// The model, worker, WASM and language data stay on this application's origin.
const LOCAL_ENGINE={
 workerPath:'/vendor/tesseract/worker.min.js',
 corePath:'/vendor/tesseract/core',
 langPath:'/vendor/tesseract/lang',
 gzip:true,
 workerBlobURL:false
};

// Retry hard-to-read pages in their other physical orientations rather than
// returning vertical gibberish as if it were the merchant's terms.
const words=text=>text.match(/[\p{L}\p{N}]{3,}/gu)||[];
const recognized=result=>{
 const text=typeof result?.data?.text==='string'?result.data.text.replace(/\r/g,'').trim():'';
 const confidence=Number.isFinite(result?.data?.confidence)?result.data.confidence:null;
 const lines=text.split('\n').map(line=>line.trim()).filter(Boolean);
 const intactStarts=lines.filter(line=>/^\p{Lu}/u.test(line)).length;
 const fragmentStarts=lines.filter(line=>/^\p{Ll}/u.test(line)).length;
 const score=(confidence??0)*Math.min(1,Math.max(.45,words(text).length/8))+
   Math.min(24,text.length*.15)+intactStarts*4-fragmentStarts*2;
 return {text,confidence,score};
};
export function turnScannedPage(original,degrees,makeCanvas=()=>document.createElement('canvas')){
 const canvas=makeCanvas();
 const sideways=degrees===90||degrees===270;
 canvas.width=sideways?original.height:original.width;
 canvas.height=sideways?original.width:original.height;
 const context=canvas.getContext('2d',{alpha:false});
 if(!context)throw Error('The original page cannot be rotated on this device.');
 context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
 if(degrees===90){context.translate(canvas.width,0);context.rotate(Math.PI/2)}
 else if(degrees===270){context.translate(0,canvas.height);context.rotate(-Math.PI/2)}
 else {context.translate(canvas.width,canvas.height);context.rotate(Math.PI)}
 context.drawImage(original,0,0);
 return canvas;
}

// An unevenly lit paper scan may carry complete ink that OCR discards.
// Estimate the paper tone around each pixel and restore dark strokes without
// altering the original page displayed to the buyer.
export function enhanceScannedPixels(rgba,width,height,mode='tone'){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||rgba.length!==width*height*4)
   throw Error('Invalid scanned image.');
 const stride=width+1,integral=new Float64Array(stride*(height+1));
 const gray=new Uint8Array(width*height);
 for(let y=0;y<height;y++){
   let sum=0;
   for(let x=0;x<width;x++){
     const pixel=y*width+x,pixel4=pixel*4;
     const light=(rgba[pixel4]*77+rgba[pixel4+1]*150+rgba[pixel4+2]*29)>>8;
     gray[pixel]=light;sum+=light;
     integral[(y+1)*stride+x+1]=integral[y*stride+x+1]+sum;
   }
 }
 const radius=Math.max(6,Math.min(38,Math.round(width/72)));
 const output=new Uint8ClampedArray(rgba.length);
 for(let y=0;y<height;y++){
   const top=Math.max(0,y-radius),bottom=Math.min(height,y+radius+1);
   for(let x=0;x<width;x++){
     const left=Math.max(0,x-radius),right=Math.min(width,x+radius+1);
     const mean=(integral[bottom*stride+right]-integral[top*stride+right]-
       integral[bottom*stride+left]+integral[top*stride+left])/
       ((bottom-top)*(right-left));
     const color=mode==='binary'?(gray[y*width+x]<mean-Math.max(9,mean/22)?0:255):
       Math.max(0,Math.min(255,Math.round(255-(mean-gray[y*width+x])*8)));
     const offset=(y*width+x)*4;
     output[offset]=output[offset+1]=output[offset+2]=color;output[offset+3]=255;
   }
 }
 return output;
}
// A page-level OCR confidence can be very high even when words on a dark
// portion of the paper have disappeared. Sample the paper's brightness in
// vertical bands independently from the OCR confidence score.
function unevenLighting(original,makeCanvas){
 if(typeof original.getContext!=='function')return false;
 let thumbnail=null;
 try{
   thumbnail=makeCanvas();thumbnail.width=thumbnail.height=96;
   const context=thumbnail.getContext('2d',{willReadFrequently:true});
   if(!context)return false;
   context.drawImage(original,0,0,96,96);
   const data=context.getImageData(0,0,96,96).data;
   const levels=[];
   for(let x=9;x<90;x+=9){
     const samples=[];
     for(let y=18;y<80;y++){
       const n=(y*96+x)*4;
       samples.push((data[n]*77+data[n+1]*150+data[n+2]*29)>>8);
     }
     samples.sort((a,b)=>a-b);
     levels.push(samples[Math.floor(samples.length*.25)]);
   }
   return Math.max(...levels)-Math.min(...levels)>38;
 }catch{return false}
 finally{if(thumbnail)thumbnail.width=thumbnail.height=0}
}

function enhancedPage(original,makeCanvas,mode){
 const count=original.width*original.height;
 if(count>8_000_000)return null;
 const source=original.getContext('2d',{willReadFrequently:true});
 if(!source)return null;
 const pixels=source.getImageData(0,0,original.width,original.height);
 const canvas=makeCanvas();canvas.width=original.width;canvas.height=original.height;
 const ctx=canvas.getContext('2d');
 if(!ctx)throw Error('This device cannot improve this scanned page.');
 const result=ctx.createImageData(canvas.width,canvas.height);
 result.data.set(enhanceScannedPixels(pixels.data,canvas.width,canvas.height,mode));
 ctx.putImageData(result,0,0);
 return canvas;
}

export function createScannedPageReader({load=()=>import('./vendor/tesseract/tesseract.esm.min.js'),makeCanvas=()=>document.createElement('canvas'),allowRotation=typeof document!=='undefined'}={}){
 let worker=null,opening=null,activeProgress=()=>{};
 const ensure=async()=>{
   if(worker)return worker;
   if(!opening)opening=load().then(async library=>{
     const api=library.default||library;
     if(typeof api.createWorker!=='function')throw Error('Page reading is not available in this browser.');
     return api.createWorker(['eng','spa'],1,{
       ...LOCAL_ENGINE,
       logger:event=>{
         if(event?.status==='recognizing text'&&Number.isFinite(event.progress))
           activeProgress(Math.round(event.progress*100));
       }
     });
   }).then(result=>(worker=result),error=>{opening=null;throw error});
   return opening;
 };
 return {
   async read(canvas,onProgress=()=>{}){
     if(!canvas||!canvas.width||!canvas.height)
       throw Error('The original PDF image is not ready to read.');
     const engine=await ensure();
     activeProgress=onProgress;
     try{
       let best={...recognized(await engine.recognize(canvas)),rotation:0};
       if((best.confidence===null||best.confidence<58||words(best.text).length<6)&&allowRotation){
         for(const degrees of [270,90,180]){
           const rotated=turnScannedPage(canvas,degrees,makeCanvas);
           try{
             const candidate=recognized(await engine.recognize(rotated));
             if(candidate.score>best.score)best={...candidate,rotation:degrees};
           }finally{rotated.width=rotated.height=0}
           if(best.confidence>=84&&words(best.text).length>=8)break;
         }
       }
       if(allowRotation&&(best.score<70||unevenLighting(canvas,makeCanvas))){
         // Paper shadows can erase whole words while reporting high page confidence.
         // Independently restore tonal detail and sharp ink, then keep the fuller
         // line-structured reading. Neither candidate changes the source image.
         for(const mode of ['tone','binary']){
           let enhanced=null;
           try{
             enhanced=enhancedPage(canvas,makeCanvas,mode);
             if(!enhanced)break;
             const contrasted=recognized(await engine.recognize(enhanced));
             if(contrasted.score>best.score)best={...contrasted,rotation:0};
             if(best.score<70){
               for(const degrees of [270,90,180]){
                 const turned=turnScannedPage(enhanced,degrees,makeCanvas);
                 try{
                   const candidate=recognized(await engine.recognize(turned));
                   if(candidate.score>best.score)best={...candidate,rotation:degrees};
                 }finally{turned.width=turned.height=0}
                 if(best.score>=80&&words(best.text).length>=8)break;
               }
             }
           }catch{
             // Image recovery can fail on constrained browsers; keep the source
             // page and original OCR or manual transcription path available.
           }finally{if(enhanced)enhanced.width=enhanced.height=0}
         }
       }
       if(!best.text)throw Error('No words were recognized. Read the original page and enter its terms.');
       return {text:best.text,confidence:best.confidence,rotation:best.rotation};
     }finally{activeProgress=()=>{}}
   },
   async terminate(){
     const current=worker||await opening?.catch(()=>null);
     worker=null;opening=null;activeProgress=()=>{};
     await current?.terminate?.();
   }
 };
}
