// ===== v34: stable pair profiles + deterministic realtime game sync =====
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
    instruction: $('#positionInstruction'), poseMeta: $('#positionMeta'), poseName: $('#positionPoseName'), poseDescription: $('#positionPoseDescription'), reveal: $('#revealPositionBtn'), defer: $('#deferPositionBtn'), complete: $('#completePositionBtn'), toast: $('#toast'), deferDialog: $('#deferDialog'), closeDeferDialog: $('#closeDeferDialog'), deferChoices: $('#deferPlayerChoices'), progressDialog: $('#progressDialog'), openProgress: $('#openProgressBtn'), closeProgress: $('#closeProgressDialog'), progressOverview: $('#progressOverview'), progressLevels: $('#progressLevels'), progressMonths: $('#progressMonths'), progressDeferred: $('#progressDeferred'), deferredCountBadge: $('#deferredCountBadge'), progressGameDebts: $('#progressGameDebts'), gameDebtCountBadge: $('#gameDebtCountBadge')
  };

  // Same keys as previous MF versions: old progress is preserved.
  const DONE_KEY = 'sa_position_done_mf';
  const REVEALED_KEY = 'sa_position_revealed_mf';
  const MANUAL_UNLOCK_KEY = 'sa_position_manual_unlock_mf';
  const DEV_UNLOCK_ALL_KEY = 'sa_position_dev_unlock_all_mf';
  const DEFERRED_KEY = 'sa_position_deferred_mf_v1';
  const HISTORY_KEY = 'sa_position_history_mf_v1';
  const GAME_WISH_DEBTS_KEY = 'sa_game_wish_debts_v1';
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
    const gameDebts=readJSON(GAME_WISH_DEBTS_KEY,[]).slice().sort((a,b)=>new Date(b.date)-new Date(a.date));
    if(els.gameDebtCountBadge) els.gameDebtCountBadge.textContent=gameDebts.filter(x=>!x.wishDone).length;
    if(els.progressGameDebts){
      els.progressGameDebts.innerHTML='';
      gameDebts.forEach(info=>{
        const card=document.createElement('div');
        card.className='deferred-progress-card game-debt-card'+(info.wishDone?' wish-done':'');
        const score=Array.isArray(info.score)?`${info.score[0]} : ${info.score[1]}`:'—';
        card.innerHTML=`<div class="game-debt-icon">🏆</div><div><strong>${info.debtorName||'Гравець'} виконує бажання</strong><span>${info.wishDone?'Бажання виконано ✓':`Для ${info.partnerName||'партнера'} · рахунок ${score}`}</span><small>${new Intl.DateTimeFormat('uk-UA',{day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(info.date))}</small></div>`;
        const actions=document.createElement('div');actions.className='deferred-card-actions';
        if(!info.wishDone){const wish=document.createElement('button');wish.type='button';wish.className='btn primary compact';wish.textContent='Бажання виконано ✓';wish.addEventListener('click',()=>{const all=readJSON(GAME_WISH_DEBTS_KEY,[]);const row=all.find(x=>x.id===info.id);if(row){row.wishDone=true;row.wishDoneDate=new Date().toISOString();saveJSON(GAME_WISH_DEBTS_KEY,all);PairDB.save?.();window.SessionSync?.replyUI?.('game-action',{action:'game-debt-done',id:info.id,wishDoneDate:row.wishDoneDate});}renderDetailedProgress();document.dispatchEvent(new CustomEvent('progress:changed'));});actions.appendChild(wish)}
        card.appendChild(actions);els.progressGameDebts.appendChild(card);
      });
      if(!gameDebts.length)els.progressGameDebts.innerHTML='<p class="empty-state">Поки немає бажань за результатами ігор.</p>';
    }
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
  // Local toast helper for the games module. The calendar module has its own
  // scoped toast() function, while the global `toast` name may resolve to the
  // #toast DOM element in browsers.
  function toast(msg){
    const el=document.getElementById('toast');
    if(!el)return;
    el.textContent=String(msg??'');
    el.classList.add('show');
    clearTimeout(toast.t);
    toast.t=setTimeout(()=>el.classList.remove('show'),1800);
  }
  const calendarTabBtn=$('#calendarTabBtn'), placesTabBtn=$('#placesTabBtn'), gamesTabBtn=$('#gamesTabBtn'), purchasesTabBtn=$('#purchasesTabBtn'), progressTabBtn=$('#progressTabBtn'), calendarSection=$('#calendarSection'), placesSection=$('#placesSection'), gamesSection=$('#gamesSection'), purchasesSection=$('#purchasesSection'), progressSection=$('#progressSection');
  if(!gamesSection) return;

  const NAMES_KEY='sa_games_player_names_v1',
        GENDERS_KEY='sa_games_player_genders_v1',
        SCORE_KEY='sa_games_score_v1',
        TURN_KEY='sa_games_turn_v1',
        PENDING_GAME_KEY='sa_games_pending_result_v1',
        PLACES_KEY='sa_games_places_v2',
        PLACES_PLANNED_KEY='sa_games_places_planned_v1',
        CUSTOM_ACTIONS_KEY='sa_games_custom_actions_v1',
        CUSTOM_BODY_KEY='sa_games_custom_body_v1',
        HEAT_KEY='sa_games_heat_v1',
        GAME_WISH_DEBTS_KEY='sa_game_wish_debts_v1',
        SCORE_FINISH_PROPOSAL_KEY='sa_score_finish_proposal_v1',
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


  const BODY_HEAT={
    light:new Set(['Рука','Спина','Живіт','Щоки','Вухо','Стопи','Палець','Коліна','Нога','Пупок','Ніс','Пальці ніг']),
    warm:new Set(['Сідниці','Груди','Пах','Губи','Шия','Соски','Стегно']),
    intimate:new Set(['Яєчка','Клітор','Статеві губи','Пеніс','Промежина','Вагіна'])
  };
  const getHeat=()=>Math.min(4,Math.max(1,Number(pairStorage.getItem(HEAT_KEY)||2)||2));
  const setHeat=(value,{sync=true}={})=>{
    const heat=Math.min(4,Math.max(1,Number(value)||2));
    pairStorage.setItem(HEAT_KEY,String(heat));
    renderHeatControls();
    refreshBodyPools();
    PairDB.save?.();
    if(sync&&window.SessionSync?.connected)window.SessionSync.replyUI?.('game-action',{action:'heat-change',heat});
  };
  function renderHeatControls(){
    const heat=getHeat();
    $$('[data-heat-control] .heat-btn').forEach(btn=>{
      const active=Number(btn.dataset.heat)===heat;
      btn.classList.toggle('active',active);
      btn.setAttribute('aria-pressed',active?'true':'false');
    });
  }
  function heatFilteredBody(items){
    const heat=getHeat();
    if(heat<=1)return items;
    const isCustom=x=>String(x.id||'').startsWith('cb_')||String(x.id||'').startsWith('custom_');
    const customAllowed=x=>!isCustom(x) || Math.min(4,Math.max(1,Number(x.heat)||1))>=heat;
    if(heat===2)return items.filter(x=>customAllowed(x) && (isCustom(x) || !['Рука','Щоки','Ніс','Палець','Стопи','Коліна','Пальці ніг'].includes(x.label)));
    if(heat===3)return items.filter(x=>customAllowed(x) && (isCustom(x) || BODY_HEAT.warm.has(x.label)||BODY_HEAT.intimate.has(x.label)||['Шия','Губи'].includes(x.label)));
    return items.filter(x=>customAllowed(x) && (isCustom(x) || BODY_HEAT.intimate.has(x.label)||['Сідниці','Груди','Пах','Соски'].includes(x.label)));
  }

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
  const getCustomBody=()=>safeParse(CUSTOM_BODY_KEY,[]).filter(x=>x&&typeof x.label==='string').map(x=>({id:x.id||('cb_'+Math.random().toString(36).slice(2)),label:x.label.trim(),gender:['male','female','any'].includes(x.gender)?x.gender:'any',heat:Math.min(4,Math.max(1,Number(x.heat)||1))}));
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
    renderHeatControls();
    refreshRollPermissions();
    renderScoreFinishProposal?.();
    const pg=currentPendingFor?.();
    if(pg?.gameKey)setResultButtonsEnabled?.(pg.gameKey,true);
  }
  function gameDebts(){return safeParse(GAME_WISH_DEBTS_KEY,[])}
  function saveGameDebts(rows){pairStorage.setItem(GAME_WISH_DEBTS_KEY,JSON.stringify(rows));PairDB.save?.();document.dispatchEvent(new CustomEvent('progress:changed'));}
  function markGameDebtDone(id,syncSession=true,forcedDate=null){
    const rows=gameDebts();const row=rows.find(x=>x.id===id);if(!row)return;
    row.wishDone=true;row.wishDoneDate=forcedDate||new Date().toISOString();saveGameDebts(rows);
    renderProgressPage();
    if(syncSession&&window.SessionSync?.connected)window.SessionSync.replyUI?.('game-action',{action:'game-debt-done',id,wishDoneDate:row.wishDoneDate});
  }

  const scoreFinishModal=$('#scoreFinishModal'), scoreFinishSummary=$('#scoreFinishSummary'),
        scoreFinishSelfVote=$('#scoreFinishSelfVote'), scoreFinishPartnerVote=$('#scoreFinishPartnerVote'),
        scoreFinishHint=$('#scoreFinishHint'), scoreFinishAgreeBtn=$('#scoreFinishAgreeBtn'), scoreFinishRejectBtn=$('#scoreFinishRejectBtn');
  // Keep the active agreement in runtime as well as IndexedDB. This prevents a
  // delayed pair snapshot from hiding an already-open confirmation dialog.
  let scoreFinishRuntime=null;
  function getScoreFinishProposal(){
    if(scoreFinishRuntime)return scoreFinishRuntime;
    try{scoreFinishRuntime=JSON.parse(pairStorage.getItem(SCORE_FINISH_PROPOSAL_KEY)||'null');return scoreFinishRuntime}catch{return null}
  }
  function setScoreFinishProposal(proposal){
    scoreFinishRuntime=proposal?JSON.parse(JSON.stringify(proposal)):null;
    if(proposal)pairStorage.setItem(SCORE_FINISH_PROPOSAL_KEY,JSON.stringify(proposal));
    else pairStorage.removeItem(SCORE_FINISH_PROPOSAL_KEY);
    PairDB.save?.();
    renderScoreFinishProposal();
    refreshRollPermissions?.();
  }
  function renderScoreFinishProposal(){
    if(!scoreFinishModal)return;
    const proposal=getScoreFinishProposal();
    if(!proposal){scoreFinishModal.hidden=true;return;}
    const names=getNames(), self=getViewRole(), partner=(self+1)%2;
    const score=Array.isArray(proposal.score)?proposal.score:[0,0];
    const isTie=Number(score[0])===Number(score[1]);
    const winner=isTie?null:(Number(score[0])>Number(score[1])?0:1), loser=isTie?null:(winner+1)%2;
    scoreFinishModal.hidden=false;
    if(scoreFinishSummary){
      scoreFinishSummary.textContent=isTie
        ? `${names[0]||'Гравець 1'} ${score[0]||0} : ${score[1]||0} ${names[1]||'Гравець 2'} · Нічия. Завершити раунд без боргу бажання?`
        : `${names[0]||'Гравець 1'} ${score[0]||0} : ${score[1]||0} ${names[1]||'Гравець 2'} · ${names[loser]||'Гравець'} виконує бажання ${names[winner]||'партнера'}`;
    }
    const approvals=Array.isArray(proposal.approvals)?proposal.approvals:[false,false];
    if(scoreFinishSelfVote){scoreFinishSelfVote.querySelector('span').textContent=`Ви — ${names[self]||('Гравець '+(self+1))}`;scoreFinishSelfVote.querySelector('strong').textContent=approvals[self]?'Погоджено ✓':'Очікує';scoreFinishSelfVote.classList.toggle('approved',!!approvals[self]);}
    if(scoreFinishPartnerVote){scoreFinishPartnerVote.querySelector('span').textContent=`Ваш партнер — ${names[partner]||('Гравець '+(partner+1))}`;scoreFinishPartnerVote.querySelector('strong').textContent=approvals[partner]?'Погоджено ✓':'Очікує';scoreFinishPartnerVote.classList.toggle('approved',!!approvals[partner]);}
    const title=$('#scoreFinishTitle');if(title)title.textContent=isTie?'Підтвердити нічию?':'Підвести результат?';
    if(scoreFinishAgreeBtn){scoreFinishAgreeBtn.disabled=!!approvals[self];scoreFinishAgreeBtn.textContent=approvals[self]?'Ви погодились ✓':'Погодитись';}
    if(scoreFinishHint)scoreFinishHint.textContent=approvals[self]&&!approvals[partner]?'Очікуємо рішення партнера…':(!approvals[self]&&approvals[partner]?'Партнер уже погодився. Потрібне ваше підтвердження.':'Для завершення мають погодитися обидва.');
  }
  function finalizeScoreProposal(proposal){
    if(!proposal)return;
    const current=getScoreFinishProposal();
    if(current&&current.id!==proposal.id)return;
    const score=Array.isArray(proposal.score)?proposal.score:[0,0], names=getNames();
    if(Number(score[0])===Number(score[1])){
      setScore([0,0]);
      setScoreFinishProposal(null);
      syncPlayers();
      PairDB.save?.();
      toast('Нічия підтверджена · рахунок скинуто');
      return;
    }
    const winner=Number(score[0])>Number(score[1])?0:1, loser=(winner+1)%2;
    const debt={id:'game_debt_'+proposal.id,type:'score',debtorIndex:loser,partnerIndex:winner,debtorName:names[loser]||`Гравець ${loser+1}`,partnerName:names[winner]||`Гравець ${winner+1}`,score:[Number(score[0])||0,Number(score[1])||0],date:new Date().toISOString(),wishDone:false};
    const rows=gameDebts();if(!rows.some(x=>x.id===debt.id))rows.push(debt);saveGameDebts(rows.slice(-300));
    setScore([0,0]);setScoreFinishProposal(null);syncPlayers();PairDB.save?.();renderProgressPage();
    toast(`${debt.debtorName} виконує бажання ${debt.partnerName}`);
  }
  function focusPendingEvaluation(pg){
    if(!pg?.gameKey)return;
    openGame(pg.gameKey,false);
    refreshPendingResult?.();
    const box=pg.gameKey==='passion'?$('#passionResultBox'):pg.gameKey==='direct'?$('#directResultBox'):null;
    if(box){
      box.hidden=false;
      box.classList.remove('pending-attention');
      void box.offsetWidth;
      box.classList.add('pending-attention');
      setTimeout(()=>box.classList.remove('pending-attention'),1800);
      setTimeout(()=>box.scrollIntoView({behavior:'smooth',block:'center'}),60);
    }
    const evaluator=(Number(pg.turn)+1)%2;
    toast(getViewRole()===evaluator?'Оцініть попередній результат':'Очікується оцінка партнера');
  }
  function proposeScoreFinish(syncSession=true,forcedProposal=null){
    const pending=!forcedProposal?currentPendingFor():null;
    if(pending){focusPendingEvaluation(pending);return;}
    const score=forcedProposal?.score||getScore();
    if(!forcedProposal&&!window.SessionSync?.connected){toast('Для спільного підтвердження підключіть партнера до сесії');return;}
    const existing=getScoreFinishProposal();
    const proposal=forcedProposal||existing||{id:'score_finish_'+Date.now()+'_'+Math.random().toString(36).slice(2,7),score:[Number(score[0])||0,Number(score[1])||0],approvals:[false,false],requestedBy:getViewRole(),createdAt:new Date().toISOString()};
    setScoreFinishProposal(proposal);
    if(scoreFinishModal)scoreFinishModal.hidden=false;
    if(syncSession&&window.SessionSync?.connected&&!forcedProposal)window.SessionSync.replyUI?.('game-action',{action:'score-finish-propose',proposal});
  }
  function voteScoreFinish(agree,syncSession=true,forcedRole=null,proposalId=null){
    const proposal=getScoreFinishProposal();if(!proposal|| (proposalId&&proposal.id!==proposalId))return;
    if(!agree){const id=proposal.id;setScoreFinishProposal(null);if(syncSession&&window.SessionSync?.connected)window.SessionSync.replyUI?.('game-action',{action:'score-finish-reject',proposalId:id});toast('Підведення результату скасовано');return;}
    const role=(forcedRole===0||forcedRole===1)?Number(forcedRole):getViewRole();
    proposal.approvals=Array.isArray(proposal.approvals)?proposal.approvals:[false,false];proposal.approvals[role]=true;setScoreFinishProposal(proposal);
    if(syncSession&&window.SessionSync?.connected)window.SessionSync.replyUI?.('game-action',{action:'score-finish-vote',proposalId:proposal.id,role,agree:true});
    if(proposal.approvals[0]&&proposal.approvals[1])finalizeScoreProposal(proposal);
  }
  $('#finishScoreBtn')?.addEventListener('click',()=>proposeScoreFinish(true));
  scoreFinishAgreeBtn?.addEventListener('click',()=>voteScoreFinish(true,true));
  scoreFinishRejectBtn?.addEventListener('click',()=>voteScoreFinish(false,true));
  $('#resetScoreBtn')?.addEventListener('click',()=>{if(getScoreFinishProposal()){toast('Спочатку завершіть або відхиліть підведення результату');return;}setScore([0,0]);setTurn(0);syncPlayers()});
  document.addEventListener('pair:changed',()=>{syncPlayers();renderScoreFinishProposal();});

  function updateRelativeGameLabels(){
    const self=getViewRole(), partner=(self+1)%2, names=getNames();
    const p1Title=$('#secretWishP1Title'),p2Title=$('#secretWishP2Title');
    if(p1Title)p1Title.textContent=participantLabel(0,true); if(p2Title)p2Title.textContent=participantLabel(1,true);
    const b1=$('#battleP1Input'),b2=$('#battleP2Input');
    if(b1){b1.placeholder=self===0?'Ваше бажання':'Додає партнер';b1.disabled=self!==0;}
    if(b2){b2.placeholder=self===1?'Ваше бажання':'Додає партнер';b2.disabled=self!==1;}
    const bf1=$('#battleP1Form'),bf2=$('#battleP2Form');
    if(bf1)bf1.classList.toggle('private-locked',self!==0);if(bf2)bf2.classList.toggle('private-locked',self!==1);
    const sw1=$('#secretWishP1Input'),sw2=$('#secretWishP2Input');
    if(sw1){sw1.placeholder=self===0?'Ваше таємне бажання':'Додає партнер';sw1.disabled=self!==0;}
    if(sw2){sw2.placeholder=self===1?'Ваше таємне бажання':'Додає партнер';sw2.disabled=self!==1;}
    const sf1=$('#secretWishP1Form'),sf2=$('#secretWishP2Form');
    if(sf1)sf1.classList.toggle('private-locked',self!==0);if(sf2)sf2.classList.toggle('private-locked',self!==1);
  }

  function currentLocalTurnAllowed(){
    if(!window.SessionSync?.connected)return true;
    const role=window.SessionSync?.role;
    return (role===0||role===1) && Number(role)===getTurn();
  }
  function refreshRollPermissions(){
    const allowed=currentLocalTurnAllowed();
    const pendingPassion=currentPendingFor?.('passion');
    const pendingDirect=currentPendingFor?.('direct');
    const scoreFinishPending=!!getScoreFinishProposal?.();
    const pb=$('#passionRollBtn'), db=$('#directRollBtn');
    const self=getViewRole();
    const pendingLabel=pg=>pg?(self===(Number(pg.turn)+1)%2?'Оцініть результат':'Очікуємо оцінку партнера'):null;
    if(pb){pb.disabled=rolling||!allowed||!!pendingPassion||scoreFinishPending;pb.textContent=scoreFinishPending?'Підводимо результат…':(!allowed&&!pendingPassion?'Хід партнера':pendingPassion?pendingLabel(pendingPassion):'Кинути');}
    if(db){db.disabled=rolling||!allowed||!!pendingDirect||scoreFinishPending;db.textContent=scoreFinishPending?'Підводимо результат…':(!allowed&&!pendingDirect?'Хід партнера':pendingDirect?pendingLabel(pendingDirect):'Кинути');}
    $$('#directActionChoice .choice-btn').forEach(btn=>{btn.disabled=scoreFinishPending||(window.SessionSync?.connected&&!allowed);});
  }
  $$('[data-heat-control] .heat-btn').forEach(btn=>btn.addEventListener('click',()=>setHeat(btn.dataset.heat,{sync:true})));
  renderHeatControls();

  document.addEventListener('session:role-changed',()=>syncPlayers());

  function showTab(which, syncSession=true){
    calendarSection.hidden=which!=='calendar'; placesSection.hidden=which!=='places'; gamesSection.hidden=which!=='games'; if(purchasesSection)purchasesSection.hidden=which!=='purchases'; if(progressSection)progressSection.hidden=which!=='progress';
    calendarTabBtn.classList.toggle('active',which==='calendar'); placesTabBtn?.classList.toggle('active',which==='places'); gamesTabBtn.classList.toggle('active',which==='games'); purchasesTabBtn?.classList.toggle('active',which==='purchases'); progressTabBtn?.classList.toggle('active',which==='progress');
    if(syncSession && !window.SessionSync?.connected) pairStorage.setItem('sa_main_tab_v1',which);
    document.body.dataset.mainTab=which;
    if(which==='games'){
      const connected=!!window.SessionSync?.connected;
      const runtimeGame=document.body.dataset.activeGame;
      const savedGame=connected?((runtimeGame&&gameMeta[runtimeGame])?runtimeGame:null):pairStorage.getItem(ACTIVE_GAME_KEY);
      if(savedGame && gameMeta[savedGame]) openGame(savedGame,syncSession);
      else showGamesMenu(syncSession,false);
    }
    if(which==='places') renderPlaces();
    if(which==='progress') renderProgressPage();
    if(which==='purchases') document.dispatchEvent(new CustomEvent('purchases:render'));
    if(syncSession) window.SessionSync?.sendUI?.('tab',{which});
  }
  calendarTabBtn?.addEventListener('click',()=>showTab('calendar'));
  placesTabBtn?.addEventListener('click',()=>showTab('places'));
  gamesTabBtn?.addEventListener('click',()=>showTab('games'));
  purchasesTabBtn?.addEventListener('click',()=>showTab('purchases'));
  progressTabBtn?.addEventListener('click',()=>showTab('progress'));

  const PAGE_DONE_KEY='sa_position_done_mf', PAGE_DEFERRED_KEY='sa_position_deferred_mf_v1', PAGE_HISTORY_KEY='sa_position_history_mf_v1';
  const pagePoseOverview=$('#pagePoseOverview'), pagePoseLevels=$('#pagePoseLevels'), pagePlacesOverview=$('#pagePlacesOverview'), pagePlacesCategories=$('#pagePlacesCategories'), pageProgressMonths=$('#pageProgressMonths'), pageDeferredList=$('#pageDeferredList'), pageDeferredCount=$('#pageDeferredCount'), pageGameDebtList=$('#pageGameDebtList'), pageGameDebtCount=$('#pageGameDebtCount'), pagePurchaseStatusList=$('#pagePurchaseStatusList'), pagePurchaseStatusCount=$('#pagePurchaseStatusCount'), pagePlannedPlacesList=$('#pagePlannedPlacesList'), pagePlannedPlacesCount=$('#pagePlannedPlacesCount');
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
    const marked=new Set(pageJSON(PLACES_KEY,[])); const plannedPlaces=new Set(pageJSON(PLACES_PLANNED_KEY,[])); const custom=getCustomPlaces(); const cats=PLACE_CATEGORIES.map(c=>({name:c.name,items:[...c.items]})); custom.forEach(x=>{let c=cats.find(y=>y.name===x.category);if(!c){c={name:x.category||'Мої місця',items:[]};cats.push(c)}c.items.push(x)}); const placeTotal=cats.reduce((s,c)=>s+c.items.length,0), placeDone=[...marked].filter(id=>cats.some(c=>c.items.some(x=>x.id===id))).length, placePlanned=[...plannedPlaces].filter(id=>!marked.has(id)&&cats.some(c=>c.items.some(x=>x.id===id))).length, placePct=placeTotal?Math.round(placeDone/placeTotal*100):0;
    if(pagePlacesOverview)pagePlacesOverview.innerHTML=`<div class="progress-stat"><strong>${placeDone}/${placeTotal}</strong><span>відзначено</span></div><div class="progress-stat"><strong>${placePlanned}</strong><span>заплановано</span></div><div class="progress-stat"><strong>${placePct}%</strong><span>місць</span></div><div class="progress-stat"><strong>${custom.length}</strong><span>власних</span></div>`;
    if(pagePlacesCategories){pagePlacesCategories.innerHTML='';cats.filter(c=>c.items.length).forEach(c=>{const count=c.items.filter(x=>marked.has(x.id)).length,pct=Math.round(count/c.items.length*100);const row=document.createElement('div');row.className='progress-level-row';row.innerHTML=`<div><strong>${c.name}</strong><span>${count}/${c.items.length}</span></div><div class="mini-progress"><span style="width:${pct}%"></span></div><b>${pct}%</b>`;pagePlacesCategories.appendChild(row)})}
    const history=pageJSON(PAGE_HISTORY_KEY,[]), months=new Map(), fmt=new Intl.DateTimeFormat('uk-UA',{month:'long',year:'numeric'}); history.forEach(ev=>{const d=new Date(ev.date);if(isNaN(d))return;const key=fmt.format(d),m=months.get(key)||{date:d,done:0,deferred:0};if(ev.status==='done')m.done++;if(ev.status==='deferred')m.deferred++;months.set(key,m)}); if(pageProgressMonths){pageProgressMonths.innerHTML='';[...months.entries()].sort((a,b)=>b[1].date-a[1].date).forEach(([label,m])=>{const row=document.createElement('div');row.className='month-row';row.innerHTML=`<strong>${label}</strong><span>Виконано: ${m.done}</span><span>Відкладено: ${m.deferred}</span>`;pageProgressMonths.appendChild(row)});if(!months.size)pageProgressMonths.innerHTML='<p class="empty-state">Поки немає історії проходження.</p>'}
    const list=Object.values(deferred).sort((a,b)=>new Date(b.date)-new Date(a.date)); if(pageDeferredCount)pageDeferredCount.textContent=list.length; if(pageDeferredList){pageDeferredList.innerHTML='';list.forEach(info=>{const item=positions.find(x=>Number(x.id)===Number(info.id));if(!item)return;const card=document.createElement('div');card.className='deferred-progress-card'+(info.wishDone?' wish-done':'');card.innerHTML=`<img src="${item.image}" alt="Поза ${item.order_index}"><div><strong>Поза ${item.order_index} · ${item.poseTitle||''}</strong><span>${info.wishDone?'Бажання виконано ✓':`${info.debtorName} має виконати бажання ${info.partnerName}`}</span><small>${new Intl.DateTimeFormat('uk-UA',{day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(info.date))}</small></div>`;const actions=document.createElement('div');actions.className='deferred-card-actions';if(!info.wishDone){const wish=document.createElement('button');wish.type='button';wish.className='btn primary compact';wish.textContent='Бажання виконано ✓';wish.addEventListener('click',()=>{const all=pageJSON(PAGE_DEFERRED_KEY,{});if(all[info.id]){all[info.id].wishDone=true;all[info.id].wishDoneDate=new Date().toISOString();pairStorage.setItem(PAGE_DEFERRED_KEY,JSON.stringify(all))}renderProgressPage();document.dispatchEvent(new CustomEvent('progress:changed'))});actions.appendChild(wish)}card.appendChild(actions);pageDeferredList.appendChild(card)});if(!list.length)pageDeferredList.innerHTML='<p class="empty-state">Відкладених поз немає.</p>'}
    // Purchases: planned + purchased statistics.
    const purchaseRows=pageJSON('sa_desired_purchases_v1',[]).filter(x=>x&&typeof x==='object');
    const purchaseStats=purchaseRows.filter(x=>x.purchased||x.planned).sort((a,b)=>Number(b.purchasedAt||b.plannedAt||b.updatedAt||b.createdAt||0)-Number(a.purchasedAt||a.plannedAt||a.updatedAt||a.createdAt||0));
    if(pagePurchaseStatusCount)pagePurchaseStatusCount.textContent=purchaseStats.length;
    if(pagePurchaseStatusList){
      pagePurchaseStatusList.innerHTML='';
      purchaseStats.forEach(info=>{const card=document.createElement('div');card.className='deferred-progress-card purchase-stat-card'+(info.purchased?' is-purchased':' is-planned');const qty=Math.max(1,Number(info.qty)||1),total=(Number(info.price)||0)*qty;const safeUrl=(()=>{try{const u=new URL(info.url||'');return (u.protocol==='http:'||u.protocol==='https:')?u.href:''}catch{return ''}})();card.innerHTML=`<div class="game-debt-icon">${info.purchased?'✓':'🗓️'}</div><div class="purchase-stat-main"><strong>${info.name||'Без назви'}</strong><span>${info.purchased?'Придбано':'В планах'} · ${new Intl.NumberFormat('uk-UA',{maximumFractionDigits:2}).format(total)} гривень · ${(()=>{const ps=PairDB.active?.players||[];const added=Number(info.addedBy)===1?1:0;let fw=info.forWhom;if(fw==='self')fw=added?'player1':'player0';else if(fw==='her')fw=added?'player0':'player1';if(fw==='both')return 'Для нас';const ix=fw==='player1'?1:0;return `Для ${ps[ix]?.name||('Гравця '+(ix+1))}`})()}</span><small>${new Intl.DateTimeFormat('uk-UA',{day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(info.purchasedAt||info.plannedAt||info.updatedAt||info.createdAt||Date.now()))}</small></div>`;const actions=document.createElement('div');actions.className='purchase-stat-actions';if(safeUrl){const a=document.createElement('a');a.className='btn secondary compact purchase-progress-link';a.href=safeUrl;a.target='_blank';a.rel='noopener noreferrer';a.textContent='Відкрити товар ↗';actions.appendChild(a)}if(!info.purchased){const bought=document.createElement('button');bought.type='button';bought.className='btn primary compact purchase-progress-bought';bought.textContent='Позначити як придбано';bought.addEventListener('click',()=>{if(window.requireSyncedPartnerSession&&!window.requireSyncedPartnerSession())return;const all=pageJSON('sa_desired_purchases_v1',[]);const item=all.find(x=>x.id===info.id);if(!item)return;item.purchased=true;item.purchasedBy=window.SessionSync?.role===1?1:0;item.purchasedAt=Date.now();item.planned=false;item.plannedAt=null;item.plannedBy=null;pairStorage.setItem('sa_desired_purchases_v1',JSON.stringify(all));PairDB.save?.();window.SessionSync?.replyUI?.('purchase-action',{action:'purchased',id:item.id,role:item.purchasedBy,value:true,updatedAt:item.purchasedAt});document.dispatchEvent(new CustomEvent('purchases:render'));document.dispatchEvent(new CustomEvent('progress:changed'));renderProgressPage()});actions.appendChild(bought)}if(actions.childElementCount)card.appendChild(actions);pagePurchaseStatusList.appendChild(card)});
      if(!purchaseStats.length)pagePurchaseStatusList.innerHTML='<p class="empty-state">Поки немає придбаних або запланованих покупок.</p>';
    }
    // Places planned for later.
    const allPlaces=cats.flatMap(c=>c.items.map(x=>({...x,category:c.name})));
    const plannedList=[...plannedPlaces].filter(id=>!marked.has(id)).map(id=>allPlaces.find(x=>x.id===id)).filter(Boolean);
    if(pagePlannedPlacesCount)pagePlannedPlacesCount.textContent=plannedList.length;
    if(pagePlannedPlacesList){pagePlannedPlacesList.innerHTML='';plannedList.forEach(info=>{const card=document.createElement('div');card.className='deferred-progress-card planned-place-card';card.innerHTML=`<div class="game-debt-icon">📍</div><div><strong>${info.label}</strong><span>Заплановано · ${info.category||'Місце'}</span></div>`;pagePlannedPlacesList.appendChild(card)});if(!plannedList.length)pagePlannedPlacesList.innerHTML='<p class="empty-state">Запланованих місць поки немає.</p>'}

    const gameDebts=pageJSON(GAME_WISH_DEBTS_KEY,[]).slice().sort((a,b)=>new Date(b.date)-new Date(a.date));
    if(pageGameDebtCount)pageGameDebtCount.textContent=gameDebts.filter(x=>!x.wishDone).length;
    if(pageGameDebtList){pageGameDebtList.innerHTML='';gameDebts.forEach(info=>{const card=document.createElement('div');card.className='deferred-progress-card game-debt-card'+(info.wishDone?' wish-done':'');const score=Array.isArray(info.score)?`${info.score[0]} : ${info.score[1]}`:'—';card.innerHTML=`<div class="game-debt-icon">🏆</div><div><strong>${info.debtorName||'Гравець'} виконує бажання</strong><span>${info.wishDone?'Бажання виконано ✓':`Для ${info.partnerName||'партнера'} · рахунок ${score}`}</span><small>${new Intl.DateTimeFormat('uk-UA',{day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(info.date))}</small></div>`;const actions=document.createElement('div');actions.className='deferred-card-actions';if(!info.wishDone){const wish=document.createElement('button');wish.type='button';wish.className='btn primary compact';wish.textContent='Бажання виконано ✓';wish.addEventListener('click',()=>markGameDebtDone(info.id,true));actions.appendChild(wish)}card.appendChild(actions);pageGameDebtList.appendChild(card)});if(!gameDebts.length)pageGameDebtList.innerHTML='<p class="empty-state">Поки немає бажань за результатами ігор.</p>'}
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
    if(clearState && syncSession && !window.SessionSync?.connected) pairStorage.removeItem(ACTIVE_GAME_KEY);
    if(syncSession) window.SessionSync?.sendUI?.('game-menu',{});
  }
  function openGame(key, syncSession=true){
    const meta=gameMeta[key]; if(!meta) return;
    // Pair/session updates can call openGame() again while the same game is already
    // visible. Re-initialising the reels here used to reset them *after* a completed
    // spin, so the result box showed the chosen value while the reel jumped back to
    // an older local value. Only initialise game-specific visuals when actually
    // switching into a different game.
    const sameGame=document.body.dataset.activeGame===key && !gameDetail.hidden;
    gamesMenu.hidden=true; gameDetail.hidden=false;
    if(activeGameTitle) activeGameTitle.textContent=meta.title;
    if(playersPanel) playersPanel.hidden=!meta.players;
    const scoreActions=document.querySelector('.score-actions');if(scoreActions)scoreActions.hidden=!(key==='passion'||key==='direct');
    if(rouletteCustomPanel) rouletteCustomPanel.hidden=!meta.custom;
    Object.entries(gameViews).forEach(([k,v])=>{if(v) v.hidden=k!==key});
    syncPlayers();
    renderCustomOptions();
    if(!sameGame){
      if(key==='passion'){passionActionSlot.setPool(actionPool());passionActionSlot.reset();passionBodySlot.reset();}
      if(key==='direct') directBodySlot.reset();
      if(key==='randomPose'){renderRandomLevelFilter();resetRandomPosePreview();}
    }
    document.body.dataset.activeGame=key;
    delete document.body.dataset.gameMenu;
    if(syncSession && !window.SessionSync?.connected) pairStorage.setItem(ACTIVE_GAME_KEY,key);
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
    const done=new Set(safeParse(PLACES_KEY,[])); const planned=new Set(safeParse(PLACES_PLANNED_KEY,[])); let total=0;
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
        const b=document.createElement('button'); b.type='button'; b.className='place-item'+(done.has(id)?' done':planned.has(id)?' planned':'');
        b.innerHTML=`<span>${done.has(id)?'✓':planned.has(id)?'◷':'○'}</span>${item.label}`;
        b.addEventListener('click',()=>{
          if(done.has(id)){done.delete(id)}else{done.add(id);planned.delete(id)}
          pairStorage.setItem(PLACES_KEY,JSON.stringify([...done]));
          pairStorage.setItem(PLACES_PLANNED_KEY,JSON.stringify([...planned]));
          renderPlaces();
          if(progressSection&&!progressSection.hidden)renderProgressPage();
        });
        row.appendChild(b);
        const plan=document.createElement('button'); plan.type='button'; plan.className='place-plan'+(planned.has(id)&&!done.has(id)?' active':''); plan.title=planned.has(id)?'Прибрати із запланованих':'Додати в заплановано'; plan.setAttribute('aria-label',`${planned.has(id)?'Прибрати із запланованих':'Запланувати'} ${item.label}`); plan.textContent=planned.has(id)&&!done.has(id)?'В планах ✓':'Запланувати'; plan.disabled=done.has(id);
        plan.addEventListener('click',()=>{if(done.has(id))return;if(window.CouplePlanning?.propose){window.CouplePlanning.propose({type:'place-plan',targetId:id,label:item.label,value:!planned.has(id)});return;}planned.has(id)?planned.delete(id):planned.add(id);pairStorage.setItem(PLACES_PLANNED_KEY,JSON.stringify([...planned]));renderPlaces();if(progressSection&&!progressSection.hidden)renderProgressPage()});
        row.appendChild(plan);
        if(item.custom){
          const del=document.createElement('button'); del.type='button'; del.className='place-delete'; del.title='Видалити власне місце'; del.setAttribute('aria-label',`Видалити ${item.label}`); del.textContent='×';
          del.addEventListener('click',()=>{
            const next=getCustomPlaces().filter(x=>x.id!==id);
            saveCustomPlaces(next);
            if(done.delete(id)) pairStorage.setItem(PLACES_KEY,JSON.stringify([...done]));
            if(planned.delete(id)) pairStorage.setItem(PLACES_PLANNED_KEY,JSON.stringify([...planned]));
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
    renderSequence(sequence,targetIndex=1,animate=false){
      if(!this.track) return;
      this.track.innerHTML='';
      sequence.forEach((value,index)=>{
        const d=document.createElement('div');
        d.className='slot-item'+(index===targetIndex?' slot-final-target':'');
        d.textContent=value;
        this.track.appendChild(d);
      });
      this.track.style.transition='none';
      this.track.style.transform='translateY(0px)';
      // CSS uses 54px rows on desktop and 48px on narrow screens. Measure the
      // actual rendered row so the reel lands on the real centre row.
      const firstItem=this.track.querySelector('.slot-item');
      const measured=firstItem?.getBoundingClientRect?.().height;
      if(Number.isFinite(measured)&&measured>0)this.itemHeight=measured;
      if(animate){
        const distance=-(targetIndex-1)*this.itemHeight;
        // Force the browser to commit the starting position before the transition.
        // The final DOM row is already the selected value, so there is no post-spin
        // replacement/jump after the reel visually stops.
        void this.track.offsetHeight;
        requestAnimationFrame(()=>{
          this.track.style.transition='transform 3.6s cubic-bezier(.16,.78,.18,1)';
          this.track.style.transform=`translateY(${distance}px)`;
        });
      }
    }
    reset(){
      if(!this.pool.length || !this.track) return;
      const n=this.pool.length,c=((this.current%n)+n)%n;
      this.renderSequence([this.pool[(c-1+n)%n],this.pool[c],this.pool[(c+1)%n]],1,false);
    }
    currentValue(){
      if(!this.pool.length)return null;
      const n=this.pool.length,c=((this.current%n)+n)%n;
      return this.pool[c] || null;
    }
    spinTo(value=null){
      if(this.busy || !this.pool.length) return Promise.reject(new Error('busy'));
      this.busy=true; this.root?.classList.add('is-spinning');
      let target=value===null?Math.floor(Math.random()*this.pool.length):this.pool.indexOf(value);
      if(target<0) target=Math.floor(Math.random()*this.pool.length);
      const targetValue=this.pool[target];
      const sequence=[];
      for(let i=0;i<38;i++) sequence.push(this.pool[(this.current+i)%this.pool.length]);
      // The last three rows are always prev / TARGET / next. The animation lands
      // with TARGET exactly in the centre row, and only then may the result box open.
      sequence.push(this.pool[(target-1+this.pool.length)%this.pool.length],targetValue,this.pool[(target+1)%this.pool.length]);
      const targetIndex=sequence.length-2;
      this.renderSequence(sequence,targetIndex,true);
      return new Promise(resolve=>{
        let finished=false;
        const finish=()=>{
          if(finished)return; finished=true;
          this.track?.removeEventListener('transitionend',onEnd);
          this.current=target;
          // IMPORTANT: do not rebuild/reset the reel here. The animation itself
          // already landed with TARGET in the centre. Rebuilding after stop was
          // the visible "stopped on X, then switched to Y" bug.
          this.busy=false;
          this.root?.classList.remove('is-spinning');
          resolve(targetValue);
        };
        const onEnd=(e)=>{if(e.target===this.track&&e.propertyName==='transform')finish()};
        this.track?.addEventListener('transitionend',onEnd);
        // Fallback only if the browser drops transitionend.
        setTimeout(finish,3900);
      });
    }
    spin(){ return this.spinTo(null); }
  }



  // Stable three-row reel used by Passion Roulette. It never relies on a long
  // translated strip, so the value visible in the centre is always the value
  // that becomes the result. The same seed produces the same animation on both peers.
  class SyncedPassionReel {
    constructor(root,pool){
      this.root=root; this.track=root?.querySelector('.slot-track'); this.pool=[...pool];
      this.current=0; this.busy=false; this.pendingPool=null; this.timer=null; this.reset();
    }
    setPool(pool){
      const clean=[...pool]; if(!clean.length)return;
      if(this.busy){this.pendingPool=clean;return;}
      const cur=this.currentValue(); this.pool=clean;
      const ix=cur?this.pool.indexOf(cur):-1; this.current=ix>=0?ix:Math.min(this.current,this.pool.length-1);
      this.reset();
    }
    renderIndex(index){
      if(!this.track||!this.pool.length)return;
      const n=this.pool.length, c=((index%n)+n)%n;
      const vals=[this.pool[(c-1+n)%n],this.pool[c],this.pool[(c+1)%n]];
      this.track.style.transition='none'; this.track.style.transform='translateY(0px)';
      this.track.innerHTML='';
      vals.forEach((value,i)=>{
        const d=document.createElement('div'); d.className='slot-item'+(i===1?' slot-final-target':'');
        d.textContent=value; this.track.appendChild(d);
      });
      this.current=c;
    }
    reset(){if(!this.busy)this.renderIndex(this.current)}
    currentValue(){return this.pool.length?this.pool[((this.current%this.pool.length)+this.pool.length)%this.pool.length]:null}
    spinTo(value,{seed=1,steps=38}={}){
      if(this.busy||!this.pool.length)return Promise.reject(new Error('busy'));
      let target=this.pool.indexOf(value); if(target<0)target=0;
      this.busy=true; this.root?.classList.add('is-spinning');
      clearTimeout(this.timer);
      // Tiny deterministic PRNG. We create all intermediate frames up front,
      // but force the last centre value to be the chosen target.
      let state=(Number(seed)>>>0)||1;
      const rnd=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296};
      const frames=[]; let last=-1;
      for(let i=0;i<Math.max(12,steps)-1;i++){
        let ix=Math.floor(rnd()*this.pool.length);
        if(this.pool.length>1&&ix===last)ix=(ix+1+Math.floor(rnd()*(this.pool.length-1)))%this.pool.length;
        frames.push(ix); last=ix;
      }
      frames.push(target);
      return new Promise(resolve=>{
        let i=0;
        const tick=()=>{
          const ix=frames[i]; this.renderIndex(ix); i++;
          if(i>=frames.length){
            this.current=target; this.renderIndex(target);
            this.busy=false; this.root?.classList.remove('is-spinning');
            if(this.pendingPool){const pp=this.pendingPool;this.pendingPool=null;this.setPool(pp);}
            resolve(this.pool[target]); return;
          }
          const t=i/(frames.length-1);
          // Quick at first, then a clearly visible ease-out near the final choice.
          const delay=Math.round(48 + 132*t*t);
          this.timer=setTimeout(tick,delay);
        };
        tick();
      });
    }
  }

  const bodyPoolForTarget=()=>{
    const turn=getTurn(), target=(turn+1)%2, gender=getGenders()[target];
    const genderPool=[...BODY_PARTS,...getCustomBody()].filter(x=>x.gender==='any'||x.gender===gender);
    const filtered=heatFilteredBody(genderPool);
    return (filtered.length?filtered:genderPool).map(x=>x.label);
  };

  const passionActionSlot=new SyncedPassionReel($('#passionActionReel'),actionPool());
  const passionBodySlot=new SyncedPassionReel($('#passionBodyReel'),bodyPoolForTarget());
  const directBodySlot=new SyncedPassionReel($('#directBodyReel'),bodyPoolForTarget());
  let pendingGame=null, rolling=false, directAction='Стиснути';
  let lastRollCompletedAt=0;
  let activeRollId=null;

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
      const heats={1:'Ніжно',2:'Тепло',3:'Гаряче',4:'Максимум'};
      getCustomBody().forEach((item,index)=>{
        const chip=document.createElement('span'); chip.className='custom-chip';
        const txt=document.createElement('span'); txt.textContent=`${item.label} · ${genders[item.gender]} · ${heats[item.heat]||heats[1]}`;
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
    e.preventDefault();
    const input=$('#customBodyInput'), gender=$('#customBodyGender'), heat=$('#customBodyHeat');
    const value=input?.value.trim(); if(!value)return;
    const heatValue=Math.min(4,Math.max(1,Number(heat?.value)||1));
    const arr=getCustomBody();
    if(!arr.some(x=>x.label.toLocaleLowerCase('uk')===value.toLocaleLowerCase('uk')&&x.gender===gender?.value&&Number(x.heat||1)===heatValue)){
      arr.push({id:'cb_'+Date.now(),label:value,gender:gender?.value||'any',heat:heatValue});
    }
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
  const RANDOM_LAST_KEY='sa_random_pose_last_v2';
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
  function applyRandomPoseLevels(ids,{sync=false,clearResult=false}={}){
    const clean=(Array.isArray(ids)?ids:[]).filter(id=>RANDOM_LEVELS.some(x=>x.id===id));
    const finalIds=clean.length?clean:RANDOM_LEVELS.map(x=>x.id);
    saveSelectedRandomLevels(finalIds);
    renderRandomLevelFilter();
    const pool=getRandomPosePool();
    if(pool.length&&!pool.includes(randomPoseCurrent))setRandomPose(pool[0]);
    if(clearResult&&randomPoseResultBox)randomPoseResultBox.hidden=true;
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
      applyRandomPoseLevels(ids,{sync:true,clearResult:true});
    }));
    updateRandomLevelSummary();
  }
  function updateRandomLevelSummary(){
    if(!fortuneLevelSummary)return;
    const ids=getSelectedRandomLevels(); const names=RANDOM_LEVELS.filter(x=>ids.includes(x.id)).map(x=>x.name); const count=getRandomPosePool().length;
    fortuneLevelSummary.textContent=`Обрано: ${names.join(', ')} · ${count} поз`;
  }
  $('#fortuneSelectAllLevelsBtn')?.addEventListener('click',()=>applyRandomPoseLevels(RANDOM_LEVELS.map(x=>x.id),{sync:true,clearResult:true}));
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
  function resetRandomPosePreview(){
    const pool=getRandomPosePool();
    let savedLast=null;try{savedLast=JSON.parse(pairStorage.getItem(RANDOM_LAST_KEY)||'null')}catch{}
    if(!savedLast){const legacy=Number(pairStorage.getItem('sa_random_pose_last_v1')||0);if(legacy)savedLast={order:legacy};}
    const lastOrder=Number(savedLast?.order||savedLast||0);
    const last=RANDOM_POSITIONS.find(x=>Number(x.order_index)===lastOrder);
    if(last){applyRandomPoseResult(last);return;}
    if(randomPoseResultBox)randomPoseResultBox.hidden=true;
    setRandomPose(pool.includes(randomPoseCurrent)?randomPoseCurrent:(pool[0]||RANDOM_POSITIONS[0]));
  }
  let lastRandomPoseResult=randomPoseCurrent;
  const waitUntil=async (ts,delayMs=0)=>{const ms=Number(delayMs)>0?Number(delayMs):(Number(ts||0)-Date.now());if(ms>2)await new Promise(r=>setTimeout(r,ms));};
  function setRandomSpinButtonBusy(busy){const button=$('#randomPoseSpinBtn');if(button)button.disabled=!!busy;}
  function applyRandomPoseResult(item){
    if(!item)return;
    lastRandomPoseResult=item;
    pairStorage.setItem(RANDOM_LAST_KEY,JSON.stringify({order:Number(item.order_index),title:item.poseTitle||'',description:item.poseDescription||'',image:item.image||''}));
    setRandomPose(item);
    if(randomPoseResultIndex)randomPoseResultIndex.textContent=`Поза ${item.order_index}`;
    if(randomPoseResult)randomPoseResult.textContent=item.poseTitle||(`Поза ${item.order_index}`);
    if(randomPoseDescription)randomPoseDescription.textContent=item.poseDescription||'Опис цієї пози поки відсутній.';
    if(randomPoseResultBox)randomPoseResultBox.hidden=false;
  }
  function buildSpinFrames(pool,target,count=18){
    if(!pool.length)return [];
    const idx=Math.max(0,pool.findIndex(x=>Number(x.order_index)===Number(target.order_index)));
    const frames=[];
    for(let i=0;i<count;i++)frames.push(pool[(idx+i*17)%pool.length]);
    frames.push(target);
    return frames;
  }
  async function preloadSpinFrames(frames){await Promise.all([...new Set(frames)].map(preloadPoseImage));}
  async function runRandomPoseSpin(forcedOrder=null,remote=false,startAt=null,forcedTurn=null,forcedIds=null,delayMs=0){
    if(Array.isArray(forcedIds)&&forcedIds.length)applyRandomPoseLevels(forcedIds,{sync:false});
    const pool=getRandomPosePool();
    if(!pool.length)return null;
    if(randomPoseBusy && !remote)return null;
    if(remote) randomPoseBusy=false;
    const target=(forcedOrder?pool.find(x=>Number(x.order_index)===Number(forcedOrder)):null)||pool[Math.floor(Math.random()*pool.length)];
    const frames=buildSpinFrames(pool,target,18);
    const button=$('#randomPoseSpinBtn');randomPoseBusy=true;if(button)button.disabled=true;if(randomPoseResultBox)randomPoseResultBox.hidden=true;
    try{
      preloadSpinFrames(frames).catch(()=>{});
      if(startAt||delayMs)await waitUntil(startAt,delayMs);
      const turn=Number.isFinite(Number(forcedTurn))?Number(forcedTurn):(5+Math.floor(Math.random()*3));
      fortuneTurns+=turn;
      if(fortuneWheelRotor){fortuneWheelRotor.style.transition='transform 3.15s cubic-bezier(.08,.72,.08,1)';fortuneWheelRotor.style.transform=`rotate(${fortuneTurns*360 + (Number(target.order_index)*37)%340}deg)`;}
      let frameIndex=0;const startTime=performance.now(),duration=3050;
      await new Promise(resolve=>{const tick=now=>{const t=Math.min(1,(now-startTime)/duration),delay=55+Math.floor(210*t*t);setRandomPose(frames[Math.min(frameIndex++,frames.length-1)]||target);if(t>=1){resolve();return}setTimeout(()=>requestAnimationFrame(tick),delay)};requestAnimationFrame(tick)});
      applyRandomPoseResult(target);
      return target;
    }finally{randomPoseBusy=false;if(button)button.disabled=false}
  }
  async function beginSyncedRandomPoseSpin(){
    const pool=getRandomPosePool();if(randomPoseBusy||!pool.length)return;
    const ids=getSelectedRandomLevels();
    const target=pool[Math.floor(Math.random()*pool.length)];
    const turn=5+Math.floor(Math.random()*3);
    if(!window.SessionSync?.connected){await runRandomPoseSpin(target.order_index,false,null,turn,ids);return;}
    // One atomic command: both devices receive identical levels, target and start time.
    const delayMs=650;
    window.SessionSync?.replyUI?.('game-action',{action:'random-pose-spin',ids,order:target.order_index,turn,delayMs});
    await runRandomPoseSpin(target.order_index,false,null,turn,ids,delayMs);
    // Final result packet is a recovery path if animation was interrupted remotely.
    window.SessionSync?.replyUI?.('game-action',{action:'random-pose-result',ids,order:target.order_index});
  }
  $('#randomPoseSpinBtn')?.addEventListener('click',()=>beginSyncedRandomPoseSpin());
  $('#randomPoseOpenBtn')?.addEventListener('click',()=>{
    let saved=null;try{saved=JSON.parse(pairStorage.getItem(RANDOM_LAST_KEY)||'null')}catch{}
    const item=RANDOM_POSITIONS.find(x=>Number(x.order_index)===Number(saved?.order))||lastRandomPoseResult||randomPoseCurrent;if(!item)return;
    const dlg=document.createElement('dialog'); dlg.className='dialog random-pose-zoom-dialog';
    dlg.innerHTML=`<div class="random-pose-zoom"><button class="icon-btn random-zoom-close" aria-label="Закрити">×</button><img src="${item.image}" alt="${item.poseTitle || ('Поза ' + item.order_index)}"><small>Поза ${item.order_index}</small><strong>${item.poseTitle || ('Поза ' + item.order_index)}</strong><p>${item.poseDescription || 'Опис цієї пози поки відсутній.'}</p></div>`;
    document.body.appendChild(dlg);dlg.querySelector('.random-zoom-close')?.addEventListener('click',()=>dlg.close());dlg.addEventListener('click',e=>{if(e.target===dlg)dlg.close()});dlg.addEventListener('close',()=>dlg.remove());dlg.showModal();
  });
  renderRandomLevelFilter();

  function showResult(gameKey,resultText,turnLabelEl,resultEl,box,forcedTurn=null,resultId=null){
    const turn=(forcedTurn===0||forcedTurn===1)?forcedTurn:getTurn(),target=(turn+1)%2;
    pendingGame={id:resultId||('result_'+Date.now()+'_'+Math.random().toString(36).slice(2,7)),gameKey,turn,resultText,createdAt:Date.now()};
    lastRollCompletedAt=Date.now();
    pairStorage.setItem(PENDING_GAME_KEY,JSON.stringify(pendingGame));
    if(turnLabelEl) turnLabelEl.textContent=`${participantLabel(turn,true)} → ${participantLabel(target,true)}`;
    if(resultEl) resultEl.textContent=resultText;
    if(box){box.hidden=false;box.dataset.pendingResultId=pendingGame.id;}
    setResultButtonsEnabled(gameKey,true);
  }
  function setResultButtonsEnabled(gameKey,enabled){
    const pg=currentPendingFor(gameKey);
    const evaluator=pg?(Number(pg.turn)+1)%2:null;
    const self=getViewRole();
    const mayEvaluate=!!enabled && pg && self===evaluator;
    const ids=gameKey==='passion'?['passionDoneBtn','passionNoBtn']:gameKey==='direct'?['directDoneBtn','directNoBtn']:[];
    ids.forEach(id=>{const b=document.getElementById(id);if(b)b.disabled=!mayEvaluate});
    const note=gameKey==='passion'?$('#passionEvaluatorNote'):gameKey==='direct'?$('#directEvaluatorNote'):null;
    if(note){
      if(!pg)note.textContent='';
      else if(mayEvaluate)note.textContent='Оцініть виконання партнера';
      else note.textContent=`Оцінює ${participantLabel(evaluator,true)}`;
    }
  }
  function currentPendingFor(gameKey){
    let pg=pendingGame;
    if(!pg){try{pg=JSON.parse(pairStorage.getItem(PENDING_GAME_KEY)||'null')}catch{pg=null}}
    if(pg&&gameKey&&pg.gameKey!==gameKey)return null;
    return pg;
  }
  function resolveResult(completed,syncSession=true,forced=null){
    const pg=forced||currentPendingFor();
    if(!pg)return;
    let score=getScore();
    if(forced?.score){score=[Number(forced.score[0])||0,Number(forced.score[1])||0]}
    else if(completed){const ix=Number(pg.turn)===1?1:0;score[ix]=(Number(score[ix])||0)+1;}
    const nextTurn=forced?.nextTurn!=null?Number(forced.nextTurn)%2:(Number(pg.turn)+1)%2;
    setScore(score);setTurn(nextTurn);pendingGame=null;pairStorage.removeItem(PENDING_GAME_KEY);syncPlayers();
    const box=pg.gameKey==='passion'?pbox:pg.gameKey==='direct'?dbox:null;if(box){box.hidden=true;delete box.dataset.pendingResultId;}
    setResultButtonsEnabled(pg.gameKey,false);
    // Persist immediately so a stale partner snapshot cannot undo score.
    PairDB.save?.();
    if(syncSession&&window.SessionSync?.connected)window.SessionSync.replyUI?.('game-action',{action:'score-resolve',gameKey:pg.gameKey,completed:!!completed,turn:pg.turn,score,nextTurn,resultId:pg.id||null});
  }

  const pbox=$('#passionResultBox');
  async function runPassionRoll(forced=null,remote=false){
    if(rolling)return;
    if(!remote&&!currentLocalTurnAllowed()){toast('Зараз хід партнера');refreshRollPermissions();return;}
    if(!remote&&currentPendingFor('passion')){toast('Спочатку оцініть попередній результат');refreshRollPermissions();return;}
    const button=$('#passionRollBtn'); rolling=true; if(button)button.disabled=true;if(pbox)pbox.hidden=true;refreshBodyPools();
    const rollId=forced?.rollId||('passion_'+Date.now()+'_'+Math.random().toString(36).slice(2,7));
    activeRollId=rollId;
    try{
      const actions=actionPool();
      const action=forced?.action || actions[Math.floor(Math.random()*actions.length)];
      const bp=bodyPoolForTarget(); const body=forced?.body || bp[Math.floor(Math.random()*bp.length)];
      const turn=(forced?.turn===0||forced?.turn===1)?forced.turn:getTurn();
      const seed=Number(forced?.seed)||Math.floor(Math.random()*0x7fffffff)||1;
      // One absolute start moment gives both peers the same visible beginning.
      // A generous lead time absorbs ordinary WebRTC latency.
      const startAt=Number(forced?.startAt)|| (window.SessionSync?.connected?Date.now()+1000:Date.now());
      if(!remote&&window.SessionSync?.connected)window.SessionSync.replyUI?.('game-action',{action:'passion-roll',actionValue:action,bodyValue:body,turn,startAt,seed,rollId,heat:getHeat()});
      await waitUntil(startAt,0);
      const [finalAction,finalBody]=await Promise.all([
        passionActionSlot.spinTo(action,{seed:seed^0x13579bdf,steps:40}),
        passionBodySlot.spinTo(body,{seed:seed^0x2468ace0,steps:40})
      ]);
      if(activeRollId!==rollId)return;
      // These are exactly the centre values left visible by the reels. No second
      // random source and no post-animation replacement.
      showResult('passion',`${finalAction} — ${finalBody}`,$('#passionTurnLabel'),$('#passionResult'),pbox,turn,'result_'+rollId);
    }catch(err){console.error(err)}finally{if(activeRollId===rollId)activeRollId=null;rolling=false;refreshRollPermissions()}
  }
  $('#passionRollBtn')?.addEventListener('click',()=>runPassionRoll());
  $('#passionDoneBtn')?.addEventListener('click',()=>{const pg=currentPendingFor('passion');if(pg&&getViewRole()===(Number(pg.turn)+1)%2)resolveResult(true)});
  $('#passionNoBtn')?.addEventListener('click',()=>{const pg=currentPendingFor('passion');if(pg&&getViewRole()===(Number(pg.turn)+1)%2)resolveResult(false)});

  $$('#directActionChoice .choice-btn').forEach(btn=>btn.addEventListener('click',()=>{
    if(window.SessionSync?.connected&&!currentLocalTurnAllowed()){toast('Зараз хід партнера');return;}
    $$('#directActionChoice .choice-btn').forEach(x=>x.classList.remove('active')); btn.classList.add('active'); directAction=btn.dataset.action;
    window.SessionSync?.replyUI?.('game-action',{action:'direct-choice',directAction});
  }));
  const dbox=$('#directResultBox');
  async function runDirectRoll(forced=null,remote=false){
    if(rolling)return;
    if(!remote&&!currentLocalTurnAllowed()){toast('Зараз хід партнера');refreshRollPermissions();return;}
    if(!remote&&currentPendingFor('direct')){toast('Спочатку оцініть попередній результат');refreshRollPermissions();return;}
    const button=$('#directRollBtn');
    rolling=true;
    if(button)button.disabled=true;
    if(dbox)dbox.hidden=true;
    refreshBodyPools();
    const rollId=forced?.rollId||('direct_'+Date.now()+'_'+Math.random().toString(36).slice(2,7));
    activeRollId=rollId;
    try{
      if(forced?.directAction) directAction=forced.directAction;
      document.querySelectorAll('#directActionChoice .choice-btn').forEach(x=>x.classList.toggle('active',x.dataset.action===directAction));
      const bp=bodyPoolForTarget();
      const body=forced?.body || bp[Math.floor(Math.random()*bp.length)];
      const turn=(forced?.turn===0||forced?.turn===1)?forced.turn:getTurn();
      const seed=Number(forced?.seed)||Math.floor(Math.random()*0x7fffffff)||1;
      const startAt=Number(forced?.startAt)|| (window.SessionSync?.connected?Date.now()+1000:Date.now());
      if(!remote&&window.SessionSync?.connected)window.SessionSync.replyUI?.('game-action',{
        action:'direct-roll',directAction,body,turn,startAt,seed,rollId,heat:getHeat()
      });
      await waitUntil(startAt,0);
      const finalBody=await directBodySlot.spinTo(body,{seed:seed^0x55aa33cc,steps:38});
      if(activeRollId!==rollId)return;
      showResult('direct',`${directAction} — ${finalBody}`,$('#directTurnLabel'),$('#directResult'),dbox,turn,'result_'+rollId);
    }catch(err){console.error(err)}finally{if(activeRollId===rollId)activeRollId=null;rolling=false;refreshRollPermissions()}
  }
  $('#directRollBtn')?.addEventListener('click',()=>runDirectRoll());
  $('#directDoneBtn')?.addEventListener('click',()=>{const pg=currentPendingFor('direct');if(pg&&getViewRole()===(Number(pg.turn)+1)%2)resolveResult(true)});
  $('#directNoBtn')?.addEventListener('click',()=>{const pg=currentPendingFor('direct');if(pg&&getViewRole()===(Number(pg.turn)+1)%2)resolveResult(false)});

  function refreshPendingResult(){
    // Do not let a delayed pair/snapshot write replace the result that has just
    // been derived from the visible centre of a spinning reel.
    if(rolling||activeRollId||Date.now()-lastRollCompletedAt<1500)return;
    let stored=null;try{stored=JSON.parse(pairStorage.getItem(PENDING_GAME_KEY)||'null')}catch{stored=null}
    if(!stored)return;
    pendingGame=stored;
    const turn=stored.turn;
    const target=(Number(turn)+1)%2;
    if(stored.gameKey==='passion'&&pbox){$('#passionTurnLabel').textContent=`${participantLabel(turn,true)} → ${participantLabel(target,true)}`;$('#passionResult').textContent=stored.resultText||'—';pbox.hidden=false;pbox.dataset.pendingResultId=stored.id||'';setResultButtonsEnabled('passion',true)}
    if(stored.gameKey==='direct'&&dbox){$('#directTurnLabel').textContent=`${participantLabel(turn,true)} → ${participantLabel(target,true)}`;$('#directResult').textContent=stored.resultText||'—';dbox.hidden=false;dbox.dataset.pendingResultId=stored.id||'';setResultButtonsEnabled('direct',true)}
  }
  function refreshPairUI(){ if(!PairDB.active) return; syncPlayers(); refreshPendingResult(); renderPlaces(); renderCustomOptions(); const connected=!!window.SessionSync?.connected; const runtimeTab=document.body.dataset.mainTab; const storedTab=pairStorage.getItem('sa_main_tab_v1'); const t=(connected&&['calendar','places','games','purchases','progress'].includes(runtimeTab))?runtimeTab:storedTab; const tab=['calendar','places','games','purchases','progress'].includes(t)?t:'calendar'; if(tab==='games'){ if(connected&&document.body.dataset.gameMenu==='1'){showGamesMenu(false,false);return;} const runtimeGame=document.body.dataset.activeGame; const storedGame=pairStorage.getItem(ACTIVE_GAME_KEY); const savedGame=connected?((runtimeGame&&gameMeta[runtimeGame])?runtimeGame:null):storedGame; if(savedGame&&gameMeta[savedGame]){ calendarSection.hidden=true; placesSection.hidden=true; gamesSection.hidden=false; if(purchasesSection)purchasesSection.hidden=true; if(progressSection)progressSection.hidden=true; openGame(savedGame,false); } else showTab('games',false);} else showTab(tab,false); }
  document.addEventListener('pair:changed', refreshPairUI);
  document.addEventListener('pair:remote-applied',()=>{if(document.body.dataset.activeGame==='randomPose'){renderRandomLevelFilter();resetRandomPosePreview();}refreshPendingResult();});
  
  document.addEventListener('session:remote-ui',e=>{
    const m=e.detail||{};
    if(m.kind==='tab'&&m.payload?.which) showTab(m.payload.which,false);
    if(m.kind==='game'&&m.payload?.key) openGame(m.payload.key,false);
    if(m.kind==='game-menu') showGamesMenu(false,true);
    if(m.kind==='game-action'){
      const a=m.payload?.action;
      if(a==='passion-roll'){if(m.payload.heat)setHeat(m.payload.heat,{sync:false});openGame('passion',false);runPassionRoll({action:m.payload.actionValue,body:m.payload.bodyValue,turn:m.payload.turn,startAt:m.payload.startAt,seed:m.payload.seed,rollId:m.payload.rollId},true);}
      if(a==='heat-change'){setHeat(m.payload.heat,{sync:false});}
      if(a==='direct-choice'){openGame('direct',false);directAction=m.payload.directAction||directAction;document.querySelectorAll('#directActionChoice .choice-btn').forEach(x=>x.classList.toggle('active',x.dataset.action===directAction));}
      if(a==='direct-roll'){if(m.payload.heat)setHeat(m.payload.heat,{sync:false});openGame('direct',false);runDirectRoll({directAction:m.payload.directAction,body:m.payload.body,turn:m.payload.turn,startAt:m.payload.startAt,seed:m.payload.seed,rollId:m.payload.rollId},true);}
      if(a==='score-resolve'){resolveResult(!!m.payload.completed,false,{gameKey:m.payload.gameKey,turn:m.payload.turn,score:m.payload.score,nextTurn:m.payload.nextTurn});}
      if(a==='score-finish-propose'&&m.payload.proposal){proposeScoreFinish(false,m.payload.proposal);}
      if(a==='score-finish-vote'&&m.payload.proposalId){voteScoreFinish(true,false,Number(m.payload.role),m.payload.proposalId);}
      if(a==='score-finish-reject'&&m.payload.proposalId){const p=getScoreFinishProposal();if(p?.id===m.payload.proposalId){setScoreFinishProposal(null);toast('Партнер відхилив підведення результату');}}
      if(a==='game-debt-done'&&m.payload.id){markGameDebtDone(m.payload.id,false,m.payload.wishDoneDate||null);}
      if(a==='random-pose-levels'){
        applyRandomPoseLevels(m.payload.ids||[],{sync:false});
        if(document.body.dataset.activeGame==='randomPose')renderRandomLevelFilter();
      }
      if(a==='random-pose-spin'){
        openGame('randomPose',false);
        applyRandomPoseLevels(m.payload.ids||[],{sync:false});
        runRandomPoseSpin(m.payload.order,true,null,m.payload.turn,m.payload.ids||[],m.payload.delayMs||550);
      }
      if(a==='random-pose-result'){
        applyRandomPoseLevels(m.payload.ids||[],{sync:false});
        const item=RANDOM_POSITIONS.find(x=>Number(x.order_index)===Number(m.payload.order));
        if(item)applyRandomPoseResult(item);
        setRandomSpinButtonBusy(false);
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
  document.addEventListener('pair:changed',e=>{
    const p=e.detail||PairDB.active;
    if(!p)return;
    label.textContent=pairLabel(p);
    // A pair received from the live session is already the active local pair.
    // Always enter the app here so a late bootstrap/showGate cannot trap the
    // joining player on the pair selector after synchronization succeeded.
    showApp();
    renderList().catch(()=>{});
  });
  document.addEventListener('pair:remote-applied',()=>{
    if(PairDB.active){showApp();renderList().catch(()=>{});}
  });
  document.addEventListener('session:pair-ready',()=>{
    if(PairDB.active){showApp();renderList().catch(()=>{});}
  });
  document.addEventListener('pair:profile',()=>{if(PairDB.active)label.textContent=pairLabel(PairDB.active)});
  (async()=>{try{
    const p=await PairDB.init();
    // PairDB.active may have been populated by the session while IndexedDB
    // bootstrap was still awaiting. Re-check it before ever reopening the gate.
    const current=PairDB.active||p;
    if(current){document.dispatchEvent(new CustomEvent('pair:changed',{detail:current}));showApp()}
    else showGate();
  }catch(err){console.error(err);gate.hidden=false;listEl.innerHTML='<div class="pair-list-empty">Не вдалося відкрити IndexedDB. Запустіть сайт через локальний веб-сервер (localhost), а не в приватному режимі.</div>'}})();
})();

// v20 unified progress refresh
document.addEventListener('pair:changed',()=>{ try{ document.dispatchEvent(new CustomEvent('progress:changed')); }catch(e){} });

// --- Extra couple games v34: stable synchronized actions ---
(() => {
  'use strict';
  const $=s=>document.querySelector(s); const parse=(k,f)=>{try{return JSON.parse(pairStorage.getItem(k)||JSON.stringify(f))}catch{return f}}; const save=(k,v)=>pairStorage.setItem(k,JSON.stringify(v));
  const names=()=>{try{return JSON.parse(pairStorage.getItem('sa_games_player_names_v1')||'[]')}catch{return []}};
  function extraGameViewRole(){const r=window.SessionSync?.role;if(r===0||r===1)return Number(r);return Number(pairStorage.getItem('sa_local_view_role_v1'))===1?1:0}
  function extraParticipantLabel(index,withName=true){const n=names(),self=extraGameViewRole(),prefix=index===self?'Ви':'Ваш партнер';return withName?`${prefix} — ${n[index]||('Гравець '+(index+1))}`:prefix}
  const SECRET='sa_secret_wishes_v1',BATTLE='sa_battle_wishes_v1',BWIN='sa_battle_winners_v1',RATINGS='sa_five_ratings_v1';
  const poses=()=>Array.isArray(window.POSITION_ITEMS)?window.POSITION_ITEMS.filter(x=>x.audience==='mf'):[];
  const allPlaces=()=>document.querySelectorAll('.place-chip').length?[...document.querySelectorAll('.place-chip')].map(x=>x.textContent.replace(/×$/,'').trim()).filter(Boolean):['У машині','У ванній','На дивані','У готельному номері','На природі'];
  const actions=['Поцілунок','Дотик','Масаж','Стиснути','Облизати','Смоктати','Шльопання'];
  const bodies=['Рука','Сідниці','Спина','Живіт','Щоки','Груди','Пах','Вухо','Стопи','Палець','Коліна','Нога','Губи','Пупок','Шия','Соски','Промежина','Стегно','Пальці ніг'];
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const send=(action,payload={})=>window.SessionSync?.connected&&window.SessionSync.replyUI?.('game-action',{action,...payload});
  const waitDelay=async ms=>{ms=Number(ms)||0;if(ms>1)await new Promise(r=>setTimeout(r,ms))};

  function addSecret(player,input){if(player!==extraGameViewRole())return;const val=$(input)?.value.trim();if(!val)return;const d=parse(SECRET,[[],[]]);d[player]||=[];d[player].push(val);save(SECRET,d);$(input).value='';renderSecret()}
  function renderSecret(){const d=parse(SECRET,[[],[]]);if($('#secretWishP1Title'))$('#secretWishP1Title').textContent=extraParticipantLabel(0,true);if($('#secretWishP2Title'))$('#secretWishP2Title').textContent=extraParticipantLabel(1,true);if($('#secretWishP1Count'))$('#secretWishP1Count').textContent=`Збережено таємно: ${(d[0]||[]).length}`;if($('#secretWishP2Count'))$('#secretWishP2Count').textContent=`Збережено таємно: ${(d[1]||[]).length}`}
  $('#secretWishP1Form')?.addEventListener('submit',e=>{e.preventDefault();addSecret(0,'#secretWishP1Input')});$('#secretWishP2Form')?.addEventListener('submit',e=>{e.preventDefault();addSecret(1,'#secretWishP2Input')});
  function showSecret(r){const box=$('#secretWishResult');if(!box)return;box.hidden=false;box.innerHTML=`<small>Бажання від: ${extraParticipantLabel(r.p,true)}</small><strong>${esc(r.x)}</strong>`}
  $('#revealSecretWishBtn')?.addEventListener('click',()=>{const d=parse(SECRET,[[],[]]),pool=[...(d[0]||[]).map(x=>({p:0,x})),...(d[1]||[]).map(x=>({p:1,x}))],box=$('#secretWishResult');if(!pool.length){box.hidden=false;box.innerHTML='<strong>Спочатку додайте хоча б одне бажання.</strong>';return}const r=pool[Math.floor(Math.random()*pool.length)];showSecret(r);send('secret-wish-reveal',{result:r})});

  const scenarios=['Романтика','Швидко','Повільно','Без слів','Із зав’язаними очима','У новому місці','Тільки поцілунки'],durations=['2 хв','5 хв','10 хв','15 хв','20 хв'];let scenMode='duration';
  function simpleReel(el,items){if(!el)return;const track=el.querySelector('.slot-track');let idx=Math.floor(Math.random()*items.length);function draw(){track.innerHTML=[-1,0,1].map(o=>`<div class="slot-item ${o===0?'active':''}">${esc(items[(idx+o+items.length)%items.length])}</div>`).join('')}draw();return{setItems(a){items=a;idx%=Math.max(a.length,1);draw()},spinTo(value=null){return new Promise(res=>{const target=value==null?Math.floor(Math.random()*items.length):Math.max(0,items.indexOf(value));let steps=28+Math.floor(Math.random()*8),i=0;const tick=()=>{idx=(idx+1)%items.length;draw();i++;if(i>=steps){idx=target;draw();res(items[idx]);return}setTimeout(tick,70+Math.floor(i*4.5))};setTimeout(tick,90)})}}}
  const scenReel=simpleReel($('#scenarioMainReel'),scenarios),secondReel=simpleReel($('#scenarioSecondReel'),durations);
  function setScenarioMode(mode,sync=true){scenMode=mode==='place'?'place':'duration';$('#scenarioSecondType')?.querySelectorAll('button').forEach(x=>x.classList.toggle('active',x.dataset.mode===scenMode));const arr=scenMode==='duration'?durations:allPlaces();secondReel?.setItems(arr.length?arr:['Ваше місце']);if($('#scenarioSecondLabel'))$('#scenarioSecondLabel').textContent=scenMode==='duration'?'Тривалість':'Місце';if(sync)send('scenario-mode',{mode:scenMode})}
  $('#scenarioSecondType')?.addEventListener('click',e=>{const b=e.target.closest('[data-mode]');if(b)setScenarioMode(b.dataset.mode,true)});
  async function rollScenario(p={},remote=false){if(p.mode)setScenarioMode(p.mode,false);const pool=scenMode==='duration'?durations:(allPlaces().length?allPlaces():['Ваше місце']),a=p.a||scenarios[Math.floor(Math.random()*scenarios.length)],b=p.b||pool[Math.floor(Math.random()*pool.length)],delayMs=Number(p.delayMs)||(window.SessionSync?.connected?550:0);if(!remote)send('scenario-roll',{mode:scenMode,a,b,delayMs});if(delayMs)await waitDelay(delayMs);const vals=await Promise.all([scenReel.spinTo(a),secondReel.spinTo(b)]),box=$('#scenarioResult');box.hidden=false;box.innerHTML=`<small>Ваш сценарій</small><strong>${vals[0]} — ${vals[1]}</strong>`}
  $('#scenarioRollBtn')?.addEventListener('click',()=>rollScenario());

  const fiveModes=['Тільки дотики','Тільки поцілунки','Без рук','Один керує','Повільний темп','Без слів'];let fiveSec=300,fiveTimerId=null,fiveMode=fiveModes[0],fiveEndAt=null;
  let fivePerfEnd=0;
  function fiveDraw(){
    if(fivePerfEnd&&fiveTimerId)fiveSec=Math.max(0,Math.ceil((fivePerfEnd-performance.now())/1000));
    if($('#fiveTimer'))$('#fiveTimer').textContent=`${String(Math.floor(fiveSec/60)).padStart(2,'0')}:${String(fiveSec%60).padStart(2,'0')}`;
    if($('#fiveMode'))$('#fiveMode').textContent=fiveMode;
  }
  function setFiveMode(mode,sync=true){fiveMode=mode||fiveModes[0];fiveDraw();if(sync)send('five-mode',{mode:fiveMode})}
  function startFive(durationMs=null,sync=true){
    clearInterval(fiveTimerId);
    const ms=Number(durationMs)>0?Number(durationMs):Math.max(1000,fiveSec*1000);
    fiveSec=Math.ceil(ms/1000);fivePerfEnd=performance.now()+ms;fiveEndAt=Date.now()+ms;
    fiveDraw();
    fiveTimerId=setInterval(()=>{fiveDraw();if(fiveSec<=0){clearInterval(fiveTimerId);fiveTimerId=null;fivePerfEnd=0;fiveEndAt=null;$('#fiveRating').hidden=false}},200);
    if(sync)send('five-start',{mode:fiveMode,durationMs:ms});
  }
  function resetFive(sync=true){clearInterval(fiveTimerId);fiveTimerId=null;fivePerfEnd=0;fiveEndAt=null;fiveSec=300;$('#fiveRating').hidden=true;fiveDraw();if(sync)send('five-reset')}
  $('#fiveRandomBtn')?.addEventListener('click',()=>setFiveMode(fiveModes[Math.floor(Math.random()*fiveModes.length)],true));$('#fiveStartBtn')?.addEventListener('click',()=>{if(!fiveTimerId)startFive(null,true)});$('#fiveResetBtn')?.addEventListener('click',()=>resetFive(true));
  document.querySelectorAll('#fiveRating [data-rating]').forEach(b=>b.addEventListener('click',()=>{const d=parse(RATINGS,[]);d.push({rating:+b.dataset.rating,mode:fiveMode,at:Date.now()});save(RATINGS,d);$('#fiveRatingHistory').textContent=`Остання оцінка: ${b.dataset.rating}/5`;$('#fiveRating').hidden=true;send('five-rating',{rating:+b.dataset.rating,mode:fiveMode})}));fiveDraw();

  function newBlind(sync=false){const box=$('#blindCards'),res=$('#blindResult');if(!box)return;res.hidden=true;box.innerHTML='';for(let i=0;i<3;i++){const b=document.createElement('button');b.className='blind-card';b.dataset.index=String(i);b.innerHTML='<span>?</span><small>Обрати</small>';b.onclick=()=>revealBlind(b,null,true);box.appendChild(b)}if(sync)send('blind-reset')}
  function blindResult(){const types=['Дія','Поза','Місце','Бажання','Бонус'],type=types[Math.floor(Math.random()*types.length)];let value='';if(type==='Дія')value=actions[Math.floor(Math.random()*actions.length)];if(type==='Поза'){const a=poses(),r=a[Math.floor(Math.random()*a.length)];value=r?`${r.poseTitle||'Поза'} · №${r.order_index}`:'Поза'}if(type==='Місце'){const a=allPlaces();value=a[Math.floor(Math.random()*a.length)]||'Ваше місце'}if(type==='Бажання'){const d=parse(SECRET,[[],[]]).flat();value=d.length?d[Math.floor(Math.random()*d.length)]:'Додайте бажання у грі «Таємне бажання»'}if(type==='Бонус')value='+1 бал поточному гравцю';return{type,value}}
  function revealBlind(btn,r=null,sync=false){if(!btn||btn.classList.contains('opened'))return;r=r||blindResult();btn.classList.add('opened');btn.innerHTML=`<strong>${r.type}</strong><small>${esc(r.value)}</small>`;const res=$('#blindResult');res.hidden=false;res.innerHTML=`<small>${r.type}</small><strong>${esc(r.value)}</strong>`;if(sync)send('blind-reveal',{index:Number(btn.dataset.index||0),result:r})}
  $('#blindResetBtn')?.addEventListener('click',()=>newBlind(true));newBlind(false);

  function addBattle(p,input){if(p!==extraGameViewRole())return;const v=$(input)?.value.trim();if(!v)return;const d=parse(BATTLE,[[],[]]);d[p]||=[];if(d[p].length<10)d[p].push(v);save(BATTLE,d);$(input).value='';renderBattle()}
  function renderBattle(){const d=parse(BATTLE,[[],[]]);if($('#battleCounts'))$('#battleCounts').textContent=`${extraParticipantLabel(0,true)}: ${(d[0]||[]).length}/10 · ${extraParticipantLabel(1,true)}: ${(d[1]||[]).length}/10`;const w=parse(BWIN,[]);if($('#battleWinners'))$('#battleWinners').innerHTML=w.length?w.map(x=>`<span class="wish-chip">${esc(x)}</span>`).join(''):'<span class="muted">Ще немає переможців</span>'}
  $('#battleP1Form')?.addEventListener('submit',e=>{e.preventDefault();addBattle(0,'#battleP1Input')});$('#battleP2Form')?.addEventListener('submit',e=>{e.preventDefault();addBattle(1,'#battleP2Input')});
  function showBattle(a,b,sync=false){const arena=$('#battleArena');arena.hidden=false;arena.innerHTML=`<button class="battle-option" data-value="${esc(a)}">${esc(a)}</button><span>VS</span><button class="battle-option" data-value="${esc(b)}">${esc(b)}</button>`;arena.querySelectorAll('.battle-option').forEach(x=>x.onclick=()=>voteBattle(x.dataset.value,true));if(sync)send('battle-start',{a,b})}
  function voteBattle(value,sync=false){const w=parse(BWIN,[]);w.push(value);save(BWIN,w);renderBattle();$('#battleArena').hidden=true;if(sync)send('battle-vote',{value})}
  $('#battleStartBtn')?.addEventListener('click',()=>{const d=parse(BATTLE,[[],[]]),arena=$('#battleArena');if(!(d[0]?.length&&d[1]?.length)){arena.hidden=false;arena.innerHTML='<strong>Додайте бажання від обох гравців.</strong>';return}showBattle(d[0][Math.floor(Math.random()*d[0].length)],d[1][Math.floor(Math.random()*d[1].length)],true)});renderBattle();

  let quest=null,questStep=0;function makeQuest(){const ps=poses(),wish=parse(SECRET,[[],[]]).flat();return[{type:'Місце',value:(()=>{const a=allPlaces();return a[Math.floor(Math.random()*a.length)]||'Обране вами місце'})()},{type:'Дія',value:actions[Math.floor(Math.random()*actions.length)]},{type:'Частина тіла',value:bodies[Math.floor(Math.random()*bodies.length)]},{type:'Поза',value:(()=>{const r=ps[Math.floor(Math.random()*ps.length)];return r?`${r.poseTitle||'Поза'} · №${r.order_index}`:'Випадкова поза'})()},{type:'Фінальне бажання',value:wish.length?wish[Math.floor(Math.random()*wish.length)]:'Додайте власне бажання'}]}
  function renderQuest(){const el=$('#questSteps');if(!el)return;el.innerHTML=(quest||[]).map((q,i)=>`<div class="quest-step ${i<questStep?'done':i===questStep?'active':'locked'}"><span>${i+1}</span><div><small>${q.type}</small><strong>${i<=questStep?esc(q.value):'Заблоковано'}</strong></div></div>`).join('');$('#questNextBtn').disabled=!quest||questStep>=quest.length-1}
  function setQuest(q,step=0,sync=false){quest=q;questStep=step;renderQuest();if(sync)send('quest-state',{quest,step:questStep})}
  $('#questNewBtn')?.addEventListener('click',()=>setQuest(makeQuest(),0,true));$('#questNextBtn')?.addEventListener('click',()=>{if(quest&&questStep<quest.length-1)setQuest(quest,questStep+1,true)});renderQuest();

  document.addEventListener('session:remote-ui',e=>{const m=e.detail||{};if(m.kind!=='game-action')return;const p=m.payload||{};
    if(p.action==='secret-wish-reveal')showSecret(p.result);
    if(p.action==='scenario-mode')setScenarioMode(p.mode,false);
    if(p.action==='scenario-roll')rollScenario(p,true);
    if(p.action==='five-mode')setFiveMode(p.mode,false);
    if(p.action==='five-start'){setFiveMode(p.mode,false);startFive(p.durationMs||300000,false)}
    if(p.action==='five-reset')resetFive(false);
    if(p.action==='five-rating'){if($('#fiveRatingHistory'))$('#fiveRatingHistory').textContent=`Остання оцінка: ${p.rating}/5`;if($('#fiveRating'))$('#fiveRating').hidden=true}
    if(p.action==='blind-reset')newBlind(false);
    if(p.action==='blind-reveal')revealBlind($(`#blindCards .blind-card[data-index="${p.index}"]`),p.result,false);
    if(p.action==='battle-start')showBattle(p.a,p.b,false);
    if(p.action==='battle-vote')voteBattle(p.value,false);
    if(p.action==='quest-state')setQuest(p.quest,p.step,false);
  });
  document.addEventListener('pair:changed',()=>{renderSecret();renderBattle()});document.addEventListener('session:role-changed',()=>{renderSecret();renderBattle()});renderSecret();
})();

// --- P2P session sync v34: deterministic game events + auto restore ---
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
  function sendPair(pair,force=false){if(!conn?.open||isApplying||!pair)return;const snap=JSON.stringify(pair);if(!force&&snap===lastSent)return;lastSent=snap;send({type:'pair',pair:JSON.parse(snap),authoritative:!!force,ts:Date.now()})}
  function sendUI(kind,payload={}){if(!conn?.open||uiApply)return;send({type:'ui',kind,payload,origin:peer?.id||null,ts:Date.now()})}
  function replyUI(kind,payload={}){if(!conn?.open)return;send({type:'ui',kind,payload,origin:peer?.id||null,ts:Date.now(),reply:true})}
  async function saveSessionMeta(mode,sessionCode){
    try{await PairDB.setMeta(SESSION_META,{mode,code:sessionCode,role:localRole,pairId:PairDB.active?.id||null,updatedAt:Date.now()})}catch(e){console.warn('session meta save',e)}
  }
  async function clearSessionMeta(){try{await PairDB.setMeta(SESSION_META,null)}catch{}}

  const mirrorIds=['scenarioResult','fiveMode','fiveRating','fiveRatingHistory','secretWishResult','secretWishP1Count','secretWishP2Count','blindResult','battleCounts','battleWinners','questSteps','fortuneLevelSummary'];
  // Reel DOM is synchronized by game-action events, never by snapshots.
  // Mirroring innerHTML during an animation interrupts the reel mid-spin.
  const slotSelectors=[];
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
    return {fields,slots,directAction:activeDirect?.dataset.action||null,scenarioMode:activeScenario?.dataset.mode||null,randomPoseLevels:(()=>{try{return JSON.parse(pairStorage.getItem('sa_random_pose_levels_v1')||'[]')}catch{return []}})(),position,mainTab:document.body.dataset.mainTab||null,activeGame:document.body.dataset.activeGame||null,gameMenu:document.body.dataset.gameMenu==='1'};
  }
  function applyUI(snap){
    if(!snap)return;uiApply=true;
    try{
      // Apply navigation first, so snapshot content lands in the visible game instead of the menu.
      if(snap.mainTab){
        const currentTab=document.body.dataset.mainTab||null;
        const currentGame=document.body.dataset.activeGame||null;
        const currentMenu=document.body.dataset.gameMenu==='1';
        if(currentTab!==snap.mainTab){
          document.dispatchEvent(new CustomEvent('session:remote-ui',{detail:{kind:'tab',payload:{which:snap.mainTab},fromSnapshot:true}}));
        }
        if(snap.mainTab==='games'){
          if(snap.gameMenu){
            if(!currentMenu)document.dispatchEvent(new CustomEvent('session:remote-ui',{detail:{kind:'game-menu',payload:{},fromSnapshot:true}}));
          }else if(snap.activeGame&&currentGame!==snap.activeGame){
            document.dispatchEvent(new CustomEvent('session:remote-ui',{detail:{kind:'game',payload:{key:snap.activeGame},fromSnapshot:true}}));
          }
        }
      }
      Object.entries(snap.fields||{}).forEach(([id,v])=>{const el=document.getElementById(id);if(!el)return;if('hidden'in v)el.hidden=!!v.hidden;if(v.src&&el.tagName==='IMG'){el.src=v.src;if(v.alt)el.alt=v.alt}else if(typeof v.html==='string')el.innerHTML=v.html;if(v.transform&&id==='fortuneWheelRotor'){el.style.transform=v.transform;el.style.transition=v.transition||''}});
      if(snap.fields?.fortuneWheelRotor){const r=$('#fortuneWheelRotor');if(r){r.style.transform=snap.fields.fortuneWheelRotor.transform||'';r.style.transition=snap.fields.fortuneWheelRotor.transition||''}}
      (snap.slots||[]).forEach((html,i)=>{const track=document.querySelector(slotSelectors[i]);if(track&&html)track.innerHTML=html});
      if(snap.directAction)document.querySelectorAll('#directActionChoice .choice-btn').forEach(b=>b.classList.toggle('active',b.dataset.action===snap.directAction));
      if(snap.scenarioMode)document.querySelectorAll('#scenarioSecondType [data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===snap.scenarioMode));
      if(Array.isArray(snap.randomPoseLevels)&&snap.randomPoseLevels.length)document.dispatchEvent(new CustomEvent('session:remote-ui',{detail:{kind:'game-action',payload:{action:'random-pose-levels',ids:snap.randomPoseLevels},fromSnapshot:true}}));
      if(snap.position){const p=snap.position,dlg=$('#positionDialog');if(dlg){if($('#positionCategoryTitle'))$('#positionCategoryTitle').textContent=p.category;if($('#positionDayTitle'))$('#positionDayTitle').textContent=p.title;if($('#calendarPositionImage')&&p.src)$('#calendarPositionImage').src=p.src;if($('#positionInstruction'))$('#positionInstruction').textContent=p.instruction;if($('#positionMeta'))$('#positionMeta').hidden=p.metaHidden;if($('#positionPoseName'))$('#positionPoseName').textContent=p.name;if($('#positionPoseDescription'))$('#positionPoseDescription').textContent=p.description;if(p.open&&!dlg.open)try{dlg.showModal()}catch{};if(!p.open&&dlg.open)dlg.close()}}
    }finally{setTimeout(()=>uiApply=false,100)}
  }
  function scheduleUISnapshot(delay=140){clearTimeout(uiTimer);uiTimer=setTimeout(()=>{if(conn?.open&&!uiApply)send({type:'ui-snapshot',snapshot:captureUI(),origin:peer?.id||null,ts:Date.now()})},delay)}
  window.SessionSync={sendUI,replyUI,snapshot:()=>scheduleUISnapshot(20),get role(){return localRole},get connected(){return !!conn?.open},get ready(){return !!conn?.open&&!restoring&&(localRole===0||localRole===1)&&(remoteRole===0||remoteRole===1)&&remoteRole!==localRole}};

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
    conn=c;isHost=hostSide;lastSent='';$('#leaveSessionBtn').hidden=false;
    c.on('open',async()=>{
      clearReconnect();
      const recoveringThisPage=!!restored;
      restoring=false;
      status(recoveringThisPage?'Сесію відновлено · отримуємо актуальний екран партнера…':'Підключено · синхронізація активна',true);updateRoleStatus(false);
      await saveSessionMeta(hostSide?'host':'guest',sessionCode);
      send({type:'hello',role:localRole,players:PairDB.active?.players||null,recovering:recoveringThisPage,hasPair:!!PairDB.active});
      if(recoveringThisPage || !PairDB.active){
        // Після reload АБО на новому пристрої без локальної пари просимо
        // авторитетний стан у хоста. Це дозволяє приєднатися лише за кодом,
        // не створюючи/не обираючи пару на другому пристрої заздалегідь.
        send({type:'state-request',origin:peer?.id||null,ts:Date.now(),needPair:!PairDB.active});
      }
      if(recoveringThisPage){
        // Старий локальний UI не надсилаємо назад партнеру.
      }else{
        if(isHost&&PairDB.active)sendPair(PairDB.active,true);
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
        // Новий/перезавантажений пристрій просить актуальний стан.
        // Хост завжди є джерелом активної пари. Не покладаємося на lastSent:
        // це НОВЕ з'єднання і пара мусить бути відправлена гарантовано.
        if(hostSide&&PairDB.active){
          sendPair(PairDB.active,true);
        }else if(PairDB.active&&msg.needPair){
          // Fallback для відновленої сесії, якщо ролі сторін уже помінялися.
          try{send({type:'pair',pair:JSON.parse(JSON.stringify(PairDB.active)),authoritative:true,ts:Date.now()})}catch{}
        }
        send({type:'ui-snapshot',snapshot:captureUI(),origin:peer?.id||null,ts:Date.now(),authoritative:true});
        return;
      }
      if(msg?.type==='hello'){
        remoteRole=Number(msg.role);const conflict=remoteRole===localRole;updateRoleStatus(conflict);status(conflict?'Підключено, але є конфлікт ролей':'Підключено · синхронізація активна',!conflict);
        // На КОЖНЕ нове підключення хост повторно віддає активну пару.
        // Раніше lastSent міг блокувати цю відправку, тому новий пристрій
        // залишався на екрані «Оберіть пару» навіть при успішному PeerJS connect.
        if(hostSide&&PairDB.active){
          sendPair(PairDB.active,true);
        }
        // Для reload додатково віддаємо актуальний UI після застосування пари.
        if(msg.recovering||msg.hasPair===false){
          setTimeout(()=>send({type:'ui-snapshot',snapshot:captureUI(),origin:peer?.id||null,ts:Date.now(),authoritative:true}),120);
        }
        return;
      }
      if(msg?.type==='pair'&&msg.pair){isApplying=true;try{
        lastSent=JSON.stringify(msg.pair);
        await PairDB.applyRemote(msg.pair);
        const g=$('#pairGate'),sh=$('#appShell'),lab=$('#activePairLabel');
        if(g)g.hidden=true;
        if(sh)sh.hidden=false;
        if(lab&&PairDB.active)lab.textContent=PairDB.active.players.map(x=>x.name).join(' + ');
        updateRoleStatus(remoteRole===localRole);
        status(remoteRole===localRole?'Синхронізовано · конфлікт ролей':'Синхронізовано',remoteRole!==localRole);
        document.dispatchEvent(new CustomEvent('session:pair-ready',{detail:{pair:PairDB.active,role:localRole,remoteRole}}));
        // Після отримання пари підтягуємо авторитетний екран хоста ще раз,
        // щоб новий пристрій одразу міг перейти в календар/ігри/покупки.
        if(!hostSide)send({type:'state-request',origin:peer?.id||null,ts:Date.now(),needPair:false});
      }finally{setTimeout(()=>isApplying=false,220)}return}
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
  document.addEventListener('click',e=>{if(!conn?.open||uiApply)return;const interactive=e.target.closest('button,[data-game],.calendar-day,.place-item,input[type=checkbox],select');if(!interactive)return;
    // Game actions have their own deterministic session events. A generic UI
    // snapshot during a spin can overwrite the live reel DOM and stop it.
    if(interactive.closest('#gameDetail'))return;
    scheduleUISnapshot(220)
  });
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



// --- v53: shared desired purchases / couple wishlist ---
(() => {
  'use strict';
  const KEY='sa_desired_purchases_v1';
  const $=s=>document.querySelector(s);
  const section=$('#purchasesSection');
  if(!section)return;
  const listEl=$('#purchaseList');
  const form=$('#purchaseForm');
  const openBtn=$('#openPurchaseFormBtn');
  const closeBtn=$('#closePurchaseFormBtn');
  const nameInput=$('#purchaseNameInput');
  const priceInput=$('#purchasePriceInput');
  const qtyInput=$('#purchaseQtyInput');
  const urlInput=$('#purchaseUrlInput');
  const imageInput=$('#purchaseImageInput');
  const forInput=$('#purchaseForInput');
  const formTitle=$('#purchaseFormTitle');
  const formEyebrow=$('#purchaseFormEyebrow');
  const submitBtn=$('#purchaseSubmitBtn');
  let filter='all', editingId=null;

  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const rows=()=>{try{const x=JSON.parse(pairStorage.getItem(KEY)||'[]');return Array.isArray(x)?x:[]}catch{return []}};
  const save=(items,{sync=true,event=null}={})=>{
    pairStorage.setItem(KEY,JSON.stringify(items));
    PairDB.save?.();
    if(sync&&event&&window.SessionSync?.connected)window.SessionSync.replyUI?.('purchase-action',event);
    render();
  };
  const role=()=>{const r=window.SessionSync?.role;return r===0||r===1?Number(r):0};
  const players=()=>PairDB.active?.players||[{name:'Гравець 1'},{name:'Гравець 2'}];
  const localRole=()=>role();
  const fmt=n=>`${new Intl.NumberFormat('uk-UA',{minimumFractionDigits:0,maximumFractionDigits:2}).format(Number(n)||0)} гривень`;
  const normalizeForWhom=(v,item=null)=>{
    if(v==='player0'||v==='player1'||v==='both')return v;
    // Migrate old relative values: "self" meant the creator, "her" meant the other player.
    const added=(Number(item?.addedBy)===1)?1:0;
    if(v==='her')return added===0?'player1':'player0';
    if(v==='self')return added===0?'player0':'player1';
    return added===0?'player0':'player1';
  };
  const forWhomValue=(v,item=null)=>normalizeForWhom(v,item);
  const forWhomLabel=(v,item=null)=>{
    const ps=PairDB.active?.players||[];
    const n=normalizeForWhom(v,item);
    if(n==='both')return 'Для нас';
    const ix=n==='player1'?1:0;
    return `Для ${ps[ix]?.name||('Гравця '+(ix+1))}`;
  };
  function refreshPurchaseForOptions(){
    if(!forInput)return;
    const ps=PairDB.active?.players||[];
    const current=forInput.value;
    forInput.innerHTML=`<option value="player0">Для ${esc(ps[0]?.name||'Гравця 1')}</option><option value="player1">Для ${esc(ps[1]?.name||'Гравця 2')}</option><option value="both">Для нас</option>`;
    if(['player0','player1','both'].includes(current))forInput.value=current;
  }
  refreshPurchaseForOptions();
  document.addEventListener('pair:changed',refreshPurchaseForOptions);
  const plural=n=>{const a=Math.abs(n)%100,b=a%10;return a>10&&a<20?'товарів':b===1?'товар':b>=2&&b<=4?'товари':'товарів'};
  const validHttp=u=>{try{const x=new URL(u);return x.protocol==='http:'||x.protocol==='https:'}catch{return false}};
  function requireSession(){return window.requireSyncedPartnerSession?window.requireSyncedPartnerSession():!!window.SessionSync?.ready}
  function resetFormMode(){
    editingId=null;
    if(formTitle)formTitle.textContent='Додати покупку';
    if(formEyebrow)formEyebrow.textContent='НОВИЙ ТОВАР';
    if(submitBtn)submitBtn.textContent='Додати в список';
  }
  function openEdit(item){
    if(!item||Number(item.addedBy)!==localRole())return;
    if(!requireSession())return;
    editingId=item.id;
    nameInput.value=item.name||'';
    priceInput.value=Number(item.price)||0;
    qtyInput.value=Math.max(1,Number(item.qty)||1);
    urlInput.value=item.url||'';
    imageInput.value=item.imageUrl||'';
    if(forInput)forInput.value=forWhomValue(item.forWhom,item);
    if(formTitle)formTitle.textContent='Редагувати покупку';
    if(formEyebrow)formEyebrow.textContent='РЕДАГУВАННЯ';
    if(submitBtn)submitBtn.textContent='Зберегти зміни';
    form.hidden=false;
    nameInput?.focus();
    form.scrollIntoView({behavior:'smooth',block:'start'});
  }

  function renderTotals(items){
    const me=localRole(), partner=me===0?1:0;
    const sumFor=r=>items.filter(x=>Number(x.addedBy)===r).reduce((s,x)=>s+(Number(x.price)||0)*Math.max(1,Number(x.qty)||1),0);
    const countFor=r=>items.filter(x=>Number(x.addedBy)===r).reduce((s,x)=>s+Math.max(1,Number(x.qty)||1),0);
    const total=items.reduce((s,x)=>s+(Number(x.price)||0)*Math.max(1,Number(x.qty)||1),0);
    const totalCount=items.reduce((s,x)=>s+Math.max(1,Number(x.qty)||1),0);
    $('#purchaseGrandTotal').textContent=fmt(total);
    $('#purchaseGrandItems').textContent=`${totalCount} ${plural(totalCount)}`;
    $('#purchaseSelfTotal').textContent=fmt(sumFor(me));
    $('#purchaseSelfItems').textContent=`${countFor(me)} ${plural(countFor(me))}`;
    $('#purchasePartnerTotal').textContent=fmt(sumFor(partner));
    $('#purchasePartnerItems').textContent=`${countFor(partner)} ${plural(countFor(partner))}`;
  }

  function voteText(v){return v==='yes'?'Потрібен ✓':v==='no'?'Не потрібен':'Не голосував'}
  function render(){
    const all=rows();
    renderTotals(all);
    const me=localRole(), partner=me===0?1:0, ps=players();
    let shown=all;
    if(filter==='mine')shown=all.filter(x=>Number(x.addedBy)===me);
    if(filter==='partner')shown=all.filter(x=>Number(x.addedBy)===partner);
    if(filter==='planned')shown=all.filter(x=>!!x.planned&&!x.purchased);
    if(filter==='purchased')shown=all.filter(x=>!!x.purchased);
    $('#purchaseCountBadge').textContent=shown.length;
    document.querySelectorAll('[data-purchase-filter]').forEach(b=>b.classList.toggle('active',b.dataset.purchaseFilter===filter));
    listEl.innerHTML='';
    if(!shown.length){listEl.innerHTML='<div class="purchase-empty"><div>🛍️</div><strong>Список поки порожній</strong><span>Додайте перший бажаний товар.</span></div>';return}
    [...shown].sort((a,b)=>(Number(b.createdAt)||0)-(Number(a.createdAt)||0)).forEach(item=>{
      const addedBy=Number(item.addedBy)===1?1:0;
      const isMine=addedBy===me;
      const qty=Math.max(1,Number(item.qty)||1), price=Number(item.price)||0, itemTotal=price*qty;
      const votes=item.votes&&typeof item.votes==='object'?item.votes:{};
      const myVote=votes[me]||null, partnerVote=votes[partner]||null;
      const priority=['low','medium','high','urgent'].includes(item.priority)?item.priority:null;
      const priorityLabels={low:'Низький',medium:'Середній',high:'Високий',urgent:'Дуже високий'};
      const canSetPriority=!isMine;
      const card=document.createElement('article');card.className='purchase-card'+(myVote==='yes'&&partnerVote==='yes'?' both-want':'')+(priority?` priority-${priority}`:'')+(item.purchased?' is-purchased':item.planned?' is-planned':'');
      const img=(item.imageUrl&&validHttp(item.imageUrl))?`<img src="${esc(item.imageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">`:'<div class="purchase-image-placeholder">🛍️</div>';
      const productLink=(item.url&&validHttp(item.url))?`<a class="purchase-link" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">Відкрити товар ↗</a>`:'';
      card.innerHTML=`
        <div class="purchase-image">${img}${item.purchased?'<span class="purchase-bought-overlay">Придбано ✓</span>':''}</div>
        <div class="purchase-card-body">
          <div class="purchase-card-top"><span class="purchase-owner ${isMine?'mine':'partner'}">${isMine?'Додали ви':`Додав ${esc(ps[addedBy]?.name||'партнер')}`}</span><div class="purchase-card-badges"><span class="purchase-for-badge ${forWhomValue(item.forWhom,item)}">${forWhomLabel(item.forWhom,item)}</span>${myVote==='yes'&&partnerVote==='yes'?'<span class="purchase-approved">Обом потрібен ✓</span>':''}${item.planned&&!item.purchased?'<span class="purchase-plan-badge">В планах</span>':''}${item.purchased?'<span class="purchase-bought-badge">Придбано ✓</span>':''}</div></div>
          <div class="purchase-title-row"><h3>${esc(item.name||'Без назви')}</h3>${isMine?`<div class="purchase-owner-actions"><button type="button" class="purchase-edit-btn" data-edit-purchase="${esc(item.id)}">Редагувати</button><button type="button" class="purchase-delete-btn" data-delete-purchase="${esc(item.id)}">Видалити</button></div>`:''}</div>
          <div class="purchase-price-row"><strong>${fmt(price)}</strong><span>× ${qty}</span><b>${qty>1?`= ${fmt(itemTotal)}`:''}</b></div>
          ${productLink}
          <section class="purchase-ui-section purchase-status-section">
            <div class="purchase-ui-section-head"><span>Статус</span><small>${item.purchased?'Придбано':item.planned?'У планах':'Активний список'}</small></div>
            <div class="purchase-status-actions" data-purchase-status-id="${esc(item.id)}">
              <button type="button" class="purchase-plan-btn ${item.planned&&!item.purchased?'active':''}" data-toggle-planned="${item.planned&&!item.purchased?'0':'1'}">${item.planned&&!item.purchased?'В планах ✓':'Додати в плани'}</button>
              <button type="button" class="purchase-bought-btn ${item.purchased?'active':''}" data-toggle-purchased="${item.purchased?'0':'1'}">${item.purchased?'Придбано ✓':'Позначити придбаним'}</button>
            </div>
          </section>
          <div class="purchase-priority purchase-ui-section">
            <div class="purchase-priority-head"><small>Пріоритет покупки</small><strong class="priority-value ${priority||'none'}">${priority?priorityLabels[priority]:'Не визначено'}</strong></div>
            ${canSetPriority?`<div class="purchase-priority-actions" data-purchase-priority-id="${esc(item.id)}">
              <button type="button" class="purchase-priority-btn ${priority==='low'?'active':''}" data-priority="low">Низький</button>
              <button type="button" class="purchase-priority-btn ${priority==='medium'?'active':''}" data-priority="medium">Середній</button>
              <button type="button" class="purchase-priority-btn ${priority==='high'?'active':''}" data-priority="high">Високий</button>
              <button type="button" class="purchase-priority-btn ${priority==='urgent'?'active':''}" data-priority="urgent">Дуже високий</button>
            </div>`:`<div class="purchase-priority-note">Пріоритет виставляє ваш партнер</div>`}
          </div>
          <section class="purchase-ui-section purchase-voting-section">
            <div class="purchase-ui-section-head"><span>Голосування</span><small>Чи потрібен цей товар?</small></div>
            <div class="purchase-votes">
              <div class="purchase-vote-status"><small>Ви</small><strong class="${myVote||'none'}">${voteText(myVote)}</strong></div>
              <div class="purchase-vote-status"><small>Ваш партнер</small><strong class="${partnerVote||'none'}">${voteText(partnerVote)}</strong></div>
            </div>
            <div class="purchase-vote-actions" data-purchase-id="${esc(item.id)}">
              <button type="button" class="purchase-vote-btn yes ${myVote==='yes'?'active':''}" data-vote="yes">Потрібен</button>
              <button type="button" class="purchase-vote-btn no ${myVote==='no'?'active':''}" data-vote="no">Не потрібен</button>
            </div>
          </section>
        </div>`;
      const bad=card.querySelector('img');if(bad)bad.addEventListener('error',()=>{const wrap=bad.parentElement;wrap.innerHTML='<div class="purchase-image-placeholder">🛍️</div>'},{once:true});
      listEl.appendChild(card);
    });
  }

  openBtn?.addEventListener('click',()=>{if(!requireSession())return;form.reset();qtyInput.value='1';if(forInput)forInput.value=localRole()===1?'player1':'player0';resetFormMode();form.hidden=false;nameInput?.focus();form.scrollIntoView({behavior:'smooth',block:'start'})});
  closeBtn?.addEventListener('click',()=>{form.hidden=true;form.reset();qtyInput.value='1';if(forInput)forInput.value=localRole()===1?'player1':'player0';resetFormMode()});
  form?.addEventListener('submit',e=>{
    e.preventDefault();if(!requireSession())return;
    const name=nameInput.value.trim(), price=Number(priceInput.value), qty=Math.max(1,Math.floor(Number(qtyInput.value)||1)), forWhom=['player0','player1','both'].includes(forInput?.value)?forInput.value:'both';
    if(!name||!Number.isFinite(price)||price<0)return;
    const all=rows();
    if(editingId){
      const item=all.find(x=>x.id===editingId);if(!item||Number(item.addedBy)!==localRole())return;
      item.name=name;item.price=price;item.qty=qty;item.url=urlInput.value.trim();item.imageUrl=imageInput.value.trim();item.forWhom=forWhom;item.updatedAt=Date.now();
      const patch={name:item.name,price:item.price,qty:item.qty,url:item.url,imageUrl:item.imageUrl,forWhom:item.forWhom,updatedAt:item.updatedAt};
      save(all,{event:{action:'edit',id:item.id,role:localRole(),patch}});
    }else{
      const item={id:'purchase_'+Date.now()+'_'+Math.random().toString(36).slice(2,8),name,price,qty,url:urlInput.value.trim(),imageUrl:imageInput.value.trim(),forWhom,addedBy:localRole(),votes:{},createdAt:Date.now()};
      all.push(item);save(all,{event:{action:'add',item}});
    }
    form.reset();qtyInput.value='1';if(forInput)forInput.value=localRole()===1?'player1':'player0';form.hidden=true;resetFormMode();
  });
  listEl?.addEventListener('click',e=>{
    const editBtn=e.target.closest('[data-edit-purchase]');
    if(editBtn){
      const item=rows().find(x=>x.id===editBtn.dataset.editPurchase);
      if(item)openEdit(item);
      return;
    }
    const deleteBtn=e.target.closest('[data-delete-purchase]');
    if(deleteBtn){
      if(!requireSession())return;
      const id=deleteBtn.dataset.deletePurchase,all=rows(),item=all.find(x=>x.id===id);if(!item)return;
      if(Number(item.addedBy)!==localRole())return;
      if(!window.confirm('Видалити цей товар зі списку?'))return;
      save(all.filter(x=>x.id!==id),{event:{action:'delete',id,role:localRole()}});
      return;
    }
    const plannedBtn=e.target.closest('[data-toggle-planned]');
    if(plannedBtn){
      if(!requireSession())return;
      const wrap=plannedBtn.closest('[data-purchase-status-id]'),id=wrap?.dataset.purchaseStatusId;if(!id)return;
      const all=rows(),item=all.find(x=>x.id===id);if(!item)return;
      const value=plannedBtn.dataset.togglePlanned==='1';
      if(window.CouplePlanning?.propose){window.CouplePlanning.propose({type:'purchase-plan',targetId:id,label:item.name||'Товар',value});return;}
      item.planned=value;item.plannedBy=localRole();item.plannedAt=value?Date.now():null;
      if(value){item.purchased=false;item.purchasedAt=null;item.purchasedBy=null;}
      save(all,{event:{action:'planned',id,role:localRole(),value,updatedAt:Date.now()}});
      document.dispatchEvent(new CustomEvent('progress:changed'));
      return;
    }
    const purchasedBtn=e.target.closest('[data-toggle-purchased]');
    if(purchasedBtn){
      if(!requireSession())return;
      const wrap=purchasedBtn.closest('[data-purchase-status-id]'),id=wrap?.dataset.purchaseStatusId;if(!id)return;
      const all=rows(),item=all.find(x=>x.id===id);if(!item)return;
      const value=purchasedBtn.dataset.togglePurchased==='1';
      item.purchased=value;item.purchasedBy=localRole();item.purchasedAt=value?Date.now():null;if(value){item.planned=false;item.plannedAt=null;item.plannedBy=null;}
      save(all,{event:{action:'purchased',id,role:localRole(),value,updatedAt:Date.now()}});document.dispatchEvent(new CustomEvent('progress:changed'));
      return;
    }
    const priorityBtn=e.target.closest('[data-priority]');
    if(priorityBtn){
      if(!requireSession())return;
      const wrap=priorityBtn.closest('[data-purchase-priority-id]'),id=wrap?.dataset.purchasePriorityId;if(!id)return;
      const all=rows(),item=all.find(x=>x.id===id);if(!item)return;
      const r=localRole();
      if(Number(item.addedBy)===r)return;
      const value=['low','medium','high','urgent'].includes(priorityBtn.dataset.priority)?priorityBtn.dataset.priority:null;if(!value)return;
      item.priority=value;item.priorityBy=r;item.priorityUpdatedAt=Date.now();
      save(all,{event:{action:'priority',id,role:r,value,updatedAt:item.priorityUpdatedAt}});
      return;
    }
    const btn=e.target.closest('[data-vote]');if(!btn)return;if(!requireSession())return;
    const wrap=btn.closest('[data-purchase-id]'),id=wrap?.dataset.purchaseId;if(!id)return;
    const all=rows(),item=all.find(x=>x.id===id);if(!item)return;
    const r=localRole(),value=btn.dataset.vote==='yes'?'yes':'no';item.votes ||= {};item.votes[r]=value;
    save(all,{event:{action:'vote',id,role:r,value}});
  });
  document.querySelectorAll('[data-purchase-filter]').forEach(btn=>btn.addEventListener('click',()=>{filter=btn.dataset.purchaseFilter||'all';render()}));

  document.addEventListener('session:remote-ui',e=>{
    const m=e.detail||{};if(m.kind!=='purchase-action')return;const p=m.payload||{},all=rows();
    if(p.action==='add'&&p.item&&!all.some(x=>x.id===p.item.id)){all.push(p.item);save(all,{sync:false});return}
    if(p.action==='edit'){
      const item=all.find(x=>x.id===p.id);if(!item)return;
      if(Number(item.addedBy)!==Number(p.role))return;
      const patch=p.patch||{};
      item.name=String(patch.name??item.name).slice(0,120);
      item.price=Math.max(0,Number(patch.price)||0);
      item.qty=Math.max(1,Math.floor(Number(patch.qty)||1));
      item.url=String(patch.url??item.url??'');
      item.imageUrl=String(patch.imageUrl??item.imageUrl??'');
      item.forWhom=forWhomValue(patch.forWhom??item.forWhom,item);
      item.updatedAt=Number(patch.updatedAt)||Date.now();
      save(all,{sync:false});return
    }
    if(p.action==='delete'){
      const item=all.find(x=>x.id===p.id);if(!item)return;
      if(Number(item.addedBy)!==Number(p.role))return;
      save(all.filter(x=>x.id!==p.id),{sync:false});return
    }
    if(p.action==='planned'){
      const item=all.find(x=>x.id===p.id);if(!item)return;
      item.planned=!!p.value;item.plannedBy=Number(p.role);item.plannedAt=p.value?(Number(p.updatedAt)||Date.now()):null;if(p.value){item.purchased=false;item.purchasedAt=null;item.purchasedBy=null;}save(all,{sync:false});document.dispatchEvent(new CustomEvent('progress:changed'));return
    }
    if(p.action==='purchased'){
      const item=all.find(x=>x.id===p.id);if(!item)return;
      item.purchased=!!p.value;item.purchasedBy=Number(p.role);item.purchasedAt=p.value?(Number(p.updatedAt)||Date.now()):null;if(p.value){item.planned=false;item.plannedAt=null;item.plannedBy=null;}save(all,{sync:false});document.dispatchEvent(new CustomEvent('progress:changed'));return
    }
    if(p.action==='vote'){
      const item=all.find(x=>x.id===p.id);if(!item)return;item.votes ||= {};item.votes[Number(p.role)]=p.value==='yes'?'yes':'no';save(all,{sync:false});return
    }
    if(p.action==='priority'){
      const item=all.find(x=>x.id===p.id);if(!item)return;
      const value=['low','medium','high','urgent'].includes(p.value)?p.value:null;if(!value)return;
      if(Number(item.addedBy)===Number(p.role))return;
      item.priority=value;item.priorityBy=Number(p.role);item.priorityUpdatedAt=Number(p.updatedAt)||Date.now();save(all,{sync:false});
    }
  });
  document.addEventListener('purchases:render',render);
  document.addEventListener('pair:changed',()=>{if(!section.hidden)render()});
  document.addEventListener('pair:remote-applied',()=>{if(!section.hidden)render()});
  render();
})();


// --- v60: two-player approval for all planning actions ---
(() => {
  'use strict';
  const KEY='sa_couple_planning_proposal_v1';
  const modal=document.getElementById('planningApprovalModal');
  const title=document.getElementById('planningApprovalTitle');
  const summary=document.getElementById('planningApprovalSummary');
  const icon=document.getElementById('planningApprovalIcon');
  const selfVote=document.getElementById('planningApprovalSelfVote');
  const partnerVote=document.getElementById('planningApprovalPartnerVote');
  const hint=document.getElementById('planningApprovalHint');
  const agree=document.getElementById('planningApprovalAgreeBtn');
  const reject=document.getElementById('planningApprovalRejectBtn');
  let runtime=null;
  const role=()=>window.SessionSync?.role===1?1:0;
  const partner=()=>role()===0?1:0;
  const players=()=>PairDB.active?.players||[{name:'Гравець 1'},{name:'Гравець 2'}];
  function read(){if(runtime)return runtime;try{runtime=JSON.parse(pairStorage.getItem(KEY)||'null')}catch{runtime=null}return runtime}
  function store(v){runtime=v?JSON.parse(JSON.stringify(v)):null;if(v)pairStorage.setItem(KEY,JSON.stringify(v));else pairStorage.removeItem(KEY);render()}
  function notify(msg){let el=document.getElementById('toast');if(!el){el=document.createElement('div');el.id='planningToast';el.className='toast';document.body.appendChild(el)}el.textContent=msg;el.classList.add('show');clearTimeout(el._t);el._t=setTimeout(()=>el.classList.remove('show'),2400)}
  function describe(p){if(p.type==='purchase-plan')return `${p.value?'Додати у плани':'Прибрати з планів'}: ${p.label||'товар'}`;if(p.type==='place-plan')return `${p.value?'Запланувати місце':'Прибрати місце з планів'}: ${p.label||'місце'}`;if(p.type==='game-debt-clear')return 'Очистити весь список бажань за результатами ігор';return p.label||'Зміна плану'}
  function render(){if(!modal)return;const p=read();if(!p){modal.hidden=true;return}modal.hidden=false;const me=role(),other=partner(),names=players().map(x=>x?.name||'Гравець');const approvals=Array.isArray(p.approvals)?p.approvals:[false,false];if(icon)icon.textContent=p.type==='place-plan'?'📍':p.type==='game-debt-clear'?'🧹':'🛍️';if(title)title.textContent=p.type==='game-debt-clear'?'Очистити бажання?':(p.value?'Погодити планування?':'Погодити зміну плану?');if(summary)summary.textContent=describe(p);if(selfVote){selfVote.querySelector('span').textContent=`Ви — ${names[me]||''}`;selfVote.querySelector('strong').textContent=approvals[me]?'Погоджено ✓':'Очікує';selfVote.classList.toggle('approved',!!approvals[me])}if(partnerVote){partnerVote.querySelector('span').textContent=`Ваш партнер — ${names[other]||''}`;partnerVote.querySelector('strong').textContent=approvals[other]?'Погоджено ✓':'Очікує';partnerVote.classList.toggle('approved',!!approvals[other])}if(agree){agree.disabled=!!approvals[me];agree.textContent=approvals[me]?'Ви погодились ✓':'Погодитись'}if(hint)hint.textContent=approvals[me]&&!approvals[other]?'Очікуємо рішення партнера…':(!approvals[me]&&approvals[other]?'Партнер уже погодився. Потрібне ваше підтвердження.':'Для зміни плану мають погодитися обидва.')}
  function apply(p){if(!p)return;if(p.type==='purchase-plan'){let all=[];try{all=JSON.parse(pairStorage.getItem('sa_desired_purchases_v1')||'[]')}catch{};const item=Array.isArray(all)?all.find(x=>x.id===p.targetId):null;if(item){item.planned=!!p.value;item.plannedBy=p.value?Number(p.initiator):null;item.plannedAt=p.value?Date.now():null;if(p.value){item.purchased=false;item.purchasedAt=null;item.purchasedBy=null}pairStorage.setItem('sa_desired_purchases_v1',JSON.stringify(all));PairDB.save?.();document.dispatchEvent(new CustomEvent('purchases:render'));document.dispatchEvent(new CustomEvent('progress:changed'))}}else if(p.type==='place-plan'){let planned=[];try{planned=JSON.parse(pairStorage.getItem('sa_games_places_planned_v1')||'[]')}catch{};const set=new Set(Array.isArray(planned)?planned:[]);if(p.value)set.add(p.targetId);else set.delete(p.targetId);pairStorage.setItem('sa_games_places_planned_v1',JSON.stringify([...set]));PairDB.save?.();document.dispatchEvent(new CustomEvent('progress:changed'));const btn=document.getElementById('placesTabBtn');if(btn&&btn.classList.contains('active'))btn.dispatchEvent(new Event('noop'))}else if(p.type==='game-debt-clear'){pairStorage.setItem('sa_game_wish_debts_v1','[]');PairDB.save?.();document.dispatchEvent(new CustomEvent('progress:changed'));}
    document.dispatchEvent(new CustomEvent('pair:changed'));
  }
  function propose(data){if(window.requireSyncedPartnerSession&&!window.requireSyncedPartnerSession())return;const existing=read();if(existing){render();notify('Спочатку завершіть поточне погодження');return}const p={id:'plan_'+Date.now()+'_'+Math.random().toString(36).slice(2,7),type:data.type,targetId:data.targetId,label:data.label||'',value:!!data.value,initiator:role(),approvals:[false,false],createdAt:Date.now()};store(p);window.SessionSync?.replyUI?.('planning-action',{action:'propose',proposal:p})}
  function vote(isAgree,remoteRole=null,proposalId=null,sync=true){const p=read();if(!p||proposalId&&p.id!==proposalId)return;const r=remoteRole===0||remoteRole===1?remoteRole:role();if(!isAgree){const id=p.id;store(null);if(sync)window.SessionSync?.replyUI?.('planning-action',{action:'reject',proposalId:id,role:r});notify('Планування скасовано');return}p.approvals ||= [false,false];p.approvals[r]=true;store(p);if(sync)window.SessionSync?.replyUI?.('planning-action',{action:'vote',proposalId:p.id,role:r});if(p.approvals[0]&&p.approvals[1]){apply(p);store(null);notify('План погоджено ✓')}}
  const clearDebtButtons=[document.getElementById('clearPageGameDebtsBtn'),document.getElementById('clearDialogGameDebtsBtn')].filter(Boolean);
  clearDebtButtons.forEach(btn=>btn.addEventListener('click',()=>{
    let rows=[];try{rows=JSON.parse(pairStorage.getItem('sa_game_wish_debts_v1')||'[]')}catch{rows=[]}
    if(!Array.isArray(rows)||!rows.length){notify('Список бажань уже порожній');return}
    propose({type:'game-debt-clear',targetId:'all-game-debts',label:'Бажання за результатами ігор',value:true});
  }));
  agree?.addEventListener('click',()=>vote(true));reject?.addEventListener('click',()=>vote(false));
  document.addEventListener('session:remote-ui',e=>{const m=e.detail||{};if(m.kind!=='planning-action')return;const x=m.payload||{};if(x.action==='propose'&&x.proposal){store(x.proposal);return}if(x.action==='vote'){vote(true,Number(x.role),x.proposalId,false);return}if(x.action==='reject'){const p=read();if(p?.id===x.proposalId){store(null);notify('Партнер відхилив планування')}}});
  document.addEventListener('pair:changed',render);
  window.CouplePlanning={propose,render,get active(){return !!read()}};
  render();
})();

// --- v51: require a fully synchronized partner session for every shared-state mutation ---
(() => {
  'use strict';
  const NEED_SESSION_TEXT='Для змін потрібна активна сесія з партнером';
  let noticeTimer=null, lastNotice=0;

  function sessionReady(){ return !!window.SessionSync?.ready; }
  function showSessionRequired(){
    const now=Date.now();
    if(now-lastNotice<350)return;
    lastNotice=now;
    let el=document.getElementById('toast');
    if(!el){
      el=document.createElement('div');
      el.id='sessionGuardToast';
      el.className='toast';
      document.body.appendChild(el);
    }
    el.textContent=NEED_SESSION_TEXT;
    el.classList.add('show');
    clearTimeout(noticeTimer);
    noticeTimer=setTimeout(()=>el.classList.remove('show'),2600);
  }

  function isViewOnlyButton(btn){
    if(!btn)return false;
    if(btn.matches('#backToGamesBtn,#randomPoseOpenBtn,#closePositionDialog,#closeDeferDialog,#closeProgressDialog,#closeAllPositionsDialog'))return true;
    const txt=(btn.textContent||'').trim();
    if(/^Відкрити\b/i.test(txt))return true;
    return false;
  }

  function isMutationTarget(target){
    if(!(target instanceof Element))return false;

    // Pair/profile/session setup must stay available, otherwise a session could never be created.
    if(target.closest('#pairGate,.pair-bar,.main-tabs,#gamesMenu'))return false;

    // Calendar: opening cards/progress is view-only; these controls actually change shared progress/unlocks.
    if(target.closest('#calendarSection')){
      if(target.closest('#resetCalendarBtn,#devUnlockAllBtn,.allow-level-btn'))return true;
      return false;
    }

    // Places are shared pair data: marks, custom places, category selection while adding, deletion, etc.
    if(target.closest('#placesSection')){
      return !!target.closest('button,input,select,textarea,form,.place-item,[data-place-id]');
    }

    // Progress page mutations are wish/debt completion buttons. Pure reading remains available.
    if(target.closest('#progressSection')){
      return !!target.closest('button,input,select,textarea,form');
    }

    // Desired purchases are shared pair data. Browsing/filtering/link opening is view-only;
    // adding an item and voting require a synchronized partner session.
    if(target.closest('#purchasesSection')){
      if(target.closest('.purchase-filter-btn,.purchase-link,#closePurchaseFormBtn'))return false;
      return !!target.closest('#openPurchaseFormBtn,#purchaseForm input,#purchaseForm select,#purchaseForm button,.purchase-vote-btn,.purchase-priority-btn,.purchase-edit-btn,.purchase-delete-btn,.purchase-bought-btn,.purchase-plan-btn,form');
    }

    // Position scratch/reveal/defer/complete mutate shared position state; closing remains view-only.
    if(target.closest('#positionDialog')){
      if(target.closest('#closePositionDialog'))return false;
      return !!target.closest('button,input,select,textarea,form,#positionScratchCanvas');
    }
    if(target.closest('#deferDialog')){
      if(target.closest('#closeDeferDialog'))return false;
      return !!target.closest('button,input,select,textarea,form');
    }
    if(target.closest('#progressDialog')){
      const btn=target.closest('button');
      if(btn&&isViewOnlyButton(btn))return false;
      return !!target.closest('button,input,select,textarea,form');
    }

    // Every interactive control inside an opened game changes shared gameplay, except navigation/zoom.
    if(target.closest('#gameDetail')){
      const btn=target.closest('button');
      if(btn&&isViewOnlyButton(btn))return false;
      return !!target.closest('button,input,select,textarea,form,[contenteditable="true"]');
    }

    // Score-finish confirmation is outside gameDetail and is shared state too.
    if(target.closest('#scoreFinishModal')){
      return !!target.closest('button,input,select,textarea,form');
    }

    // Dynamically rendered debt buttons inside the legacy modal/page.
    if(target.closest('.deferred-card-actions')){
      const btn=target.closest('button');
      if(btn&&isViewOnlyButton(btn))return false;
      return !!btn;
    }
    return false;
  }

  function blockIfNeeded(e){
    if(sessionReady() || !isMutationTarget(e.target))return false;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation?.();
    showSessionRequired();
    return true;
  }

  // Capture phase runs before existing game/progress handlers, so no local-only mutation can slip through.
  document.addEventListener('click',blockIfNeeded,true);
  document.addEventListener('pointerdown',e=>{
    if(sessionReady()||!isMutationTarget(e.target))return;
    // For text/select/canvas controls stop interaction immediately. Buttons are also caught on click/keyboard.
    if(e.target.closest('input,select,textarea,#positionScratchCanvas,.place-item,[data-place-id]'))blockIfNeeded(e);
  },true);
  document.addEventListener('submit',blockIfNeeded,true);
  document.addEventListener('change',blockIfNeeded,true);
  document.addEventListener('beforeinput',blockIfNeeded,true);
  document.addEventListener('paste',blockIfNeeded,true);
  document.addEventListener('drop',blockIfNeeded,true);

  // Public helper for future controls/functions added to the project.
  window.requireSyncedPartnerSession=()=>{
    if(sessionReady())return true;
    showSessionRequired();
    return false;
  };
})();
