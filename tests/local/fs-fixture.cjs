// Real temporary disk behind a MOCK FileSystemHandle API. Not native browser FSA evidence.
const fs=require('node:fs/promises'),path=require('node:path');
function named(name,message){return Object.assign(Error(message),{name})}
function fixture(base){const locks=new Set();const control={permission:'granted',fail:null,ignoreExclusive:false};
 const dir=p=>({kind:'directory',name:path.basename(p),queryPermission:async()=>control.permission,requestPermission:async()=>control.permission,
  async getDirectoryHandle(name,{create=false}={}){const full=path.join(p,name);if(create)await fs.mkdir(full,{recursive:true});try{await fs.stat(full)}catch{throw named('NotFoundError',name)}return dir(full)},
  async getFileHandle(name,{create=false}={}){const full=path.join(p,name);if(create){try{await fs.writeFile(full,'',{flag:'wx'})}catch(e){if(e.code!=='EEXIST')throw e}}try{await fs.stat(full)}catch{throw named('NotFoundError',name)}return {
   async getFile(){const text=await fs.readFile(full,'utf8');return {size:Buffer.byteLength(text),text:async()=>text}},
   async createWritable(options={}){if(options.mode==='exclusive'&&!control.ignoreExclusive){if(locks.has(full))throw named('NoModificationAllowedError','locked');locks.add(full)}let buffer='';return {write:async text=>{if(control.fail?.(full,'write'))throw Error('synthetic disk failure');buffer=text},close:async()=>{if(control.fail?.(full,'close'))throw Error('synthetic disk failure');await fs.writeFile(full,buffer);locks.delete(full)},abort:async()=>{locks.delete(full)}}}
  }},async *entries(){for(const entry of await fs.readdir(p,{withFileTypes:true}))yield [entry.name,{kind:entry.isDirectory()?'directory':'file'}]}});
 return {root:dir(base),control,base,releaseAll:()=>locks.clear()};
}
module.exports={fixture};
