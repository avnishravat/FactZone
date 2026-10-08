const sharp=require('sharp');
const fs=require('fs');
const path=require('path');
const http=require('http');
const https=require('https');

const ROOT=path.join(__dirname,'..');
const postsDir=path.join(ROOT,'data/posts');
const outputDir=path.join(ROOT,'assets/images/posts');

fs.mkdirSync(postsDir,{recursive:true});
fs.mkdirSync(outputDir,{recursive:true});

function fetchBuffer(url,redirects=0){
 return new Promise((resolve,reject)=>{
  if(redirects>5)return reject(new Error('Too many redirects'));
  const client=url.startsWith('https://')?https:http;
  const req=client.get(url,{headers:{'User-Agent':'FactZone Image Builder/1.0'}},res=>{
   if(res.statusCode>=300&&res.statusCode<400&&res.headers.location){
    res.resume(); return fetchBuffer(new URL(res.headers.location,url).toString(),redirects+1).then(resolve).catch(reject);
   }
   if(res.statusCode!==200){res.resume();return reject(new Error('HTTP '+res.statusCode));}
   const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve(Buffer.concat(chunks)));res.on('error',reject);
  });
  req.setTimeout(30000,()=>req.destroy(new Error('Request timeout')));
  req.on('error',reject);
 });
}
function getInlineUrls(html){
 return [...String(html||'').matchAll(/<img\b[^>]*\bsrc=["'](https?:\/\/[^"']+)["'][^>]*>/gi)].map(m=>m[1]);
}
async function convertOne(url,outFile){
 if(fs.existsSync(outFile)&&fs.statSync(outFile).size>0){console.log('[SKIP] '+path.basename(outFile));return;}
 try{
  const input=await fetchBuffer(url);
  await sharp(input).resize(1200,675,{fit:'cover',position:'center'}).webp({quality:80,effort:6}).toFile(outFile);
  console.log('[SUCCESS] '+url+' -> '+path.relative(ROOT,outFile));
 }catch(err){console.error('[ERROR] '+url+': '+err.message);}
}
async function convertImages(){
 for(const file of fs.readdirSync(postsDir).filter(f=>f.endsWith('.json'))){
  try{
   const post=JSON.parse(fs.readFileSync(path.join(postsDir,file),'utf8'));
   const slug=post.slug||path.parse(file).name;
   if(post.image&&/^https?:\/\//i.test(post.image)) await convertOne(post.image,path.join(outputDir,slug+'.webp'));
   const urls=getInlineUrls(post.content);
   for(let i=0;i<urls.length;i++) await convertOne(urls[i],path.join(outputDir,slug+'-inline-'+(i+1)+'.webp'));
  }catch(err){console.error('[ERROR] '+file+': '+err.message);}
 }
}
convertImages();