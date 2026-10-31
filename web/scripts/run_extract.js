const http=require('http'),fs=require('fs'),path=require('path');const {chromium}=require('playwright');
const dir=process.argv[2];const types={'.html':'text/html','.js':'text/javascript','.wasm':'application/wasm'};
const srv=http.createServer((q,r)=>{const f=path.join(dir,decodeURIComponent(q.url.split('?')[0])==='/'?'index.html':decodeURIComponent(q.url.split('?')[0]));
fs.readFile(f,(e,d)=>{if(e){r.writeHead(404);return r.end()}r.writeHead(200,{'Content-Type':types[path.extname(f)]||'application/octet-stream'});r.end(d)})}).listen(0,async()=>{
const b=await chromium.launch();const p=await b.newPage();const logs=[];
p.on('console',m=>logs.push(m.text()));p.on('pageerror',e=>logs.push('[pageerror] '+e.message));
await p.goto('http://localhost:'+srv.address().port+'/');
const t0=Date.now();while(Date.now()-t0<400000&&!logs.some(l=>/FIM_OK|^ERRO|pageerror/.test(l)))await new Promise(r=>setTimeout(r,1000));
fs.writeFileSync(path.join(dir,'log.txt'),logs.join('\n'));
const out=await p.evaluate(()=>{try{const d=window.__m.FS.readFile('/out/mk64.o2r');let s='';for(let i=0;i<d.length;i+=32768)s+=String.fromCharCode.apply(null,d.subarray(i,i+32768));return btoa(s)}catch(e){return null}});
if(out)fs.writeFileSync(path.join(dir,'mk64.o2r'),Buffer.from(out,'base64'));
console.log(logs.filter(l=>!/Added|^\[torch\] .*(Processing|Writing)/.test(l)).slice(-25).join('\n').slice(0,3500));
console.log('mk64.o2r:',fs.existsSync(path.join(dir,'mk64.o2r'))?fs.statSync(path.join(dir,'mk64.o2r')).size:'ausente');
await b.close();srv.close()});
