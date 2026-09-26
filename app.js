// ===== v9: IndexedDB pair profiles (no localStorage) =====
const PairDB = (() => {
  const DB='scratch_love_db_v1', STORE='pairs', META='meta';
  let db=null, active=null, saveTimer=null;
  const open=()=>new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains(STORE))d.createObjectStore(STORE,{keyPath:'id'});if(!d.objectStoreNames.contains(META))d.createObjectStore(META,{keyPath:'key'})};r.onsuccess=()=>{db=r.result;resolve(db)};r.onerror=()=>reject(r.error)});
  const tx=(store,mode='readonly')=>db.transaction(store,mode).objectStore(store);
  const req=p=>new Promise((resolve,reject)=>{p.onsuccess=()=>resolve(p.result);p.onerror=()=>reject(p.error)});
  async function list(){return req(tx(STORE).getAll())}
  async function getMeta(key){return (await req(tx(META).get(key)))?.value??null}
  async function setMeta(key,value){return req(tx(META,'readwrite').put({key,value}))}
  async function put(pair){await req(tx(STORE,'readwrite').put(pair));}
  async function remove(id){await req(tx(STORE,'readwrite').delete(id));if(active?.id===id){active=null;await setMeta('activePairId',null)}}
  async function exportAll(){
    const pairs=await list();
    const activePairId=active?.id || await getMeta('activePairId');
    return {format:'scratch-love-backup',version:1,exportedAt:new Date().toISOString(),activePairId,pairs};
  }
  async function importAll(payload){
    if(!payload || payload.format!=='scratch-love-backup' || !Array.isArray(payload.pairs)) throw new Error('Невірний формат резервної копії');
    for(const pair of payload.pairs){
      if(!pair || typeof pair.id!=='string' || !Array.isArray(pair.players)) continue;
      pair.state ||= freshState(); pair.state.calendar ||= {}; pair.state.games ||= {}; pair.state.ui ||= {}; pair.state.kv ||= {};
      await put(pair);
    }
    const preferred = payload.activePairId && payload.pairs.some(p=>p?.id===payload.activePairId) ? payload.activePairId : payload.pairs[0]?.id;
    if(preferred) await activate(preferred);
    return payload.pairs.length;
  }
  function freshState(){return {calendar:{},games:{},ui:{}}}
  async function create(p1,g1,p2,g2){const n1=p1||'Гравець 1',n2=p2||'Гравець 2',gg1=g1||'male',gg2=g2||'female';const pair={id:'pair_'+Date.now()+'_'+Math.random().toString(36).slice(2,8),players:[{name:n1,gender:gg1},{name:n2,gender:gg2}],state:{calendar:{},games:{},ui:{},kv:{sa_games_player_names_v1:JSON.stringify([n1,n2]),sa_games_player_genders_v1:JSON.stringify([gg1,gg2])}},createdAt:Date.now()};await put(pair);await activate(pair.id);return pair}
  async function activate(id){active=await req(tx(STORE).get(id));if(!active)return null;active.state ||= freshState();active.state.calendar ||= {};active.state.games ||= {};active.state.ui ||= {};active.state.kv ||= {};await setMeta('activePairId',id);document.dispatchEvent(new CustomEvent('pair:changed',{detail:active}));return active}
  async function applyRemote(pair){if(!pair?.id)return;active=JSON.parse(JSON.stringify(pair));active.state ||= freshState();active.state.kv ||= {};await put(active);await setMeta('activePairId',active.id);document.dispatchEvent(new CustomEvent('pair:changed',{detail:active}));document.dispatchEvent(new CustomEvent('pair:remote-applied',{detail:active}));}
  function scheduleSave(){clearTimeout(saveTimer);saveTimer=setTimeout(async()=>{if(active){await put(active);document.dispatchEvent(new CustomEvent('pair:state-saved',{detail:active}))}},60)}
  function getKV(key){return active?.state?.kv?.[key]??null}
  function setKV(key,value){if(!active)return;active.state.kv ||= {};active.state.kv[key]=value;scheduleSave()}
  function removeKV(key){if(!active?.state?.kv)return;delete active.state.kv[key];scheduleSave()}
  async function init(){await open();const id=await getMeta('activePairId');if(id)active=await req(tx(STORE).get(id));return active}
  return {init,list,create,activate,remove,exportAll,importAll,applyRemote,getMeta,setMeta,get active(){return active},save:async()=>{if(active){await put(active);document.dispatchEvent(new CustomEvent('pair:state-saved',{detail:active}))}},getKV,setKV,removeKV};
})();

const pairStorage={
  getItem(key){const v=PairDB.getKV(key);return v===null?null:String(v)},
  setItem(key,value){PairDB.setKV(key,String(value))},
  removeItem(key){PairDB.removeKV(key)}
};

(() => {
  'use strict';

  const ITEMS = (Array.isArray(window.POSITION_ITEMS) ? window.POSITION_ITEMS : [])
    .filter(x => x.audience === 'mf')
    .sort((a,b) => Number(a.order_index) - Number(b.order_index));

  // 312 MF-позицій розподілені за точними діапазонами номерів.
  // Рівні 1–4 відкриваються послідовно. Рівні 5–7 — вручну кнопкою «Дозволити».
  const CATEGORY_CONFIG = [
    {name:'Легкий', size:46, mode:'progression'},          // 1–46
    {name:'Середній', size:59, mode:'progression'},       // 47–105
    {name:'Важкий', size:53, mode:'progression'},         // 106–158
    {name:'Складний', size:52, mode:'progression'},       // 159–210
    {name:'У ванній', size:44, mode:'manual'},            // 211–254
    {name:'У машині', size:40, mode:'manual'},            // 255–294
    {name:'Акробатичний', size:18, mode:'manual'}         // 295–312
  ];

  const CATEGORIES = [];
  let offset = 0;
  CATEGORY_CONFIG.forEach((cfg,index) => {
    const items = ITEMS.slice(offset, offset + cfg.size);
    CATEGORIES.push({id:`cat_${index+1}`, index, name:cfg.name, mode:cfg.mode || 'progression', items, start:offset});
    offset += cfg.size;
  });
  if(offset < ITEMS.length) CATEGORIES.push({id:`cat_${CATEGORIES.length+1}`, index:CATEGORIES.length, name:`Категорія ${CATEGORIES.length+1}`, items:ITEMS.slice(offset), start:offset});

  const $ = s => document.querySelector(s);
  const els = {
    ageGate: $('#ageGate'), confirmAge: $('#confirmAge'), leaveSite: $('#leaveSite'),
    categories: $('#categoryList'), done: $('#calendarDone'), total: $('#calendarTotal'),
    percent: $('#calendarPercent'), progress: $('#calendarProgress'), status: $('#calendarStatus'),
    reset: $('#resetCalendarBtn'), devUnlockAll: $('#devUnlockAllBtn'), devShowAll: $('#devShowAllBtn'),
    allDialog: $('#allPositionsDialog'), closeAllDialog: $('#closeAllPositionsDialog'), allGrid: $('#allPositionsGrid'),
    dialog: $('#positionDialog'), close: $('#closePositionDialog'),
    categoryTitle: $('#positionCategoryTitle'), dayTitle: $('#positionDayTitle'), image: $('#calendarPositionImage'), canvas: $('#positionScratchCanvas'),
    instruction: $('#positionInstruction'), poseMeta: $('#positionMeta'), poseName: $('#positionPoseName'), poseDescription: $('#positionPoseDescription'), reveal: $('#revealPositionBtn'), defer: $('#deferPositionBtn'), complete: $('#completePositionBtn'), toast: $('#toast'), deferDialog: $('#deferDialog'), closeDeferDialog: $('#closeDeferDialog'), deferChoices: $('#deferPlayerChoices'), progressDialog: $('#progressDialog'), openProgress: $('#openProgressBtn'), closeProgress: $('#closeProgressDialog'), progressOverview: $('#progressOverview'), progressLevels: $('#progressLevels'), progressMonths: $('#progressMonths'), progressDeferred: $('#progressDeferred'), deferredCountBadge: $('#deferredCountBadge')
  };

  // Same keys as previous MF versions: old progress is preserved.
  const DONE_KEY = 'sa_position_done_mf';
  const REVEALED_KEY = 'sa_position_revealed_mf';
  const MANUAL_UNLOCK_KEY = 'sa_position_manual_unlock_mf';
  const DEV_UNLOCK_ALL_KEY = 'sa_position_dev_unlock_all_mf';
  const DEFERRED_KEY = 'sa_position_deferred_mf_v1';
  const HISTORY_KEY = 'sa_position_history_mf_v1';
  let current = null;
  let currentGlobalIndex = -1;
  let currentCategoryIndex = -1;
  let drawing = false;
  let revealedNow = false;
  const ctx = els.canvas.getContext('2d', {willReadFrequently:true});

  const readSet = key => {
    try { return new Set(JSON.parse(pairStorage.getItem(key) || '[]')); }
    catch { return new Set(); }
  };
  const saveSet = (key,set) => pairStorage.setItem(key, JSON.stringify([...set]));
  const readJSON = (key,fallback) => { try { const v=pairStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } };
  const saveJSON = (key,value) => pairStorage.setItem(key, JSON.stringify(value));
  const getDeferred = () => readJSON(DEFERRED_KEY, {});
  const getHistory = () => readJSON(HISTORY_KEY, []);
  const progressSet = () => { const set=readSet(DONE_KEY); Object.keys(getDeferred()).forEach(id=>set.add(Number(id))); return set; };
  const logProgressEvent = (item,status,extra={}) => {
    const history=getHistory();
    history.push({id:item.id,order_index:item.order_index,status,date:new Date().toISOString(),...extra});
    saveJSON(HISTORY_KEY,history.slice(-1200));
  };

  function toast(msg){
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => els.toast.classList.remove('show'), 1800);
  }

  function categoryDone(category, done){
    return category.items.length > 0 && category.items.every(item => done.has(item.id));
  }

  function categoryUnlocked(index, done){
    if(pairStorage.getItem(DEV_UNLOCK_ALL_KEY) === '1') return true;
    const category = CATEGORIES[index];
    if(category.mode === 'manual') return readSet(MANUAL_UNLOCK_KEY).has(category.id);
    if(index === 0) return true;
    // Для прогресійних рівнів враховуємо тільки попередній прогресійний рівень.
    return categoryDone(CATEGORIES[index - 1], done);
  }

  function allowManualCategory(category){
    const unlocked = readSet(MANUAL_UNLOCK_KEY);
    unlocked.add(category.id);
    saveSet(MANUAL_UNLOCK_KEY, unlocked);
    render();
    toast(`${category.name} дозволено ✓`);
  }


  function toggleDevUnlockAll(){
    const enabled = pairStorage.getItem(DEV_UNLOCK_ALL_KEY) === '1';
    if(enabled){
      pairStorage.removeItem(DEV_UNLOCK_ALL_KEY);
      toast('DEV: звичайні блокування повернено');
    } else {
      pairStorage.setItem(DEV_UNLOCK_ALL_KEY, '1');
      toast('DEV: усі рівні відкрито');
    }
    render();
  }

  function syncDevButton(){
    if(!els.devUnlockAll) return;
    const enabled = pairStorage.getItem(DEV_UNLOCK_ALL_KEY) === '1';
    els.devUnlockAll.textContent = enabled ? 'Повернути блокування' : 'Відкрити все';
    els.devUnlockAll.classList.toggle('dev-active', enabled);
  }

  function findItemLocation(item){
    for(let catIndex=0; catIndex<CATEGORIES.length; catIndex++){
      const localIndex = CATEGORIES[catIndex].items.findIndex(x => x.id === item.id);
      if(localIndex !== -1) return {catIndex, localIndex, globalIndex:CATEGORIES[catIndex].start + localIndex};
    }
    return {catIndex:0, localIndex:0, globalIndex:0};
  }

  function renderAllPositionsGallery(){
    const done = readSet(DONE_KEY);
    els.allGrid.innerHTML = '';
    ITEMS.forEach((item,index) => {
      const loc = findItemLocation(item);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `all-position-card ${done.has(item.id) ? 'completed' : ''}`;
      const img = document.createElement('img');
      img.src = item.image;
      img.alt = `MF позиція ${index+1}`;
      img.loading = 'lazy';
      const label = document.createElement('span');
      label.textContent = `${index+1} · ${CATEGORIES[loc.catIndex].name}`;
      btn.append(img,label);
      btn.addEventListener('click', () => {
        els.allDialog.close();
        openPosition(item, loc.globalIndex, loc.catIndex, loc.localIndex, done.has(item.id));
      });
      els.allGrid.appendChild(btn);
    });
  }

  function showAllPositions(){
    renderAllPositionsGallery();
    els.allDialog.showModal();
  }

  function firstUnlockedIncompleteCategory(done){
    for(let i=0;i<4;i++){
      if(categoryUnlocked(i,done) && !categoryDone(CATEGORIES[i],done)) return i;
    }
    for(let i=4;i<CATEGORIES.length;i++){
      if(categoryUnlocked(i,done) && !categoryDone(CATEGORIES[i],done)) return i;
    }
    return 3;
  }

  function render(){
    const done = readSet(DONE_KEY);
    const deferred = getDeferred();
    const passed = progressSet();
    const revealed = readSet(REVEALED_KEY);
    const doneCount = ITEMS.filter(x => passed.has(x.id)).length;
    const pct = ITEMS.length ? Math.round(doneCount / ITEMS.length * 100) : 0;
    const activeCat = firstUnlockedIncompleteCategory(passed);

    els.done.textContent = doneCount;
    els.total.textContent = ITEMS.length;
    els.percent.textContent = pct + '%';
    els.progress.style.width = pct + '%';
    els.status.textContent = doneCount >= ITEMS.length && ITEMS.length
      ? 'Усі категорії завершено 🎉'
      : `${CATEGORIES[activeCat]?.name || 'Легкий'} відкрито`;

    syncDevButton();
    els.categories.innerHTML = '';
    CATEGORIES.forEach((category,catIndex) => {
      const unlocked = categoryUnlocked(catIndex, passed);
      const complete = categoryDone(category, passed);
      const catDoneCount = category.items.filter(item => passed.has(item.id)).length;
      const catPct = category.items.length ? Math.round(catDoneCount/category.items.length*100) : 0;

      const section = document.createElement('section');
      section.className = `category-card ${!unlocked ? 'locked' : complete ? 'complete' : 'active'}`;

      const head = document.createElement('div');
      head.className = 'category-head';
      head.innerHTML = `
        <div class="category-title-wrap">
          <div class="category-badge">${catIndex+1}</div>
          <div><h2>${category.name}</h2><div class="category-meta">${catDoneCount} / ${category.items.length} виконано · ${catPct}%</div></div>
        </div>
        <div class="category-state">${!unlocked ? '🔒 Заблоковано' : complete ? '✓ Завершено' : 'Відкрито'}</div>`;
      section.appendChild(head);
      const bar = document.createElement('div');
      bar.className = 'category-progress';
      bar.innerHTML = `<span style="width:${catPct}%"></span>`;
      section.appendChild(bar);

      if(!unlocked){
        const locked = document.createElement('div');
        locked.className = 'locked-grid';
        if(category.mode === 'manual') {
          locked.innerHTML = `<strong>${category.name}</strong><span>Спеціальний рівень можна відкрити незалежно від основного прогресу.</span>`;
          const allowBtn = document.createElement('button');
          allowBtn.type = 'button';
          allowBtn.className = 'btn primary allow-level-btn';
          allowBtn.textContent = 'Дозволити';
          allowBtn.addEventListener('click', () => allowManualCategory(category));
          locked.appendChild(allowBtn);
        } else {
          locked.innerHTML = `<strong>Завершіть ${CATEGORIES[catIndex-1].name}</strong><span>Потрібно виконати всі ${CATEGORIES[catIndex-1].items.length} позиції попереднього рівня.</span>`;
        }
        section.appendChild(locked);
      } else {
        const grid = document.createElement('div');
        grid.className = 'position-calendar';
        category.items.forEach((item,localIndex) => {
          const globalIndex = category.start + localIndex;
          const isDone = done.has(item.id);
          const deferredInfo = deferred[item.id];
          const isDeferred = !!deferredInfo;
          const isRevealed = revealed.has(item.id);
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = `calendar-day ${isDone ? 'completed' : isDeferred ? 'deferred' : isRevealed ? 'revealed' : 'available'}`;
          if(isDone || isDeferred){
            const img = document.createElement('img');
            img.src = item.image;
            img.alt = `${category.name}, поза ${item.order_index}`;
            img.loading = 'lazy';
            btn.appendChild(img);
            if(isDeferred){ const badge=document.createElement('span'); badge.className='deferred-badge'; badge.textContent=deferredInfo.wishDone?'Відкладено · бажання ✓':'Відкладено'; btn.appendChild(badge); }
          } else {
            btn.innerHTML = `<span class="day-number">${localIndex+1}</span><span class="day-label">${isRevealed ? 'Відкрита' : 'Стерти'}</span>`;
          }
          btn.addEventListener('click', () => openPosition(item,globalIndex,catIndex,localIndex,isDone));
          grid.appendChild(btn);
        });
        section.appendChild(grid);
      }
      els.categories.appendChild(section);
    });
  }

  function fitCanvas(){
    const rect = els.canvas.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    els.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    els.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }

  function drawCover(){
    fitCanvas();
    const r = els.canvas.getBoundingClientRect();
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0,0,r.width,r.height);
    const g = ctx.createLinearGradient(0,0,r.width,r.height);
    g.addColorStop(0,'#39343c'); g.addColorStop(.5,'#201d23'); g.addColorStop(1,'#49424c');
    ctx.fillStyle = g; ctx.fillRect(0,0,r.width,r.height);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#f5eff4'; ctx.font = '800 22px system-ui';
    ctx.fillText('ВІДКРИЙ ПОЗУ', r.width/2, r.height/2 - 13);
    ctx.font = '500 13px system-ui'; ctx.fillStyle = '#bbb2bd';
    ctx.fillText('зітріть пальцем або мишкою', r.width/2, r.height/2 + 18);
    els.canvas.style.opacity = '1'; els.canvas.style.pointerEvents = 'auto'; revealedNow = false;
  }

  function scratchPoint(nx,ny,radius=32){
    const r=els.canvas.getBoundingClientRect(),x=nx*r.width,y=ny*r.height;
    ctx.globalCompositeOperation='destination-out';ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);ctx.fill();
  }
  let lastScratchSync=0;
  function scratch(e,sync=true){
    const r=els.canvas.getBoundingClientRect();const nx=(e.clientX-r.left)/Math.max(1,r.width),ny=(e.clientY-r.top)/Math.max(1,r.height);
    scratchPoint(nx,ny,32);
    const now=performance.now();if(sync&&now-lastScratchSync>32){lastScratchSync=now;window.SessionSync?.sendUI?.('pose-scratch',{id:current?.id,nx,ny,radius:32});}
  }

  function scratchedRatio(){
    const w = els.canvas.width, h = els.canvas.height; if(!w || !h) return 0;
    const data = ctx.getImageData(0,0,w,h).data; let clear = 0, checked = 0; const step = 64;
    for(let i=3;i<data.length;i+=4*step){ checked++; if(data[i] < 80) clear++; }
    return checked ? clear/checked : 0;
  }

  function updatePositionMeta(item, visible){
    if(!els.poseMeta || !item) return;
    els.poseName.textContent = item.poseTitle || ('Поза ' + item.order_index);
    els.poseDescription.textContent = item.poseDescription || '';
    els.poseMeta.hidden = !visible;
  }

  function reveal(save=true,syncSession=true){
    if(!current) return;
    revealedNow = true; els.canvas.style.opacity = '0'; els.canvas.style.pointerEvents = 'none';
    if(save){ const set = readSet(REVEALED_KEY); set.add(current.id); saveSet(REVEALED_KEY,set); }
    const done = readSet(DONE_KEY).has(current.id);
    const deferredInfo = getDeferred()[current.id];
    els.complete.disabled = done; els.complete.textContent = done ? 'Вже виконано ✓' : deferredInfo ? 'Виконати зараз ✓' : 'Виконано ✓';
    if(els.defer){ els.defer.disabled = done || !!deferredInfo; els.defer.textContent = deferredInfo ? 'Вже відкладено' : 'Відкласти'; }
    els.instruction.textContent = done ? 'Цю позицію вже виконано.' : deferredInfo ? (deferredInfo.wishDone ? 'Поза відкладена. Бажання вже виконано ✓' : `Поза відкладена. ${deferredInfo.debtorName} має виконати бажання партнера.`) : 'Позиція відкрита. Після виконання натисніть «Виконано» або відкладіть її.';
    updatePositionMeta(current, true);
    if(syncSession)window.SessionSync?.sendUI?.('pose-reveal',{id:current.id});
    render();
  }

  function openPosition(item,globalIndex,catIndex,localIndex,isDone,syncSession=true){
    current = item; currentGlobalIndex = globalIndex; currentCategoryIndex = catIndex;
    els.categoryTitle.textContent = CATEGORIES[catIndex].name.toUpperCase();
    els.dayTitle.textContent = `Поза ${item.order_index}`;
    els.image.src = item.image; els.image.alt = item.poseTitle || ('Поза ' + item.order_index);
    updatePositionMeta(item, false);
    els.dialog.showModal();
    const deferredInfo = getDeferred()[item.id];
    const alreadyRevealed = readSet(REVEALED_KEY).has(item.id) || isDone || !!deferredInfo;
    els.complete.disabled = !alreadyRevealed || isDone;
    els.complete.textContent = isDone ? 'Вже виконано ✓' : deferredInfo ? 'Виконати зараз ✓' : 'Виконано ✓';
    if(els.defer){ els.defer.disabled = !alreadyRevealed || isDone || !!deferredInfo; els.defer.textContent = deferredInfo ? 'Вже відкладено' : 'Відкласти'; }
    els.instruction.textContent = isDone ? 'Цю позицію вже виконано.' : deferredInfo ? (deferredInfo.wishDone ? 'Поза відкладена. Бажання вже виконано ✓' : `Поза відкладена. ${deferredInfo.debtorName} має виконати бажання партнера.`) : alreadyRevealed ? 'Позиція відкрита. Після виконання натисніть «Виконано» або відкладіть її.' : 'Зітріть захисний шар, щоб відкрити позицію.';
    updatePositionMeta(item, alreadyRevealed || isDone);
    requestAnimationFrame(() => alreadyRevealed ? reveal(false,false) : drawCover());
    if(syncSession)window.SessionSync?.sendUI?.('pose-open',{id:item.id});
  }

  els.canvas.addEventListener('pointerdown', e => { drawing = true; els.canvas.setPointerCapture?.(e.pointerId); scratch(e); });
  els.canvas.addEventListener('pointermove', e => { if(!drawing) return; scratch(e); if(Math.random() < .10 && scratchedRatio() > .48) reveal(true); });
  window.addEventListener('pointerup', () => drawing = false);
  els.reveal.addEventListener('click', () => reveal(true));
  els.close.addEventListener('click', () => els.dialog.close());
  els.dialog.addEventListener('click', e => { if(e.target === els.dialog) els.dialog.close(); });

  els.complete.addEventListener('click', () => {
    if(!current || els.complete.disabled) return;
    const done = readSet(DONE_KEY); done.add(current.id); saveSet(DONE_KEY,done);
    const deferred=getDeferred(); const wasDeferred=deferred[current.id]; if(wasDeferred){ delete deferred[current.id]; saveJSON(DEFERRED_KEY,deferred); }
    const rev = readSet(REVEALED_KEY); rev.add(current.id); saveSet(REVEALED_KEY,rev);
    logProgressEvent(current,'done',{resolvedDeferred:!!wasDeferred});
    const justFinishedCategory = categoryDone(CATEGORIES[currentCategoryIndex], progressSet());
    const isProgression = CATEGORIES[currentCategoryIndex].mode === 'progression';
    const nextIndex = currentCategoryIndex + 1;
    const nextIsProgression = nextIndex < 4;
    els.dialog.close(); render();
    if(justFinishedCategory && isProgression && nextIsProgression) toast(`${CATEGORIES[nextIndex].name} розблоковано 🎉`);
    else toast('Позицію виконано ✓');
  });

  function openDeferDialog(){
    if(!current || !els.deferDialog) return;
    const players=PairDB.active?.players || [{name:'Гравець 1'},{name:'Гравець 2'}];
    els.deferChoices.innerHTML='';
    players.forEach((player,index)=>{
      const btn=document.createElement('button'); btn.type='button'; btn.className='defer-player-btn';
      btn.innerHTML=`<strong>${player.name || ('Гравець '+(index+1))}</strong><span>відкладає позу й виконує бажання партнера</span>`;
      btn.addEventListener('click',()=>deferCurrent(index)); els.deferChoices.appendChild(btn);
    });
    els.deferDialog.showModal();
  }
  function deferCurrent(playerIndex){
    if(!current) return;
    const players=PairDB.active?.players || [{name:'Гравець 1'},{name:'Гравець 2'}];
    const debtor=players[playerIndex] || players[0]; const partner=players[(playerIndex+1)%2] || players[1];
    const deferred=getDeferred();
    deferred[current.id]={id:current.id,order_index:current.order_index,debtorIndex:playerIndex,debtorName:debtor.name||`Гравець ${playerIndex+1}`,partnerName:partner?.name||'партнера',date:new Date().toISOString()};
    saveJSON(DEFERRED_KEY,deferred);
    const rev=readSet(REVEALED_KEY); rev.add(current.id); saveSet(REVEALED_KEY,rev);
    logProgressEvent(current,'deferred',{debtorIndex:playerIndex,debtorName:deferred[current.id].debtorName,partnerName:deferred[current.id].partnerName});
    els.deferDialog.close(); els.dialog.close(); render(); toast(`Поза відкладена · ${deferred[current.id].debtorName} виконує бажання`);
  }
  function monthLabel(iso){
    const d=new Date(iso); if(Number.isNaN(d.getTime())) return 'Без дати';
    return new Intl.DateTimeFormat('uk-UA',{month:'long',year:'numeric'}).format(d);
  }
  function renderDetailedProgress(){
    const done=readSet(DONE_KEY), deferred=getDeferred(), passed=progressSet();
    const completed=ITEMS.filter(x=>done.has(x.id)).length, deferredCount=Object.keys(deferred).length, total=ITEMS.length;
    const pct=total?Math.round(passed.size/total*100):0;
    els.progressOverview.innerHTML=`<div class="progress-stat"><strong>${passed.size}/${total}</strong><span>зараховано</span></div><div class="progress-stat"><strong>${completed}</strong><span>виконано</span></div><div class="progress-stat deferred-stat"><strong>${deferredCount}</strong><span>відкладено</span></div><div class="progress-stat"><strong>${pct}%</strong><span>загалом</span></div>`;
    els.progressLevels.innerHTML='';
    CATEGORIES.forEach(cat=>{ const count=cat.items.filter(x=>passed.has(x.id)).length; const pc=cat.items.length?Math.round(count/cat.items.length*100):0; const row=document.createElement('div'); row.className='progress-level-row'; row.innerHTML=`<div><strong>${cat.name}</strong><span>${count}/${cat.items.length}</span></div><div class="mini-progress"><span style="width:${pc}%"></span></div><b>${pc}%</b>`; els.progressLevels.appendChild(row); });
    const history=getHistory();
    const byMonth=new Map();
    history.forEach(ev=>{ const key=monthLabel(ev.date); const entry=byMonth.get(key)||{done:0,deferred:0,date:ev.date}; if(ev.status==='done')entry.done++; if(ev.status==='deferred')entry.deferred++; byMonth.set(key,entry); });
    if(!history.length && done.size){ byMonth.set('Раніше',{done:done.size,deferred:0,date:'1970-01-01'}); }
    els.progressMonths.innerHTML='';
    [...byMonth.entries()].sort((a,b)=>new Date(b[1].date)-new Date(a[1].date)).forEach(([label,val])=>{ const row=document.createElement('div'); row.className='month-row'; row.innerHTML=`<strong>${label}</strong><span>Виконано: ${val.done}</span><span>Відкладено: ${val.deferred}</span>`; els.progressMonths.appendChild(row); });
    if(!byMonth.size) els.progressMonths.innerHTML='<p class="empty-state">Поки немає історії проходження.</p>';
    els.deferredCountBadge.textContent=deferredCount;
    els.progressDeferred.innerHTML='';
    const deferredList=Object.values(deferred).sort((a,b)=>new Date(b.date)-new Date(a.date));
    deferredList.forEach(info=>{ const item=ITEMS.find(x=>x.id===Number(info.id)); if(!item)return; const card=document.createElement('div'); card.className='deferred-progress-card'+(info.wishDone?' wish-done':''); card.innerHTML=`<img src="${item.image}" alt="Поза ${item.order_index}"><div><strong>Поза ${item.order_index} · ${item.poseTitle||''}</strong><span>${info.wishDone?'Бажання виконано ✓':`${info.debtorName} має виконати бажання ${info.partnerName}`}</span><small>${new Intl.DateTimeFormat('uk-UA',{day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(info.date))}</small></div>`; const actions=document.createElement('div'); actions.className='deferred-card-actions'; if(!info.wishDone){ const wish=document.createElement('button'); wish.type='button'; wish.className='btn primary compact'; wish.textContent='Бажання виконано ✓'; wish.addEventListener('click',()=>{ const all=getDeferred(); if(all[info.id]){ all[info.id].wishDone=true; all[info.id].wishDoneDate=new Date().toISOString(); saveJSON(DEFERRED_KEY,all); } renderDetailedProgress(); document.dispatchEvent(new CustomEvent('progress:changed')); }); actions.appendChild(wish); } const btn=document.createElement('button'); btn.type='button'; btn.className='btn secondary compact'; btn.textContent='Відкрити'; btn.addEventListener('click',()=>{els.progressDialog.close(); const loc=findItemLocation(item); openPosition(item,loc.globalIndex,loc.catIndex,loc.localIndex,false)}); actions.appendChild(btn); card.appendChild(actions); els.progressDeferred.appendChild(card); });
    if(!deferredList.length) els.progressDeferred.innerHTML='<p class="empty-state">Відкладених поз немає.</p>';
  }

  els.defer?.addEventListener('click',openDeferDialog);
  els.closeDeferDialog?.addEventListener('click',()=>els.deferDialog.close());
  els.deferDialog?.addEventListener('click',e=>{if(e.target===els.deferDialog)els.deferDialog.close()});
  els.openProgress?.addEventListener('click',()=>{renderDetailedProgress();els.progressDialog.showModal()});
  els.closeProgress?.addEventListener('click',()=>els.progressDialog.close());
  els.progressDialog?.addEventListener('click',e=>{if(e.target===els.progressDialog)els.progressDialog.close()});

  els.devUnlockAll?.addEventListener('click', toggleDevUnlockAll);
  els.devShowAll?.addEventListener('click', showAllPositions);
  els.closeAllDialog?.addEventListener('click', () => els.allDialog.close());
  els.allDialog?.addEventListener('click', e => { if(e.target === els.allDialog) els.allDialog.close(); });

  els.reset.addEventListener('click', () => {
    if(confirm('Скинути весь прогрес календаря MF?')){
      pairStorage.removeItem(DONE_KEY); pairStorage.removeItem(REVEALED_KEY); pairStorage.removeItem(MANUAL_UNLOCK_KEY); pairStorage.removeItem(DEV_UNLOCK_ALL_KEY); pairStorage.removeItem(DEFERRED_KEY); pairStorage.removeItem(HISTORY_KEY); render(); toast('Прогрес скинуто');
    }
  });

  if(sessionStorage.getItem('sa_age_ok') !== '1') els.ageGate.hidden = false;
  els.confirmAge.addEventListener('click', () => { sessionStorage.setItem('sa_age_ok','1'); els.ageGate.hidden = true; });
  els.leaveSite.addEventListener('click', () => { document.body.innerHTML = '<main class="leave"><h1>18+</h1><p>Сторінку закрито.</p></main>'; });
  window.addEventListener('resize', () => { if(els.dialog.open && current && !revealedNow) drawCover(); });

  document.addEventListener('session:remote-ui',e=>{
    const m=e.detail||{},p=m.payload||{};
    if(m.kind==='pose-open'){
      const item=ITEMS.find(x=>String(x.id)===String(p.id));if(!item)return;const loc=findItemLocation(item);openPosition(item,loc.globalIndex,loc.catIndex,loc.localIndex,readSet(DONE_KEY).has(item.id),false);
      if(!readSet(REVEALED_KEY).has(item.id)&&!readSet(DONE_KEY).has(item.id))requestAnimationFrame(()=>drawCover());
    }
    if(m.kind==='pose-scratch'&&current&&String(current.id)===String(p.id)){scratchPoint(Number(p.nx)||0,Number(p.ny)||0,Number(p.radius)||32);}
    if(m.kind==='pose-reveal'&&current&&String(current.id)===String(p.id)){reveal(true,false);}
  });
  document.addEventListener('pair:changed',()=>render());
  if(PairDB.active) render();
})();

// --- Couple games module ---
(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const calendarTabBtn=$('#calendarTabBtn'), placesTabBtn=$('#placesTabBtn'), gamesTabBtn=$('#gamesTabBtn'), progressTabBtn=$('#progressTabBtn'), calendarSection=$('#calendarSection'), placesSection=$('#placesSection'), gamesSection=$('#gamesSection'), progressSection=$('#progressSection');
  if(!gamesSection) return;

  const NAMES_KEY='sa_games_player_names_v1',
        GENDERS_KEY='sa_games_player_genders_v1',
        SCORE_KEY='sa_games_score_v1',
        TURN_KEY='sa_games_turn_v1',
        PLACES_KEY='sa_games_places_v2',
        CUSTOM_ACTIONS_KEY='sa_games_custom_actions_v1',
        CUSTOM_BODY_KEY='sa_games_custom_body_v1',
        CUSTOM_PLACES_KEY='sa_places_custom_v1';

  // Місця витягнуті з string-resources наданого APK Scratch Adventure.
  // Групування зроблено для зручності веб-інтерфейсу.
  const PLACE_CATEGORIES=[{"name":"Вдома","items":[{"id":"at_the_front_door","label":"Біля вхідних дверей"},{"id":"in_a_beach_chair_beach_shell","label":"У пляжному кріслі/пляжній мушлі"},{"id":"in_front_of_a_mirror","label":"Перед дзеркалом"},{"id":"in_the_attic","label":"На горищі"},{"id":"in_the_basement","label":"У підвалі"},{"id":"in_the_bathroom","label":"У ванній кімнаті"},{"id":"in_the_closet","label":"У шафі"},{"id":"in_the_garden_house_garage","label":"У садовому будинку/гаражі"},{"id":"in_the_kitchen","label":"На кухні"},{"id":"in_the_shower","label":"У душі"},{"id":"in_the_stairwell","label":"На сходовій клітці"},{"id":"on_a_chair","label":"На стільці"},{"id":"on_the_couch","label":"На дивані"},{"id":"on_the_dining_table","label":"На обідньому столі"},{"id":"on_the_floor","label":"На підлозі"},{"id":"on_the_washing_machine","label":"На пральній машині"},{"id":"room_where_others_sleep","label":"Кімната, де сплять інші"}]},{"name":"Транспорт і дорога","items":[{"id":"at_a_car_wash","label":"На мийці для автомобілів"},{"id":"at_a_rest_stop","label":"На зупинці відпочинку"},{"id":"at_the_airport_on_a_plane","label":"В аеропорту/на літаку"},{"id":"at_the_ghost_train","label":"На поїзді-примарі"},{"id":"in_a_cab","label":"У таксі"},{"id":"in_a_caravan","label":"У каравані"},{"id":"in_a_carriage","label":"У кареті"},{"id":"in_the_car","label":"У машині"},{"id":"on_a_forest_cabin","label":"У лісовій хатинці"},{"id":"on_a_test_drive","label":"На тест-драйві"},{"id":"on_the_engine_hood","label":"На капоті автомобіля"},{"id":"on_train_bus","label":"У поїзді/автобусі"}]},{"name":"Природа","items":[{"id":"at_a_campfire","label":"Біля багаття"},{"id":"at_a_lake","label":"Біля озера"},{"id":"at_the_beach","label":"На пляжі"},{"id":"in_a_park","label":"У парку"},{"id":"in_a_theme_park","label":"У парку розваг"},{"id":"in_the_forest","label":"У лісі"},{"id":"in_the_rain_snow","label":"У дощ/сніг"},{"id":"in_the_tent","label":"У наметі"},{"id":"on_a_hunting_seat","label":"На мисливській вежі"},{"id":"on_a_mountain","label":"На горі"},{"id":"on_a_park_bench","label":"На лавці в парку"},{"id":"on_an_open_field","label":"На відкритому полі"},{"id":"on_the_balcony_in_the_garden","label":"На балконі/в саду"},{"id":"on_under_a_bridge","label":"На/під мостом"}]},{"name":"Відпочинок і розваги","items":[{"id":"at_a_festival_concert","label":"На фестивалі/концерті"},{"id":"at_a_funfair","label":"На ярмарку розваг"},{"id":"at_a_spa","label":"У спа"},{"id":"at_the_cinema","label":"У кінотеатрі"},{"id":"in_a_swimming_pool","label":"У басейні"},{"id":"in_a_zoo","label":"У зоопарку"},{"id":"in_the_gym","label":"У тренажерному залі"},{"id":"in_the_sauna","label":"У сауні"},{"id":"in_the_whirpool","label":"У джакузі"},{"id":"on_a_boat","label":"На човні"},{"id":"on_a_bouncy_castle","label":"На надувному замку"},{"id":"on_a_ferris_wheel","label":"На колесі огляду"},{"id":"on_a_jetski","label":"На водному мотоциклі"},{"id":"on_a_pedal_boat","label":"На педальному човні"},{"id":"on_a_ping_pong_table","label":"На столі для пінг-понгу"},{"id":"on_a_playground","label":"На дитячому майданчику"},{"id":"on_a_slide","label":"На гірці"},{"id":"on_a_sports_field","label":"На спортивному полі"},{"id":"on_a_standup_paddle","label":"На StandUp Paddle"},{"id":"on_a_swing","label":"На гойдалці"},{"id":"on_a_trampoline","label":"На батутах"},{"id":"on_a_weight_bench","label":"На лавці для жиму"},{"id":"on_a_yoga_mat","label":"На килимку для йоги"}]},{"name":"Подорожі","items":[{"id":"at_a_house_tour","label":"На екскурсії по будинку"},{"id":"at_a_landmark","label":"Біля пам'ятки"},{"id":"at_a_lost_place","label":"У покинутому місці"},{"id":"at_a_ski_lodge","label":"У будиночку для лижників"},{"id":"in_a_gondola","label":"У гондолі"},{"id":"in_a_hotel_room","label":"У готельному номері"},{"id":"in_a_television_tower","label":"У телевізійній вежі"},{"id":"in_an_igloo","label":"У іглу"},{"id":"in_the_vacation_home","label":"У будинку для відпочинку"}]},{"name":"Публічні місця","items":[{"id":"at_a_supermarket","label":"У супермаркеті"},{"id":"at_a_wedding","label":"На весіллі"},{"id":"at_work","label":"На роботі"},{"id":"in_a_furniture_store","label":"У меблевому магазині"},{"id":"in_a_library","label":"У бібліотеці"},{"id":"in_a_locker_room","label":"У роздягальні"},{"id":"in_a_museum","label":"У музеї"},{"id":"in_a_photo_booth","label":"У фотокабінці"},{"id":"in_a_restaurant","label":"У ресторані"},{"id":"in_an_alley","label":"У провулку"},{"id":"in_public_restroom","label":"У громадській вбиральні"},{"id":"in_the_elevator","label":"У ліфті"},{"id":"in_the_old_university_school","label":"У (старому) університеті/школі"}]},{"name":"Інше","items":[{"id":"at_sunrise","label":"На світанку"},{"id":"in_a_barn","label":"У сараї"},{"id":"in_a_dark_backyard","label":"У темному дворі"},{"id":"in_a_float","label":"У поплавці"},{"id":"in_a_hammock","label":"У гамаку"},{"id":"in_sleeping_bag","label":"У спальному мішку"},{"id":"on_a_rooftop_terrace","label":"На терасі на даху"},{"id":"on_the_stairs","label":"На сходах"}]}];

  // Дії й частини тіла — з ресурсів наданого APK.
  const PASSION_ACTIONS=['Поцілунок','Дотик','Масаж','Стиснути','Облизати','Смоктати','Шльопання'];
  const BODY_PARTS=[
    {label:'Рука',gender:'any'},{label:'Сідниці',gender:'any'},{label:'Спина',gender:'any'},
    {label:'Яєчка',gender:'male'},{label:'Живіт',gender:'any'},{label:'Щоки',gender:'any'},
    {label:'Груди',gender:'any'},{label:'Клітор',gender:'female'},{label:'Пах',gender:'any'},
    {label:'Вухо',gender:'any'},{label:'Стопи',gender:'any'},{label:'Палець',gender:'any'},
    {label:'Коліна',gender:'any'},{label:'Статеві губи',gender:'female'},{label:'Нога',gender:'any'},
    {label:'Губи',gender:'any'},{label:'Пупок',gender:'any'},{label:'Шия',gender:'any'},
    {label:'Соски',gender:'any'},{label:'Ніс',gender:'any'},{label:'Пеніс',gender:'male'},
    {label:'Промежина',gender:'any'},{label:'Стегно',gender:'any'},{label:'Пальці ніг',gender:'any'},
    {label:'Вагіна',gender:'female'}
  ];

  const gamesMenu=$('#gamesMenu'), gameDetail=$('#gameDetail'), backToGames=$('#backToGamesBtn'), activeGameTitle=$('#activeGameTitle');
  const playersPanel=$('#playersPanel');
  const gameViews={passion:$('#passionGameView'),direct:$('#directGameView'),randomPose:$('#randomPoseGameView'),secretWish:$('#secretWishGameView'),scenarioWheel:$('#scenarioWheelGameView'),fiveMinutes:$('#fiveMinutesGameView'),blindChoice:$('#blindChoiceGameView'),wishBattle:$('#wishBattleGameView'),eveningQuest:$('#eveningQuestGameView')};
  const gameMeta={
    passion:{title:'🎰 Рулетка Страсті',players:true,custom:true},
    direct:{title:'🎲 Прямолінійний кубик',players:true,custom:true},
    randomPose:{title:'🎡 Випадкова поза',players:false,custom:false},
    secretWish:{title:'💌 Таємне бажання',players:true,custom:false},
    scenarioWheel:{title:'🎭 Колесо сценаріїв',players:true,custom:false},
    fiveMinutes:{title:'⏱️ 5 хвилин',players:false,custom:false},
    blindChoice:{title:'🃏 Сліпий вибір',players:true,custom:false},
    wishBattle:{title:'⚔️ Батл бажань',players:true,custom:false},
    eveningQuest:{title:'🌙 Квест на вечір',players:true,custom:false}
  };
  const rouletteCustomPanel=$('#rouletteCustomPanel');

  const safeParse=(k,f)=>{try{return JSON.parse(pairStorage.getItem(k)||JSON.stringify(f))}catch{return f}};
  const getCustomActions=()=>safeParse(CUSTOM_ACTIONS_KEY,[]).filter(x=>typeof x==='string'&&x.trim()).map(x=>x.trim());
  const getCustomBody=()=>safeParse(CUSTOM_BODY_KEY,[]).filter(x=>x&&typeof x.label==='string').map(x=>({id:x.id||('cb_'+Math.random().toString(36).slice(2)),label:x.label.trim(),gender:['male','female','any'].includes(x.gender)?x.gender:'any'}));
  const actionPool=()=>[...PASSION_ACTIONS,...getCustomActions()];
  const saveCustomActions=items=>pairStorage.setItem(CUSTOM_ACTIONS_KEY,JSON.stringify(items));
  const saveCustomBody=items=>pairStorage.setItem(CUSTOM_BODY_KEY,JSON.stringify(items));
  const getNames=()=>safeParse(NAMES_KEY,['Гравець 1','Гравець 2']);
  const setNames=n=>{pairStorage.setItem(NAMES_KEY,JSON.stringify(n));if(PairDB.active){PairDB.active.players[0].name=n[0];PairDB.active.players[1].name=n[1];PairDB.save();document.dispatchEvent(new CustomEvent('pair:profile'))}};
  const getGenders=()=>safeParse(GENDERS_KEY,['male','female']);
  const setGenders=g=>{pairStorage.setItem(GENDERS_KEY,JSON.stringify(g));if(PairDB.active){PairDB.active.players[0].gender=g[0];PairDB.active.players[1].gender=g[1];PairDB.save();document.dispatchEvent(new CustomEvent('pair:profile'))}};
  const getScore=()=>safeParse(SCORE_KEY,[0,0]);
  const setScore=s=>pairStorage.setItem(SCORE_KEY,JSON.stringify(s));
  const getTurn=()=>Number(pairStorage.getItem(TURN_KEY)||0)%2;
  const setTurn=t=>pairStorage.setItem(TURN_KEY,String(t%2));

  const scoreEls=[$('#player1Score'),$('#player2Score')],
        selfPlayerName=$('#selfPlayerName'), partnerPlayerName=$('#partnerPlayerName'),
        selfPlayerGender=$('#selfPlayerGender'), partnerPlayerGender=$('#partnerPlayerGender'),
        currentName=$('#currentPlayerName'), currentTarget=$('#currentTargetName');

  function getViewRole(){
    const sessionRole=window.SessionSync?.role;
    if(sessionRole===0||sessionRole===1) return Number(sessionRole);
    const saved=Number(pairStorage.getItem('sa_local_view_role_v1'));
    return saved===1?1:0;
  }
  function participantLabel(index,withName=true){
    const names=getNames(), self=getViewRole();
    const prefix=index===self?'Ви':'Ваш партнер';
    return withName?`${prefix} — ${names[index]||('Гравець '+(index+1))}`:prefix;
  }
  function genderLabel(g){ return g==='female'?'Жіноча стать':'Чоловіча стать'; }

  function syncPlayers(){
    const names=getNames(), genders=getGenders(), score=getScore(), turn=getTurn(), target=(turn+1)%2;
    const self=getViewRole(), partner=(self+1)%2;
    if(selfPlayerName) selfPlayerName.textContent=names[self]||`Гравець ${self+1}`;
    if(partnerPlayerName) partnerPlayerName.textContent=names[partner]||`Гравець ${partner+1}`;
    if(selfPlayerGender) selfPlayerGender.textContent=genderLabel(genders[self]);
    if(partnerPlayerGender) partnerPlayerGender.textContent=genderLabel(genders[partner]);
    if(scoreEls[0]) scoreEls[0].textContent=score[self]??0;
    if(scoreEls[1]) scoreEls[1].textContent=score[partner]??0;
    if(currentName) currentName.textContent=participantLabel(turn,true);
    if(currentTarget) currentTarget.textContent=`→ ${participantLabel(target,true)}`;
    refreshBodyPools();
    updateRelativeGameLabels();
  }
  $('#resetScoreBtn')?.addEventListener('click',()=>{setScore([0,0]);setTurn(0);syncPlayers()});
  document.addEventListener('pair:changed',()=>syncPlayers());

  function updateRelativeGameLabels(){
    const self=getViewRole(), partner=(self+1)%2, names=getNames();
    const p1Title=$('#secretWishP1Title'),p2Title=$('#secretWishP2Title');
    if(p1Title)p1Title.textContent=participantLabel(0,true); if(p2Title)p2Title.textContent=participantLabel(1,true);
    const b1=$('#battleP1Input'),b2=$('#battleP2Input');
    if(b1)b1.placeholder=(self===0?'Ваше бажання':`Бажання — ${names[0]}`);
    if(b2)b2.placeholder=(self===1?'Ваше бажання':`Бажання — ${names[1]}`);
  }
  document.addEventListener('session:role-changed',()=>syncPlayers());

  function showTab(which, syncSession=true){
    calendarSection.hidden=which!=='calendar'; placesSection.hidden=which!=='places'; gamesSection.hidden=which!=='games'; if(progressSection)progressSection.hidden=which!=='progress';
    calendarTabBtn.classList.toggle('active',which==='calendar'); placesTabBtn?.classList.toggle('active',which==='places'); gamesTabBtn.classList.toggle('active',which==='games'); progressTabBtn?.classList.toggle('active',which==='progress');
    if(syncSession) pairStorage.setItem('sa_main_tab_v1',which);
    document.body.dataset.mainTab=which;
    if(which==='games'){
      const savedGame=pairStorage.getItem(ACTIVE_GAME_KEY);
      if(savedGame && gameMeta[savedGame]) openGame(savedGame,syncSession);
      else showGamesMenu(syncSession,false);
    }
    if(which==='places') renderPlaces();
    if(which==='progress') renderProgressPage();
    if(syncSession) window.SessionSync?.sendUI?.('tab',{which});
  }
  calendarTabBtn?.addEventListener('click',()=>showTab('calendar'));
  placesTabBtn?.addEventListener('click',()=>showTab('places'));
  gamesTabBtn?.addEventListener('click',()=>showTab('games'));
  progressTabBtn?.addEventListener('click',()=>showTab('progress'));

  const PAGE_DONE_KEY='sa_position_done_mf', PAGE_DEFERRED_KEY='sa_position_deferred_mf_v1', PAGE_HISTORY_KEY='sa_position_history_mf_v1';
  const pagePoseOverview=$('#pagePoseOverview'), pagePoseLevels=$('#pagePoseLevels'), pagePlacesOverview=$('#pagePlacesOverview'), pagePlacesCategories=$('#pagePlacesCategories'), pageProgressMonths=$('#pageProgressMonths'), pageDeferredList=$('#pageDeferredList'), pageDeferredCount=$('#pageDeferredCount');
  const POSE_LEVELS=[['Легкий',1,46],['Середній',47,105],['Важкий',106,158],['Складний',159,210],['У ванній',211,254],['У машині',255,294],['Акробатичний',295,312]];
  function pageJSON(key,fallback){try{return JSON.parse(pairStorage.getItem(key)||JSON.stringify(fallback))}catch{return fallback}}
  function renderProgressPage(){
    if(!progressSection)return;
    const positions=(Array.isArray(window.POSITION_ITEMS)?window.POSITION_ITEMS:[]).filter(x=>x.audience==='mf');
    const done=new Set(pageJSON(PAGE_DONE_KEY,[]).map(Number)); const deferred=pageJSON(PAGE_DEFERRED_KEY,{}); const passed=new Set(done); Object.keys(deferred).forEach(id=>passed.add(Number(id)));
    const wishDone=Object.values(deferred).filter(x=>x.wishDone).length, wishOpen=Object.values(deferred).filter(x=>!x.wishDone).length;
    const posePct=positions.length?Math.round(passed.size/positions.length*100):0;
    if(pagePoseOverview)pagePoseOverview.innerHTML=`<div class="progress-stat"><strong>${passed.size}/${positions.length}</strong><span>зараховано</span></div><div class="progress-stat"><strong>${done.size}</strong><span>виконано</span></div><div class="progress-stat deferred-stat"><strong>${Object.keys(deferred).length}</strong><span>відкладено</span></div><div class="progress-stat"><strong>${posePct}%</strong><span>поз</span></div>`;
    if(pagePoseLevels){pagePoseLevels.innerHTML='';POSE_LEVELS.forEach(([name,from,to])=>{const total=to-from+1,count=positions.filter(x=>x.order_index>=from&&x.order_index<=to&&passed.has(Number(x.id))).length,pct=Math.round(count/total*100);const row=document.createElement('div');row.className='progress-level-row';row.innerHTML=`<div><strong>${name}</strong><span>${count}/${total}</span></div><div class="mini-progress"><span style="width:${pct}%"></span></div><b>${pct}%</b>`;pagePoseLevels.appendChild(row)})}
    const marked=new Set(pageJSON(PLACES_KEY,[])); const custom=getCustomPlaces(); const cats=PLACE_CATEGORIES.map(c=>({name:c.name,items:[...c.items]})); custom.forEach(x=>{let c=cats.find(y=>y.name===x.category);if(!c){c={name:x.category||'Мої місця',items:[]};cats.push(c)}c.items.push(x)}); const placeTotal=cats.reduce((s,c)=>s+c.items.length,0), placeDone=[...marked].filter(id=>cats.some(c=>c.items.some(x=>x.id===id))).length, placePct=placeTotal?Math.round(placeDone/placeTotal*100):0;
    if(pagePlacesOverview)pagePlacesOverview.innerHTML=`<div class="progress-stat"><strong>${placeDone}/${placeTotal}</strong><span>відзначено</span></div><div class="progress-stat"><strong>${placePct}%</strong><span>місць</span></div><div class="progress-stat"><strong>${custom.length}</strong><span>власних</span></div>`;
    if(pagePlacesCategories){pagePlacesCategories.innerHTML='';cats.filter(c=>c.items.length).forEach(c=>{const count=c.items.filter(x=>marked.has(x.id)).length,pct=Math.round(count/c.items.length*100);const row=document.createElement('div');row.className='progress-level-row';row.innerHTML=`<div><strong>${c.name}</strong><span>${count}/${c.items.length}</span></div><div class="mini-progress"><span style="width:${pct}%"></span></div><b>${pct}%</b>`;pagePlacesCategories.appendChild(row)})}
    const history=pageJSON(PAGE_HISTORY_KEY,[]), months=new Map(), fmt=new Intl.DateTimeFormat('uk-UA',{month:'long',year:'numeric'}); history.forEach(ev=>{const d=new Date(ev.date);if(isNaN(d))return;const key=fmt.format(d),m=months.get(key)||{date:d,done:0,deferred:0};if(ev.status==='done')m.done++;if(ev.status==='deferred')m.deferred++;months.set(key,m)}); if(pageProgressMonths){pageProgressMonths.innerHTML='';[...months.entries()].sort((a,b)=>b[1].date-a[1].date).forEach(([label,m])=>{const row=document.createElement('div');row.className='month-row';row.innerHTML=`<strong>${label}</strong><span>Виконано: ${m.done}</span><span>Відкладено: ${m.deferred}</span>`;pageProgressMonths.appendChild(row)});if(!months.size)pageProgressMonths.innerHTML='<p class="empty-state">Поки немає історії проходження.</p>'}
    const list=Object.values(deferred).sort((a,b)=>new Date(b.date)-new Date(a.date)); if(pageDeferredCount)pageDeferredCount.textContent=list.length; if(pageDeferredList){pageDeferredList.innerHTML='';list.forEach(info=>{const item=positions.find(x=>Number(x.id)===Number(info.id));if(!item)return;const card=document.createElement('div');card.className='deferred-progress-card'+(info.wishDone?' wish-done':'');card.innerHTML=`<img src="${item.image}" alt="Поза ${item.order_index}"><div><strong>Поза ${item.order_index} · ${item.poseTitle||''}</strong><span>${info.wishDone?'Бажання виконано ✓':`${info.debtorName} має виконати бажання ${info.partnerName}`}</span><small>${new Intl.DateTimeFormat('uk-UA',{day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(info.date))}</small></div>`;const actions=document.createElement('div');actions.className='deferred-card-actions';if(!info.wishDone){const wish=document.createElement('button');wish.type='button';wish.className='btn primary compact';wish.textContent='Бажання виконано ✓';wish.addEventListener('click',()=>{const all=pageJSON(PAGE_DEFERRED_KEY,{});if(all[info.id]){all[info.id].wishDone=true;all[info.id].wishDoneDate=new Date().toISOString();pairStorage.setItem(PAGE_DEFERRED_KEY,JSON.stringify(all))}renderProgressPage();document.dispatchEvent(new CustomEvent('progress:changed'))});actions.appendChild(wish)}card.appendChild(actions);pageDeferredList.appendChild(card)});if(!list.length)pageDeferredList.innerHTML='<p class="empty-state">Відкладених поз немає.</p>'}
  }
  document.addEventListener('progress:changed',()=>{if(progressSection&&!progressSection.hidden)renderProgressPage()});
  const ACTIVE_GAME_KEY='sa_active_game_v2';
  function showGamesMenu(syncSession=true, clearState=true){
    gamesMenu.hidden=false; gameDetail.hidden=true;
    Object.values(gameViews).forEach(v=>v && (v.hidden=true));
    if(playersPanel) playersPanel.hidden=true;
    if(rouletteCustomPanel) rouletteCustomPanel.hidden=true;
    delete document.body.dataset.activeGame;
    document.body.dataset.gameMenu='1';
    if(clearState && syncSession) pairStorage.removeItem(ACTIVE_GAME_KEY);
    if(syncSession) window.SessionSync?.sendUI?.('game-menu',{});
  }
  function openGame(key, syncSession=true){
    const meta=gameMeta[key]; if(!meta) return;
    gamesMenu.hidden=true; gameDetail.hidden=false;
    if(activeGameTitle) activeGameTitle.textContent=meta.title;
    if(playersPanel) playersPanel.hidden=!meta.players;
    if(rouletteCustomPanel) rouletteCustomPanel.hidden=!meta.custom;
    Object.entries(gameViews).forEach(([k,v])=>{if(v) v.hidden=k!==key});
    syncPlayers();
    renderCustomOptions();
    if(key==='passion'){passionActionSlot.setPool(actionPool());passionActionSlot.reset();passionBodySlot.reset();}
    if(key==='direct') directBodySlot.reset();
    if(key==='randomPose') resetRandomPosePreview();
    document.body.dataset.activeGame=key;
    delete document.body.dataset.gameMenu;
    if(syncSession) pairStorage.setItem(ACTIVE_GAME_KEY,key);
    if(syncSession) window.SessionSync?.sendUI?.('game',{key});
  }
  $$('.game-launch-card').forEach(btn=>btn.addEventListener('click',()=>openGame(btn.dataset.game)));
  backToGames?.addEventListener('click',()=>showGamesMenu(true,true));

  const placesBox=$('#placesCategories'), placesDone=$('#placesDone'), placesTotal=$('#placesTotal');
  const customPlaceForm=$('#customPlaceForm'), customPlaceInput=$('#customPlaceInput'), customPlaceCategory=$('#customPlaceCategory'), customPlaceNewCategory=$('#customPlaceNewCategory');

  function getCustomPlaces(){
    const rows=safeParse(CUSTOM_PLACES_KEY,[]);
    return Array.isArray(rows)?rows:[];
  }
  function saveCustomPlaces(rows){ pairStorage.setItem(CUSTOM_PLACES_KEY,JSON.stringify(rows)); }

  function allPlaceCategoryNames(){
    const names=PLACE_CATEGORIES.map(x=>x.name);
    getCustomPlaces().forEach(x=>{ if(x.category && !names.includes(x.category)) names.push(x.category); });
    return names;
  }

  function renderPlaceCategorySelect(){
    if(!customPlaceCategory) return;
    const current=customPlaceCategory.value;
    customPlaceCategory.innerHTML='';
    allPlaceCategoryNames().forEach(name=>{
      const o=document.createElement('option'); o.value=name; o.textContent=name; customPlaceCategory.appendChild(o);
    });
    const fresh=document.createElement('option'); fresh.value='__new__'; fresh.textContent='＋ Нова категорія'; customPlaceCategory.appendChild(fresh);
    if([...customPlaceCategory.options].some(o=>o.value===current)) customPlaceCategory.value=current;
    if(customPlaceNewCategory) customPlaceNewCategory.hidden=customPlaceCategory.value!=='__new__';
  }

  function renderPlaces(){
    if(!placesBox) return;
    const done=new Set(safeParse(PLACES_KEY,[])); let total=0;
    const custom=getCustomPlaces();
    const categories=PLACE_CATEGORIES.map(cat=>({name:cat.name,items:cat.items.map(item=>({...item,custom:false}))}));
    custom.forEach(item=>{
      let cat=categories.find(x=>x.name===item.category);
      if(!cat){ cat={name:item.category||'Мої місця',items:[]}; categories.push(cat); }
      cat.items.push({...item,custom:true});
    });

    placesBox.innerHTML='';
    categories.forEach(cat=>{
      if(!cat.items.length) return;
      const wrap=document.createElement('section'); wrap.className='place-category';
      const h=document.createElement('h3'); h.textContent=cat.name;
      const grid=document.createElement('div'); grid.className='place-grid';
      cat.items.forEach(item=>{
        total++;
        const id=item.id;
        const row=document.createElement('div'); row.className='place-item-row';
        const b=document.createElement('button'); b.type='button'; b.className='place-item'+(done.has(id)?' done':'');
        b.innerHTML=`<span>${done.has(id)?'✓':'○'}</span>${item.label}`;
        b.addEventListener('click',()=>{
          done.has(id)?done.delete(id):done.add(id);
          pairStorage.setItem(PLACES_KEY,JSON.stringify([...done]));
          renderPlaces();
          if(progressSection&&!progressSection.hidden)renderProgressPage();
        });
        row.appendChild(b);
        if(item.custom){
          const del=document.createElement('button'); del.type='button'; del.className='place-delete'; del.title='Видалити власне місце'; del.setAttribute('aria-label',`Видалити ${item.label}`); del.textContent='×';
          del.addEventListener('click',()=>{
            const next=getCustomPlaces().filter(x=>x.id!==id);
            saveCustomPlaces(next);
            if(done.delete(id)) pairStorage.setItem(PLACES_KEY,JSON.stringify([...done]));
            renderPlaceCategorySelect();
            renderPlaces();
          });
          row.appendChild(del);
        }
        grid.appendChild(row);
      });
      wrap.append(h,grid); placesBox.appendChild(wrap);
    });
    if(placesDone) placesDone.textContent=done.size;
    if(placesTotal) placesTotal.textContent=total;
    renderPlaceCategorySelect();
  }

  customPlaceCategory?.addEventListener('change',()=>{
    if(customPlaceNewCategory) customPlaceNewCategory.hidden=customPlaceCategory.value!=='__new__';
    if(customPlaceCategory.value==='__new__') customPlaceNewCategory?.focus();
  });

  customPlaceForm?.addEventListener('submit',e=>{
    e.preventDefault();
    const label=customPlaceInput?.value.trim();
    if(!label) return;
    let category=customPlaceCategory?.value || 'Мої місця';
    if(category==='__new__') category=customPlaceNewCategory?.value.trim() || 'Мої місця';
    const rows=getCustomPlaces();
    const duplicate=rows.some(x=>x.label.toLocaleLowerCase('uk')===label.toLocaleLowerCase('uk') && x.category===category);
    if(duplicate){ toast('Таке місце вже є у цій категорії'); return; }
    rows.push({id:'custom_place_'+Date.now()+'_'+Math.random().toString(36).slice(2,6),label,category});
    saveCustomPlaces(rows);
    customPlaceInput.value='';
    if(customPlaceNewCategory) customPlaceNewCategory.value='';
    renderPlaceCategorySelect();
    if([...customPlaceCategory.options].some(o=>o.value===category)) customPlaceCategory.value=category;
    if(customPlaceNewCategory) customPlaceNewCategory.hidden=true;
    renderPlaces();
    toast('Місце додано ✓');
  });

  class SlotReel {
    constructor(root,pool){
      this.root=root; this.track=root?.querySelector('.slot-track'); this.pool=[...pool]; this.current=0; this.busy=false; this.itemHeight=54; this.reset();
    }
    setPool(pool){
      const clean=[...pool];
      if(!clean.length) return;
      this.pool=clean; this.current=Math.min(this.current,this.pool.length-1); this.reset();
    }
    renderSequence(sequence,targetIndex=0,animate=false){
      if(!this.track) return;
      this.track.innerHTML='';
      sequence.forEach(value=>{const d=document.createElement('div');d.className='slot-item';d.textContent=value;this.track.appendChild(d)});
      this.track.style.transition='none'; this.track.style.transform='translateY(0px)';
      if(animate){
        requestAnimationFrame(()=>requestAnimationFrame(()=>{
          this.track.style.transition='transform 1.65s cubic-bezier(.12,.7,.13,1)';
          this.track.style.transform=`translateY(${-(targetIndex-1)*this.itemHeight}px)`;
        }));
      }
    }
    reset(){
      if(!this.pool.length || !this.track) return;
      const n=this.pool.length,c=((this.current%n)+n)%n;
      this.renderSequence([this.pool[(c-1+n)%n],this.pool[c],this.pool[(c+1)%n]],0,false);
    }
    spinTo(value=null){
      if(this.busy || !this.pool.length) return Promise.reject(new Error('busy'));
      this.busy=true; this.root?.classList.add('is-spinning');
      let target=value===null?Math.floor(Math.random()*this.pool.length):this.pool.indexOf(value);
      if(target<0) target=Math.floor(Math.random()*this.pool.length);
      const sequence=[];
      for(let i=0;i<24;i++) sequence.push(this.pool[(this.current+i)%this.pool.length]);
      sequence.push(this.pool[(target-1+this.pool.length)%this.pool.length],this.pool[target],this.pool[(target+1)%this.pool.length]);
      const targetIndex=sequence.length-2; this.renderSequence(sequence,targetIndex,true);
      return new Promise(resolve=>setTimeout(()=>{
        this.current=target; this.busy=false; this.root?.classList.remove('is-spinning'); this.reset(); resolve(this.pool[target]);
      },1700));
    }
    spin(){ return this.spinTo(null); }
  }

  const bodyPoolForTarget=()=>{
    const turn=getTurn(), target=(turn+1)%2, gender=getGenders()[target];
    return [...BODY_PARTS,...getCustomBody()].filter(x=>x.gender==='any'||x.gender===gender).map(x=>x.label);
  };

  const passionActionSlot=new SlotReel($('#passionActionReel'),actionPool());
  const passionBodySlot=new SlotReel($('#passionBodyReel'),bodyPoolForTarget());
  const directBodySlot=new SlotReel($('#directBodyReel'),bodyPoolForTarget());
  let pendingGame=null, rolling=false, directAction='Стиснути';

  function refreshBodyPools(){
    const pool=bodyPoolForTarget();
    passionBodySlot?.setPool(pool); directBodySlot?.setPool(pool);
    passionActionSlot?.setPool(actionPool());
  }

  function renderCustomOptions(){
    const actionList=$('#customActionList'), bodyList=$('#customBodyList');
    if(actionList){
      actionList.innerHTML='';
      getCustomActions().forEach((label,index)=>{
        const chip=document.createElement('span'); chip.className='custom-chip';
        const txt=document.createElement('span'); txt.textContent=label;
        const rm=document.createElement('button'); rm.type='button'; rm.textContent='×'; rm.title='Видалити';
        rm.onclick=()=>{const arr=getCustomActions();arr.splice(index,1);saveCustomActions(arr);renderCustomOptions();refreshBodyPools()};
        chip.append(txt,rm); actionList.appendChild(chip);
      });
      if(!actionList.children.length) actionList.innerHTML='<span class="custom-empty">Ще немає власних дій</span>';
    }
    if(bodyList){
      bodyList.innerHTML='';
      const genders={any:'для всіх',male:'для чоловіка',female:'для жінки'};
      getCustomBody().forEach((item,index)=>{
        const chip=document.createElement('span'); chip.className='custom-chip';
        const txt=document.createElement('span'); txt.textContent=`${item.label} · ${genders[item.gender]}`;
        const rm=document.createElement('button'); rm.type='button'; rm.textContent='×'; rm.title='Видалити';
        rm.onclick=()=>{const arr=getCustomBody();arr.splice(index,1);saveCustomBody(arr);renderCustomOptions();refreshBodyPools()};
        chip.append(txt,rm); bodyList.appendChild(chip);
      });
      if(!bodyList.children.length) bodyList.innerHTML='<span class="custom-empty">Ще немає власних частин тіла</span>';
    }
  }
  $('#customActionForm')?.addEventListener('submit',e=>{
    e.preventDefault(); const input=$('#customActionInput'); const value=input?.value.trim(); if(!value)return;
    const arr=getCustomActions(); if(!arr.some(x=>x.toLocaleLowerCase('uk')===value.toLocaleLowerCase('uk'))) arr.push(value);
    saveCustomActions(arr); if(input)input.value=''; renderCustomOptions(); refreshBodyPools();
  });
  $('#customBodyForm')?.addEventListener('submit',e=>{
    e.preventDefault(); const input=$('#customBodyInput'), gender=$('#customBodyGender'); const value=input?.value.trim(); if(!value)return;
    const arr=getCustomBody(); if(!arr.some(x=>x.label.toLocaleLowerCase('uk')===value.toLocaleLowerCase('uk')&&x.gender===gender?.value)) arr.push({id:'custom_'+Date.now(),label:value,gender:gender?.value||'any'});
    saveCustomBody(arr); if(input)input.value=''; renderCustomOptions(); refreshBodyPools();
  });

  const RANDOM_POSITIONS=(Array.isArray(window.POSITION_ITEMS)?window.POSITION_ITEMS:[]).filter(x=>x.audience==='mf').slice().sort((a,b)=>(a.order_index||0)-(b.order_index||0));
  const RANDOM_LEVELS = [
    {id:'easy',name:'Легкий',from:1,to:46},
    {id:'medium',name:'Середній',from:47,to:105},
    {id:'hard',name:'Важкий',from:106,to:158},
    {id:'complex',name:'Складний',from:159,to:210},
    {id:'bath',name:'У ванній',from:211,to:254},
    {id:'car',name:'У машині',from:255,to:294},
    {id:'acro',name:'Акробатичний',from:295,to:312}
  ];
  const RANDOM_LEVELS_KEY='sa_random_pose_levels_v1';
  const fortuneWheel=$('#fortuneWheel'), fortuneWheelRotor=$('#fortuneWheelRotor'), randomPosePreview=$('#randomPosePreview'), randomPoseNumber=$('#randomPoseNumber'), randomPoseCaption=$('#randomPoseCaption'), randomPoseResultBox=$('#randomPoseResultBox'), randomPoseResultIndex=$('#randomPoseResultIndex'), randomPoseResult=$('#randomPoseResult'), randomPoseDescription=$('#randomPoseDescription');
  const fortuneLevelOptions=$('#fortuneLevelOptions'), fortuneLevelSummary=$('#fortuneLevelSummary');
  let randomPoseCurrent=RANDOM_POSITIONS[0]||null, randomPoseBusy=false, fortuneTurns=0;
  function getSelectedRandomLevels(){
    try{
      const raw=pairStorage.getItem(RANDOM_LEVELS_KEY); if(!raw)return RANDOM_LEVELS.map(x=>x.id);
      const parsed=JSON.parse(raw); return Array.isArray(parsed)&&parsed.length?parsed.filter(id=>RANDOM_LEVELS.some(x=>x.id===id)):RANDOM_LEVELS.map(x=>x.id);
    }catch{return RANDOM_LEVELS.map(x=>x.id)}
  }
  function saveSelectedRandomLevels(ids){pairStorage.setItem(RANDOM_LEVELS_KEY,JSON.stringify(ids));}
  function applyRandomPoseLevels(ids,{sync=false}={}){
    const clean=(Array.isArray(ids)?ids:[]).filter(id=>RANDOM_LEVELS.some(x=>x.id===id));
    const finalIds=clean.length?clean:RANDOM_LEVELS.map(x=>x.id);
    saveSelectedRandomLevels(finalIds);
    renderRandomLevelFilter();
    const pool=getRandomPosePool();
    if(pool.length&&!pool.includes(randomPoseCurrent))setRandomPose(pool[0]);
    if(randomPoseResultBox)randomPoseResultBox.hidden=true;
    if(sync)window.SessionSync?.sendUI?.('game-action',{action:'random-pose-levels',ids:finalIds});
  }
  function getRandomPosePool(){
    const selected=new Set(getSelectedRandomLevels());
    return RANDOM_POSITIONS.filter(item=>RANDOM_LEVELS.some(level=>selected.has(level.id)&&Number(item.order_index)>=level.from&&Number(item.order_index)<=level.to));
  }
  function renderRandomLevelFilter(){
    if(!fortuneLevelOptions)return;
    const selected=new Set(getSelectedRandomLevels());
    fortuneLevelOptions.innerHTML=RANDOM_LEVELS.map(level=>`<label class="fortune-level-option"><input type="checkbox" value="${level.id}" ${selected.has(level.id)?'checked':''}><span>${level.name}</span><small>${level.from}–${level.to}</small></label>`).join('');
    fortuneLevelOptions.querySelectorAll('input').forEach(input=>input.addEventListener('change',()=>{
      let ids=[...fortuneLevelOptions.querySelectorAll('input:checked')].map(x=>x.value);
      if(!ids.length){ input.checked=true; ids=[input.value]; }
      applyRandomPoseLevels(ids,{sync:true});
    }));
    updateRandomLevelSummary();
  }
  function updateRandomLevelSummary(){
    if(!fortuneLevelSummary)return;
    const ids=getSelectedRandomLevels(); const names=RANDOM_LEVELS.filter(x=>ids.includes(x.id)).map(x=>x.name); const count=getRandomPosePool().length;
    fortuneLevelSummary.textContent=`Обрано: ${names.join(', ')} · ${count} поз`;
  }
  $('#fortuneSelectAllLevelsBtn')?.addEventListener('click',()=>applyRandomPoseLevels(RANDOM_LEVELS.map(x=>x.id),{sync:true}));
  const poseImageCache=new Map();
  function preloadPoseImage(item){
    if(!item?.image)return Promise.resolve();
    if(poseImageCache.has(item.image))return poseImageCache.get(item.image);
    const promise=new Promise(resolve=>{
      const img=new Image();
      img.decoding='async';
      img.onload=()=>{ Promise.resolve(img.decode?.()).catch(()=>{}).finally(()=>resolve(img)); };
      img.onerror=()=>resolve(null);
      img.src=item.image;
    });
    poseImageCache.set(item.image,promise);
    return promise;
  }
  async function preloadPosePool(pool){
    await Promise.all(pool.map(preloadPoseImage));
  }
  function setRandomPose(item){
    if(!item)return; randomPoseCurrent=item;
    if(randomPosePreview && randomPosePreview.getAttribute('src')!==item.image){
      randomPosePreview.src=item.image;
      randomPosePreview.alt=item.poseTitle || ('Поза ' + item.order_index);
    }
    if(randomPoseNumber) randomPoseNumber.textContent=`Поза ${item.order_index}`;
    if(randomPoseCaption) randomPoseCaption.textContent=item.poseTitle || ('Поза ' + item.order_index);
  }
  function resetRandomPosePreview(){ const pool=getRandomPosePool(); if(randomPoseResultBox)randomPoseResultBox.hidden=true; setRandomPose(pool.includes(randomPoseCurrent)?randomPoseCurrent:(pool[0]||RANDOM_POSITIONS[0])); }
  const randomSpinPending=new Map();
  const waitUntil=async ts=>{const ms=Number(ts||0)-Date.now();if(ms>2)await new Promise(r=>setTimeout(r,ms));};
  function setRandomSpinButtonBusy(busy){const button=$('#randomPoseSpinBtn');if(button)button.disabled=!!busy;}
  async function runRandomPoseSpin(forcedOrder=null,remote=false,startAt=null,forcedTurn=null){
    const pool=getRandomPosePool();
    if(!pool.length)return null;
    if(randomPoseBusy && !remote)return null;
    if(remote) randomPoseBusy=false;
    const button=$('#randomPoseSpinBtn');randomPoseBusy=true;if(button)button.disabled=true;if(randomPoseResultBox)randomPoseResultBox.hidden=true;
    try{
      await preloadPosePool(pool);
      if(startAt)await waitUntil(startAt);
      const target=(forcedOrder?pool.find(x=>Number(x.order_index)===Number(forcedOrder)):null)||pool[Math.floor(Math.random()*pool.length)];
      const turn=Number.isFinite(Number(forcedTurn))?Number(forcedTurn):(5+Math.floor(Math.random()*3));
      fortuneTurns+=turn;
      if(fortuneWheelRotor){fortuneWheelRotor.style.transition='transform 3.15s cubic-bezier(.08,.72,.08,1)';fortuneWheelRotor.style.transform=`rotate(${fortuneTurns*360 + (Number(target.order_index)*37)%340}deg)`;}
      // Deterministic frame order: both devices see the same sequence.
      const targetIndex=Math.max(0,pool.findIndex(x=>x.id===target.id));
      const frames=pool.map((_,i)=>pool[(targetIndex+i*17)%pool.length]);let frameIndex=0;const start=performance.now(),duration=3050;
      await new Promise(resolve=>{const tick=now=>{const t=Math.min(1,(now-start)/duration),delay=55+Math.floor(210*t*t);setRandomPose(frames[frameIndex++%frames.length]);if(t>=1){resolve();return}setTimeout(()=>requestAnimationFrame(tick),delay)};requestAnimationFrame(tick)});
      setRandomPose(target);if(randomPoseResultIndex)randomPoseResultIndex.textContent=`Поза ${target.order_index}`;if(randomPoseResult)randomPoseResult.textContent=target.poseTitle||(`Поза ${target.order_index}`);if(randomPoseDescription)randomPoseDescription.textContent=target.poseDescription||'';if(randomPoseResultBox)randomPoseResultBox.hidden=false;
      return target;
    }finally{randomPoseBusy=false;if(button)button.disabled=false}
  }
  async function beginSyncedRandomPoseSpin(){
    const pool=getRandomPosePool();if(randomPoseBusy||!pool.length)return;
    // Offline/local mode does not need a handshake.
    if(!window.SessionSync?.connected){await runRandomPoseSpin();return;}
    setRandomSpinButtonBusy(true);
    await preloadPosePool(pool);
    const ids=getSelectedRandomLevels();
    const target=pool[Math.floor(Math.random()*pool.length)];
    const spinId='rp_'+Date.now()+'_'+Math.random().toString(36).slice(2,8);
    const turn=5+Math.floor(Math.random()*3);
    randomSpinPending.set(spinId,{role:'initiator',target:target.order_index,turn,ids,started:false});
    window.SessionSync.sendUI('game-action',{action:'random-pose-prepare',spinId,ids,order:target.order_index,turn});
    // Safety fallback if the remote side disappears during the handshake.
    setTimeout(()=>{
      const p=randomSpinPending.get(spinId);if(!p||p.started)return;
      p.started=true;const startAt=Date.now()+250;
      runRandomPoseSpin(p.target,false,startAt,p.turn).finally(()=>{randomSpinPending.delete(spinId);setRandomSpinButtonBusy(false)});
    },3500);
  }
  $('#randomPoseSpinBtn')?.addEventListener('click',()=>beginSyncedRandomPoseSpin());
  $('#randomPoseOpenBtn')?.addEventListener('click',()=>{
    if(!randomPoseCurrent)return;
    const dlg=document.createElement('dialog'); dlg.className='dialog random-pose-zoom-dialog';
    dlg.innerHTML=`<div class="random-pose-zoom"><button class="icon-btn random-zoom-close" aria-label="Закрити">×</button><img src="${randomPoseCurrent.image}" alt="${randomPoseCurrent.poseTitle || ('Поза ' + randomPoseCurrent.order_index)}"><small>Поза ${randomPoseCurrent.order_index}</small><strong>${randomPoseCurrent.poseTitle || ('Поза ' + randomPoseCurrent.order_index)}</strong><p>${randomPoseCurrent.poseDescription || ''}</p></div>`;
    document.body.appendChild(dlg); dlg.querySelector('.random-zoom-close')?.addEventListener('click',()=>dlg.close()); dlg.addEventListener('close',()=>dlg.remove()); dlg.showModal();
  });
  renderRandomLevelFilter();

  function showResult(gameKey,resultText,turnLabelEl,resultEl,box){
    const names=getNames(),turn=getTurn(),target=(turn+1)%2;
    pendingGame={gameKey,turn};
    if(turnLabelEl) turnLabelEl.textContent=`${participantLabel(turn,true)} → ${participantLabel(target,true)}`;
    if(resultEl) resultEl.textContent=resultText;
    if(box) box.hidden=false;
  }
  function resolveResult(completed){
    if(!pendingGame)return;
    const score=getScore();
    if(completed){score[pendingGame.turn]+=1;setScore(score)}
    setTurn((pendingGame.turn+1)%2); pendingGame=null; syncPlayers();
  }

  const pbox=$('#passionResultBox');
  async function runPassionRoll(forced=null,remote=false){
    if(rolling)return;
    const button=$('#passionRollBtn'); rolling=true; if(button)button.disabled=true;if(pbox)pbox.hidden=true;refreshBodyPools();
    try{
      const action=forced?.action || actionPool()[Math.floor(Math.random()*actionPool().length)];
      const bp=bodyPoolForTarget(); const body=forced?.body || bp[Math.floor(Math.random()*bp.length)];
      if(!remote) window.SessionSync?.sendUI?.('game-action',{action:'passion-roll',actionValue:action,bodyValue:body});
      const [a,b]=await Promise.all([passionActionSlot.spinTo(action),passionBodySlot.spinTo(body)]);
      showResult('passion',`${a} — ${b}`,$('#passionTurnLabel'),$('#passionResult'),pbox);
    }catch(err){console.error(err)}finally{rolling=false;if(button)button.disabled=false}
  }
  $('#passionRollBtn')?.addEventListener('click',()=>runPassionRoll());
  $('#passionDoneBtn')?.addEventListener('click',()=>{resolveResult(true);if(pbox)pbox.hidden=true});
  $('#passionNoBtn')?.addEventListener('click',()=>{resolveResult(false);if(pbox)pbox.hidden=true});

  $$('#directActionChoice .choice-btn').forEach(btn=>btn.addEventListener('click',()=>{
    $$('#directActionChoice .choice-btn').forEach(x=>x.classList.remove('active')); btn.classList.add('active'); directAction=btn.dataset.action;
    window.SessionSync?.sendUI?.('game-action',{action:'direct-choice',directAction});
  }));
  const dbox=$('#directResultBox');
  async function runDirectRoll(forced=null,remote=false){
    if(rolling)return;const button=$('#directRollBtn');rolling=true;if(button)button.disabled=true;if(dbox)dbox.hidden=true;refreshBodyPools();
    try{
      if(forced?.directAction) directAction=forced.directAction;
      document.querySelectorAll('#directActionChoice .choice-btn').forEach(x=>x.classList.toggle('active',x.dataset.action===directAction));
      const bp=bodyPoolForTarget();const body=forced?.body || bp[Math.floor(Math.random()*bp.length)];
      if(!remote)window.SessionSync?.sendUI?.('game-action',{action:'direct-roll',directAction,body});
      const b=await directBodySlot.spinTo(body);showResult('direct',`${directAction} — ${b}`,$('#directTurnLabel'),$('#directResult'),dbox);
    }catch(err){console.error(err)}finally{rolling=false;if(button)button.disabled=false}
  }
  $('#directRollBtn')?.addEventListener('click',()=>runDirectRoll());
  $('#directDoneBtn')?.addEventListener('click',()=>{resolveResult(true);if(dbox)dbox.hidden=true});
  $('#directNoBtn')?.addEventListener('click',()=>{resolveResult(false);if(dbox)dbox.hidden=true});

  function refreshPairUI(){ if(!PairDB.active) return; syncPlayers(); renderPlaces(); renderCustomOptions(); const connected=!!window.SessionSync?.connected; const runtimeTab=document.body.dataset.mainTab; const storedTab=pairStorage.getItem('sa_main_tab_v1'); const t=(connected&&['calendar','places','games','progress'].includes(runtimeTab))?runtimeTab:storedTab; const tab=['calendar','places','games','progress'].includes(t)?t:'calendar'; if(tab==='games'){ if(connected&&document.body.dataset.gameMenu==='1'){showGamesMenu(false,false);return;} const runtimeGame=document.body.dataset.activeGame; const storedGame=pairStorage.getItem(ACTIVE_GAME_KEY); const savedGame=(connected&&runtimeGame&&gameMeta[runtimeGame])?runtimeGame:storedGame; if(savedGame&&gameMeta[savedGame]){ calendarSection.hidden=true; placesSection.hidden=true; gamesSection.hidden=false; if(progressSection)progressSection.hidden=true; openGame(savedGame,false); } else showTab('games',false);} else showTab(tab,false); }
  document.addEventListener('pair:changed', refreshPairUI);
  document.addEventListener('session:remote-ui',e=>{
    const m=e.detail||{};
    if(m.kind==='tab'&&m.payload?.which) showTab(m.payload.which,false);
    if(m.kind==='game'&&m.payload?.key) openGame(m.payload.key,false);
    if(m.kind==='game-menu') showGamesMenu(false,true);
    if(m.kind==='game-action'){
      const a=m.payload?.action;
      if(a==='passion-roll'){openGame('passion',false);runPassionRoll({action:m.payload.actionValue,body:m.payload.bodyValue},true);}
      if(a==='direct-choice'){openGame('direct',false);directAction=m.payload.directAction||directAction;document.querySelectorAll('#directActionChoice .choice-btn').forEach(x=>x.classList.toggle('active',x.dataset.action===directAction));}
      if(a==='direct-roll'){openGame('direct',false);runDirectRoll({directAction:m.payload.directAction,body:m.payload.body},true);}
      if(a==='random-pose-levels'){
        openGame('randomPose',false);applyRandomPoseLevels(m.payload.ids||[],{sync:false});
      }
      if(a==='random-pose-prepare'){
        openGame('randomPose',false);
        applyRandomPoseLevels(m.payload.ids||[],{sync:false});
        const spinId=m.payload.spinId;
        const pool=getRandomPosePool();
        randomSpinPending.set(spinId,{role:'receiver',target:m.payload.order,turn:m.payload.turn,ids:m.payload.ids||[],started:false});
        setRandomSpinButtonBusy(true);
        preloadPosePool(pool).then(()=>window.SessionSync?.sendUI?.('game-action',{action:'random-pose-ready',spinId}));
      }
      if(a==='random-pose-ready'){
        const p=randomSpinPending.get(m.payload.spinId);
        if(p&&p.role==='initiator'&&!p.started){
          p.started=true;
          const startAt=Date.now()+700;
          window.SessionSync?.sendUI?.('game-action',{action:'random-pose-start',spinId:m.payload.spinId,startAt,order:p.target,turn:p.turn,ids:p.ids});
          runRandomPoseSpin(p.target,false,startAt,p.turn).then(target=>{
            if(target) window.SessionSync?.sendUI?.('game-action',{action:'random-pose-result',spinId:m.payload.spinId,order:target.order_index,ids:p.ids});
          }).finally(()=>{randomSpinPending.delete(m.payload.spinId);setRandomSpinButtonBusy(false)});
        }
      }
      if(a==='random-pose-start'){
        openGame('randomPose',false);
        applyRandomPoseLevels(m.payload.ids||[],{sync:false});
        const p=randomSpinPending.get(m.payload.spinId)||{};p.started=true;randomSpinPending.set(m.payload.spinId,p);
        runRandomPoseSpin(m.payload.order,true,m.payload.startAt,m.payload.turn).finally(()=>{randomSpinPending.delete(m.payload.spinId);setRandomSpinButtonBusy(false)});
      }
      if(a==='random-pose-result'){
        openGame('randomPose',false);
        applyRandomPoseLevels(m.payload.ids||[],{sync:false});
        const item=RANDOM_POSITIONS.find(x=>Number(x.order_index)===Number(m.payload.order));
        if(item){
          setRandomPose(item);
          if(randomPoseResultIndex)randomPoseResultIndex.textContent=`Поза ${item.order_index}`;
          if(randomPoseResult)randomPoseResult.textContent=item.poseTitle||(`Поза ${item.order_index}`);
          if(randomPoseDescription)randomPoseDescription.textContent=item.poseDescription||'';
          if(randomPoseResultBox)randomPoseResultBox.hidden=false;
        }
        randomSpinPending.delete(m.payload.spinId);setRandomSpinButtonBusy(false);
      }
    }
  });
  if(PairDB.active) refreshPairUI();
})();


// --- Pair selector / bootstrap ---
(() => {
  const $=s=>document.querySelector(s);
  const gate=$('#pairGate'), shell=$('#appShell'), listEl=$('#pairList'), label=$('#activePairLabel');
  const pairLabel=p=>`${p.players?.[0]?.name||'Гравець 1'} + ${p.players?.[1]?.name||'Гравець 2'}`;
  async function renderList(){
    const pairs=await PairDB.list(); listEl.innerHTML='';
    if(!pairs.length){const d=document.createElement('div');d.className='pair-list-empty';d.textContent='Ще немає створених пар.';listEl.appendChild(d);return;}
    pairs.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)).forEach(p=>{
      const row=document.createElement('div');row.className='pair-row';
      const btn=document.createElement('button');btn.className='pair-select';btn.type='button';btn.innerHTML=`<strong>${pairLabel(p)}</strong><small>${p.players[0].gender==='male'?'Чоловік':'Жінка'} + ${p.players[1].gender==='male'?'Чоловік':'Жінка'}</small>`;
      btn.onclick=async()=>{await PairDB.activate(p.id);showApp()};
      const del=document.createElement('button');del.className='pair-delete';del.type='button';del.textContent='×';del.title='Видалити пару';del.onclick=async()=>{if(confirm(`Видалити пару “${pairLabel(p)}” та весь її прогрес?`)){await PairDB.remove(p.id);await renderList();if(!PairDB.active)showGate()}};
      row.append(btn,del);listEl.appendChild(row);
    });
  }
  function showApp(){const p=PairDB.active;if(!p)return;gate.hidden=true;shell.hidden=false;label.textContent=pairLabel(p);}
  function showGate(){shell.hidden=true;gate.hidden=false;renderList()}
  $('#switchPairBtn')?.addEventListener('click',showGate);
  $('#openSessionBtn')?.addEventListener('click',()=>{showGate();setTimeout(()=>document.querySelector('.pair-session-card')?.scrollIntoView({behavior:'smooth',block:'center'}),50)});
  $('#createPairBtn')?.addEventListener('click',async()=>{
    const p1=$('#newPairP1').value.trim()||'Гравець 1', p2=$('#newPairP2').value.trim()||'Гравець 2';
    await PairDB.create(p1,$('#newPairG1').value,p2,$('#newPairG2').value); showApp();
  });
  $('#exportDbBtn')?.addEventListener('click',async()=>{
    try{
      await PairDB.save();
      const backup=await PairDB.exportAll();
      const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'});
      const url=URL.createObjectURL(blob);
      const a=document.createElement('a');
      const stamp=new Date().toISOString().replace(/[:.]/g,'-');
      a.href=url; a.download=`scratch-love-backup-${stamp}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(err){console.error(err);alert('Не вдалося експортувати базу.');}
  });
  $('#importDbBtn')?.addEventListener('click',()=>$('#importDbFile')?.click());
  $('#importDbFile')?.addEventListener('change',async e=>{
    const file=e.target.files?.[0]; if(!file)return;
    try{
      const payload=JSON.parse(await file.text());
      if(!confirm('Імпортувати резервну копію? Профілі з однаковими ID будуть оновлені даними з файлу.')){e.target.value='';return;}
      const count=await PairDB.importAll(payload);
      await renderList();
      if(PairDB.active) showApp(); else showGate();
      alert(`Імпортовано профілів: ${count}`);
    }catch(err){console.error(err);alert('Не вдалося імпортувати файл. Перевірте, що це резервна копія Scratch Love.');}
    e.target.value='';
  });
  document.addEventListener('pair:changed',e=>{if(e.detail)label.textContent=pairLabel(e.detail)});document.addEventListener('pair:profile',()=>{if(PairDB.active)label.textContent=pairLabel(PairDB.active)});
  (async()=>{try{const p=await PairDB.init();if(p){document.dispatchEvent(new CustomEvent('pair:changed',{detail:p}));showApp()}else showGate()}catch(err){console.error(err);gate.hidden=false;listEl.innerHTML='<div class="pair-list-empty">Не вдалося відкрити IndexedDB. Запустіть сайт через локальний веб-сервер (localhost), а не в приватному режимі.</div>'}})();
})();

// v20 unified progress refresh
document.addEventListener('pair:changed',()=>{ try{ document.dispatchEvent(new CustomEvent('progress:changed')); }catch(e){} });

// --- Extra couple games v21 ---
(() => {
  'use strict';
  const $=s=>document.querySelector(s); const parse=(k,f)=>{try{return JSON.parse(pairStorage.getItem(k)||JSON.stringify(f))}catch{return f}}; const save=(k,v)=>pairStorage.setItem(k,JSON.stringify(v));
  const names=()=>{try{return JSON.parse(pairStorage.getItem('sa_games_player_names_v1')||'[]')}catch{return []}};
  function extraGameViewRole(){
    const sessionRole=window.SessionSync?.role;
    if(sessionRole===0||sessionRole===1)return Number(sessionRole);
    const saved=Number(pairStorage.getItem('sa_local_view_role_v1'));
    return saved===1?1:0;
  }
  function extraParticipantLabel(index,withName=true){
    const n=names(), self=extraGameViewRole();
    const prefix=index===self?'Ви':'Ваш партнер';
    return withName?`${prefix} — ${n[index]||('Гравець '+(index+1))}`:prefix;
  }
  const SECRET='sa_secret_wishes_v1', BATTLE='sa_battle_wishes_v1', BWIN='sa_battle_winners_v1', RATINGS='sa_five_ratings_v1';
  const poses=()=>Array.isArray(window.POSITION_ITEMS)?window.POSITION_ITEMS.filter(x=>x.audience==='mf'):[];
  const allPlaces=()=>document.querySelectorAll('.place-chip').length?[...document.querySelectorAll('.place-chip')].map(x=>x.textContent.replace(/×$/,'').trim()).filter(Boolean):['У машині','У ванній','На дивані','У готельному номері','На природі'];
  const actions=['Поцілунок','Дотик','Масаж','Стиснути','Облизати','Смоктати','Шльопання'];
  const bodies=['Рука','Сідниці','Спина','Живіт','Щоки','Груди','Пах','Вухо','Стопи','Палець','Коліна','Нога','Губи','Пупок','Шия','Соски','Промежина','Стегно','Пальці ніг'];
  function addSecret(player,input){const val=$(input)?.value.trim();if(!val)return;const d=parse(SECRET,[[],[]]);d[player]||=[];d[player].push(val);save(SECRET,d);$(input).value='';renderSecret()}
  function renderSecret(){const d=parse(SECRET,[[],[]]); if($('#secretWishP1Title'))$('#secretWishP1Title').textContent=extraParticipantLabel(0,true);if($('#secretWishP2Title'))$('#secretWishP2Title').textContent=extraParticipantLabel(1,true);if($('#secretWishP1Count'))$('#secretWishP1Count').textContent=`Збережено таємно: ${(d[0]||[]).length}`;if($('#secretWishP2Count'))$('#secretWishP2Count').textContent=`Збережено таємно: ${(d[1]||[]).length}`}
  $('#secretWishP1Form')?.addEventListener('submit',e=>{e.preventDefault();addSecret(0,'#secretWishP1Input')});$('#secretWishP2Form')?.addEventListener('submit',e=>{e.preventDefault();addSecret(1,'#secretWishP2Input')});
  $('#revealSecretWishBtn')?.addEventListener('click',()=>{const d=parse(SECRET,[[],[]]), pool=[...(d[0]||[]).map(x=>({p:0,x})),...(d[1]||[]).map(x=>({p:1,x}))],box=$('#secretWishResult'),n=names();if(!pool.length){box.hidden=false;box.innerHTML='<strong>Спочатку додайте хоча б одне бажання.</strong>';return}const r=pool[Math.floor(Math.random()*pool.length)];box.hidden=false;box.innerHTML=`<small>Бажання від: ${extraParticipantLabel(r.p,true)}</small><strong>${escapeHtml(r.x)}</strong>`});
  function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
  // scenario reels
  const scenarios=['Романтика','Швидко','Повільно','Без слів','Із зав’язаними очима','У новому місці','Тільки поцілунки']; const durations=['2 хв','5 хв','10 хв','15 хв','20 хв']; let scenMode='duration';
  function simpleReel(el,items){if(!el)return;const track=el.querySelector('.slot-track');let idx=Math.floor(Math.random()*items.length);function draw(){track.innerHTML=[-1,0,1].map(o=>`<div class="slot-item ${o===0?'active':''}">${escapeHtml(items[(idx+o+items.length)%items.length])}</div>`).join('')}draw();return {setItems(a){items=a;idx%=Math.max(a.length,1);draw()},spinTo(value=null){return new Promise(res=>{const target=value==null?Math.floor(Math.random()*items.length):Math.max(0,items.indexOf(value));let steps=18+Math.floor(Math.random()*10),i=0;const t=setInterval(()=>{idx=(idx+1)%items.length;draw();if(++i>=steps){clearInterval(t);idx=target;draw();res(items[idx])}},70+i*3)})},spin(){return this.spinTo(null)}}}
  const scenReel=simpleReel($('#scenarioMainReel'),scenarios), secondReel=simpleReel($('#scenarioSecondReel'),durations);
  $('#scenarioSecondType')?.addEventListener('click',e=>{const b=e.target.closest('[data-mode]');if(!b)return;scenMode=b.dataset.mode;$('#scenarioSecondType').querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));const arr=scenMode==='duration'?durations:allPlaces();secondReel?.setItems(arr.length?arr:['Ваше місце']);$('#scenarioSecondLabel').textContent=scenMode==='duration'?'Тривалість':'Місце'});
  async function runScenarioRoll(forced=null,remote=false){const secondItems=scenMode==='duration'?durations:allPlaces();if(forced?.mode){scenMode=forced.mode;document.querySelectorAll('#scenarioSecondType [data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===scenMode));secondReel?.setItems(scenMode==='duration'?durations:(allPlaces().length?allPlaces():['Ваше місце']));if($('#scenarioSecondLabel'))$('#scenarioSecondLabel').textContent=scenMode==='duration'?'Тривалість':'Місце'}const aTarget=forced?.a||scenarios[Math.floor(Math.random()*scenarios.length)], pool=scenMode==='duration'?durations:(allPlaces().length?allPlaces():['Ваше місце']), bTarget=forced?.b||pool[Math.floor(Math.random()*pool.length)];if(!remote)window.SessionSync?.sendUI?.('game-action',{action:'scenario-roll',mode:scenMode,a:aTarget,b:bTarget});const [a,b]=await Promise.all([scenReel.spinTo(aTarget),secondReel.spinTo(bTarget)]),box=$('#scenarioResult');box.hidden=false;box.innerHTML=`<small>Ваш сценарій</small><strong>${a} — ${b}</strong>`}
  $('#scenarioRollBtn')?.addEventListener('click',()=>runScenarioRoll());
  document.addEventListener('session:remote-ui',e=>{const m=e.detail||{};if(m.kind!=='game-action')return;const p=m.payload||{};if(p.action==='scenario-roll')runScenarioRoll(p,true);});
  // 5 minutes
  const fiveModes=['Тільки дотики','Тільки поцілунки','Без рук','Один керує','Повільний темп','Без слів'];let fiveSec=300,fiveTimerId=null,fiveMode=fiveModes[0];
  function fiveDraw(){if($('#fiveTimer'))$('#fiveTimer').textContent=`${String(Math.floor(fiveSec/60)).padStart(2,'0')}:${String(fiveSec%60).padStart(2,'0')}`;if($('#fiveMode'))$('#fiveMode').textContent=fiveMode}
  $('#fiveRandomBtn')?.addEventListener('click',()=>{fiveMode=fiveModes[Math.floor(Math.random()*fiveModes.length)];fiveDraw()});$('#fiveStartBtn')?.addEventListener('click',()=>{if(fiveTimerId)return;fiveTimerId=setInterval(()=>{fiveSec--;fiveDraw();if(fiveSec<=0){clearInterval(fiveTimerId);fiveTimerId=null;$('#fiveRating').hidden=false}},1000)});$('#fiveResetBtn')?.addEventListener('click',()=>{clearInterval(fiveTimerId);fiveTimerId=null;fiveSec=300;$('#fiveRating').hidden=true;fiveDraw()});
  document.querySelectorAll('#fiveRating [data-rating]').forEach(b=>b.addEventListener('click',()=>{const d=parse(RATINGS,[]);d.push({rating:+b.dataset.rating,mode:fiveMode,at:Date.now()});save(RATINGS,d);$('#fiveRatingHistory').textContent=`Остання оцінка: ${b.dataset.rating}/5`;$('#fiveRating').hidden=true}));fiveDraw();
  // blind choice
  function newBlind(){const box=$('#blindCards'),res=$('#blindResult');if(!box)return;res.hidden=true;box.innerHTML='';for(let i=0;i<3;i++){const b=document.createElement('button');b.className='blind-card';b.innerHTML='<span>?</span><small>Обрати</small>';b.onclick=()=>revealBlind(b);box.appendChild(b)}}
  function revealBlind(btn){if(btn.classList.contains('opened'))return;const types=['Дія','Поза','Місце','Бажання','Бонус'],type=types[Math.floor(Math.random()*types.length)];let value='';if(type==='Дія')value=actions[Math.floor(Math.random()*actions.length)];if(type==='Поза'){const a=poses(),r=a[Math.floor(Math.random()*a.length)];value=r?`${r.poseTitle||'Поза'} · №${r.order_index}`:'Поза'}if(type==='Місце'){const a=allPlaces();value=a[Math.floor(Math.random()*a.length)]||'Ваше місце'}if(type==='Бажання'){const d=parse(SECRET,[[],[]]).flat();value=d.length?d[Math.floor(Math.random()*d.length)]:'Додайте бажання у грі «Таємне бажання»'}if(type==='Бонус')value='+1 бал поточному гравцю';btn.classList.add('opened');btn.innerHTML=`<strong>${type}</strong><small>${escapeHtml(value)}</small>`;const res=$('#blindResult');res.hidden=false;res.innerHTML=`<small>${type}</small><strong>${escapeHtml(value)}</strong>`}$('#blindResetBtn')?.addEventListener('click',newBlind);newBlind();
  // battle
  function addBattle(p,input){const v=$(input)?.value.trim();if(!v)return;const d=parse(BATTLE,[[],[]]);d[p]||=[];if(d[p].length<10)d[p].push(v);save(BATTLE,d);$(input).value='';renderBattle()};function renderBattle(){const d=parse(BATTLE,[[],[]]);if($('#battleCounts'))$('#battleCounts').textContent=`${extraParticipantLabel(0,true)}: ${(d[0]||[]).length}/10 · ${extraParticipantLabel(1,true)}: ${(d[1]||[]).length}/10`;const w=parse(BWIN,[]);if($('#battleWinners'))$('#battleWinners').innerHTML=w.length?w.map(x=>`<span class="wish-chip">${escapeHtml(x)}</span>`).join(''):'<span class="muted">Ще немає переможців</span>'}
  $('#battleP1Form')?.addEventListener('submit',e=>{e.preventDefault();addBattle(0,'#battleP1Input')});$('#battleP2Form')?.addEventListener('submit',e=>{e.preventDefault();addBattle(1,'#battleP2Input')});$('#battleStartBtn')?.addEventListener('click',()=>{const d=parse(BATTLE,[[],[]]),arena=$('#battleArena');if(!(d[0]?.length&&d[1]?.length)){arena.hidden=false;arena.innerHTML='<strong>Додайте бажання від обох гравців.</strong>';return}const a=d[0][Math.floor(Math.random()*d[0].length)],b=d[1][Math.floor(Math.random()*d[1].length)];arena.hidden=false;arena.innerHTML=`<button class="battle-option">${escapeHtml(a)}</button><span>VS</span><button class="battle-option">${escapeHtml(b)}</button>`;arena.querySelectorAll('.battle-option').forEach(x=>x.onclick=()=>{const w=parse(BWIN,[]);w.push(x.textContent);save(BWIN,w);renderBattle();arena.hidden=true})});renderBattle();
  // quest
  let quest=null,questStep=0;function makeQuest(){const ps=poses(),wish=parse(SECRET,[[],[]]).flat();return [{type:'Місце',value:(()=>{const a=allPlaces();return a[Math.floor(Math.random()*a.length)]||'Обране вами місце'})()},{type:'Дія',value:actions[Math.floor(Math.random()*actions.length)]},{type:'Частина тіла',value:bodies[Math.floor(Math.random()*bodies.length)]},{type:'Поза',value:(()=>{const r=ps[Math.floor(Math.random()*ps.length)];return r?`${r.poseTitle||'Поза'} · №${r.order_index}`:'Випадкова поза'})()},{type:'Фінальне бажання',value:wish.length?wish[Math.floor(Math.random()*wish.length)]:'Додайте власне бажання'}]};function renderQuest(){const el=$('#questSteps');if(!el)return;el.innerHTML=(quest||[]).map((s,i)=>`<div class="quest-step ${i<questStep?'done':i===questStep?'active':'locked'}"><span>${i+1}</span><div><small>${s.type}</small><strong>${i<=questStep?escapeHtml(s.value):'Заблоковано'}</strong></div></div>`).join('');$('#questNextBtn').disabled=!quest||questStep>=quest.length-1}$('#questNewBtn')?.addEventListener('click',()=>{quest=makeQuest();questStep=0;renderQuest()});$('#questNextBtn')?.addEventListener('click',()=>{if(quest&&questStep<quest.length-1){questStep++;renderQuest()}});renderQuest();
  document.addEventListener('pair:changed',()=>{renderSecret();renderBattle()});renderSecret();
})();

// --- P2P session sync v24: stable UI + auto restore ---
(() => {
  'use strict';
  const $=s=>document.querySelector(s);
  let peer=null,conn=null,isApplying=false,lastSent='',localRole=null,remoteRole=null,isHost=false,uiApply=false,uiTimer=null;
  let reconnectTimer=null, reconnectAttempts=0, restoring=false;
  const SESSION_META='p2p_session_v2';
  const status=(t,ok=false)=>{const e=$('#sessionStatus');if(e){e.textContent=t;e.classList.toggle('connected',ok)}};
  const roleStatus=$('#sessionRoleStatus'), activeSessionRole=$('#activeSessionRole');
  function code(){return 'love-'+Math.random().toString(36).slice(2,8)}
  function roleLabel(role){const p=PairDB.active?.players?.[role];return p?.name?`${p.name} (Гравець ${role+1})`:`Гравець ${role+1}`}
  function updateRoleStatus(conflict=false){
    const connected=!!conn?.open;
    const selected=localRole===0||localRole===1;
    const text=conflict?`Конфлікт ролей: обидва обрали ${roleLabel(localRole)}. Перепідключіться та оберіть різні ролі.`:`Ви: ${selected?roleLabel(localRole):'роль не обрана'}${remoteRole===0||remoteRole===1?` · партнер: ${roleLabel(remoteRole)}`:''}`;
    if(roleStatus){roleStatus.hidden=!(connected||restoring);roleStatus.classList.toggle('conflict',conflict);if(connected||restoring)roleStatus.textContent=text}
    if(activeSessionRole){activeSessionRole.hidden=!(connected||restoring);activeSessionRole.classList.toggle('conflict',conflict);if(connected||restoring)activeSessionRole.textContent=text}
    document.dispatchEvent(new CustomEvent('session:role-changed',{detail:{role:localRole,remoteRole,connected,restoring}}));
  }
  function send(msg){if(conn?.open)try{conn.send(msg)}catch(e){console.warn('session send',e)}}
  function sendPair(pair){if(!conn?.open||isApplying||!pair)return;const snap=JSON.stringify(pair);if(snap===lastSent)return;lastSent=snap;send({type:'pair',pair:JSON.parse(snap)})}
  function sendUI(kind,payload={}){if(!conn?.open||uiApply)return;send({type:'ui',kind,payload,origin:peer?.id||null,ts:Date.now()})}
  async function saveSessionMeta(mode,sessionCode){
    try{await PairDB.setMeta(SESSION_META,{mode,code:sessionCode,role:localRole,pairId:PairDB.active?.id||null,updatedAt:Date.now()})}catch(e){console.warn('session meta save',e)}
  }
  async function clearSessionMeta(){try{await PairDB.setMeta(SESSION_META,null)}catch{}}

  const mirrorIds=['passionResultBox','passionTurnLabel','passionResult','directResultBox','directTurnLabel','directResult','randomPoseResultBox','randomPoseResultIndex','randomPoseResult','randomPoseDescription','randomPoseNumber','randomPoseCaption','scenarioResult','fiveTimer','fiveMode','fiveRating','fiveRatingHistory','secretWishResult','secretWishP1Count','secretWishP2Count','blindResult','battleCounts','battleWinners','questSteps','fortuneLevelSummary'];
  const slotSelectors=['#passionActionSlot .slot-track','#passionBodySlot .slot-track','#directBodySlot .slot-track','#scenarioMainReel .slot-track','#scenarioSecondReel .slot-track'];
  function captureUI(){
    const fields={};
    mirrorIds.forEach(id=>{const el=document.getElementById(id);if(!el)return;fields[id]={hidden:!!el.hidden,html:el.innerHTML,text:el.textContent}});
    const preview=$('#randomPosePreview');if(preview)fields.randomPosePreview={src:preview.getAttribute('src'),alt:preview.getAttribute('alt')};
    const rotor=$('#fortuneWheelRotor');if(rotor)fields.fortuneWheelRotor={transform:rotor.style.transform,transition:rotor.style.transition};
    const activeDirect=$('#directActionChoice .choice-btn.active');
    const activeScenario=$('#scenarioSecondType [data-mode].active');
    const slots=slotSelectors.map(sel=>document.querySelector(sel)?.innerHTML||'');
    const pd=$('#positionDialog');
    const position=pd?{open:pd.open,category:$('#positionCategoryTitle')?.textContent||'',title:$('#positionDayTitle')?.textContent||'',src:$('#calendarPositionImage')?.getAttribute('src')||'',instruction:$('#positionInstruction')?.textContent||'',metaHidden:$('#positionMeta')?.hidden??true,name:$('#positionPoseName')?.textContent||'',description:$('#positionPoseDescription')?.textContent||''}:null;
    return {fields,slots,directAction:activeDirect?.dataset.action||null,scenarioMode:activeScenario?.dataset.mode||null,position,mainTab:document.body.dataset.mainTab||null,activeGame:document.body.dataset.activeGame||null,gameMenu:document.body.dataset.gameMenu==='1'};
  }
  function applyUI(snap){
    if(!snap)return;uiApply=true;
    try{
      // Apply navigation first, so snapshot content lands in the visible game instead of the menu.
      if(snap.mainTab){
        document.dispatchEvent(new CustomEvent('session:remote-ui',{detail:{kind:'tab',payload:{which:snap.mainTab},fromSnapshot:true}}));
        if(snap.mainTab==='games'){
          if(snap.gameMenu)document.dispatchEvent(new CustomEvent('session:remote-ui',{detail:{kind:'game-menu',payload:{},fromSnapshot:true}}));
          else if(snap.activeGame)document.dispatchEvent(new CustomEvent('session:remote-ui',{detail:{kind:'game',payload:{key:snap.activeGame},fromSnapshot:true}}));
        }
      }
      Object.entries(snap.fields||{}).forEach(([id,v])=>{const el=document.getElementById(id);if(!el)return;if('hidden'in v)el.hidden=!!v.hidden;if(v.src&&el.tagName==='IMG'){el.src=v.src;if(v.alt)el.alt=v.alt}else if(typeof v.html==='string')el.innerHTML=v.html;if(v.transform&&id==='fortuneWheelRotor'){el.style.transform=v.transform;el.style.transition=v.transition||''}});
      if(snap.fields?.fortuneWheelRotor){const r=$('#fortuneWheelRotor');if(r){r.style.transform=snap.fields.fortuneWheelRotor.transform||'';r.style.transition=snap.fields.fortuneWheelRotor.transition||''}}
      (snap.slots||[]).forEach((html,i)=>{const track=document.querySelector(slotSelectors[i]);if(track&&html)track.innerHTML=html});
      if(snap.directAction)document.querySelectorAll('#directActionChoice .choice-btn').forEach(b=>b.classList.toggle('active',b.dataset.action===snap.directAction));
      if(snap.scenarioMode)document.querySelectorAll('#scenarioSecondType [data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===snap.scenarioMode));
      if(snap.position){const p=snap.position,dlg=$('#positionDialog');if(dlg){if($('#positionCategoryTitle'))$('#positionCategoryTitle').textContent=p.category;if($('#positionDayTitle'))$('#positionDayTitle').textContent=p.title;if($('#calendarPositionImage')&&p.src)$('#calendarPositionImage').src=p.src;if($('#positionInstruction'))$('#positionInstruction').textContent=p.instruction;if($('#positionMeta'))$('#positionMeta').hidden=p.metaHidden;if($('#positionPoseName'))$('#positionPoseName').textContent=p.name;if($('#positionPoseDescription'))$('#positionPoseDescription').textContent=p.description;if(p.open&&!dlg.open)try{dlg.showModal()}catch{};if(!p.open&&dlg.open)dlg.close()}}
    }finally{setTimeout(()=>uiApply=false,100)}
  }
  function scheduleUISnapshot(delay=140){clearTimeout(uiTimer);uiTimer=setTimeout(()=>{if(conn?.open&&!uiApply)send({type:'ui-snapshot',snapshot:captureUI(),origin:peer?.id||null,ts:Date.now()})},delay)}
  window.SessionSync={sendUI,snapshot:()=>scheduleUISnapshot(20),get role(){return localRole},get connected(){return !!conn?.open}};

  function clearReconnect(){clearTimeout(reconnectTimer);reconnectTimer=null;reconnectAttempts=0}
  function scheduleGuestReconnect(sessionCode){
    clearTimeout(reconnectTimer);
    reconnectTimer=setTimeout(()=>{
      if(conn?.open||!peer||peer.destroyed)return;
      reconnectAttempts++;
      status(`Відновлюємо сесію… спроба ${reconnectAttempts}`);
      try{wire(peer.connect(sessionCode,{reliable:true}),false,sessionCode,false)}catch{}
    },Math.min(5000,1000+reconnectAttempts*700));
  }
  function wire(c,hostSide,sessionCode,restored=false){
    if(conn&&conn!==c){try{conn.close()}catch{}}
    conn=c;isHost=hostSide;$('#leaveSessionBtn').hidden=false;
    c.on('open',async()=>{
      clearReconnect();
      const recoveringThisPage=!!restored;
      restoring=false;
      status(recoveringThisPage?'Сесію відновлено · отримуємо актуальний екран партнера…':'Підключено · синхронізація активна',true);updateRoleStatus(false);
      await saveSessionMeta(hostSide?'host':'guest',sessionCode);
      send({type:'hello',role:localRole,players:PairDB.active?.players||null,recovering:recoveringThisPage});
      if(recoveringThisPage){
        // Після reload не відправляємо старий локальний UI/профіль.
        // Просимо пристрій, який залишався онлайн, надіслати актуальний стан.
        send({type:'state-request',origin:peer?.id||null,ts:Date.now()});
      }else{
        if(isHost&&PairDB.active)sendPair(PairDB.active);
        sendUI('tab',{which:document.body.dataset.mainTab||pairStorage.getItem('sa_main_tab_v1')||'calendar'});
        const activeGame=document.body.dataset.activeGame||pairStorage.getItem('sa_active_game_v2');
        if(activeGame)sendUI('game',{key:activeGame}); else if((document.body.dataset.mainTab||pairStorage.getItem('sa_main_tab_v1'))==='games')sendUI('game-menu',{});
        scheduleUISnapshot(220);
      }
    });
    c.on('data',async msg=>{
      // Ignore reflected UI messages from our own Peer id.
      if(msg?.origin&&peer?.id&&msg.origin===peer.id)return;
      if(msg?.type==='state-request'){
        // Інша сторона щойно перезавантажилась. Саме цей пристрій є джерелом
        // актуальної вкладки/гри та прогресу.
        if(PairDB.active){
          try{send({type:'pair',pair:JSON.parse(JSON.stringify(PairDB.active))})}catch{}
        }
        send({type:'ui-snapshot',snapshot:captureUI(),origin:peer?.id||null,ts:Date.now(),authoritative:true});
        return;
      }
      if(msg?.type==='hello'){
        remoteRole=Number(msg.role);const conflict=remoteRole===localRole;updateRoleStatus(conflict);status(conflict?'Підключено, але є конфлікт ролей':'Підключено · синхронізація активна',!conflict);
        // Якщо партнер повідомляє, що він після reload, повторно надішлемо
        // актуальний стан після hello — це робить відновлення стійкішим до гонок.
        if(msg.recovering){
          if(PairDB.active){try{send({type:'pair',pair:JSON.parse(JSON.stringify(PairDB.active))})}catch{}}
          setTimeout(()=>send({type:'ui-snapshot',snapshot:captureUI(),origin:peer?.id||null,ts:Date.now(),authoritative:true}),80);
        }
        return;
      }
      if(msg?.type==='pair'&&msg.pair){isApplying=true;try{lastSent=JSON.stringify(msg.pair);await PairDB.applyRemote(msg.pair);const g=$('#pairGate'),sh=$('#appShell'),lab=$('#activePairLabel');if(g)g.hidden=true;if(sh)sh.hidden=false;if(lab&&PairDB.active)lab.textContent=PairDB.active.players.map(x=>x.name).join(' + ');updateRoleStatus(remoteRole===localRole);status(remoteRole===localRole?'Синхронізовано · конфлікт ролей':'Синхронізовано',remoteRole!==localRole)}finally{setTimeout(()=>isApplying=false,220)}return}
      if(msg?.type==='ui'){uiApply=true;try{document.dispatchEvent(new CustomEvent('session:remote-ui',{detail:msg}))}finally{setTimeout(()=>uiApply=false,100)}return}
      if(msg?.type==='ui-snapshot'){applyUI(msg.snapshot);return}
    });
    c.on('close',()=>{
      conn=null;remoteRole=null;updateRoleStatus(false);
      if(!isHost&&sessionCode){restoring=true;status('Зв’язок втрачено · очікуємо хоста…');updateRoleStatus(false);scheduleGuestReconnect(sessionCode)}
      else status('Партнер відключився · сесія очікує повторного підключення');
    });
    c.on('error',e=>{status('Помилка з’єднання: '+e.type);if(!hostSide&&sessionCode)scheduleGuestReconnect(sessionCode)});
  }
  function createHost(sessionCode,role,restored=false,attempt=0){
    if(typeof Peer==='undefined'){status('Не вдалося завантажити P2P-модуль. Перевірте інтернет.');return}
    localRole=Number(role);isHost=true;restoring=restored;updateRoleStatus(false);
    try{peer?.destroy()}catch{}
    peer=new Peer(sessionCode);
    status(restored?`Відновлюємо сесію як ${roleLabel(localRole)}…`:`Створюємо сесію як ${roleLabel(localRole)}…`);
    peer.on('open',async pid=>{$('#sessionCode').textContent=pid;$('#sessionCodeBox').hidden=false;$('#leaveSessionBtn').hidden=false;await saveSessionMeta('host',pid);status(`${restored?'Сесію відновлено':'Очікуємо партнера'} · ви ${roleLabel(localRole)}`)});
    peer.on('connection',c=>wire(c,true,sessionCode,restored));
    peer.on('error',e=>{
      if(restored&&e.type==='unavailable-id'&&attempt<8){status('Чекаємо звільнення коду сесії…');setTimeout(()=>createHost(sessionCode,role,true,attempt+1),1000+attempt*350)}
      else status('Помилка: '+e.type)
    });
  }
  function createGuest(sessionCode,role,restored=false){
    if(typeof Peer==='undefined'){status('Не вдалося завантажити P2P-модуль. Перевірте інтернет.');return}
    localRole=Number(role);isHost=false;restoring=restored;updateRoleStatus(false);
    try{peer?.destroy()}catch{}
    peer=new Peer();status(restored?`Відновлюємо підключення як ${roleLabel(localRole)}…`:`Підключення як ${roleLabel(localRole)}…`);
    peer.on('open',async()=>{await saveSessionMeta('guest',sessionCode);wire(peer.connect(sessionCode,{reliable:true}),false,sessionCode,restored)});
    peer.on('error',e=>{status('Помилка: '+e.type);if(restored)scheduleGuestReconnect(sessionCode)});
  }
  $('#createSessionBtn')?.addEventListener('click',()=>{
    const roleValue=$('#createSessionRole')?.value;
    if(roleValue!=='0'&&roleValue!=='1'){status('Спочатку оберіть, за кого ви граєте.');$('#createSessionRole')?.focus();return}
    createHost(code(),Number(roleValue),false,0);
  });
  $('#joinSessionBtn')?.addEventListener('click',()=>{
    const id=$('#joinSessionCode')?.value.trim();if(!id){status('Введіть код сесії.');return}
    const roleValue=$('#joinSessionRole')?.value;
    if(roleValue!=='0'&&roleValue!=='1'){status('Спочатку оберіть, за кого ви граєте.');$('#joinSessionRole')?.focus();return}
    createGuest(id,Number(roleValue),false);
  });
  $('#copySessionCodeBtn')?.addEventListener('click',async()=>{const t=$('#sessionCode')?.textContent;if(t&&t!=='—'){try{await navigator.clipboard.writeText(t);status('Код скопійовано')}catch{status('Скопіюйте код вручну: '+t)}}});
  $('#leaveSessionBtn')?.addEventListener('click',async()=>{clearReconnect();try{conn?.close();peer?.destroy()}catch{}conn=null;peer=null;remoteRole=null;restoring=false;$('#sessionCodeBox').hidden=true;$('#leaveSessionBtn').hidden=true;status('Не підключено');localRole=null;updateRoleStatus(false);await clearSessionMeta()});
  document.addEventListener('pair:state-saved',e=>{sendPair(e.detail);scheduleUISnapshot(150)});
  document.addEventListener('pair:profile',()=>sendPair(PairDB.active));
  document.addEventListener('click',e=>{if(!conn?.open||uiApply)return;const interactive=e.target.closest('button,[data-game],.calendar-day,.place-item,input[type=checkbox],select');if(!interactive)return;scheduleUISnapshot(220)});
  document.addEventListener('change',()=>scheduleUISnapshot(160));
  // No periodic UI snapshots: they caused visible flashing and could re-apply stale navigation.

  async function autoRestore(){
    for(let i=0;i<20;i++){
      try{
        if(!PairDB.active){await new Promise(r=>setTimeout(r,200));continue}
        const saved=await PairDB.getMeta(SESSION_META);
        if(!saved||!saved.code||(saved.role!==0&&saved.role!==1))return;
        localRole=Number(saved.role);restoring=true;
        if($('#createSessionRole'))$('#createSessionRole').value=String(localRole);
        if($('#joinSessionRole'))$('#joinSessionRole').value=String(localRole);
        if(saved.mode==='host'){
          $('#sessionCode').textContent=saved.code;$('#sessionCodeBox').hidden=false;
          createHost(saved.code,localRole,true,0);
        }else if(saved.mode==='guest'){
          if($('#joinSessionCode'))$('#joinSessionCode').value=saved.code;
          createGuest(saved.code,localRole,true);
        }
        return;
      }catch(e){await new Promise(r=>setTimeout(r,250))}
    }
  }
  setTimeout(autoRestore,350);
})();
