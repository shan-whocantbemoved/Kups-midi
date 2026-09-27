(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const KEYS = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const COLORS = ['#8bdcff','#d4a8ff','#e9ca78','#7cdbad','#ff9e83','#a6b5ff'];
  const DB_NAME = 'blue-note-performance';
  const DB_VERSION = 2;
  const state = { setlists: [], mappings: [], settings: { theme: 'dark', defaultMidiChannel: 1, keyDisplay: 'sharps' }, currentSet: null, currentSong: null, dirty: false, midi: null, learnTimer: null, selectedMap: null, sceneIndex: -1, tapTimes: [], audio: null, oscillators: [], filter: null, ambientOn: false, ambientExpanded: false, ambientKey: 'C', toastTimer: null };
  let db;

  function openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains('setlists')) database.createObjectStore('setlists', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('mappings')) database.createObjectStore('mappings', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('meta')) database.createObjectStore('meta', { keyPath: 'key' });
        if (!database.objectStoreNames.contains('packs')) database.createObjectStore('packs', { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  function store(name, mode = 'readonly') { return db.transaction(name, mode).objectStore(name); }
  function getAll(name) { return new Promise((resolve, reject) => { const req = store(name).getAll(); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); }); }
  function put(name, value) { return new Promise((resolve, reject) => { const req = store(name, 'readwrite').put(value); req.onsuccess = () => resolve(); req.onerror = () => reject(req.error); }); }
  function remove(name, key) { return new Promise((resolve, reject) => { const req = store(name, 'readwrite').delete(key); req.onsuccess = () => resolve(); req.onerror = () => reject(req.error); }); }
  function clearStore(name) { return new Promise((resolve, reject) => { const req = store(name, 'readwrite').clear(); req.onsuccess = () => resolve(); req.onerror = () => reject(req.error); }); }
  const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const now = () => new Date().toISOString();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
  function cleanName(value) { return String(value || '').trim().slice(0, 60); }
  function clamp(value, min, max) { return Math.min(max, Math.max(min, Math.round(Number(value) || min))); }
  function markDirty() { state.dirty = true; updateSaveButtons(); }
  function updateSaveButtons() { $('#save-performance').disabled = !state.dirty; $('#save-performance').textContent = state.dirty ? 'Save set' : 'Saved'; $('#detail-save').disabled = !state.dirty; }
  async function persistSet() {
    if (!state.currentSet) return;
    state.currentSet.updatedAt = now();
    await put('setlists', state.currentSet);
    state.dirty = false;
    updateSaveButtons();
    renderDashboard();
    toast('Set saved', 'success');
  }
  function activeSong() { return state.currentSet?.songs.find(song => song.id === state.currentSong) || null; }
  function toast(message, type = '', action) {
    const element = document.createElement('div');
    element.className = `toast ${type}`;
    element.textContent = message;
    if (action) { const button = document.createElement('button'); button.textContent = action.label; button.onclick = () => { action.run(); element.remove(); }; element.append(button); }
    $('#toast-region').append(element);
    setTimeout(() => element.remove(), 4300);
  }
  function confirmDialog(title, message, confirmLabel = 'Confirm') {
    return showDialog({ title, content: `<p class="form-note">${esc(message)}</p>`, submit: confirmLabel, danger: true }).then(result => result === 'confirm');
  }
  function showDialog({ title, content, submit = 'Done', kicker = 'BLUE NOTE', hideSubmit = false, danger = false, onOpen } = {}) {
    const dialog = $('#dialog');
    $('#dialog-title').textContent = title || '';
    $('#dialog-kicker').textContent = kicker;
    $('#dialog-content').innerHTML = content || '';
    $('#dialog-submit').textContent = submit;
    $('#dialog-submit').classList.toggle('danger-button', danger);
    $('#dialog-submit').hidden = hideSubmit;
    $('#dialog-cancel').hidden = hideSubmit;
    dialog.returnValue = 'cancel';
    return new Promise(resolve => {
      dialog.addEventListener('close', () => resolve(dialog.returnValue), { once: true });
      dialog.showModal();
      onOpen?.();
    });
  }
  function newSong(name = 'New patch') { return { id: uid(), name, key: 'C', bpm: 120, volume: 80, layers: [], scenes: [], note: '', updatedAt: now() }; }
  function newLayer(name, type = 'instrument') { return { id: uid(), name, type, level: 80, muted: false, soloed: false, locked: false }; }

  function renderDashboard() {
    const list = [...state.setlists].sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
    const recent = $('#recent-list');
    if (!list.length) { recent.innerHTML = '<div class="empty-state">No setlists yet. Create one and your next performance will be right here.</div>'; return; }
    recent.innerHTML = list.slice(0, 8).map((set, i) => `<button class="recent-card" data-open-set="${esc(set.id)}" style="--card-accent:${COLORS[i%COLORS.length]}"><strong>${esc(set.name)}</strong><small>${esc(set.description || 'Performance set')}</small><span class="recent-meta"><span>${set.songs.length} ${set.songs.length === 1 ? 'patch' : 'patches'}</span><span>${relativeTime(set.updatedAt)}</span></span></button>`).join('');
  }
  function relativeTime(value) {
    const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
    if (elapsed < 60_000) return 'just now';
    if (elapsed < 3_600_000) return `${Math.floor(elapsed/60_000)}m ago`;
    if (elapsed < 86_400_000) return `${Math.floor(elapsed/3_600_000)}h ago`;
    return new Date(value).toLocaleDateString(undefined, { month:'short', day:'numeric' });
  }
  async function createSetlist() {
    const result = await showDialog({ title: 'New setlist', submit: 'Create setlist', content: `<label class="form-field"><span>SETLIST NAME</span><input id="set-name-input" maxlength="60" required placeholder="Friday at The Lantern" autocomplete="off"></label><label class="form-field"><span>DESCRIPTION <small>(OPTIONAL)</small></span><textarea id="set-description" maxlength="220" placeholder="Room, run of show, or notes"></textarea></label><p id="duplicate-warning" class="form-note"></p>` , onOpen: () => $('#set-name-input').focus() });
    if (result !== 'confirm') return;
    const name = cleanName($('#set-name-input').value);
    if (!name) { toast('Give this setlist a name first', 'error'); return createSetlist(); }
    if (state.setlists.some(set => set.name.toLowerCase() === name.toLowerCase())) toast('A setlist with that name already exists. This name is still allowed.');
    const set = { id: uid(), name, description: $('#set-description').value.trim(), createdAt: now(), updatedAt: now(), songs: [] };
    state.setlists.push(set); await put('setlists', set); localStorage.setItem('lastSetlistId', set.id); renderDashboard(); openPerformance(set.id);
  }
  function showSetlists() {
    const content = `<div class="sort-row"><input id="setlist-search" type="search" placeholder="Search setlists" aria-label="Search setlists"><select id="setlist-sort" aria-label="Sort setlists"><option value="recent">Recent</option><option value="az">A–Z</option></select></div><div id="setlist-results" class="dialog-list"></div>`;
    showDialog({ title: 'Open a setlist', submit: 'Done', hideSubmit: true, content, onOpen: renderSetlistPicker }).then(() => {});
  }
  function renderSetlistPicker() {
    const results = $('#setlist-results'); if (!results) return;
    const query = ($('#setlist-search')?.value || '').toLowerCase();
    const sets = [...state.setlists].filter(set => set.name.toLowerCase().includes(query));
    sets.sort($('#setlist-sort')?.value === 'az' ? (a,b) => a.name.localeCompare(b.name) : (a,b) => b.updatedAt.localeCompare(a.updatedAt));
    results.innerHTML = sets.length ? sets.map(set => `<div class="dialog-set-row"><button class="dialog-set-main" data-open-set="${esc(set.id)}"><strong>${esc(set.name)}</strong><small>${set.songs.length} songs · updated ${new Date(set.updatedAt).toLocaleDateString()}</small></button><button class="row-menu" data-set-menu="${esc(set.id)}" aria-label="Setlist actions">•••</button></div>`).join('') : '<div class="empty-state">No matching setlists.</div>';
  }
  async function manageSet(id) {
    const set = state.setlists.find(item => item.id === id); if (!set) return;
    const action = await showDialog({ title: set.name, kicker: 'SETLIST ACTIONS', content: `<div class="dialog-list"><button type="button" class="outline-button" data-set-action="rename">Rename setlist</button><button type="button" class="outline-button" data-set-action="duplicate">Duplicate setlist</button><button type="button" class="outline-button" data-set-action="delete">Delete setlist</button></div>`, submit: 'Done', onOpen: () => $$('[data-set-action]').forEach(button => button.addEventListener('click', () => $('#dialog').close(button.dataset.setAction))) });
    if (action === 'rename') await renameSet(set);
    if (action === 'duplicate') await duplicateSet(set);
    if (action === 'delete' && await confirmDialog('Delete setlist?', `Delete “${set.name}” and its songs? This cannot be undone.`, 'Delete')) { state.setlists = state.setlists.filter(item => item.id !== id); await remove('setlists', id); renderDashboard(); renderSetlistPicker(); toast('Setlist deleted'); }
  }
  async function renameSet(set) {
    const result = await showDialog({ title: 'Rename setlist', submit: 'Save name', content: `<label class="form-field"><span>NAME</span><input id="rename-value" maxlength="60" value="${esc(set.name)}" required></label>` });
    if (result !== 'confirm') return;
    const name = cleanName($('#rename-value').value); if (!name) return toast('Name cannot be empty', 'error');
    set.name = name; set.updatedAt = now(); await put('setlists', set); if (state.currentSet?.id === set.id) { state.currentSet = set; renderPerformance(); } renderDashboard(); renderSetlistPicker(); toast('Setlist renamed');
  }
  async function duplicateSet(set) {
    const copy = structuredClone(set); copy.id = uid(); copy.name = `${set.name} copy`.slice(0,60); copy.createdAt = now(); copy.updatedAt = now(); copy.songs = copy.songs.map(song => ({ ...song, id: uid(), layers: song.layers.map(layer => ({ ...layer, id: uid() })), scenes: song.scenes.map(scene => ({ ...scene, id: uid() })) }));
    state.setlists.push(copy); await put('setlists', copy); renderDashboard(); renderSetlistPicker(); toast('Setlist duplicated');
  }
  async function openPerformance(id) {
    if (state.currentSet?.id === id) { $('#dashboard').classList.add('is-hidden'); $('#performance').classList.remove('is-hidden'); renderPerformance(); return; }
    if (state.dirty && !await unsavedGuard()) return;
    const set = state.setlists.find(item => item.id === id); if (!set) return;
    state.currentSet = set; state.currentSong = set.songs[0]?.id || null; state.sceneIndex = -1; localStorage.setItem('lastSetlistId', id);
    $('#dashboard').classList.add('is-hidden'); $('#performance').classList.remove('is-hidden'); $('#top-context').textContent = 'LIVE PERFORMANCE'; renderPerformance();
  }
  async function unsavedGuard() {
    const result = await showDialog({ title: 'Unsaved changes', hideSubmit: true, content: '<p class="form-note">Save your current performance before switching sets?</p><div class="dialog-list"><button type="button" class="outline-button" data-guard="save">Save changes</button><button type="button" class="outline-button" data-guard="discard">Discard changes</button><button type="button" class="outline-button" data-guard="stay">Keep performing</button></div>', onOpen: () => $$('[data-guard]').forEach(button => button.addEventListener('click', () => $('#dialog').close(button.dataset.guard))) });
    if (result === 'save') { await persistSet(); return true; }
    if (result === 'discard') { state.dirty = false; updateSaveButtons(); return true; }
    return false;
  }
  function leavePerformance() {
    if (!state.dirty) { closePerformance(); return; }
    showDialog({ title: 'Unsaved changes', hideSubmit: true, content: '<p class="form-note">Save changes before closing, discard them, or keep performing.</p><div class="dialog-list"><button type="button" class="outline-button" data-guard="save">Save and close</button><button type="button" class="outline-button" data-guard="discard">Discard changes</button><button type="button" class="outline-button" data-guard="stay">Keep performing</button></div>', onOpen: () => $$('[data-guard]').forEach(button => button.addEventListener('click', () => $('#dialog').close(button.dataset.guard))) }).then(async result => {
      if (result === 'save') { await persistSet(); closePerformance(); }
      if (result === 'discard') { state.dirty = false; closePerformance(); }
    });
  }
  function closePerformance() { state.currentSet = null; state.currentSong = null; state.dirty = false; $('#performance').classList.add('is-hidden'); $('#dashboard').classList.remove('is-hidden'); $('#top-context').textContent = 'MIDI SETLIST PERFORMANCE'; renderDashboard(); }
  function renderPerformance() {
    if (!state.currentSet) return;
    const set = state.currentSet, song = activeSong();
    $('#performance-setname').textContent = set.name.toUpperCase(); $('#detail-setname').textContent = set.name; $('#editable-setname').textContent = set.name;
    $('#performance-songname').textContent = song?.name || 'Choose a song'; $('#detail-songname').textContent = song?.name || 'Choose a song';
    $('#song-count').textContent = `${set.songs.length} ${set.songs.length === 1 ? 'song' : 'songs'}`;
    const query = ($('#song-search').value || '').toLowerCase();
    const songs = set.songs.filter(item => item.name.toLowerCase().includes(query));
    $('#song-list').innerHTML = songs.length ? songs.map(songItem => `<button class="song-row ${songItem.id === state.currentSong ? 'active' : ''}" data-song="${esc(songItem.id)}"><span class="song-index">${String(set.songs.indexOf(songItem)+1).padStart(2,'0')}</span><span class="song-info"><strong>${esc(songItem.name)}</strong><small>${songItem.bpm} BPM · ${songItem.layers.length} layers</small></span><span class="song-key">${esc(songItem.key)}</span></button>`).join('') : set.songs.length ? '<div class="empty-state">No songs match your search.</div>' : '<div class="empty-state">No patches in this set yet. Add a patch to begin.</div>';
    if (song) {
      $('#key-value').textContent = displayKey(song.key); $('#song-bpm').textContent = song.bpm; $('#bpm-entry').value = song.bpm; $('#tempo-value').textContent = song.bpm;
      $('#song-volume').textContent = `${song.volume}%`; $('#song-volume-slider').value = song.volume; $('#song-note').value = song.note || '';
      $('#master-volume').value = song.volume; $('#master-output').value = `${song.volume}%`;
      $('#detail-layer-count').textContent = song.layers.length; $('#layer-total').textContent = song.layers.length;
      $('#detail-layers').innerHTML = layerMarkup(song, true); $('#sidebar-layers').innerHTML = layerMarkup(song, false);
      $('#key-options').innerHTML = KEYS.map(key => `<button data-key="${key}" class="${key === song.key ? 'selected' : ''}">${displayKey(key)}</button>`).join('');
      $('#pad-layer-toggle').setAttribute('aria-pressed', song.layers.some(layer => layer.type === 'pad' && !layer.muted) ? 'true' : 'false');
      const scenes = song.scenes || [];
      $('#scene-list').innerHTML = scenes.map((scene,i) => `<span class="scene-item"><button class="scene-chip ${i === state.sceneIndex ? 'active' : ''}" data-scene="${esc(scene.id)}">${esc(scene.name)}</button><button class="scene-delete" data-delete-scene="${esc(scene.id)}" aria-label="Delete ${esc(scene.name)}">×</button></span>`).join('') || '<span class="empty-small">No snapshots</span>';
      $('#scene-position').textContent = scenes.length ? `Scene ${Math.max(1,state.sceneIndex+1)} of ${scenes.length}` : 'No scenes';
    } else {
      $('#detail-layer-count').textContent = '0'; $('#layer-total').textContent = '0'; $('#detail-layers').innerHTML = '<div class="empty-state">Add a patch to start building its sound stack.</div>'; $('#sidebar-layers').innerHTML = '<div class="empty-small">Choose a song or add a patch.</div>'; $('#scene-list').innerHTML = '<span class="empty-small">No snapshots</span>'; $('#scene-position').textContent = 'No scenes';
    }
    renderDevices(); renderMappings(); updateSaveButtons();
  }
  function displayKey(key) { if (state.settings.keyDisplay !== 'flats') return key; return ({'C#':'Db','D#':'Eb','F#':'Gb','G#':'Ab','A#':'Bb'})[key] || key; }
  function layerMarkup(song, detailed) {
    if (!song.layers.length) return '<div class="empty-small">No layers yet. Add an instrument layer.</div>';
    return song.layers.map((layer,index) => `<div class="layer-row" data-layer-row="${esc(layer.id)}" style="--layer-color:${COLORS[index%COLORS.length]}"><span class="layer-color"></span><span class="layer-name" title="${esc(layer.name)}">${esc(layer.name)}${layer.locked?' 🔒':''}</span><button class="layer-button" data-layer-action="mute" data-layer="${esc(layer.id)}" aria-label="Mute ${esc(layer.name)}" aria-pressed="${layer.muted}">M</button><button class="layer-button" data-layer-action="solo" data-layer="${esc(layer.id)}" aria-label="Solo ${esc(layer.name)}" aria-pressed="${layer.soloed}">S</button><input type="range" min="0" max="100" value="${layer.level}" data-layer-level="${esc(layer.id)}" aria-label="${esc(layer.name)} level"><span class="layer-level">${layer.level}%</span>${detailed?`<button class="layer-button" data-layer-action="up" data-layer="${esc(layer.id)}" aria-label="Move ${esc(layer.name)} earlier">↑</button><button class="layer-button layer-remove" data-layer-action="remove" data-layer="${esc(layer.id)}" aria-label="Remove ${esc(layer.name)}">×</button>`:''}</div>`).join('');
  }
  async function addSong() {
    const packs = await getAll('packs');
    const presets = packs.flatMap(pack => pack.patches.map((patch,index) => ({ packName:pack.name, patch,index })));
    const importOptions = presets.map((item,index) => `<option value="${index}">${esc(item.patch.name)} · ${esc(item.packName)}</option>`).join('');
    const result = await showDialog({ title: 'Add a patch', submit: 'Add patch', content: `<label class="form-field"><span>PATCH NAME</span><input id="patch-name" maxlength="60" required placeholder="Warm piano"></label><div class="sort-row"><label class="form-field" style="flex:1"><span>KEY</span><select id="patch-key">${KEYS.map(key=>`<option>${key}</option>`).join('')}</select></label><label class="form-field" style="flex:1"><span>BPM</span><input id="patch-bpm" type="number" min="20" max="300" value="120"></label></div>${presets.length?`<label class="form-field"><span>IMPORT INSTALLED PRESET</span><select id="preset-import"><option value="">Start from scratch</option>${importOptions}</select></label>`:''}` });
    if (result !== 'confirm') return;
    const name = cleanName($('#patch-name').value); if (!name) return toast('Patch name is required', 'error');
    const song = newSong(name); song.key = $('#patch-key').value; song.bpm = clamp($('#patch-bpm').value,20,300);
    const presetIndex = Number($('#preset-import')?.value); if ($('#preset-import')?.value !== '') { const preset=presets[presetIndex]?.patch; if(preset){song.key=preset.key||song.key;song.bpm=clamp(preset.bpm||song.bpm,20,300);song.layers=preset.layers.map(layer=>({...newLayer(layer.name,layer.type),level:clamp(layer.level??80,0,100)}));} }
    state.currentSet.songs.push(song); state.currentSong = song.id; state.currentSet.updatedAt = now(); markDirty(); renderPerformance();
  }
  async function addLayer() {
    const song = activeSong(); if (!song) return toast('Add a patch before adding sound layers');
    const result = await showDialog({ title: 'Add a layer', submit: 'Add layer', content: `<label class="form-field"><span>LAYER NAME</span><input id="layer-name" maxlength="60" required placeholder="Grand piano"></label><label class="form-field"><span>TYPE</span><select id="layer-type"><option value="instrument">Instrument</option><option value="pad">Pad layer (patch)</option><option value="strings">Strings</option><option value="keys">Keys</option><option value="other">Other</option></select></label>` });
    if (result !== 'confirm') return;
    const name = cleanName($('#layer-name').value); if (!name) return toast('Layer name is required', 'error');
    song.layers.push(newLayer(name,$('#layer-type').value)); markDirty(); renderPerformance();
  }
  async function addScene() {
    const song = activeSong(); if (!song) return toast('Choose a patch before saving a scene');
    const next = (song.scenes?.length || 0) + 1;
    const result = await showDialog({ title: 'Snapshot this mix', submit: 'Save scene', content: `<label class="form-field"><span>SCENE NAME</span><input id="scene-name" maxlength="60" value="Scene ${next}" required></label><p class="form-note">The current layer levels, mute, and solo states will be captured.</p>` });
    if (result !== 'confirm') return;
    const name = cleanName($('#scene-name').value); if (!name) return toast('Scene name is required', 'error');
    song.scenes ||= []; song.scenes.push({ id: uid(), name, layerSnapshot: structuredClone(song.layers), midiTrigger: null }); state.sceneIndex = song.scenes.length-1; markDirty(); renderPerformance(); toast('Scene snapshot saved', 'success');
  }
  function recallScene(id) {
    const song = activeSong(); const index = song?.scenes.findIndex(scene => scene.id === id) ?? -1; if (index < 0) return;
    song.layers = structuredClone(song.scenes[index].layerSnapshot); state.sceneIndex = index; markDirty(); renderPerformance(); toast(`Recalled ${song.scenes[index].name}`);
  }
  async function deleteScene(id) {
    const song = activeSong(); const scene = song?.scenes.find(item=>item.id===id); if (!scene) return;
    if (!await confirmDialog('Delete scene?', `Delete “${scene.name}”?`, 'Delete')) return;
    song.scenes = song.scenes.filter(item=>item.id!==id); state.sceneIndex = Math.min(state.sceneIndex,song.scenes.length-1); markDirty(); renderPerformance();
  }
  function updateTempo(amount) {
    const song = activeSong(); if (!song) return;
    song.bpm = clamp(song.bpm + amount,20,300); $('#song-bpm').textContent=song.bpm; $('#tempo-value').textContent=song.bpm; $('#bpm-entry').value=song.bpm; markDirty();
  }
  function tapTempo() {
    const time = performance.now(); state.tapTimes = state.tapTimes.filter(t=>time-t<2500); state.tapTimes.push(time);
    if (state.tapTimes.length < 2) return toast('Tap again to set tempo');
    const gaps = state.tapTimes.slice(1).map((tap,i)=>tap-state.tapTimes[i]); const average = gaps.reduce((a,b)=>a+b,0)/gaps.length;
    const song=activeSong(); if (!song) return toast('Choose a patch before setting tempo');
    song.bpm=clamp(60000/average,20,300); $('#song-bpm').textContent=song.bpm; $('#tempo-value').textContent=song.bpm; $('#bpm-entry').value=song.bpm; markDirty();
  }
  async function midiLearn() {
    const button=$('#learn-toggle'), status=$('#learn-status');
    if (button.classList.contains('active')) { stopLearning('Learning cancelled.'); return; }
    if (!state.midi) { await requestMidi(); }
    button.classList.add('active'); button.setAttribute('aria-pressed','true'); $('kbd',button).textContent='ON';
    status.innerHTML=`<select id="learn-target" aria-label="Choose control to learn"><option value="master">Master volume</option>${(state.currentSet?.songs||[]).map(song=>`<optgroup label="${esc(song.name)}">${song.layers.map(layer=>`<option value="layer:${esc(layer.id)}">Layer: ${esc(layer.name)}</option>`).join('')}${song.scenes.map(scene=>`<option value="scene:${esc(scene.id)}">Scene: ${esc(scene.name)}</option>`).join('')}</optgroup>`).join('')}</select><span>Move a hardware control…</span>`;
    state.learnTimer=setTimeout(()=>stopLearning('Learn timed out. Try again.'),7000);
  }
  function stopLearning(message) { clearTimeout(state.learnTimer); state.learnTimer=null; $('#learn-toggle').classList.remove('active'); $('#learn-toggle').setAttribute('aria-pressed','false'); $('kbd',$('#learn-toggle')).textContent='OFF'; $('#learn-status').textContent=message; }
  async function receiveMidi(event) {
    const [status,data1,data2]=event.data; const command=status&0xf0; const channel=(status&0x0f)+1;
    if (state.learnTimer && [0x80,0x90,0xb0].includes(command)) {
      const target=$('#learn-target')?.value || 'master';
      const duplicate=state.mappings.find(mapping=>mapping.deviceId===event.target.id&&mapping.channel===channel&&mapping.command===command&&mapping.number===data1);
      if (duplicate && duplicate.target!==target && !await confirmDialog('Overwrite mapping?', 'This control is already assigned. Replace the existing mapping?', 'Overwrite')) { stopLearning('Learn cancelled.'); return; }
      if (duplicate) state.mappings=state.mappings.filter(mapping=>mapping.id!==duplicate.id);
      state.mappings.push({ id:uid(), deviceId:event.target.id, deviceName:event.target.name, channel, command, number:data1, target }); stopLearning('Control learned. Save mappings to keep it.'); renderMappings(); markDirty(); toast('MIDI control learned','success'); return;
    }
    const mapping=state.mappings.find(item=>item.deviceId===event.target.id&&item.channel===channel&&item.command===command&&item.number===data1); if (!mapping) return;
    const value=command===0xb0?data2/127:((command===0x90&&data2>0)?1:0);
    if (mapping.target==='master'&&command===0xb0) { $('#master-volume').value=Math.round(value*100); $('#master-output').value=`${Math.round(value*100)}%`; }
    if (mapping.target.startsWith('layer:')) { const layer=activeSong()?.layers.find(item=>item.id===mapping.target.slice(6)); if (layer&&command===0xb0) { layer.level=Math.round(value*100); markDirty(); renderPerformance(); } }
    if (mapping.target.startsWith('scene:')&&(command===0x90&&data2>0)) recallScene(mapping.target.slice(6));
  }
  async function requestMidi() {
    if (!navigator.requestMIDIAccess) { renderDevices(); toast('Web MIDI is unavailable in this browser. On-screen controls still work.'); return; }
    try { state.midi=await navigator.requestMIDIAccess({sysex:false}); state.midi.onstatechange=renderDevices; for (const input of state.midi.inputs.values()) input.onmidimessage=receiveMidi; renderDevices(); }
    catch { renderDevices(); toast('MIDI permission was denied. Check browser permissions in Settings.'); }
  }
  function renderDevices() {
    const inputs=state.midi?[...state.midi.inputs.values()]:[]; const connected=inputs.filter(input=>input.state==='connected');
    $('#device-count').textContent=connected.length; const markup=connected.map(input=>`<div class="device-row"><i class="status-dot ${input.connection==='open'?'active':''}"></i><span>${esc(input.name||'MIDI device')}</span></div>`).join('')||'<div class="empty-small">No devices connected.</div>';
    $('#device-popover').innerHTML=`<div class="popover-title">CONNECTED MIDI DEVICES</div>${markup}`; $('#sidebar-devices').innerHTML=markup;
    if (state.midi) for (const input of state.midi.inputs.values()) input.onmidimessage=receiveMidi;
  }
  function renderMappings() {
    $('#mapping-list').innerHTML=state.mappings.slice(0,4).map(mapping=>`<div class="mapping-row"><span>${esc(mapping.target.split(':')[0])}</span><span>CH ${mapping.channel} · ${mapping.command===0xb0?'CC':'NOTE'} ${mapping.number}</span></div>`).join('')||'<span>No saved mappings</span>';
  }
  async function saveMappings() { await put('mappings',{ id:'all', items:state.mappings }); if (state.currentSet) await put('setlists',state.currentSet); state.dirty=false; updateSaveButtons(); toast('Mappings and layers saved','success'); }
  async function deleteSelectedMapping() {
    if (!state.mappings.length) return toast('No MIDI mappings to delete');
    const options=state.mappings.map((mapping,index)=>`<option value="${index}">${esc(mapping.deviceName||'Device')} · CH ${mapping.channel} · ${mapping.command===0xb0?'CC':'NOTE'} ${mapping.number} → ${esc(mapping.target)}</option>`).join('');
    const result=await showDialog({title:'Delete MIDI mapping',submit:'Delete mapping',content:`<label class="form-field"><span>SELECT MAPPING</span><select id="mapping-select">${options}</select></label>`}); if(result!=='confirm')return;
    state.mappings.splice(Number($('#mapping-select').value),1); markDirty(); renderMappings();
  }
  function setKey(key) { const song=activeSong(); if (!song) return; song.key=key; $('#key-value').textContent=displayKey(key); $('#key-options').hidden=true; markDirty(); renderPerformance(); }
  function playReference() {
    const song=activeSong(); if(!song)return toast('Load a patch before hearing a reference key');
    try { const Audio=window.AudioContext||window.webkitAudioContext; state.audio ||= new Audio(); state.audio.resume(); const index=KEYS.indexOf(song.key); const oscillator=state.audio.createOscillator(), gain=state.audio.createGain(); oscillator.frequency.value=440*Math.pow(2,(index-9)/12); oscillator.type='sine'; gain.gain.setValueAtTime(.0001,state.audio.currentTime); gain.gain.exponentialRampToValueAtTime(.17,state.audio.currentTime+.04); gain.gain.exponentialRampToValueAtTime(.0001,state.audio.currentTime+.7); oscillator.connect(gain).connect(state.audio.destination); oscillator.start(); oscillator.stop(state.audio.currentTime+.72); }
    catch { toast('Audio playback is not available in this browser.', 'error'); }
  }
  async function startAmbient() {
    const Audio=window.AudioContext||window.webkitAudioContext; if(!Audio)return toast('Audio playback is not available.');
    state.audio ||= new Audio(); await state.audio.resume(); const context=state.audio, nowTime=context.currentTime;
    state.filter=context.createBiquadFilter(); state.filter.type='lowpass'; state.filter.frequency.value=Number($('#tone-control').value); state.filter.connect(context.destination);
    state.oscillators=[]; const root=KEYS.indexOf($('#ambient-key').value); [0,7,12,19].forEach((step,index)=>{const osc=context.createOscillator(),gain=context.createGain();osc.type=index===0?'sine':'triangle';osc.frequency.value=65.406*Math.pow(2,(root+step)/12);gain.gain.value=[.12,.045,.035,.025][index];osc.connect(gain).connect(state.filter);osc.start();state.oscillators.push({osc,gain});});
    const attack=Number($('#attack-control').value); for(const item of state.oscillators){item.gain.gain.setValueAtTime(.0001,nowTime);item.gain.gain.exponentialRampToValueAtTime([.12,.045,.035,.025][state.oscillators.indexOf(item)],nowTime+Math.max(.02,attack));}
    state.ambientOn=true; $('#ambient-power').classList.add('on'); $('#ambient-power').setAttribute('aria-pressed','true'); $('#ambient-power').setAttribute('aria-label','Turn ambient pad off'); $('#ambient-status').textContent=`ON · ${$('#ambient-key').value} drone`;
  }
  function stopAmbient() {
    if(state.audio&&state.oscillators.length){const stopAt=state.audio.currentTime+Number($('#release-control').value);for(const item of state.oscillators){item.gain.gain.cancelScheduledValues(state.audio.currentTime);item.gain.gain.setTargetAtTime(.0001,state.audio.currentTime,Number($('#release-control').value)/4);item.osc.stop(stopAt+.15);}state.oscillators=[];}
    state.ambientOn=false;$('#ambient-power').classList.remove('on');$('#ambient-power').setAttribute('aria-pressed','false');$('#ambient-power').setAttribute('aria-label','Turn ambient pad on');$('#ambient-status').textContent='OFF · standalone drone';
  }
  function toggleAmbient() { if(state.ambientOn)stopAmbient();else startAmbient(); }
  function openSettings() {
    const usage=JSON.stringify(state.setlists).length;
    showDialog({title:'Settings',submit:'Done',content:`<div class="dialog-settings"><label class="setting-row"><span>Key display</span><select id="setting-key"><option value="sharps">Sharps (C#)</option><option value="flats">Flats (Db)</option></select></label><label class="setting-row"><span>Default MIDI channel</span><select id="setting-channel">${Array.from({length:16},(_,i)=>`<option value="${i+1}">${i+1}</option>`).join('')}</select></label><label class="setting-row"><span>Theme</span><select id="setting-theme"><option value="dark">Stage dark</option></select></label><p class="form-note">Local setlist data: ${(usage/1024).toFixed(1)} KB · App version 1.0.0</p><button id="clear-cache" type="button" class="outline-button">Clear offline cache…</button><button id="clear-data" type="button" class="outline-button">Clear local setlists…</button><p class="form-note">About Blue Note: offline-first setlist and MIDI performance control.</p></div>`,onOpen:()=>{$('#setting-key').value=state.settings.keyDisplay;$('#setting-channel').value=state.settings.defaultMidiChannel;$('#setting-theme').value=state.settings.theme;$('#clear-cache').addEventListener('click',()=>$('#dialog').close('clear-cache'));$('#clear-data').addEventListener('click',()=>$('#dialog').close('clear-data'));}}).then(async result=>{if(result==='confirm'){state.settings.keyDisplay=$('#setting-key').value;state.settings.defaultMidiChannel=Number($('#setting-channel').value);state.settings.theme=$('#setting-theme').value;localStorage.setItem('settings',JSON.stringify(state.settings));renderPerformance();}if(result==='clear-cache'&&await confirmDialog('Clear offline cache?','The app shell and downloaded packs will be removed from this browser.','Continue')&&await confirmDialog('Confirm cache removal','Offline use will require opening the app online once more. Clear the cache?','Clear cache')){await Promise.all((await caches.keys()).map(key=>caches.delete(key)));toast('Offline cache cleared');}if(result==='clear-data'&&await confirmDialog('Clear local setlists?','All saved setlists and MIDI mappings will be permanently deleted.','Continue')&&await confirmDialog('Confirm deletion','This cannot be undone. Clear all local performance data?','Delete all')){await Promise.all(['setlists','mappings','packs'].map(clearStore));state.setlists=[];state.mappings=[];localStorage.removeItem('lastSetlistId');toast('Local data cleared');location.reload();}});
  }
  function bindEvents() {
    document.addEventListener('click',async event=>{
      const target=event.target.closest('button'); if(!target)return;
      if(target.dataset.openSet){$('#dialog').close();openPerformance(target.dataset.openSet);}
      if(target.dataset.setMenu)manageSet(target.dataset.setMenu);
      if(target.dataset.song){state.currentSong=target.dataset.song;state.sceneIndex=-1;renderPerformance();}
      if(target.dataset.key)setKey(target.dataset.key);
      if(target.dataset.scene)recallScene(target.dataset.scene);
      if(target.dataset.deleteScene)deleteScene(target.dataset.deleteScene);
      if(target.dataset.layerAction){const song=activeSong();const layer=song?.layers.find(item=>item.id===target.dataset.layer);if(!layer)return;const action=target.dataset.layerAction;if(action==='mute')layer.muted=!layer.muted;if(action==='solo')layer.soloed=!layer.soloed;if(action==='up'){const index=song.layers.indexOf(layer);if(index>0)[song.layers[index-1],song.layers[index]]=[song.layers[index],song.layers[index-1]];}if(action==='remove'){if(!await confirmDialog('Remove layer?',`Remove “${layer.name}” from this patch?`,'Remove'))return;song.layers=song.layers.filter(item=>item.id!==layer.id);}markDirty();renderPerformance();}
      if(target.dataset.action==='add-layer')addLayer();
      if(target.id==='new-setlist')createSetlist();
      if(target.id==='open-setlist'||target.id==='see-all')showSetlists();
      if(target.id==='settings-button')openSettings();
      if(target.id==='brand-home')state.currentSet?leavePerformance():null;
      if(target.id==='ambient-launch'){state.ambientExpanded=true;$('#performance').classList.remove('is-hidden');$('#dashboard').classList.add('is-hidden');$('#ambient-bar').classList.remove('collapsed');$('#top-context').textContent='AMBIENT PLAYER';}
      if(target.id==='device-button'){$('#device-popover').hidden=!$('#device-popover').hidden;target.setAttribute('aria-expanded',String(!$('#device-popover').hidden));}
      if(target.id==='refresh-midi'){target.classList.add('spinning');await requestMidi();setTimeout(()=>target.classList.remove('spinning'),400);}
      if(target.id==='learn-toggle')midiLearn();
      if(target.id==='delete-map')deleteSelectedMapping();
      if(target.id==='save-maps')saveMappings();
      if(target.id==='add-song')addSong();
      if(target.id==='detail-add-layer')addLayer();
      if(target.id==='add-scene'||target.id==='detail-add-scene')addScene();
      if(target.id==='save-performance'||target.id==='detail-save')persistSet();
      if(target.id==='close-performance')leavePerformance();
      if(target.id==='key-button')$('#key-options').hidden=!$('#key-options').hidden;
      if(target.id==='bpm-button')$('#bpm-options').hidden=!$('#bpm-options').hidden;
      if(target.id==='volume-button')$('#volume-options').hidden=!$('#volume-options').hidden;
      if(target.id==='hear-key')playReference();
      if(target.id==='tempo-down'||target.id==='tempo-up'){if(state.longTempoPress){state.longTempoPress=false;return;}updateTempo(target.id==='tempo-up'?1:-1);}
      if(target.id==='tap-tempo')tapTempo();
      if(target.dataset.bpm){const input=$('#bpm-entry');input.value=clamp(Number(input.value)+Number(target.dataset.bpm),20,300);input.dispatchEvent(new Event('change',{bubbles:true}));}
      if(target.id==='prev-scene'||target.id==='next-scene'){const song=activeSong();if(song?.scenes.length){state.sceneIndex=(state.sceneIndex+(target.id==='next-scene'?1:-1)+song.scenes.length)%song.scenes.length;recallScene(song.scenes[state.sceneIndex].id);}}
      if(target.id==='pad-layer-toggle'){const song=activeSong();if(song){let pad=song.layers.find(layer=>layer.type==='pad');if(!pad){pad=newLayer('Patch pad','pad');song.layers.push(pad);}else pad.muted=!pad.muted;markDirty();renderPerformance();}}
      if(target.id==='ambient-expand'){state.ambientExpanded=!state.ambientExpanded;$('#ambient-bar').classList.toggle('collapsed',!state.ambientExpanded);}
      if(target.id==='ambient-power')toggleAmbient();
      if(target.id==='save-ambient-key'){state.ambientKey=$('#ambient-key').value;localStorage.setItem('ambientKey',state.ambientKey);toast(`Ambient root ${state.ambientKey} saved`);}
      if(target.id==='mobile-menu'){$('#performance').classList.add('drawer-open');}
      if(target.id==='sidebar-close'||target.id==='drawer-shade')$('#performance').classList.remove('drawer-open');
      if(target.id==='editable-setname'&&state.currentSet)renameSet(state.currentSet);
      if(target.id==='song-more')showSongActions();
      if(target.id==='menu-button')showPerformanceMenu();
      if(target.id==='content-packs')showContentPacks();
      if(target.id==='default-cut'){const song=activeSong();if(song){const previous=structuredClone(song.layers);song.layers.forEach(layer=>{layer.muted=true;layer.soloed=false;});markDirty();renderPerformance();toast('All patch layers muted','',{label:'Undo',run:()=>{song.layers=previous;markDirty();renderPerformance();}});}}
    });
    $('#song-search').addEventListener('input',renderPerformance);
    $('#setlist-search')?.addEventListener('input',renderSetlistPicker);
    document.addEventListener('input',event=>{
      const target=event.target;
      if(target.matches('[data-layer-level]')){const layer=activeSong()?.layers.find(item=>item.id===target.dataset.layerLevel);if(layer){layer.level=Number(target.value);const row=target.closest('.layer-row');$('.layer-level',row).textContent=`${layer.level}%`;markDirty();}}
      if(target.id==='master-volume'){const song=activeSong();if(song){song.volume=Number(target.value);$('#master-output').value=`${song.volume}%`;$('#song-volume').textContent=`${song.volume}%`;$('#song-volume-slider').value=song.volume;markDirty();}}
      if(target.id==='song-volume-slider'){const song=activeSong();if(song){song.volume=Number(target.value);$('#song-volume').textContent=`${song.volume}%`;$('#master-volume').value=song.volume;$('#master-output').value=`${song.volume}%`;markDirty();}}
      if(target.id==='song-note'){const song=activeSong();if(song){song.note=target.value;markDirty();}}
      if(target.id==='setlist-search'||target.id==='setlist-sort')renderSetlistPicker();
    });
    document.addEventListener('change',event=>{if(event.target.id==='bpm-entry'){const song=activeSong();if(song){song.bpm=clamp(event.target.value,20,300);$('#song-bpm').textContent=song.bpm;$('#tempo-value').textContent=song.bpm;event.target.value=song.bpm;markDirty();}}if(event.target.id==='ambient-key')$('#ambient-status').textContent=`${state.ambientOn?'ON':'OFF'} · ${event.target.value} drone`;});
    $('#dialog-form').addEventListener('submit',event=>{if(event.submitter?.value==='confirm'){const required=$$('#dialog-content [required]');for(const input of required){if(!input.value.trim()){event.preventDefault();input.focus();return;}}}});
    $('#tempo-down').addEventListener('contextmenu',event=>event.preventDefault());
    for(const [id,delta] of [['tempo-down',-5],['tempo-up',5]]){let timer;const button=$(`#${id}`);button.addEventListener('pointerdown',()=>{timer=setTimeout(()=>{state.longTempoPress=true;updateTempo(delta);timer=null;},600);});for(const name of ['pointerup','pointerleave','pointercancel'])button.addEventListener(name,()=>{if(timer)clearTimeout(timer);});}
    document.addEventListener('keydown',event=>{if(event.key==='Escape')$('#performance').classList.remove('drawer-open');if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'&&state.currentSet){event.preventDefault();persistSet();}});
  }
  async function showSongActions(){const song=activeSong();if(!song)return;const action=await showDialog({title:song.name,kicker:'PATCH ACTIONS',hideSubmit:true,content:'<div class="dialog-list"><button type="button" class="outline-button" data-song-action="rename">Rename patch</button><button type="button" class="outline-button" data-song-action="delete">Delete patch</button></div>',onOpen:()=>$$('[data-song-action]').forEach(button=>button.addEventListener('click',()=>$('#dialog').close(button.dataset.songAction)))});if(action==='rename'){const rename=await showDialog({title:'Rename patch',submit:'Save',content:`<label class="form-field"><span>NAME</span><input id="rename-value" value="${esc(song.name)}" maxlength="60" required></label>`});if(rename==='confirm'){const value=cleanName($('#rename-value').value);if(value){song.name=value;markDirty();renderPerformance();}}}else if(action==='delete'&&await confirmDialog('Delete patch?',`Delete “${song.name}” and its scenes?`,'Delete')){state.currentSet.songs=state.currentSet.songs.filter(item=>item.id!==song.id);state.currentSong=state.currentSet.songs[0]?.id||null;markDirty();renderPerformance();}}
  async function showPerformanceMenu(){const action=await showDialog({title:'Performance set',kicker:'QUICK MENU',hideSubmit:true,content:'<div class="dialog-list"><button type="button" class="outline-button" data-performance-action="save">Save current set</button><button type="button" class="outline-button" data-performance-action="open">Open another set</button><button type="button" class="outline-button" data-performance-action="close">Close current set</button></div>',onOpen:()=>$$('[data-performance-action]').forEach(button=>button.addEventListener('click',()=>$('#dialog').close(button.dataset.performanceAction)))});if(action==='save')persistSet();if(action==='open'){if(await unsavedGuard())showSetlists();}if(action==='close')leavePerformance();}
  async function showContentPacks(){let catalog;try{catalog=await fetch('./packs/index.json').then(response=>{if(!response.ok)throw new Error();return response.json();});}catch{return toast('Content pack catalog is unavailable. Connect to the internet and try again.','error');}const installed=new Set((await getAll('packs')).map(pack=>pack.id));const content=`<div class="dialog-list">${catalog.packs.map(pack=>`<div class="dialog-set-row"><div class="dialog-set-main"><strong>${esc(pack.name)}</strong><small>${esc(pack.description)} · ${pack.sizeLabel} · ${pack.preview.join(', ')}</small></div><button type="button" class="outline-button" data-pack="${esc(pack.id)}">${installed.has(pack.id)?'Remove':'Install'}</button></div>`).join('')}</div><p class="form-note">Preset packs contain patch and layer definitions; instrument sounds are provided by your connected hardware or software.</p>`;const action=await showDialog({title:'Content packs',submit:'Done',content,onOpen:()=>$$('[data-pack]').forEach(button=>button.addEventListener('click',()=>$('#dialog').close(button.dataset.pack)))});if(action!=='confirm'&&action!=='cancel'){await managePack(action,installed.has(action));showContentPacks();}}
  async function managePack(id,isInstalled){if(isInstalled){if(!await confirmDialog('Remove content pack?','Installed presets will be removed. Patches already in setlists are kept.','Remove'))return;await remove('packs',id);toast('Content pack removed');return;}try{const response=await fetch(`./packs/${encodeURIComponent(id)}.json`);if(!response.ok)throw new Error();const pack=await response.json();const estimate=await navigator.storage?.estimate?.();const free=(estimate?.quota||Infinity)-(estimate?.usage||0);if(pack.sizeBytes>free&&!await confirmDialog('Storage may be full','This pack may exceed the estimated available storage. Continue anyway?','Continue'))return;await put('packs',{...pack,installedAt:now()});toast(`${pack.name} installed`,'success');}catch{toast('Could not download this pack. Try again when online.','error');}}
  async function boot() {
    try { db=await openDB(); state.setlists=await getAll('setlists'); const saved=await new Promise(resolve=>{const req=store('mappings').get('all');req.onsuccess=()=>resolve(req.result);req.onerror=()=>resolve(null);});state.mappings=saved?.items||[]; }
    catch { toast('Browser storage is unavailable; changes may not persist.', 'error'); }
    try { state.settings={...state.settings,...JSON.parse(localStorage.getItem('settings')||'{}')}; } catch {}
    $('#ambient-key').innerHTML=KEYS.map(key=>`<option value="${key}">${displayKey(key)}</option>`).join('');$('#ambient-key').value=KEYS.includes(localStorage.getItem('ambientKey'))?localStorage.getItem('ambientKey'):'C';$('#ambient-bar').classList.add('collapsed');
    renderDashboard();bindEvents();await requestMidi();
    if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
    const last=localStorage.getItem('lastSetlistId');if(!state.midi||!state.midi.inputs.size)toast('No MIDI devices detected — check Settings.');
    if(last&&state.setlists.some(set=>set.id===last))$('#recent-list').dataset.lastSetlistId=last;
    setTimeout(()=>{$('#splash').classList.add('done');$('#app').classList.remove('is-hidden');setTimeout(()=>$('#splash').remove(),700);},1250);
  }
  boot();
})();