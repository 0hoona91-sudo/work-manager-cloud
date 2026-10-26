const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process'),acorn=require('acorn'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),base='3f5a443320075a6837f86a13303f54e64796be10',out=path.join(__dirname,'dist');
const source=file=>execFileSync('git',['show',`${base}:${file}`],{cwd:root,maxBuffer:20*1024*1024,encoding:'utf8'});
const added=file=>fs.readFileSync(path.join(__dirname,'src',file),'utf8');
let html=source('index.html');
const replacements={
 loadState:`async function loadState(){const connected=await window.WMLocalReady;for(const key of Object.keys(state))delete state[key];Object.assign(state,connected.state);window.__workspaceLocalStateKey='folder:'+connected.workspaceId;window.cloudSync=localCloudShim();window.__LOCAL_STATE_READY_V121__=true;return state;}`,
 saveState:`async function saveState(meta={}){if(!window.__LOCAL_STATE_READY_V121__)return {persistence:'not-connected'};if(window.__backupRecoveryRequired||window.WMBackupUI?.isSaving)throw Error('백업 미확정 저장 확인이 필요합니다.');const job=localSaveTailV33.then(()=>window.WMLocalStore.save(snapshot,meta));const snapshot=clone(state);localSaveTailV33=job.catch(()=>{});try{const receipt=await job;return {...receipt,operationId:meta.operationId||receipt.operationId};}catch(error){window.WMLocalUI.failure(error);throw error}}`,
 readLocalState:`async function readLocalState(){return window.WMLocalStore?.snapshot||null}`,
 writeLocalState:`async function writeLocalState(snapshot){try{return await window.WMLocalStore.save(snapshot,{reason:'검토한 백업 가져오기'})}catch(error){window.WMLocalUI.failure(error);throw error}}`,
 readLocalMeta:`async function readLocalMeta(key,fallback=null){return window.WMLocalStore?.getMeta(key,fallback)??fallback}`,
 writeLocalMeta:`async function writeLocalMeta(key,value){try{await window.WMLocalStore.setMeta(key,value);return value}catch(error){window.WMLocalUI.failure(error);throw error}}`,
 storeLocalFile:`async function storeLocalFile(){throw Error('12-B는 첨부 참조만 보존합니다. PC 원본 연결은 12-C에서 지원합니다. 파일을 저장하지 않았습니다.')}`,
 readLocalFile:`async function readLocalFile(){return null}`,
 clearAllLocalData:`async function clearAllLocalData(){throw Error('폴더 자료와 복구 기록의 자동 초기화는 지원하지 않습니다.')}`,
 fileData:`async function fileData(){throw Error('첨부 원본 저장은 12-C에서 지원합니다. 이미지 본문을 JSON에 넣지 않습니다.')}`,
 bindCloudUi:`function bindCloudUi(){window.WMLocalUI.bind()}`,
 exportJson:`async function exportJson(){try{const backup=window.WMBackupFiles.jsonSnapshot(state);const file=await window.WMLocalStore.backup(backup);download(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}),file);toast('backups 폴더 저장·재읽기 완료. 첨부 원본은 포함되지 않습니다.')}catch(error){window.WMLocalUI.failure(error)}}`,
};
const counts={};
html=html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,(all,attrs,code)=>{
 if(/id="(?:cloud-v2-rc1-script|cloud-v122-legacy-drive-repair)"/.test(attrs))return '';
 if(/\bsrc=/.test(attrs))return all;
 const ast=acorn.parse(code,{ecmaVersion:'latest'}),edits=[];
 for(const node of ast.body)if(node.type==='FunctionDeclaration'&&replacements[node.id.name]){edits.push([node.start,node.end,replacements[node.id.name]]);counts[node.id.name]=(counts[node.id.name]||0)+1}
 for(const [start,end,text]of edits.reverse())code=code.slice(0,start)+text+code.slice(end);
 return `<script${attrs}>${code}</script>`;
});
for(const name of Object.keys(replacements))if(!counts[name])throw Error('Missing adapter boundary '+name);
html=html.replace(/<script\b[^>]*src="\.\/([^"?]+)[^"]*"[^>]*><\/script>/g,(all,file)=>{
 let code=source(file);
 if(file==='js/project-ui.js')code=code.replaceAll('error.serverConfirmed','error.folderConfirmed').replaceAll('서버에는 프로젝트가 저장됐으나 이 기기의 캐시 저장에 실패했습니다. 새로고침 후 서버 내용을 확인해 주세요.','PC 폴더의 프로젝트 저장은 확인됐지만 후속 확인 기록에 실패했습니다. journal을 보존하고 다시 연결해 복구 기록을 확인해 주세요.').replaceAll('서버 폐기는 확인됐으나 로컬 캐시 저장에 실패했습니다. 새로고침 후 서버를 확인해 주세요.','PC 폴더의 폐기 결과는 확인됐지만 후속 확인 기록에 실패했습니다. journal을 보존하고 다시 연결해 확인해 주세요.');
 if(file==='js/save-command.js')code=code.replaceAll('server-confirmed','folder-confirmed');
 if(file==='js/save-command-adapter.js')code=code.replaceAll('서버','PC 폴더');
 if(file==='js/backup-ui.js')code=code.replace('이 브라우저에 보관','PC 폴더 journal에 보관');
 return `<script data-bundled-source="${file}">${code.replace(/<\/script/gi,'<\\/script')}</script>`;
});
html=html.replace(/<link\b[^>]*rel="stylesheet"[^>]*href="\.\/([^"?]+)[^"]*"[^>]*>/g,(all,file)=>`<style data-bundled-source="${file}">${source(file)}</style>`);
html=html.replace(/<link\b[^>]*rel="manifest"[^>]*>/g,'');
html=html.replace(/\.\/assets\/shared-hello-kitty-bg-68137d.webp\?v=phase9/g,'data:image/webp;base64,'+execFileSync('git',['show',`${base}:assets/shared-hello-kitty-bg-68137d.webp`],{cwd:root,maxBuffer:1024*1024}).toString('base64'));
html=html.replace(/href="\.\/(icon[^"?]+)(?:\?[^"]*)?"/g,(all,file)=>{const mime=file.endsWith('.svg')?'image/svg+xml':'image/png';return `href="data:${mime};base64,${execFileSync('git',['show',`${base}:${file}`],{cwd:root}).toString('base64')}"`});
html=html.replace("const DBNAME='TaskManagerCloud_v1'","const DBNAME='WMLocalStandaloneAux_v1'").replace("const LOCAL_FALLBACK_PREFIX='TaskManagerCloud_v1:'","const LOCAL_FALLBACK_PREFIX='WMLocalStandaloneAux_v1:'");
html=html.replace('content="hotfix1"','content="local12b-hotfix1"').replace('Google 로그인으로 여러 기기에서 실시간 동기화하는 업무관리시스템','PC 폴더에 저장하는 오프라인 업무관리시스템');
html=html.replaceAll("window.__LOCAL_DEV_BUILD__='v1.0'","window.__LOCAL_DEV_BUILD__='12-B'").replaceAll("8733e9d02ded986d37789773902e584e16c4584f",base);
const csp=`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; media-src blob: data:; frame-src blob:; object-src 'none'; form-action 'none'; base-uri 'none'">`;
html=html.replace('<meta charset="utf-8" />',`<meta charset="utf-8" />${csp}<script>window.WMLocalReady=new Promise(resolve=>window.__localResolve=resolve);</script><script>${added('folder-store.js')}</script>`);
const end=html.lastIndexOf('</body>');if(end<0)throw Error('Missing body');html=html.slice(0,end)+`<script>${added('local-ui.js').replace(/<\/script/gi,'<\\/script')}</script>`+html.slice(end);
if(/import\s*\(|<script\b[^>]*src=|<link\b[^>]*href="\.\//.test(html))throw Error('Unbundled runtime dependency');
fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'업무관리.html'),html);
fs.writeFileSync(path.join(out,'build.json'),JSON.stringify({base,version:'local12b-hotfix1',sha256:crypto.createHash('sha256').update(html).digest('hex'),bytes:Buffer.byteLength(html),boundaries:counts},null,2)+'\n');
console.log('Built hotfix1 local HTML',Buffer.byteLength(html),'bytes');
