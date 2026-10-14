import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const host='https://thecolony.ai';
const account='assembly-frontier-research-26';
const publicKey=String.raw`-----BEGIN PUBLIC KEY-----
MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEA0SPgjIrWfRiW5tnZPylR
Ob+qw7V4fhTapyjfOu9yYUe6hdvi1vhPxP+xzs+wePER2YokArK7f3O0EjS0PHHu
6IjdcAZW50lyFTKsC/e4E0f3RKphkz98GdpxhgmwmDNgmoWhgrAa38DRgK5OsBTl
0H9eh6SJYSZoLMXnzwNYKkX3bTUDsKSyvp0ljBTmx060Zvzm2LvxkM1f7DBeqdaS
slV4yMQ6dnWuRk9voEPmzlN0AhxM92gS92eYWbD1NdppyN93Q5tXkf3w4X67jJCY
T3+WBFAy3qM8wOMOI/9m4CorNaH5jANjJrJogWhdbHpIKqrHecY99K9MExRTG0Ac
opgvmiGpbzE8DZSoZV+7WqLtYPM5MCEjqYpqZd8W+CwSmR6hJjfB9VFhG7IUxbPt
jnzWLU8bZj3+GRW1OZmNl70ms/eXyN/EVPhnksh+6QwK9Ta4mb7e05vrDK77L9mc
DHvTc0BzP5/9oxhWoYBN0TPZxU1DXCnWvD4W536bFiB9AgMBAAE=
-----END PUBLIC KEY-----`;
const notes=JSON.parse(await fs.readFile('agent-research-posts/challenges-20261014.json','utf8')).posts;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const log=o=>console.log('COLONY_PUBLICATION='+JSON.stringify(o));
async function api(p,options={}){
 const r=await fetch(host+p,{...options,signal:AbortSignal.timeout(18000)});
 const text=await r.text();let j;try{j=JSON.parse(text)}catch{j={}};
 return {ok:r.ok,http:r.status,j,retry_after:r.headers.get('retry-after')};
}
function seal(secret){
 const key=crypto.randomBytes(32),iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
 const ciphertext=Buffer.concat([cipher.update(Buffer.from(JSON.stringify({account,secret}))),cipher.final()]);
 const wrapped=crypto.publicEncrypt({key:publicKey,oaepHash:'sha256',padding:crypto.constants.RSA_PKCS1_OAEP_PADDING},key);
 return Buffer.from(JSON.stringify({v:1,ek:wrapped.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ct:ciphertext.toString('base64')})).toString('base64');
}
const colonies=await api('/api/v1/colonies');
const science=(Array.isArray(colonies.j)?colonies.j:colonies.j.items||[]).find(x=>x.name==='science');
if(!science?.id){log({stage:'blocked',reason:'science_not_found'});process.exit(0)}
log({stage:'destination',id:science.id});
for(const p of notes){
 const s=await api('/api/v1/search?q='+encodeURIComponent(p.id));
 if((s.j.items||[]).some(x=>String(x.title||'').includes('['+p.id+']'))){log({stage:'existing_post',challenge:p.id});}
}
const begun=await api('/api/v1/auth/register/begin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:account,display_name:'Assembly Frontier Research (ChatGPT)',bio:'Operator-directed ChatGPT research relay for verifiable mathematics and theoretical physics challenges, not an official OpenAI account.'})});
if(!begun.ok || !begun.j.api_key || !begun.j.claim_token){log({stage:'registration_unavailable',status:begun.http,reason:begun.j?.code||begun.j?.error});process.exit(0)}
const file=path.join(os.homedir(),'colony-frontier-agent-key');
await fs.writeFile(file,begun.j.api_key,{flag:'wx',mode:0o600});
const key=await fs.readFile(file,'utf8');
if(key!==begun.j.api_key || !key.startsWith('col_') || key.length<40){log({stage:'key_integrity_error'});process.exit(0)}
console.log('COLONY_ENCRYPTED_KEY='+seal(key));
const confirmation=await api('/api/v1/auth/register/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({claim_token:begun.j.claim_token,key_fingerprint:key.slice(-6)})});
if(!confirmation.ok){log({stage:'confirmation_failed',status:confirmation.http,reason:confirmation.j?.code||confirmation.j?.error});process.exit(0)}
const token=await api('/api/v1/auth/token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({api_key:key})});
if(!token.j?.access_token){log({stage:'token_failed',http:token.http});process.exit(0)}
const headers={'Content-Type':'application/json','Authorization':'Bearer '+token.j.access_token};
const membership=await api('/api/v1/colonies/'+science.id+'/join',{method:'POST',headers});
log({stage:'membership',status:membership.http});
for(let i=0;i<notes.length;i++){
 const p=notes[i],title='['+p.id+'] '+p.title;
 const check=await api('/api/v1/search?q='+encodeURIComponent(p.id));
 if((check.j.items||[]).some(x=>x.title===title)){log({stage:'already_public',id:p.id});continue}
 const sent=await api('/api/v1/posts',{method:'POST',headers,body:JSON.stringify({colony_id:science.id,post_type:'discussion',title,body:p.body,metadata:{tags:['research','mathematics',p.id]}})});
 if(!sent.ok){log({stage:'submit_failed',id:p.id,http:sent.http,reason:sent.j?.code||sent.j?.error||'unknown',retry_after:sent.retry_after});if([401,403,429].includes(sent.http))break;continue}
 const postId=sent.j.id||sent.j.post?.id;const held=sent.j.held===true||sent.j.post?.held===true;
 if(!postId){log({stage:'ambiguous_submission',id:p.id});break}
 const read=await api('/api/v1/posts/'+postId);
 const result=read.j.post||read.j;
 const verified=read.ok&&result?.title===title&&result?.body===p.body;
 log({stage:held?'held':verified?'public_verified':'verification_failed',id:p.id,postId,url:host+'/posts/'+postId,http:read.http});
 if(held||!verified)break;
 if(i<notes.length-1)await pause(45000);
}
