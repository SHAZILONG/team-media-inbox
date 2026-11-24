'use strict';
const $ = id => document.getElementById(id);
const CHUNK = 4*1024*1024;
const jobs=[];
let code='',running=false;
async function request(url, options={}) {
  if(window.easyRequest)return window.easyRequest(url,options,code);
  const r=await fetch(url,{method:'POST',...options,headers:{Authorization:'Bearer '+code,...options.headers}});
  const data=await r.json();
  if(!r.ok) throw Object.assign(new Error(data.message),{status:r.status});
  return data;
}
if($('login')) $('login').onsubmit=async e=>{
  e.preventDefault(); code=$('code').value; $('connect').disabled=true; $('msg').textContent='正在连接…';
  try {await request('/api/connect'); $('pair').hidden=true; $('upload').hidden=false; $('msg').textContent='';}
  catch(error) {$('msg').textContent=error.status?error.message:'连接中断，请检查电脑和手机的网络。';}
  finally {$('connect').disabled=false;}
};
else {
  code=new URLSearchParams(location.hash.slice(1)).get('k') || '';
  const connect=async()=>{
    $('upload').hidden=true;$('again').hidden=true;$('pair').hidden=false;
    if(!code){$('msg').textContent='请打开群里的完整收件链接，或重新扫描二维码。';return;}
    try {await request('/api/connect');$('pair').hidden=true;$('upload').hidden=false;}
    catch(e){$('msg').textContent=e.status||window.easyRequest?e.message:'暂时连不上接收电脑，请稍后重试。';$('again').hidden=e.status===401;}
  };
  $('again').onclick=connect;connect();
}
$('pick').onclick=()=>$('files').click();
$('files').onchange=()=>{
  for(const file of $('files').files) {
    const row=document.createElement('li'),title=document.createElement('strong'),bar=document.createElement('progress'),status=document.createElement('small'),retry=document.createElement('button');
    title.textContent=file.name; bar.max=100; bar.value=0; bar.setAttribute('aria-label',file.name+' 的传输进度'); status.textContent='等待传输'; status.setAttribute('role','status'); retry.textContent='重试';retry.hidden=true;
    const job={file,row,bar,status,retry,state:'waiting'};
    retry.onclick=()=>{job.state='waiting';retry.hidden=true;status.textContent='等待重试';pump();};
    row.append(title,bar,status,retry);$('rows').append(row);jobs.push(job);
  }
  $('files').value='';$('queue').hidden=!jobs.length;
  if($('summary'))$('summary').textContent='已保存 '+jobs.filter(j=>j.state==='done').length+' / '+jobs.length+' 个文件';
  pump();
};
function show(job,text,progress) {
  if(job.status.textContent!==text) job.status.textContent=text;
  job.bar.value=progress;
}
async function fingerprint(job) {
  const file=job.file,h=sha256.create();
  for(let i=0;i<file.size;i+=CHUNK) {
    const bytes=await file.slice(i,i+CHUNK).arrayBuffer(); h.update(bytes);
    show(job,'正在识别原文件 · '+Math.floor(100*Math.min(i+CHUNK,file.size)/file.size)+'%',0);
  }
  return h.hex();
}
async function send(job) {
  const file=job.file;
  if(!file.size) throw Error('文件为空，请重新选择。');
  job.hash ||= await fingerprint(job);
  let retries=0;
  for(;;) {
    try {
      const m=await request('/api/begin',{headers:{'Content-Type':'application/json'},body:JSON.stringify({name:file.name,size:file.size,hash:job.hash})});
      if(m.done) return m.name;
      let offset=m.offset;
      while(offset<file.size) {
        const pct=Math.floor(100*offset/file.size);show(job,'正在上传 · '+pct+'%',pct);
        const r=await request('/api/chunk/'+m.id,{method:'PUT',headers:{'Upload-Offset':String(offset)},body:file.slice(offset,offset+CHUNK)});
        offset=r.offset;retries=0;
      }
      show(job,'电脑正在校验并保存文件…',100);
      return (await request('/api/finish/'+m.id)).name;
    } catch(e) {
      const transient=!e.status || e.status===409 || e.status===503;
      if(!transient || ++retries>3) throw e;
      job.status.textContent='连接暂时中断，正在恢复进度…';
      await new Promise(resolve=>setTimeout(resolve,1000*retries));
    }
  }
}
async function pump() {
  if(running) return;
  running=true;
  try {
    for(let job;(job=jobs.find(j=>j.state==='waiting'));) {
      job.state='active';
      try {const name=await send(job);job.state='done';show(job,'已保存 · '+name,100);}
      catch(e) {job.state='error';job.retry.hidden=false;job.status.textContent=e.status||!(e instanceof TypeError)?e.message:'网络中断，恢复连接后可重试。';if(e.status===401){$('pair').hidden=false;$('upload').hidden=true;$('msg').textContent=e.message;}}
      job.row.dataset.state=job.state;
      if($('summary')){
        const saved=jobs.filter(j=>j.state==='done').length;
        $('summary').textContent=saved===jobs.length?'全部已保存（'+saved+' 个文件）':'已保存 '+saved+' / '+jobs.length+' 个文件';
      }
    }
  } finally {running=false;}
}
