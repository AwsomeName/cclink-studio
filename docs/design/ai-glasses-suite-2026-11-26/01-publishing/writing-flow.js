// Sample material for the local design prototype.
const sources = [
  {id:'note',name:'结构观察记录.md',kind:'MD',info:'观察记录 · 可对外引用',note:'镜腿前端连接光学模块，透明光学件位于镜片前方。'},
  {id:'main',name:'整体结构.jpg',info:'参考照片 · 可署名使用',caption:'镜架与光学模块的相对位置'},
  {id:'front',name:'前部模块.jpg',info:'参考照片 · 可署名使用',caption:'前部光学件的连接位置'},
  {id:'package',name:'包装内视图.jpg',info:'参考照片 · 可署名使用',caption:'包装内的器件摆放'},
  {id:'log',name:'原始测试日志.csv',kind:'CSV',info:'仅供内部 · 含设备标识'}
];
const source = id => sources.find(item=>item.id===id);
const credit = '<a class="w-credit" href="../02-video/reference-cut.sources.md">参考照片：Tim.Reckmann · CC BY-SA 3.0</a>';
const chosen = new Set(['note','main','front']);
let writeStep='pick',candidate=null;
if(!draft.revision && localStorageAvailable()){
  // Earlier design revisions stored title and body and showed three fixed images.
  draft={...draft,revision:1,pictures:sources.filter(s=>s.caption).map(s=>({id:s.id,caption:s.caption}))};
}
function localStorageAvailable(){
  try{const value=JSON.parse(localStorage.getItem('studio-promotion-drawing'));return typeof value?.title==='string'&&typeof value.body==='string'}catch{return false}
}
function renderWriting(){
  const picking=writeStep==='pick';
  q('selectScene').hidden=!picking;q('editScene').hidden=picking;
  q('stagePick').classList.toggle('current',picking);q('stageEdit').classList.toggle('current',!picking);
  q('reopen').hidden=!draft.revision&&!candidate;
  q('reopen').textContent=candidate?'返回当前编辑稿':'打开已存稿';
  if(!picking)return;
  q('sourceList').replaceChildren();
  for(const item of sources){
    const row=document.createElement('label');row.className='w-source';
    const icon=item.kind?'<span class="asset-type">'+item.kind+'</span>':'<img alt="" src="'+img(item.id)+'">';
    row.innerHTML='<input type="checkbox" '+(chosen.has(item.id)?'checked ':'')+(item.id==='log'?'disabled ':'')+'>'+icon+'<span><b>'+item.name+'</b><small>'+item.info+'</small></span>';
    row.querySelector('input').onchange=e=>{if(e.target.checked)chosen.add(item.id);else chosen.delete(item.id);updateSelection()};
    q('sourceList').append(row);
  }
  updateSelection();
}
function updateSelection(){
  const count=sources.filter(s=>s.caption&&chosen.has(s.id)).length;
  q('selectionSummary').textContent=(chosen.has('note')?'1':'0')+' 份记录 · '+count+' 张配图';
  q('sourceTip').textContent=!chosen.has('note')?'请勾选一份可以引用的观察记录。':!count?'请选择至少一张配图来演示图文成稿。':'观察记录用于写正文，勾选的照片按列表顺序插入，可在审稿时调整。';
  q('generate').disabled=!chosen.has('note')||!count||!q('brief').value.trim();
}
q('brief').oninput=updateSelection;
function showEditor(model){
  candidate=structuredClone(model);writeStep='edit';
  q('titleText').value=candidate.title;q('bodyText').value=candidate.body;
  q('sourceRef').textContent='结构观察记录.md　·　“'+source('note').note+'”';
  q('saveState').textContent=model.revision?'已保存 v'+model.revision:'初稿待审阅';
  renderPictures();renderWriting();
}
function renderPictures(){
  q('editImages').replaceChildren();
  for(const [index,pic] of candidate.pictures.entries()){
    const row=document.createElement('div');row.className='w-image';
    row.innerHTML='<img src="'+img(pic.id)+'" alt="'+source(pic.id).name+'"><label>图 '+(index+1)+' · 图注<input class="field"></label><button aria-label="将图 '+(index+1)+' 上移">↑ 上移</button>';
    const input=row.querySelector('input');input.value=pic.caption;
    input.oninput=()=>{pic.caption=input.value;markEdited()};
    const up=row.querySelector('button');up.disabled=index===0;
    up.onclick=()=>{candidate.pictures.splice(index-1,0,candidate.pictures.splice(index,1)[0]);renderPictures();markEdited()};
    q('editImages').append(row);
  }
  q('editImages').insertAdjacentHTML('beforeend',credit);
}
function markEdited(){q('saveState').textContent='有未保存的修改'}
q('titleText').oninput=q('bodyText').oninput=markEdited;
q('generate').onclick=()=>{
  const make=()=>{
    const pictures=sources.filter(s=>s.caption&&chosen.has(s.id)).map(s=>({id:s.id,caption:s.caption}));
    showEditor({title:q('brief').value.trim(),body:'对照本批结构观察记录，光学模块连接在镜腿前端，透明光学件位于镜片前方。'+(chosen.has('front')?'前部参考图可用来对照这两部分的连接位置。':''),pictures});
  };
  if(candidate){showDialog('用本次所选素材生成新初稿？');option('替换当前编辑稿',()=>{q('dialog').close();make()})}else make();
};
q('reopen').onclick=()=>{if(candidate){writeStep='edit';renderWriting()}else showEditor(draft)};
q('backToPick').onclick=()=>{writeStep='pick';renderWriting()};
function saveWriting(){
  const title=q('titleText').value.trim(),body=q('bodyText').value.trim();
  if(!title||!body||candidate.pictures.some(p=>!p.caption.trim())){q('saveState').textContent='请补齐标题、正文及每张图的图注。';return false}
  const content={title,body,pictures:structuredClone(candidate.pictures)};
  const previous={title:draft.title,body:draft.body,pictures:draft.pictures};
  const revision=JSON.stringify(content)===JSON.stringify(previous)?draft.revision:(draft.revision||0)+1;
  draft={...content,revision};candidate=structuredClone(draft);
  try{localStorage.setItem('studio-promotion-drawing',JSON.stringify(draft));q('saveState').textContent='已保存到浏览器 · v'+revision}
  catch{q('saveState').textContent='已保存到本次预览 · v'+revision}
  return true;
}
q('save').onclick=saveWriting;
q('use').onclick=()=>{if(saveWriting()){pick(structuredClone(draft),false);location.hash='publish'}};
function renderReceived(model){
  const details=document.createElement('details');
  details.innerHTML='<summary>查看收到的正文、图序和图注</summary><p></p>';
  details.querySelector('p').textContent=model.body;
  for(const [i,pic] of model.pictures.entries()){
    const row=document.createElement('div');row.className='w-image';
    row.innerHTML='<img alt="" src="'+img(pic.id)+'"><span></span>';
    row.querySelector('span').textContent='图 '+(i+1)+'　'+pic.caption;details.append(row);
  }
  details.insertAdjacentHTML('beforeend',credit);
  q('receivedBody').replaceChildren(details);
}
