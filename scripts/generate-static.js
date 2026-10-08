const fs=require('fs');
const path=require('path');
const sanitizeHtml=require('sanitize-html');

const ROOT=path.join(__dirname,'..');
const postsDir=path.join(ROOT,'data/posts');
const outputPostsDir=path.join(ROOT,'posts');
const categoriesDir=path.join(ROOT,'categories');
const indexHtmlPath=path.join(ROOT,'index.html');
const postsIndexJsonPath=path.join(ROOT,'posts-index.json');
const sitemapPath=path.join(ROOT,'sitemap.xml');
const articleTemplatePath=path.join(ROOT,'templates/article.html');
const categoryTemplatePath=path.join(ROOT,'templates/category.html');
const SITE_URL='https://factzone.online';
const CATEGORY_LABELS={science:'Science / विज्ञान',tech:'Tech / तकनीक',history:'History / इतिहास',mystery:'Mystery / रहस्य',viral:'Viral / रोचक तथ्य'};

for(const d of [postsDir,outputPostsDir,categoriesDir])fs.mkdirSync(d,{recursive:true});
function esc(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function stripTags(html){return sanitizeHtml(html||'',{allowedTags:[],allowedAttributes:{}}).replace(/\s+/g,' ').trim();}
function formatDate(v){if(!v)return '';const d=new Date(v);if(Number.isNaN(d.getTime()))return '';return d.toLocaleDateString('hi-IN',{day:'numeric',month:'short',year:'numeric'});}
function iso(v){const d=new Date(v||Date.now());return Number.isNaN(d.getTime())?new Date().toISOString():d.toISOString();}
function categorySlug(v){const s=String(v||'').toLowerCase().trim();for(const [k,label] of Object.entries(CATEGORY_LABELS))if(s===k||s===label.toLowerCase()||s.includes(k))return k;return s.replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'')||'science';}
function imageFor(p){return p.image||SITE_URL+'/assets/images/posts/'+encodeURIComponent(p.slug)+'.webp';}
function canonical(p){return SITE_URL+'/posts/'+encodeURIComponent(p.slug)+'.html';}
function buildArticle(p,all){
 const title=p.title||'FactZone Post',slug=p.slug,date=iso(p.date||p.createdAt),modified=iso(p.updatedAt||date),cat=categorySlug(p.category),catLabel=CATEGORY_LABELS[cat]||p.category||'Science / विज्ञान',description=p.description||p.desc||stripTags(p.content).slice(0,160),author=p.author||'Awaneesh',image=imageFor(p),url=canonical(p);
 const related=all.filter(x=>x.slug!==slug&&categorySlug(x.category)===cat).slice(0,3);
 const relatedHtml=related.length?'<section class="related-posts"><h2>📚 Related FactZone Articles</h2><div class="related-grid">'+related.map(x=>'<a href="/posts/'+encodeURIComponent(x.slug)+'.html">'+esc(x.title)+'</a>').join('')+'</div></section>':'';
 const jsonld={"@context":"https://schema.org","@graph":[
  {"@type":"Organization","@id":SITE_URL+"/#organization","name":"FactZone","url":SITE_URL+"/","logo":{"@type":"ImageObject","url":SITE_URL+"/logo.png","width":512,"height":512}},
  {"@type":"WebSite","@id":SITE_URL+"/#website","name":"FactZone","url":SITE_URL+"/","inLanguage":"hi","publisher":{"@id":SITE_URL+"/#organization"}},
  {"@type":"BreadcrumbList","@id":url+"#breadcrumb","itemListElement":[{"@type":"ListItem","position":1,"name":"Home","item":SITE_URL+"/"},{"@type":"ListItem","position":2,"name":catLabel,"item":SITE_URL+"/categories/"+cat+"/"},{"@type":"ListItem","position":3,"name":title,"item":url}]},
  {"@type":["Article","BlogPosting"],"@id":url+"#article","headline":title,"description":description,"image":[image],"inLanguage":"hi","articleSection":catLabel,"datePublished":date,"dateModified":modified,"author":{"@type":"Person","name":author,"url":SITE_URL+"/author.html"},"publisher":{"@id":SITE_URL+"/#organization"}}
 ]};
 let html=fs.readFileSync(articleTemplatePath,'utf8');
 const repl={
  '{{TITLE}}':esc(title),'{{META_DESCRIPTION}}':esc(description),'{{CANONICAL_URL}}':url,'{{OG_IMAGE}}':image,'{{PUBLISHED_ISO}}':date,'{{MODIFIED_ISO}}':modified,'{{CATEGORY_LABEL}}':esc(catLabel),'{{JSONLD}}':JSON.stringify(jsonld,null,2),'{{CATEGORY_URL}}':SITE_URL+'/categories/'+cat+'/','{{META_LINE}}':'<strong>Author:</strong> '+esc(author)+' &nbsp;•&nbsp; <strong>Date:</strong> '+esc(formatDate(date))+' &nbsp;•&nbsp; <strong>Updated:</strong> '+esc(formatDate(modified)),'{{CONTENT_HTML}}':sanitizeHtml(p.content||'',{allowedTags:sanitizeHtml.defaults.allowedTags.concat(['img','iframe','h1','h2']),allowedAttributes:{'*':['class','style'],a:['href','target','rel'],img:['src','alt','width','height','loading','decoding','fetchpriority']}}),'{{SHARE_WHATSAPP_URL}}':'https://api.whatsapp.com/send?text='+encodeURIComponent(title+' - Read on FactZone: '+url),'{{SHARE_FACEBOOK_URL}}':'https://www.facebook.com/sharer/sharer.php?u='+encodeURIComponent(url),'{{SHARE_TWITTER_URL}}':'https://twitter.com/intent/tweet?text='+encodeURIComponent(title+' - FactZone')+'&url='+encodeURIComponent(url),'{{RELATED_SECTION_HIDDEN}}':relatedHtml?'':' hidden','{{RELATED_HTML}}':relatedHtml,'{{POST_ID}}':esc(p.id||slug)
 };
 for(const [k,v] of Object.entries(repl))html=html.split(k).join(v);
 return html;
}
function buildCategory(cat,posts){
 const label=CATEGORY_LABELS[cat]||cat,url=SITE_URL+'/categories/'+cat+'/',cards=posts.map((p,i)=>'<a class="post-card" href="/posts/'+encodeURIComponent(p.slug)+'.html"><img src="'+esc(imageFor(p))+'" alt="'+esc(p.title)+'" width="1200" height="675" loading="'+(i<3?'eager':'lazy')+'"><div><h2>'+esc(p.title)+'</h2><time datetime="'+iso(p.date||p.createdAt)+'">'+esc(formatDate(p.date||p.createdAt))+'</time></div></a>').join('\n'),jsonld={"@context":"https://schema.org","@type":"CollectionPage","name":label+" | FactZone","url":url,"mainEntity":{"@type":"ItemList","numberOfItems":posts.length,"itemListElement":posts.map((p,i)=>({"@type":"ListItem","position":i+1,"url":canonical(p),"name":p.title}))}};
 let html=fs.readFileSync(categoryTemplatePath,'utf8');const r={'{{CATEGORY_LABEL}}':esc(label),'{{META_DESCRIPTION}}':esc(label+' के FactZone पर सभी लेख पढ़ें।'),'{{CANONICAL_URL}}':url,'{{JSONLD}}':JSON.stringify(jsonld,null,2),'{{POST_COUNT}}':String(posts.length),'{{POST_CARDS_HTML}}':cards};for(const [k,v] of Object.entries(r))html=html.split(k).join(v);fs.mkdirSync(path.join(categoriesDir,cat),{recursive:true});fs.writeFileSync(path.join(categoriesDir,cat,'index.html'),html);
}
function main(){
 const posts=[];for(const file of fs.readdirSync(postsDir).filter(f=>f.endsWith('.json'))){try{const p=JSON.parse(fs.readFileSync(path.join(postsDir,file),'utf8'));p.slug=p.slug||path.parse(file).name;p.date=p.date||p.createdAt||new Date().toISOString();p.category=categorySlug(p.category);if(!p.title||!p.content)throw new Error('title/content missing');posts.push(p);}catch(e){console.error('[ERROR]',file,e.message);}}
 posts.sort((a,b)=>new Date(b.date||0)-new Date(a.date||0));
 const current=new Set(posts.map(p=>p.slug+'.html'));
 for(const f of fs.readdirSync(outputPostsDir)){if(f.endsWith('.html')&&!current.has(f)){try{fs.unlinkSync(path.join(outputPostsDir,f));}catch(e){}}}
 for(const p of posts)fs.writeFileSync(path.join(outputPostsDir,p.slug+'.html'),buildArticle(p,posts));
 fs.writeFileSync(postsIndexJsonPath,JSON.stringify(posts,null,2));
 for(const cat of Object.keys(CATEGORY_LABELS))buildCategory(cat,posts.filter(p=>categorySlug(p.category)===cat));
 const urls=[SITE_URL+'/',...posts.map(canonical),...Object.keys(CATEGORY_LABELS).map(c=>SITE_URL+'/categories/'+c+'/')];
 fs.writeFileSync(sitemapPath,'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+urls.map(u=>'  <url><loc>'+esc(u)+'</loc></url>').join('\n')+'\n</urlset>\n');
 if(fs.existsSync(indexHtmlPath)){
  let h=fs.readFileSync(indexHtmlPath,'utf8'),start=h.indexOf('<!-- POSTS_GRID_START -->'),end=h.indexOf('<!-- POSTS_GRID_END -->');
  if(start>=0&&end>start){const cards=posts.map((p,i)=>'<article class="post-card"><a href="/posts/'+encodeURIComponent(p.slug)+'.html" class="card-link"><div class="card-image-wrapper"><img src="'+esc(imageFor(p))+'" alt="'+esc(p.title)+'" width="1200" height="675" loading="'+(i<4?'eager':'lazy')+'" decoding="async" class="card-image"></div><div class="card-body"><h2 class="card-title">'+esc(p.title)+'</h2><p class="card-excerpt">'+esc(p.excerpt||p.description||stripTags(p.content).slice(0,120)+'…')+'</p><time class="card-date" datetime="'+iso(p.date)+'">'+esc(formatDate(p.date))+'</time></div></a></article>').join('\n');h=h.slice(0,start+26)+'\n'+cards+'\n        '+h.slice(end);}
  const marker=h.indexOf('const FIRESTORE_PROJECT_ID');if(marker>=0){const ss=h.lastIndexOf('<script>',marker),ee=h.indexOf('</script>',marker);if(ss>=0&&ee>ss){const staticScript='<script>\n    const postsContainer=document.getElementById("posts");let selectedCategory="all";\n    function filterPosts(){const q=(document.getElementById("searchInput")?.value||"").toLowerCase();document.querySelectorAll("#posts .card").forEach(c=>{const okCat=selectedCategory==="all"||c.dataset.category===selectedCategory;const okQ=!q||c.textContent.toLowerCase().includes(q);c.style.display=okCat&&okQ?"":"none";});}\n    const q=new URLSearchParams(location.search).get("search");if(q&&document.getElementById("searchInput"))document.getElementById("searchInput").value=q;\n    document.getElementById("searchInput")?.addEventListener("input",filterPosts);document.querySelectorAll(".filter-tab").forEach(tab=>tab.addEventListener("click",()=>{document.querySelectorAll(".filter-tab").forEach(t=>t.classList.remove("active-tab","text-white"));tab.classList.add("active-tab","text-white");selectedCategory=tab.dataset.value;filterPosts();}));filterPosts();\n  </script>';h=h.slice(0,ss)+staticScript+h.slice(ee+9);}}
  h=h.replace(/<link rel="preconnect" href="https:\/\/firestore\.googleapis\.com"[^>]*>\s*/g,'');fs.writeFileSync(indexHtmlPath,h);
 }
 console.log('[DONE] '+posts.length+' posts generated.');
}
main();
