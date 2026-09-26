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
  async function activate(id){active=await req(tx(STORE).get(id));if(!active)return null;active.state ||= freshState();active.state.calendar ||= {};active.state.games ||= {};active.state.ui ||= {};await setMeta('activePairId',id);document.dispatchEvent(new CustomEvent('pair:changed',{detail:active}));return active}
  function scheduleSave(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>{if(active)put(active)},60)}
  function getKV(key){return active?.state?.kv?.[key]??null}
  function setKV(key,value){if(!active)return;active.state.kv ||= {};active.state.kv[key]=value;scheduleSave()}
  function removeKV(key){if(!active?.state?.kv)return;delete active.state.kv[key];scheduleSave()}
  async function init(){await open();const id=await getMeta('activePairId');if(id)active=await req(tx(STORE).get(id));return active}
  return {init,list,create,activate,remove,exportAll,importAll,get active(){return active},save:()=>active?put(active):Promise.resolve(),getKV,setKV,removeKV};
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
    instruction: $('#positionInstruction'), poseMeta: $('#positionMeta'), poseName: $('#positionPoseName'), poseDescription: $('#positionPoseDescription'), reveal: $('#revealPositionBtn'), complete: $('#completePositionBtn'), toast: $('#toast')
  };

  // Same keys as previous MF versions: old progress is preserved.
  const DONE_KEY = 'sa_position_done_mf';
  const REVEALED_KEY = 'sa_position_revealed_mf';
  const MANUAL_UNLOCK_KEY = 'sa_position_manual_unlock_mf';
  const DEV_UNLOCK_ALL_KEY = 'sa_position_dev_unlock_all_mf';
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
    const revealed = readSet(REVEALED_KEY);
    const doneCount = ITEMS.filter(x => done.has(x.id)).length;
    const pct = ITEMS.length ? Math.round(doneCount / ITEMS.length * 100) : 0;
    const activeCat = firstUnlockedIncompleteCategory(done);

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
      const unlocked = categoryUnlocked(catIndex, done);
      const complete = categoryDone(category, done);
      const catDoneCount = category.items.filter(item => done.has(item.id)).length;
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
          const isRevealed = revealed.has(item.id);
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = `calendar-day ${isDone ? 'completed' : isRevealed ? 'revealed' : 'available'}`;
          if(isDone){
            const img = document.createElement('img');
            img.src = item.image;
            img.alt = `${category.name}, позиція ${localIndex+1}`;
            img.loading = 'lazy';
            btn.appendChild(img);
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

  function scratch(e){
    const r = els.canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    ctx.globalCompositeOperation = 'destination-out'; ctx.beginPath(); ctx.arc(x,y,32,0,Math.PI*2); ctx.fill();
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

  function reveal(save=true){
    if(!current) return;
    revealedNow = true; els.canvas.style.opacity = '0'; els.canvas.style.pointerEvents = 'none';
    if(save){ const set = readSet(REVEALED_KEY); set.add(current.id); saveSet(REVEALED_KEY,set); }
    const done = readSet(DONE_KEY).has(current.id);
    els.complete.disabled = done; els.complete.textContent = done ? 'Вже виконано ✓' : 'Виконано ✓';
    els.instruction.textContent = done ? 'Цю позицію вже виконано.' : 'Позиція відкрита. Після виконання натисніть «Виконано».';
    updatePositionMeta(current, true);
    render();
  }

  function openPosition(item,globalIndex,catIndex,localIndex,isDone){
    current = item; currentGlobalIndex = globalIndex; currentCategoryIndex = catIndex;
    els.categoryTitle.textContent = CATEGORIES[catIndex].name.toUpperCase();
    els.dayTitle.textContent = `Поза ${item.order_index}`;
    els.image.src = item.image; els.image.alt = item.poseTitle || ('Поза ' + item.order_index);
    updatePositionMeta(item, false);
    els.dialog.showModal();
    const alreadyRevealed = readSet(REVEALED_KEY).has(item.id) || isDone;
    els.complete.disabled = !alreadyRevealed || isDone;
    els.complete.textContent = isDone ? 'Вже виконано ✓' : 'Виконано ✓';
    els.instruction.textContent = isDone ? 'Цю позицію вже виконано.' : alreadyRevealed ? 'Позиція відкрита. Після виконання натисніть «Виконано».' : 'Зітріть захисний шар, щоб відкрити позицію.';
    updatePositionMeta(item, alreadyRevealed || isDone);
    requestAnimationFrame(() => alreadyRevealed ? reveal(false) : drawCover());
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
    const rev = readSet(REVEALED_KEY); rev.add(current.id); saveSet(REVEALED_KEY,rev);
    const justFinishedCategory = categoryDone(CATEGORIES[currentCategoryIndex], done);
    const isProgression = CATEGORIES[currentCategoryIndex].mode === 'progression';
    const nextIndex = currentCategoryIndex + 1;
    const nextIsProgression = nextIndex < 4;
    els.dialog.close(); render();
    if(justFinishedCategory && isProgression && nextIsProgression) toast(`${CATEGORIES[nextIndex].name} розблоковано 🎉`);
    else toast('Позицію виконано ✓');
  });

  els.devUnlockAll?.addEventListener('click', toggleDevUnlockAll);
  els.devShowAll?.addEventListener('click', showAllPositions);
  els.closeAllDialog?.addEventListener('click', () => els.allDialog.close());
  els.allDialog?.addEventListener('click', e => { if(e.target === els.allDialog) els.allDialog.close(); });

  els.reset.addEventListener('click', () => {
    if(confirm('Скинути весь прогрес календаря MF?')){
      pairStorage.removeItem(DONE_KEY); pairStorage.removeItem(REVEALED_KEY); pairStorage.removeItem(MANUAL_UNLOCK_KEY); pairStorage.removeItem(DEV_UNLOCK_ALL_KEY); render(); toast('Прогрес скинуто');
    }
  });

  if(sessionStorage.getItem('sa_age_ok') !== '1') els.ageGate.hidden = false;
  els.confirmAge.addEventListener('click', () => { sessionStorage.setItem('sa_age_ok','1'); els.ageGate.hidden = true; });
  els.leaveSite.addEventListener('click', () => { document.body.innerHTML = '<main class="leave"><h1>18+</h1><p>Сторінку закрито.</p></main>'; });
  window.addEventListener('resize', () => { if(els.dialog.open && current && !revealedNow) drawCover(); });

  document.addEventListener('pair:changed',()=>render());
  if(PairDB.active) render();
})();

// --- Couple games module ---
(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const calendarTabBtn=$('#calendarTabBtn'), placesTabBtn=$('#placesTabBtn'), gamesTabBtn=$('#gamesTabBtn'), calendarSection=$('#calendarSection'), placesSection=$('#placesSection'), gamesSection=$('#gamesSection');
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
  const gameViews={passion:$('#passionGameView'),direct:$('#directGameView'),randomPose:$('#randomPoseGameView')};
  const gameMeta={
    passion:{title:'🎰 Рулетка Страсті',players:true,custom:true},
    direct:{title:'🎲 Прямолінійний кубик',players:true,custom:true},
    randomPose:{title:'🎡 Випадкова поза',players:false,custom:false}
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

  const namesEls=[$('#player1Name'),$('#player2Name')],
        genderEls=[$('#player1Gender'),$('#player2Gender')],
        scoreEls=[$('#player1Score'),$('#player2Score')],
        currentName=$('#currentPlayerName'),
        currentTarget=$('#currentTargetName');

  function syncPlayers(){
    const names=getNames(), genders=getGenders(), score=getScore(), turn=getTurn(), target=(turn+1)%2;
    namesEls.forEach((el,i)=>{if(el && document.activeElement!==el) el.value=names[i]});
    genderEls.forEach((el,i)=>{if(el && document.activeElement!==el) el.value=genders[i]});
    scoreEls.forEach((el,i)=>{if(el) el.textContent=score[i]});
    if(currentName) currentName.textContent=names[turn];
    if(currentTarget) currentTarget.textContent=`→ ${names[target]}`;
    refreshBodyPools();
  }
  namesEls.forEach((el,i)=>el?.addEventListener('input',()=>{
    const n=getNames(); n[i]=el.value.trim()||`Гравець ${i+1}`; setNames(n); syncPlayers();
  }));
  genderEls.forEach((el,i)=>el?.addEventListener('change',()=>{
    const g=getGenders(); g[i]=el.value; setGenders(g); syncPlayers();
  }));
  $('#resetScoreBtn')?.addEventListener('click',()=>{setScore([0,0]);setTurn(0);syncPlayers()});

  function showTab(which){
    calendarSection.hidden=which!=='calendar'; placesSection.hidden=which!=='places'; gamesSection.hidden=which!=='games';
    calendarTabBtn.classList.toggle('active',which==='calendar'); placesTabBtn?.classList.toggle('active',which==='places'); gamesTabBtn.classList.toggle('active',which==='games');
    pairStorage.setItem('sa_main_tab_v1',which);
    if(which==='games') showGamesMenu();
    if(which==='places') renderPlaces();
  }
  calendarTabBtn?.addEventListener('click',()=>showTab('calendar'));
  placesTabBtn?.addEventListener('click',()=>showTab('places'));
  gamesTabBtn?.addEventListener('click',()=>showTab('games'));

  function showGamesMenu(){
    gamesMenu.hidden=false; gameDetail.hidden=true;
    Object.values(gameViews).forEach(v=>v && (v.hidden=true));
    if(playersPanel) playersPanel.hidden=true;
    if(rouletteCustomPanel) rouletteCustomPanel.hidden=true;
  }
  function openGame(key){
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
  }
  $$('.game-launch-card').forEach(btn=>btn.addEventListener('click',()=>openGame(btn.dataset.game)));
  backToGames?.addEventListener('click',showGamesMenu);

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
    spin(){
      if(this.busy || !this.pool.length) return Promise.reject(new Error('busy'));
      this.busy=true; this.root?.classList.add('is-spinning');
      const target=Math.floor(Math.random()*this.pool.length), sequence=[];
      for(let i=0;i<24;i++) sequence.push(this.pool[(this.current+i)%this.pool.length]);
      sequence.push(this.pool[(target-1+this.pool.length)%this.pool.length],this.pool[target],this.pool[(target+1)%this.pool.length]);
      const targetIndex=sequence.length-2; this.renderSequence(sequence,targetIndex,true);
      return new Promise(resolve=>setTimeout(()=>{
        this.current=target; this.busy=false; this.root?.classList.remove('is-spinning'); this.reset(); resolve(this.pool[target]);
      },1700));
    }
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
      saveSelectedRandomLevels(ids); updateRandomLevelSummary();
      const pool=getRandomPosePool(); if(pool.length && !pool.includes(randomPoseCurrent)) setRandomPose(pool[0]);
      if(randomPoseResultBox)randomPoseResultBox.hidden=true;
    }));
    updateRandomLevelSummary();
  }
  function updateRandomLevelSummary(){
    if(!fortuneLevelSummary)return;
    const ids=getSelectedRandomLevels(); const names=RANDOM_LEVELS.filter(x=>ids.includes(x.id)).map(x=>x.name); const count=getRandomPosePool().length;
    fortuneLevelSummary.textContent=`Обрано: ${names.join(', ')} · ${count} поз`;
  }
  $('#fortuneSelectAllLevelsBtn')?.addEventListener('click',()=>{saveSelectedRandomLevels(RANDOM_LEVELS.map(x=>x.id));renderRandomLevelFilter();if(randomPoseResultBox)randomPoseResultBox.hidden=true;});
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
  $('#randomPoseSpinBtn')?.addEventListener('click',async e=>{
    const pool=getRandomPosePool();
    if(randomPoseBusy||!pool.length)return;
    const button=e.currentTarget; randomPoseBusy=true; if(button)button.disabled=true; if(randomPoseResultBox)randomPoseResultBox.hidden=true;
    try{
      // Decode the selected pose set before the animation starts. This prevents
      // blank/flickering frames while the center image is changing rapidly.
      await preloadPosePool(pool);
      const target=pool[Math.floor(Math.random()*pool.length)];
      fortuneTurns+=5+Math.floor(Math.random()*3);
      if(fortuneWheelRotor){ fortuneWheelRotor.style.transition='transform 3.15s cubic-bezier(.08,.72,.08,1)'; fortuneWheelRotor.style.transform=`rotate(${fortuneTurns*360 + Math.floor(Math.random()*340)}deg)`; }
      const frames=[...pool].sort(()=>Math.random()-.5);
      let frameIndex=0;
      const start=performance.now(), duration=3050;
      await new Promise(resolve=>{
        const tick=now=>{
          const t=Math.min(1,(now-start)/duration); const delay=55+Math.floor(210*t*t);
          const item=frames[frameIndex++%frames.length];
          setRandomPose(item);
          if(t>=1){resolve();return} setTimeout(()=>requestAnimationFrame(tick),delay);
        }; requestAnimationFrame(tick);
      });
      setRandomPose(target);
      if(randomPoseResultIndex)randomPoseResultIndex.textContent=`Поза ${target.order_index}`;
      if(randomPoseResult)randomPoseResult.textContent=target.poseTitle || (`Поза ${target.order_index}`);
      if(randomPoseDescription)randomPoseDescription.textContent=target.poseDescription || '';
      if(randomPoseResultBox)randomPoseResultBox.hidden=false;
    }finally{
      randomPoseBusy=false; if(button)button.disabled=false;
    }
  });
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
    if(turnLabelEl) turnLabelEl.textContent=`${names[turn]} → ${names[target]}`;
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
  $('#passionRollBtn')?.addEventListener('click',async e=>{
    if(rolling)return;
    const button=e.currentTarget; // currentTarget стає null після await у деяких браузерах/file://
    rolling=true; if(button) button.disabled=true; if(pbox) pbox.hidden=true;
    refreshBodyPools();
    try{
      const [action,body]=await Promise.all([passionActionSlot.spin(),passionBodySlot.spin()]);
      showResult('passion',`${action} — ${body}`,$('#passionTurnLabel'),$('#passionResult'),pbox);
    } catch(err) {
      console.error(err);
    } finally {
      rolling=false; if(button) button.disabled=false;
    }
  });
  $('#passionDoneBtn')?.addEventListener('click',()=>{resolveResult(true);if(pbox)pbox.hidden=true});
  $('#passionNoBtn')?.addEventListener('click',()=>{resolveResult(false);if(pbox)pbox.hidden=true});

  $$('#directActionChoice .choice-btn').forEach(btn=>btn.addEventListener('click',()=>{
    $$('#directActionChoice .choice-btn').forEach(x=>x.classList.remove('active')); btn.classList.add('active'); directAction=btn.dataset.action;
  }));
  const dbox=$('#directResultBox');
  $('#directRollBtn')?.addEventListener('click',async e=>{
    if(rolling)return;
    const button=e.currentTarget;
    rolling=true; if(button) button.disabled=true; if(dbox) dbox.hidden=true;
    refreshBodyPools();
    try{
      const body=await directBodySlot.spin();
      showResult('direct',`${directAction} — ${body}`,$('#directTurnLabel'),$('#directResult'),dbox);
    } catch(err) {
      console.error(err);
    } finally {
      rolling=false; if(button) button.disabled=false;
    }
  });
  $('#directDoneBtn')?.addEventListener('click',()=>{resolveResult(true);if(dbox)dbox.hidden=true});
  $('#directNoBtn')?.addEventListener('click',()=>{resolveResult(false);if(dbox)dbox.hidden=true});

  function refreshPairUI(){ if(!PairDB.active) return; syncPlayers(); renderPlaces(); renderCustomOptions(); const t=pairStorage.getItem('sa_main_tab_v1'); showTab(['calendar','places','games'].includes(t)?t:'calendar'); }
  document.addEventListener('pair:changed', refreshPairUI);
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
