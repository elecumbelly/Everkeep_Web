import { DRAFT_KEY, ONBOARDING_KEY, OWNER_KEY_STORAGE, STORAGE_KEY, prompts } from './src/data/defaults.js';
import { applyFilters } from './src/logic/filters.js';
import { formatDateLabel, getMemoryDate } from './src/logic/dates.js';
import { mergeRemoteState } from './src/logic/merge.js';
import { getPlaceName } from './src/logic/places.js';
import { normaliseState } from './src/logic/state.js';
import { getAllTags, parseTags } from './src/logic/tags.js';
import { emptyStateHTML, escapeHtml, safeParse, uid } from './src/logic/utils.js';

const API_BASE = window.EVERKEEP_API_BASE || '/api/index.php';

const ui = {
  activeTab: 'today',
  promptIndex: 0,
  memoryDraft: null,
  mediaDraft: [],
  mediaPreviews: {},
  detailMediaPreviews: {},
  removedMedia: [],
  currentView: 'recent',
  cloudRestoreAttempted: false,
  modalFocus: {},
  syncLabel: '',
  syncErrorMessage: '',
  syncErrorNotified: false,
  activeOverlayId: null,
  filters: {
    search: '',
    section: 'all',
    visibility: 'all',
    tag: 'all',
    person: 'all',
    place: 'all',
    date: 'any'
  },
  onboardingStep: 0
};

const mediaStore = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('everkeep-media', 1);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('media')) {
          db.createObjectStore('media', { keyPath: 'id' });
        }
      };
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };
      request.onerror = () => reject(request.error);
    });
  },
  async putMedia(blob, meta) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const id = meta.id || uid('media');
      const tx = db.transaction('media', 'readwrite');
      const store = tx.objectStore('media');
      store.put({ id, blob, meta });
      tx.oncomplete = () => resolve(id);
      tx.onerror = () => reject(tx.error);
    });
  },
  async getMedia(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('media', 'readonly');
      const store = tx.objectStore('media');
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },
  async deleteMedia(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('media', 'readwrite');
      const store = tx.objectStore('media');
      store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
};

let state = loadState();
let recorder = null;
let recorderChunks = [];
let recorderStream = null;
let discardRecording = false;
let draftTimer = null;
let syncTimer = null;
let syncInFlight = false;
let confirmResolver = null;
let syncRetryTimer = null;
let syncRetryCount = 0;

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => Array.from(parent.querySelectorAll(selector));

function loadState() {
  const stored = safeParse(localStorage.getItem(STORAGE_KEY)) || {};
  return normaliseState(stored);
}

function saveState(options = {}) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (!options.skipSync) {
    scheduleCloudSync();
  }
}

function init() {
  bindEvents();
  renderAll();
  updateStorageStatus();
  updateConnectionStatus();
  registerServiceWorker();
  if (state.settings.cloudSync) {
    restoreFromCloud();
  }
  if (!localStorage.getItem(ONBOARDING_KEY)) {
    openOnboarding();
  }
}

function bindEvents() {
  document.addEventListener('click', (event) => {
    const tabButton = event.target.closest('[data-tab-target]');
    if (tabButton) {
      setActiveTab(tabButton.dataset.tabTarget);
      return;
    }

    const action = event.target.closest('[data-action]');
    if (!action) return;

    const type = action.dataset.action;
    if (type === 'open-add') {
      openMemoryModal({ source: 'Today', mode: action.dataset.mode || 'write' });
    } else if (type === 'open-backfill') {
      openMemoryModal({ source: 'Backfill', mode: 'write' });
    } else if (type === 'close-memory') {
      closeOverlay('memory-modal');
    } else if (type === 'open-person') {
      openOverlay('person-modal');
      $('#person-name').focus();
    } else if (type === 'close-person') {
      closeOverlay('person-modal');
    } else if (type === 'open-section') {
      openOverlay('section-modal');
      $('#section-name').focus();
    } else if (type === 'close-section') {
      closeOverlay('section-modal');
    } else if (type === 'close-detail') {
      closeOverlay('detail-modal');
    } else if (type === 'close-confirm' || type === 'cancel-confirm') {
      resolveConfirm(false);
    } else if (type === 'open-onboarding') {
      openOnboarding();
    } else if (type === 'close-onboarding') {
      closeOverlay('onboarding');
    } else if (type === 'swap-prompt') {
      swapPrompt();
    } else if (type === 'toggle-advanced') {
      toggleAdvanced();
    } else if (type === 'restore-draft') {
      restoreDraft();
    } else if (type === 'clear-search') {
      ui.filters.search = '';
      $('#library-search').value = '';
      renderLibrary();
    } else if (type === 'start-record') {
      startRecording();
    } else if (type === 'stop-record') {
      stopRecording();
    } else if (type === 'export-all') {
      exportAll();
    } else if (type === 'remove-media') {
      removeMedia(action.dataset.mediaId);
    } else if (type === 'copy-owner-key') {
      copyOwnerKey();
    } else if (type === 'rotate-owner-key') {
      rotateOwnerKey();
    } else if (type === 'confirm-action') {
      resolveConfirm(true);
    } else if (type === 'select-view') {
      ui.currentView = action.dataset.view;
      renderLibrary();
    } else if (type === 'edit-memory') {
      const memoryId = action.dataset.memoryId;
      const memory = state.memories.find((item) => item.id === memoryId);
      if (memory) openMemoryModal({ memory, source: memory.source || 'Today', mode: 'write' });
    } else if (type === 'export-memory') {
      exportMemory(action.dataset.memoryId);
    } else if (type === 'delete-memory') {
      deleteMemory(action.dataset.memoryId);
    } else if (type === 'filter-person') {
      ui.filters.person = action.dataset.personId;
      setActiveTab('library');
      renderLibrary();
    } else if (type === 'filter-place') {
      ui.filters.place = action.dataset.placeId;
      setActiveTab('library');
      renderLibrary();
    } else if (type === 'set-tag-filter') {
      ui.filters.tag = action.dataset.tag;
      ui.currentView = 'recent';
      setActiveTab('library');
      renderLibrary();
    }
  });

  $('#memory-form').addEventListener('submit', handleMemorySubmit);
  $('#person-form').addEventListener('submit', handlePersonSubmit);
  $('#section-form').addEventListener('submit', handleSectionSubmit);
  $('#photo-input').addEventListener('change', handlePhotoUpload);
  $('#memory-visibility').addEventListener('change', handleVisibilityChange);
  $('#low-energy').addEventListener('change', handleLowEnergyToggle);
  $('#date-type').addEventListener('change', handleDateTypeChange);
  $('#library-search').addEventListener('input', (event) => {
    ui.filters.search = event.target.value;
    renderLibrary();
  });
  $('#library-filters').addEventListener('change', (event) => {
    const { name, value } = event.target;
    ui.filters[name] = value;
    renderLibrary();
  });
  $('#settings-list').addEventListener('change', handleSettingsChange);
  $('#memory-form').addEventListener('input', queueDraftSave);
  document.addEventListener('keydown', handleGlobalKeydown);

  window.addEventListener('online', updateConnectionStatus);
  window.addEventListener('offline', updateConnectionStatus);
}

function setActiveTab(tab) {
  ui.activeTab = tab;
  $$('.tab-panel').forEach((panel) => {
    panel.classList.toggle('is-active', panel.dataset.tab === tab);
  });
  $$('.nav-item').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.tabTarget === tab);
    button.setAttribute('aria-selected', button.dataset.tabTarget === tab ? 'true' : 'false');
  });
}

function renderAll() {
  renderPrompt();
  renderToday();
  renderLibrary();
  renderPeople();
  renderPlaces();
  renderSections();
  renderSettings();
  renderMemoryForm();
}

function renderPrompt() {
  const style = state.settings.promptStyle;
  const promptList = prompts[style] || prompts.gentle;
  ui.promptIndex = ui.promptIndex % promptList.length;
  $('#today-prompt').textContent = promptList[ui.promptIndex];
}

function swapPrompt() {
  ui.promptIndex += 1;
  renderPrompt();
}

function renderToday() {
  const recent = [...state.memories]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 3);
  const container = $('#today-recent');
  if (!recent.length) {
    container.innerHTML = emptyStateHTML('No memories yet. One line is enough to begin.');
    return;
  }
  container.innerHTML = recent.map(renderMemoryCard).join('');
}

function renderLibrary() {
  renderViewSwitch();
  renderFilters();
  const list = $('#library-list');
  if (ui.currentView === 'tags') {
    const tags = getAllTags(state.memories);
    if (!tags.length) {
      list.innerHTML = emptyStateHTML('Tags appear after your first tag.');
      return;
    }
    list.innerHTML = tags
      .map((tag) => {
        const count = state.memories.filter((memory) => (memory.tags || []).includes(tag)).length;
        return `
          <div class="memory-card" role="button" tabindex="0" aria-label="Filter by tag ${escapeHtml(tag)}" data-action="set-tag-filter" data-tag="${escapeHtml(tag)}">
            <strong>${escapeHtml(tag)}</strong>
            <div class="memory-meta">
              <span>${count} memories</span>
            </div>
          </div>
        `;
      })
      .join('');
    return;
  }

  if (ui.currentView === 'keepsakes') {
    list.innerHTML = emptyStateHTML('Keepsakes are coming soon. For now, use filters to curate a collection.');
    return;
  }

  let filtered = applyFilters(state.memories, ui.filters, state.people, state.places);
  if (ui.currentView === 'timeline' || ui.currentView === 'calendar') {
    filtered = filtered.sort((a, b) => getMemoryDate(b) - getMemoryDate(a));
  }
  if (!filtered.length) {
    list.innerHTML = emptyStateHTML('No matches yet. Try a different filter or add a memory.');
    return;
  }
  const note = ui.currentView === 'calendar'
    ? '<p class="panel-note">Calendar view is a gentle date list for now.</p>'
    : '';
  list.innerHTML = `${note}${filtered.map(renderMemoryCard).join('')}`;
}

function renderViewSwitch() {
  const views = getAvailableViews();
  const container = $('#library-views');
  container.innerHTML = views
    .map((view) => {
      const active = view.id === ui.currentView ? 'is-active' : '';
      return `<button type="button" class="${active}" data-action="select-view" data-view="${view.id}">${view.label}</button>`;
    })
    .join('');
}

function getAvailableViews() {
  const unlocks = getUnlocks();
  const views = [{ id: 'recent', label: 'Recent' }];
  if (unlocks.timeline) views.push({ id: 'timeline', label: 'Timeline' });
  if (unlocks.calendar) views.push({ id: 'calendar', label: 'Calendar' });
  if (unlocks.tags) views.push({ id: 'tags', label: 'Tags' });
  if (unlocks.keepsakes) views.push({ id: 'keepsakes', label: 'Keepsakes' });
  if (!views.find((view) => view.id === ui.currentView)) {
    ui.currentView = 'recent';
  }
  return views;
}

function getUnlocks() {
  const hasTags = state.memories.some((memory) => (memory.tags || []).length > 0);
  return {
    timeline: state.memories.length >= 7 || state.settings.revealTimeline,
    calendar: state.memories.length >= 14 || state.settings.revealCalendar,
    tags: hasTags || state.settings.revealTags,
    keepsakes: state.memories.length >= 20 || state.settings.revealKeepsakes
  };
}

function renderFilters() {
  const tags = getAllTags(state.memories);
  const people = state.people;
  const places = state.places;
  $('#library-filters').innerHTML = `
    <label>
      <span class="sr-only">Section</span>
      <select name="section">
        <option value="all">All sections</option>
        ${state.sections.map((section) => `<option value="${section.id}" ${ui.filters.section === section.id ? 'selected' : ''}>${escapeHtml(section.name)}</option>`).join('')}
      </select>
    </label>
    <label>
      <span class="sr-only">Visibility</span>
      <select name="visibility">
        <option value="all">All visibility</option>
        <option value="Private" ${ui.filters.visibility === 'Private' ? 'selected' : ''}>Private</option>
        <option value="Family" ${ui.filters.visibility === 'Family' ? 'selected' : ''}>Family</option>
        <option value="Selected" ${ui.filters.visibility === 'Selected' ? 'selected' : ''}>Selected</option>
      </select>
    </label>
    <label>
      <span class="sr-only">Tags</span>
      <select name="tag">
        <option value="all">All tags</option>
        ${tags.map((tag) => `<option value="${escapeHtml(tag)}" ${ui.filters.tag === tag ? 'selected' : ''}>${escapeHtml(tag)}</option>`).join('')}
      </select>
    </label>
    <label>
      <span class="sr-only">Date</span>
      <select name="date">
        <option value="any">Any time</option>
        <option value="last7" ${ui.filters.date === 'last7' ? 'selected' : ''}>Last 7 days</option>
        <option value="last30" ${ui.filters.date === 'last30' ? 'selected' : ''}>Last 30 days</option>
        <option value="year" ${ui.filters.date === 'year' ? 'selected' : ''}>This year</option>
      </select>
    </label>
    ${people.length ? `
      <label>
        <span class="sr-only">People</span>
        <select name="person">
          <option value="all">All people</option>
          ${people.map((person) => `<option value="${person.id}" ${ui.filters.person === person.id ? 'selected' : ''}>${escapeHtml(person.name)}</option>`).join('')}
        </select>
      </label>
    ` : ''}
    ${places.length ? `
      <label>
        <span class="sr-only">Places</span>
        <select name="place">
          <option value="all">All places</option>
          ${places.map((place) => `<option value="${place.id}" ${ui.filters.place === place.id ? 'selected' : ''}>${escapeHtml(place.name)}</option>`).join('')}
        </select>
      </label>
    ` : ''}
  `;
}

function renderPeople() {
  const list = $('#people-list');
  if (!state.people.length) {
    list.innerHTML = emptyStateHTML('No people yet. Add someone you want to remember.');
    return;
  }
  list.innerHTML = state.people
    .map((person) => {
      const total = state.memories.filter((memory) => (memory.peopleIds || []).includes(person.id)).length;
      const shared = state.memories.filter((memory) => memory.visibility.type === 'Selected' && (memory.visibility.peopleIds || []).includes(person.id)).length;
      return `
        <div class="memory-card" role="button" tabindex="0" aria-label="Filter by ${escapeHtml(person.name)}" data-action="filter-person" data-person-id="${person.id}">
          <strong>${escapeHtml(person.name)}</strong>
          <div class="memory-meta">
            <span>${total} memories</span>
            <span class="badge sage">${shared} shared</span>
          </div>
        </div>
      `;
    })
    .join('');
}

function renderPlaces() {
  const list = $('#places-list');
  if (!state.places.length) {
    list.innerHTML = emptyStateHTML('No places yet. Add a place from any memory.');
    return;
  }
  list.innerHTML = state.places
    .map((place) => {
      const total = state.memories.filter((memory) => memory.placeId === place.id).length;
      return `
        <div class="memory-card" role="button" tabindex="0" aria-label="Filter by ${escapeHtml(place.name)}" data-action="filter-place" data-place-id="${place.id}">
          <strong>${escapeHtml(place.name)}</strong>
          <div class="memory-meta">
            <span>${total} memories</span>
          </div>
        </div>
      `;
    })
    .join('');
}

function renderSections() {
  const list = $('#sections-list');
  list.innerHTML = state.sections
    .map((section) => {
      return `
        <div class="memory-card">
          <strong>${escapeHtml(section.name)}</strong>
          <div class="memory-meta">
            <span class="badge neutral">${section.defaultVisibility}</span>
            <span>${section.system ? 'System' : 'Custom'}</span>
          </div>
        </div>
      `;
    })
    .join('');
}

function renderSettings() {
  const list = $('#settings-list');
  list.innerHTML = `
    <div class="memory-card">
      <label class="field">
        <span>Prompt style</span>
        <select data-setting="promptStyle">
          <option value="gentle" ${state.settings.promptStyle === 'gentle' ? 'selected' : ''}>Gentle</option>
          <option value="curious" ${state.settings.promptStyle === 'curious' ? 'selected' : ''}>Curious</option>
          <option value="quiet" ${state.settings.promptStyle === 'quiet' ? 'selected' : ''}>Quiet</option>
        </select>
      </label>
    </div>
    <div class="memory-card">
      <label class="switch">
        <input type="checkbox" data-setting="cloudSync" ${state.settings.cloudSync ? 'checked' : ''} />
        <span>Cloud backup (beta)</span>
      </label>
      <p class="panel-note">Local only mode is the default. Backup stores metadata on your server.</p>
    </div>
    <div class="memory-card">
      <label class="field">
        <span>Device backup key</span>
        <div class="field-row">
          <input type="text" value="${escapeHtml(getOwnerKey())}" readonly />
          <button type="button" class="ghost-button" data-action="copy-owner-key">Copy</button>
          <button type="button" class="ghost-button" data-action="rotate-owner-key">Rotate</button>
        </div>
      </label>
      <p class="panel-note">Use this to find your backup row in MySQL.</p>
    </div>
    <div class="memory-card">
      <label class="switch">
        <input type="checkbox" data-setting="revealTimeline" ${state.settings.revealTimeline ? 'checked' : ''} />
        <span>Reveal timeline view</span>
      </label>
      <label class="switch">
        <input type="checkbox" data-setting="revealCalendar" ${state.settings.revealCalendar ? 'checked' : ''} />
        <span>Reveal calendar view</span>
      </label>
      <label class="switch">
        <input type="checkbox" data-setting="revealTags" ${state.settings.revealTags ? 'checked' : ''} />
        <span>Reveal tags view</span>
      </label>
      <label class="switch">
        <input type="checkbox" data-setting="revealKeepsakes" ${state.settings.revealKeepsakes ? 'checked' : ''} />
        <span>Reveal keepsakes</span>
      </label>
    </div>
    <div class="memory-card">
      <label class="switch">
        <input type="checkbox" data-setting="reducedMotion" ${state.settings.reducedMotion ? 'checked' : ''} />
        <span>Reduce motion</span>
      </label>
    </div>
  `;
}

function renderMemoryForm() {
  const select = $('#memory-section');
  select.innerHTML = state.sections
    .map((section) => `<option value="${section.id}">${escapeHtml(section.name)}</option>`)
    .join('');
  const draft = safeParse(localStorage.getItem(DRAFT_KEY));
  $('#restore-draft').hidden = !draft;
}

function openMemoryModal({ memory, source, mode }) {
  ui.memoryDraft = memory || null;
  ui.mediaDraft = memory ? [...(memory.media || [])] : [];
  ui.removedMedia = [];
  ui.mediaPreviews = {};
  $('#memory-form').reset();
  $('#memory-id').value = memory ? memory.id : '';
  $('#memory-title').textContent = memory ? 'Edit memory' : 'Add a memory';
  $('#memory-section').value = memory ? memory.sectionId : state.sections[0].id;
  if (memory) {
    $('#memory-visibility').value = memory.visibility.type;
  } else {
    const section = state.sections.find((item) => item.id === $('#memory-section').value);
    $('#memory-visibility').value = section?.defaultVisibility || 'Private';
  }
  $('#memory-title-input').value = memory ? memory.title || '' : '';
  $('#memory-body').value = memory ? memory.body || '' : '';
  $('#low-energy').checked = memory ? Boolean(memory.lowEnergy) : false;
  $('#low-energy-line').value = memory ? memory.lowEnergyLine || '' : '';
  handleLowEnergyToggle();
  if (memory) {
    setDateFields(memory.date);
  } else if (source === 'Backfill') {
    setDateFields({ type: 'unknown' });
  } else {
    setDateFields({ type: 'exact', value: '' });
  }
  $('#memory-tags').value = memory ? (memory.tags || []).join(', ') : '';
  $('#memory-place').value = memory ? getPlaceName(state.places, memory.placeId) : '';
  $('#advanced-fields').hidden = true;
  renderMemoryForm();
  const draft = safeParse(localStorage.getItem(DRAFT_KEY));
  $('#restore-draft').hidden = Boolean(memory) || !draft;
  renderPeopleOptions();
  handleVisibilityChange();
  setMediaStatus(false);
  setRecordingIndicator(false);
  renderMediaPreview();
  if (memory) {
    loadExistingMedia(memory.media);
  } else if (mode === 'record') {
    startRecording();
  }
  openOverlay('memory-modal');
  $('#memory-title-input').focus();
  localStorage.setItem('everkeep:last-source', source);
}

function setDateFields(date) {
  const dateType = date?.type || 'exact';
  $('#date-type').value = dateType;
  $('#date-value').value = '';
  $('#date-month-value').value = '';
  $('#date-season-value').value = 'spring';
  $('#date-year-value').value = '';
  if (dateType === 'exact') {
    $('#date-value').value = date?.value || '';
  } else if (dateType === 'month') {
    $('#date-month-value').value = date?.value || '';
  } else if (dateType === 'season') {
    $('#date-season-value').value = date?.season || 'spring';
    $('#date-year-value').value = date?.year || '';
  }
  handleDateTypeChange();
}

function handleDateTypeChange() {
  const type = $('#date-type').value;
  $('#date-exact').hidden = type !== 'exact';
  $('#date-month').hidden = type !== 'month';
  $('#date-season').hidden = type !== 'season';
  $('#date-year').hidden = type !== 'season';
}

function handleLowEnergyToggle() {
  const checked = $('#low-energy').checked;
  $('#low-energy-field').hidden = !checked;
}

function renderPeopleOptions() {
  const container = $('#people-options');
  if (!state.people.length) {
    container.innerHTML = '<span class="panel-note">No people yet.</span>';
    return;
  }
  const existing = getCheckedValues('#people-options');
  const selectedIds = existing.length ? existing : (ui.memoryDraft?.peopleIds || []);
  container.innerHTML = state.people
    .map((person) => {
      const checked = selectedIds.includes(person.id);
      return `
        <label class="chip">
          <input type="checkbox" value="${person.id}" ${checked ? 'checked' : ''} />
          ${escapeHtml(person.name)}
        </label>
      `;
    })
    .join('');
}

function renderSelectedPeopleOptions(selectedIds = []) {
  const container = $('#selected-people-options');
  if (!state.people.length) {
    container.innerHTML = '<span class="panel-note">Add a person to share with.</span>';
    return;
  }
  const existing = getCheckedValues('#selected-people-options');
  const activeIds = selectedIds.length ? selectedIds : existing;
  container.innerHTML = state.people
    .map((person) => {
      const checked = activeIds.includes(person.id);
      return `
        <label class="chip">
          <input type="checkbox" value="${person.id}" ${checked ? 'checked' : ''} />
          ${escapeHtml(person.name)}
        </label>
      `;
    })
    .join('');
}

function handleVisibilityChange() {
  const visibility = $('#memory-visibility').value;
  const showSelected = visibility === 'Selected';
  $('#selected-people-field').hidden = !showSelected;
  if (showSelected) {
    const selectedIds = ui.memoryDraft?.visibility?.peopleIds || [];
    renderSelectedPeopleOptions(selectedIds);
  }
}

function toggleAdvanced() {
  const advanced = $('#advanced-fields');
  advanced.hidden = !advanced.hidden;
}

function openOverlay(id) {
  const overlay = document.getElementById(id);
  ui.modalFocus[id] = document.activeElement;
  ui.activeOverlayId = id;
  overlay.classList.add('is-open');
  overlay.setAttribute('aria-hidden', 'false');
}

function closeOverlay(id) {
  const overlay = document.getElementById(id);
  overlay.classList.remove('is-open');
  overlay.setAttribute('aria-hidden', 'true');
  if (id === 'memory-modal') {
    stopRecording(true);
    setMediaStatus(false);
    setRecordingIndicator(false);
    Object.values(ui.mediaPreviews).forEach((url) => URL.revokeObjectURL(url));
    ui.mediaPreviews = {};
  }
  if (id === 'detail-modal') {
    clearDetailMedia();
  }
  const focusTarget = ui.modalFocus[id];
  if (focusTarget && typeof focusTarget.focus === 'function') {
    focusTarget.focus();
  }
  if (ui.activeOverlayId === id) {
    ui.activeOverlayId = null;
  }
}

function handleGlobalKeydown(event) {
  const isActionKey = event.key === 'Enter' || event.key === ' ';
  if (isActionKey) {
    const target = event.target;
    if (target && target.matches('[data-action][role="button"]')) {
      event.preventDefault();
      target.click();
      return;
    }
  }

  if (!ui.activeOverlayId) return;

  if (event.key === 'Escape') {
    event.preventDefault();
    if (ui.activeOverlayId === 'confirm-modal') {
      resolveConfirm(false);
    } else {
      closeOverlay(ui.activeOverlayId);
    }
    return;
  }

  if (event.key !== 'Tab') return;

  const overlay = document.getElementById(ui.activeOverlayId);
  if (!overlay) return;
  const focusables = Array.from(
    overlay.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex=\"-1\"])')
  );
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function showConfirm({ title, body, confirmLabel, cancelLabel } = {}) {
  if (confirmResolver) {
    confirmResolver(false);
  }
  $('#confirm-title').textContent = title || 'Are you sure?';
  $('#confirm-body').textContent = body || '';
  const confirmButton = $('[data-action="confirm-action"]');
  const cancelButton = $('[data-action="cancel-confirm"]');
  confirmButton.textContent = confirmLabel || 'Confirm';
  cancelButton.textContent = cancelLabel || 'Cancel';
  openOverlay('confirm-modal');
  confirmButton.focus();
  return new Promise((resolve) => {
    confirmResolver = resolve;
  });
}

function resolveConfirm(result) {
  if (confirmResolver) {
    confirmResolver(result);
    confirmResolver = null;
  }
  closeOverlay('confirm-modal');
}

function handleMemorySubmit(event) {
  event.preventDefault();
  const formData = collectMemoryForm();
  if (!formData) return;

  const isEditing = Boolean($('#memory-id').value);
  if (isEditing) {
    const index = state.memories.findIndex((memory) => memory.id === formData.id);
    if (index >= 0) {
      state.memories[index] = formData;
    }
  } else {
    state.memories.push(formData);
  }

  ui.removedMedia.forEach((id) => mediaStore.deleteMedia(id));
  saveState();
  localStorage.removeItem(DRAFT_KEY);
  closeOverlay('memory-modal');
  renderAll();
  showToast('Memory saved.', { type: 'success' });
}

function collectMemoryForm() {
  const visibility = $('#memory-visibility').value;
  const title = $('#memory-title-input').value.trim();
  const body = $('#memory-body').value.trim();
  const lowEnergy = $('#low-energy').checked;
  const lowEnergyLine = $('#low-energy-line').value.trim();
  const sectionId = $('#memory-section').value;
  const date = readDate();
  const tags = parseTags($('#memory-tags').value);
  const placeName = $('#memory-place').value.trim();
  const peopleIds = getCheckedValues('#people-options');
  const selectedPeople = getCheckedValues('#selected-people-options');

  const content = body || (lowEnergy ? lowEnergyLine : '') || title;
  if (!content && ui.mediaDraft.length === 0) {
    showToast('Add a line, a photo, or a recording before saving.', { type: 'error' });
    return null;
  }

  if (visibility === 'Selected' && selectedPeople.length === 0) {
    showToast('Choose at least one person to share with, or keep it private.', { type: 'error' });
    return null;
  }

  let placeId = null;
  if (placeName) {
    placeId = upsertPlace(placeName);
  }

  const now = Date.now();
  const existing = $('#memory-id').value;
  const createdAt = existing
    ? state.memories.find((memory) => memory.id === existing)?.createdAt || now
    : now;

  return {
    id: existing || uid('mem'),
    title,
    body,
    lowEnergy,
    lowEnergyLine: lowEnergy ? lowEnergyLine : '',
    sectionId,
    peopleIds,
    placeId,
    tags,
    visibility: {
      type: visibility,
      peopleIds: visibility === 'Selected' ? selectedPeople : []
    },
    date,
    media: ui.mediaDraft,
    source: localStorage.getItem('everkeep:last-source') || 'Today',
    createdAt,
    updatedAt: now
  };
}

function readDate() {
  const type = $('#date-type').value;
  if (type === 'exact') {
    const value = $('#date-value').value;
    return { type, value };
  }
  if (type === 'month') {
    const value = $('#date-month-value').value;
    return { type, value };
  }
  if (type === 'season') {
    const season = $('#date-season-value').value;
    const year = $('#date-year-value').value.trim();
    return { type, season, year };
  }
  return { type: 'unknown' };
}

function getCheckedValues(selector) {
  return $$(selector + ' input:checked').map((input) => input.value);
}

function upsertPlace(name) {
  const existing = state.places.find((place) => place.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    existing.updatedAt = Date.now();
    return existing.id;
  }
  const now = Date.now();
  const place = { id: uid('place'), name, createdAt: now, updatedAt: now };
  state.places.push(place);
  return place.id;
}

function renderMemoryCard(memory) {
  const title = memory.title || memory.body || memory.lowEnergyLine || 'Untitled memory';
  const dateLabel = formatDateLabel(memory);
  const section = state.sections.find((section) => section.id === memory.sectionId);
  const people = (memory.peopleIds || [])
    .map((id) => state.people.find((person) => person.id === id))
    .filter(Boolean)
    .map((person) => person.name);
  const tags = memory.tags || [];
  const mediaCount = memory.media?.length || 0;

  return `
    <div class="memory-card" role="button" tabindex="0" aria-label="Open memory: ${escapeHtml(title)}" data-action="open-detail" data-memory-id="${memory.id}">
      <strong>${escapeHtml(title)}</strong>
      <div class="memory-meta">
        <span>${escapeHtml(dateLabel)}</span>
        <span class="badge">${escapeHtml(memory.visibility.type)}</span>
        ${memory.lowEnergy ? '<span class="badge neutral">Low energy</span>' : ''}
        ${section ? `<span>${escapeHtml(section.name)}</span>` : ''}
        ${mediaCount ? `<span>${mediaCount} media</span>` : ''}
      </div>
      ${people.length ? `<div class="memory-meta">People: ${escapeHtml(people.join(', '))}</div>` : ''}
      ${tags.length ? `<div class="memory-meta">Tags: ${escapeHtml(tags.join(', '))}</div>` : ''}
    </div>
  `;
}

function handlePhotoUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  addMediaFile(file, 'photo');
  event.target.value = '';
}

async function addMediaFile(file, kind, nameOverride) {
  const name = nameOverride || file.name || (kind === 'audio' ? 'voice-note.webm' : 'photo');
  const type = file.type || (kind === 'audio' ? 'audio/webm' : 'image/*');
  const size = file.size || 0;
  setMediaStatus(true);
  try {
    const id = await mediaStore.putMedia(file, {
      id: uid('media'),
      name,
      type,
      size,
      kind,
      createdAt: Date.now()
    });
    ui.mediaDraft.push({ id, kind, name, type, size });
    ui.mediaPreviews[id] = URL.createObjectURL(file);
    renderMediaPreview();
  } finally {
    setMediaStatus(false);
  }
}

function renderMediaPreview() {
  const container = $('#media-preview');
  if (!ui.mediaDraft.length) {
    container.innerHTML = emptyStateHTML('Add a photo or a voice note if you want to.');
    return;
  }
  container.innerHTML = ui.mediaDraft
    .map((item) => {
      const preview = ui.mediaPreviews[item.id];
      const content = item.kind === 'photo'
        ? (preview ? `<img src="${preview}" alt="Photo preview" />` : '<div class="empty-state">Photo ready</div>')
        : (preview ? `<audio controls src="${preview}"></audio>` : '<div class="empty-state">Audio ready</div>');
      return `
        <div class="memory-card">
          ${content}
          <button type="button" class="ghost-button" data-action="remove-media" data-media-id="${item.id}">Remove</button>
        </div>
      `;
    })
    .join('');
}

function setMediaStatus(isActive) {
  const status = $('#media-status');
  if (!status) return;
  status.hidden = !isActive;
}

function setRecordingIndicator(isRecording) {
  const indicator = $('#recording-indicator');
  if (!indicator) return;
  indicator.hidden = !isRecording;
}

async function loadExistingMedia(media) {
  if (!media?.length) return;
  for (const item of media) {
    const record = await mediaStore.getMedia(item.id);
    if (record?.blob) {
      ui.mediaPreviews[item.id] = URL.createObjectURL(record.blob);
    }
  }
  renderMediaPreview();
}

function removeMedia(id) {
  ui.mediaDraft = ui.mediaDraft.filter((item) => item.id !== id);
  ui.removedMedia.push(id);
  if (ui.mediaPreviews[id]) {
    URL.revokeObjectURL(ui.mediaPreviews[id]);
    delete ui.mediaPreviews[id];
  }
  renderMediaPreview();
}

async function startRecording() {
  if (recorder) return;
  try {
    discardRecording = false;
    recorderStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recorder = new MediaRecorder(recorderStream);
    recorderChunks = [];
    recorder.ondataavailable = (event) => recorderChunks.push(event.data);
    recorder.onstop = async () => {
      if (discardRecording) {
        recorderChunks = [];
        discardRecording = false;
        return;
      }
      const mimeType = recorder.mimeType || 'audio/webm';
      const blob = new Blob(recorderChunks, { type: mimeType });
      await addMediaFile(blob, 'audio', 'voice-note.webm');
      recorderChunks = [];
    };
    recorder.start();
    setRecordingIndicator(true);
    toggleRecordButtons(true);
  } catch (error) {
    showToast('Microphone access was blocked. You can add audio later.', { type: 'error' });
  }
}

function stopRecording(silent = false) {
  if (!recorder) return;
  if (silent) discardRecording = true;
  recorder.stop();
  recorderStream?.getTracks().forEach((track) => track.stop());
  recorder = null;
  recorderStream = null;
  toggleRecordButtons(false);
  setRecordingIndicator(false);
  if (!silent) {
    showToast('Recording saved.', { type: 'success' });
  }
}

function toggleRecordButtons(isRecording) {
  const start = $('[data-action="start-record"]');
  const stop = $('[data-action="stop-record"]');
  start.disabled = isRecording;
  stop.disabled = !isRecording;
}

function handlePersonSubmit(event) {
  event.preventDefault();
  const name = $('#person-name').value.trim();
  if (!name) return;
  const note = $('#person-note').value.trim();
  const now = Date.now();
  state.people.push({ id: uid('person'), name, note, createdAt: now, updatedAt: now });
  saveState();
  closeOverlay('person-modal');
  $('#person-form').reset();
  renderPeople();
  renderPeopleOptions();
  renderSelectedPeopleOptions();
}

function handleSectionSubmit(event) {
  event.preventDefault();
  const name = $('#section-name').value.trim();
  if (!name) return;
  const visibility = $('#section-visibility').value;
  const now = Date.now();
  state.sections.push({
    id: uid('section'),
    name,
    system: false,
    defaultVisibility: visibility,
    createdAt: now,
    updatedAt: now
  });
  saveState();
  closeOverlay('section-modal');
  $('#section-form').reset();
  renderSections();
  renderMemoryForm();
}

function handleSettingsChange(event) {
  const target = event.target;
  const setting = target.dataset.setting;
  if (!setting) return;
  const value = target.type === 'checkbox' ? target.checked : target.value;
  state.settings[setting] = value;
  const skipSync = setting === 'cloudSync' && value;
  saveState({ skipSync });
  renderPrompt();
  renderLibrary();
  updateStorageStatus();
  if (setting === 'cloudSync' && value) {
    restoreFromCloud(true);
  }
  if (setting === 'cloudSync' && !value) {
    ui.cloudRestoreAttempted = false;
    ui.syncErrorMessage = '';
    ui.syncErrorNotified = false;
    syncRetryCount = 0;
    clearTimeout(syncRetryTimer);
  }
  if (setting === 'reducedMotion') {
    document.documentElement.style.scrollBehavior = value ? 'auto' : 'smooth';
  }
}

function openOnboarding() {
  ui.onboardingStep = 0;
  renderOnboarding();
  openOverlay('onboarding');
}

function renderOnboarding() {
  const steps = [
    {
      title: 'Welcome to EverKeep',
      body: `
        <p>A calm, personal space to keep stories, photos, voices, and memories.</p>
        <p>No streaks. No guilt. Small steps count.</p>
      `,
      actions: [
        { label: 'Skip', action: 'finish-onboarding', style: 'ghost' },
        { label: 'Continue', action: 'next-onboarding', style: 'primary' }
      ]
    },
    {
      title: 'Private by default',
      body: `
        <p>Nothing is shared unless you choose.</p>
        <p>You can always see and change visibility on every memory.</p>
      `,
      actions: [
        { label: 'Back', action: 'prev-onboarding', style: 'ghost' },
        { label: 'Continue', action: 'next-onboarding', style: 'primary' }
      ]
    },
    {
      title: 'Choose your prompt style',
      body: `
        <div class="stack">
          <button type="button" class="primary-card" data-action="set-prompt" data-style="gentle">Gentle</button>
          <button type="button" class="primary-card" data-action="set-prompt" data-style="curious">Curious</button>
          <button type="button" class="primary-card" data-action="set-prompt" data-style="quiet">Quiet</button>
        </div>
      `,
      actions: [
        { label: 'Skip for now', action: 'finish-onboarding', style: 'ghost' },
        { label: 'Finish', action: 'finish-onboarding', style: 'primary' }
      ]
    }
  ];

  const step = steps[ui.onboardingStep];
  $('#onboarding-title').textContent = step.title;
  $('#onboarding-body').innerHTML = step.body;
  $('#onboarding-actions').innerHTML = step.actions
    .map((item) => {
      const className = item.style === 'primary' ? 'primary-button' : 'ghost-button';
      return `<button type="button" class="${className}" data-action="${item.action}">${item.label}</button>`;
    })
    .join('');
}

document.addEventListener('click', (event) => {
  const action = event.target.closest('[data-action]');
  if (!action) return;
  const type = action.dataset.action;
  if (type === 'next-onboarding') {
    ui.onboardingStep = Math.min(ui.onboardingStep + 1, 2);
    renderOnboarding();
  } else if (type === 'prev-onboarding') {
    ui.onboardingStep = Math.max(ui.onboardingStep - 1, 0);
    renderOnboarding();
  } else if (type === 'finish-onboarding') {
    localStorage.setItem(ONBOARDING_KEY, 'done');
    closeOverlay('onboarding');
  } else if (type === 'set-prompt') {
    state.settings.promptStyle = action.dataset.style;
    saveState();
    renderPrompt();
    localStorage.setItem(ONBOARDING_KEY, 'done');
    closeOverlay('onboarding');
  } else if (type === 'open-detail') {
    const id = action.dataset.memoryId;
    openDetail(id);
  }
});

function openDetail(memoryId) {
  const memory = state.memories.find((item) => item.id === memoryId);
  if (!memory) return;
  $('#detail-title').textContent = memory.title || 'Memory';
  const detail = $('#detail-body');
  detail.innerHTML = `
    <div class="stack">
      <p class="badge">${escapeHtml(memory.visibility.type)}</p>
      <p><strong>${escapeHtml(formatDateLabel(memory))}</strong></p>
      ${memory.body ? `<p>${escapeHtml(memory.body)}</p>` : ''}
      ${memory.lowEnergyLine ? `<p>${escapeHtml(memory.lowEnergyLine)}</p>` : ''}
      ${memory.peopleIds?.length ? `<p class="panel-note">People: ${escapeHtml(memory.peopleIds.map((id) => state.people.find((person) => person.id === id)?.name).filter(Boolean).join(', '))}</p>` : ''}
      ${memory.tags?.length ? `<p class="panel-note">Tags: ${escapeHtml(memory.tags.join(', '))}</p>` : ''}
      ${memory.placeId ? `<p class="panel-note">Place: ${escapeHtml(getPlaceName(state.places, memory.placeId))}</p>` : ''}
    </div>
    <div class="media-preview" id="detail-media"></div>
  `;
  $('#detail-actions').innerHTML = `
    <button type="button" class="ghost-button" data-action="edit-memory" data-memory-id="${memory.id}">Edit</button>
    <button type="button" class="ghost-button" data-action="export-memory" data-memory-id="${memory.id}">Export</button>
    <button type="button" class="ghost-button" data-action="delete-memory" data-memory-id="${memory.id}">Delete</button>
  `;
  renderDetailMedia(memory);
  openOverlay('detail-modal');
}

async function renderDetailMedia(memory) {
  const container = $('#detail-media');
  if (!memory.media?.length) return;
  const items = await Promise.all(
    memory.media.map(async (item) => {
      const record = await mediaStore.getMedia(item.id);
      if (!record?.blob) return '';
      const url = URL.createObjectURL(record.blob);
      ui.detailMediaPreviews[item.id] = url;
      if (item.kind === 'photo') {
        return `<img src="${url}" alt="Photo" />`;
      }
      return `<audio controls src="${url}"></audio>`;
    })
  );
  container.innerHTML = items.join('');
}

function clearDetailMedia() {
  Object.values(ui.detailMediaPreviews).forEach((url) => URL.revokeObjectURL(url));
  ui.detailMediaPreviews = {};
}

async function deleteMemory(id) {
  const memory = state.memories.find((item) => item.id === id);
  if (!memory) return;
  const confirmed = await showConfirm({
    title: 'Delete this memory?',
    body: 'This cannot be undone.',
    confirmLabel: 'Delete',
    cancelLabel: 'Keep it'
  });
  if (!confirmed) return;
  state.memories = state.memories.filter((item) => item.id !== id);
  memory.media?.forEach((item) => mediaStore.deleteMedia(item.id));
  saveState();
  closeOverlay('detail-modal');
  renderAll();
  showToast('Memory deleted.', { type: 'info' });
}

function exportMemory(id) {
  const memory = state.memories.find((item) => item.id === id);
  if (!memory) return;
  const payload = {
    exportedAt: new Date().toISOString(),
    memory
  };
  downloadJson(payload, `everkeep-memory-${id}.json`);
  showToast('Memory export ready.', { type: 'success' });
}

function exportAll() {
  const payload = {
    exportedAt: new Date().toISOString(),
    note: 'Media blobs are stored on this device. This export includes metadata only.',
    data: {
      memories: state.memories,
      sections: state.sections,
      people: state.people,
      places: state.places
    }
  };
  downloadJson(payload, 'everkeep-export.json');
  showToast('Export ready.', { type: 'success' });
}

function downloadJson(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function updateStorageStatus() {
  const status = $('#storage-status');
  status.classList.toggle('is-syncing', syncInFlight);
  status.classList.toggle('is-error', Boolean(ui.syncErrorMessage));
  if (state.settings.cloudSync) {
    if (syncInFlight) {
      status.textContent = ui.syncLabel || 'Syncing...';
    } else {
      status.textContent = ui.syncErrorMessage || (navigator.onLine ? 'Backed up (beta)' : 'Backup paused (offline)');
    }
    return;
  }
  status.textContent = 'Saved on this device';
}

function updateConnectionStatus() {
  const online = navigator.onLine;
  $('#connection-status').textContent = online ? 'Online' : 'Offline';
  updateStorageStatus();
  if (online) {
    scheduleCloudSync();
  }
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').then((registration) => {
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            showToast('Update available.', {
              duration: 0,
              actionLabel: 'Reload',
              onAction: () => {
                if (registration.waiting) {
                  registration.waiting.postMessage({ type: 'SKIP_WAITING' });
                }
              }
            });
          }
        });
      });
    });

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      window.location.reload();
    });
  }
}

function getOwnerKey() {
  let key = localStorage.getItem(OWNER_KEY_STORAGE);
  if (!key) {
    key = generateOwnerKey();
    localStorage.setItem(OWNER_KEY_STORAGE, key);
  }
  return key;
}

function generateOwnerKey() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : uid('owner');
}

function showToast(message, options = {}) {
  const container = $('#toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  const type = options.type || 'info';
  toast.className = `toast ${type === 'error' ? 'is-error' : ''} ${type === 'success' ? 'is-success' : ''}`.trim();
  const text = document.createElement('span');
  text.textContent = message;
  toast.appendChild(text);
  if (options.actionLabel) {
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'toast-action';
    action.textContent = options.actionLabel;
    action.addEventListener('click', () => {
      if (typeof options.onAction === 'function') {
        options.onAction();
      }
      toast.remove();
    });
    toast.appendChild(action);
  }
  container.appendChild(toast);
  const duration = typeof options.duration === 'number' ? options.duration : 3200;
  if (duration > 0) {
    setTimeout(() => {
      toast.remove();
    }, duration);
  }
}

async function copyOwnerKey() {
  const key = getOwnerKey();
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(key);
      showToast('Device key copied.', { type: 'success' });
      return;
    } catch (error) {
      console.warn('Clipboard copy failed', error);
    }
  }
  const input = document.createElement('input');
  input.value = key;
  document.body.appendChild(input);
  input.select();
  document.execCommand('copy');
  document.body.removeChild(input);
  showToast('Device key copied.', { type: 'success' });
}

async function rotateOwnerKey() {
  const confirmed = await showConfirm({
    title: 'Rotate backup key?',
    body: 'This creates a new backup identity. The old backup will remain in the database.',
    confirmLabel: 'Rotate',
    cancelLabel: 'Keep current'
  });
  if (!confirmed) return;
  const nextKey = generateOwnerKey();
  localStorage.setItem(OWNER_KEY_STORAGE, nextKey);
  ui.cloudRestoreAttempted = true;
  renderSettings();
  showToast('Backup key rotated.', { type: 'success' });
  scheduleCloudSync();
}

function clearSyncError() {
  const hadError = Boolean(ui.syncErrorMessage);
  ui.syncErrorMessage = '';
  ui.syncErrorNotified = false;
  syncRetryCount = 0;
  clearTimeout(syncRetryTimer);
  if (hadError) {
    showToast('Backup restored.', { type: 'success' });
  }
}

function handleSyncError(message, retryFn) {
  ui.syncErrorMessage = message;
  if (!ui.syncErrorNotified) {
    showToast(message, { type: 'error' });
    ui.syncErrorNotified = true;
  }
  syncRetryCount += 1;
  const delay = Math.min(60000, 2000 * Math.pow(2, syncRetryCount));
  clearTimeout(syncRetryTimer);
  syncRetryTimer = setTimeout(() => {
    if (navigator.onLine) {
      retryFn();
    }
  }, delay);
}

function scheduleCloudSync() {
  if (!state.settings.cloudSync) return;
  if (!navigator.onLine) return;
  if (!ui.cloudRestoreAttempted) {
    restoreFromCloud(true);
    return;
  }
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    backupToCloud();
  }, 800);
}

async function backupToCloud() {
  if (!state.settings.cloudSync || syncInFlight) return;
  syncInFlight = true;
  ui.syncLabel = 'Backing up...';
  updateStorageStatus();
  const payload = {
    ownerKey: getOwnerKey(),
    state,
    clientUpdatedAt: Date.now()
  };
  try {
    const response = await fetch(`${API_BASE}?action=backup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || 'Backup failed');
    }
    clearSyncError();
  } catch (error) {
    console.warn('Cloud backup failed', error);
    handleSyncError('Backup failed. Retrying...', backupToCloud);
  } finally {
    syncInFlight = false;
    ui.syncLabel = '';
    updateStorageStatus();
  }
}

async function restoreFromCloud(triggerSync = false) {
  if (!state.settings.cloudSync || !navigator.onLine) return;
  ui.cloudRestoreAttempted = true;
  syncInFlight = true;
  ui.syncLabel = 'Restoring...';
  updateStorageStatus();
  try {
    const response = await fetch(`${API_BASE}?action=restore&ownerKey=${encodeURIComponent(getOwnerKey())}`);
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || 'Restore failed');
    }
    if (!data.state) return;
    const merged = mergeRemoteState(state, data.state);
    state = normaliseState(merged);
    saveState({ skipSync: true });
    renderAll();
    if (triggerSync) {
      scheduleCloudSync();
    }
    clearSyncError();
  } catch (error) {
    console.warn('Cloud restore failed', error);
    handleSyncError('Restore failed. Retrying...', () => restoreFromCloud(triggerSync));
  } finally {
    syncInFlight = false;
    ui.syncLabel = '';
    updateStorageStatus();
  }
}

function queueDraftSave() {
  if ($('#memory-id').value) return;
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    const draft = collectDraft();
    if (draft) {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      $('#restore-draft').hidden = false;
    }
  }, 300);
}

function collectDraft() {
  const title = $('#memory-title-input').value.trim();
  const body = $('#memory-body').value.trim();
  const lowEnergy = $('#low-energy').checked;
  const lowEnergyLine = $('#low-energy-line').value.trim();
  const sectionId = $('#memory-section').value;
  const visibility = $('#memory-visibility').value;
  const date = readDate();
  const tags = $('#memory-tags').value.trim();
  const placeName = $('#memory-place').value.trim();
  return {
    title,
    body,
    lowEnergy,
    lowEnergyLine,
    sectionId,
    visibility,
    date,
    tags,
    placeName,
    media: ui.mediaDraft
  };
}

function restoreDraft() {
  const draft = safeParse(localStorage.getItem(DRAFT_KEY));
  if (!draft) return;
  $('#memory-title-input').value = draft.title || '';
  $('#memory-body').value = draft.body || '';
  $('#low-energy').checked = draft.lowEnergy || false;
  $('#low-energy-line').value = draft.lowEnergyLine || '';
  $('#memory-section').value = draft.sectionId || state.sections[0].id;
  $('#memory-visibility').value = draft.visibility || 'Private';
  $('#memory-tags').value = draft.tags || '';
  $('#memory-place').value = draft.placeName || '';
  setDateFields(draft.date || { type: 'exact', value: '' });
  ui.mediaDraft = draft.media || [];
  ui.mediaPreviews = {};
  renderPeopleOptions();
  handleVisibilityChange();
  renderMediaPreview();
  loadExistingMedia(ui.mediaDraft);
}

init();
