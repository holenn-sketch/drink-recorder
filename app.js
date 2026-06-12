'use strict';

const PEOPLE_STORAGE_KEY = 'drink_people_records';
const QUICK_STORAGE_KEY = 'drink_quick_amounts';
const SYNC_CLIENT_STORAGE_KEY = 'drink_sync_client_id';
const PROFILE_STORAGE_KEY = 'drink_user_profile';
const INVALID_AMOUNT_MESSAGE = '请输入 0.25 的整数倍，例如 0.25、0.5、0.75、1';
const DEFAULT_ROOM_ID = 'party';

const DEFAULT_QUICK_AMOUNTS = [
  { id: 'default_025', label: '0.25', quarters: 1 },
  { id: 'default_05', label: '0.5', quarters: 2 },
  { id: 'default_1', label: '1', quarters: 4 }
];

const state = {
  people: [],
  quickAmounts: [],
  sortMode: 'created',
  inputDialog: null,
  confirmDialog: null,
  toastTimer: null,
  sync: {
    clientId: '',
    roomId: DEFAULT_ROOM_ID,
    enabled: false,
    status: 'local',
    revision: 0,
    eventSource: null,
    applyingRemote: false
  },
  profile: {
    name: '访客'
  }
};

const elements = {};

document.addEventListener('DOMContentLoaded', init);

function init() {
  cacheElements();
  state.sync.clientId = getClientId();
  state.sync.roomId = getRoomId();
  state.sync.enabled = canUseRealtimeSync();
  state.profile = loadProfile();
  state.people = loadPeople();
  state.quickAmounts = loadQuickAmounts();
  bindEvents();
  render();
  startRealtimeSync();
}

function cacheElements() {
  elements.peopleList = document.querySelector('#peopleList');
  elements.statPeopleCount = document.querySelector('#statPeopleCount');
  elements.statTotalCups = document.querySelector('#statTotalCups');
  elements.statTopPerson = document.querySelector('#statTopPerson');
  elements.statTopCups = document.querySelector('#statTopCups');
  elements.sortToggleText = document.querySelector('#sortToggleText');
  elements.toast = document.querySelector('#toast');
  elements.syncCluster = document.querySelector('.sync-cluster');
  elements.syncStatusLabel = document.querySelector('#syncStatusLabel');
  elements.syncRoomLabel = document.querySelector('#syncRoomLabel');
  elements.copyShareLinkButton = document.querySelector('#copyShareLinkButton');
  elements.editProfileButton = document.querySelector('#editProfileButton');

  elements.addPersonButton = document.querySelector('#addPersonButton');
  elements.openQuickPanelButton = document.querySelector('#openQuickPanelButton');
  elements.resetAllButton = document.querySelector('#resetAllButton');
  elements.clearAllButton = document.querySelector('#clearAllButton');
  elements.sortToggleButton = document.querySelector('#sortToggleButton');

  elements.quickPanel = document.querySelector('#quickPanel');
  elements.closeQuickPanelButton = document.querySelector('#closeQuickPanelButton');
  elements.quickAmountInput = document.querySelector('#quickAmountInput');
  elements.addQuickAmountButton = document.querySelector('#addQuickAmountButton');
  elements.quickAmountList = document.querySelector('#quickAmountList');
  elements.restoreDefaultButton = document.querySelector('#restoreDefaultButton');

  elements.inputModal = document.querySelector('#inputModal');
  elements.inputModalTitle = document.querySelector('#inputModalTitle');
  elements.inputModalSubtitle = document.querySelector('#inputModalSubtitle');
  elements.inputModalLabel = document.querySelector('#inputModalLabel');
  elements.modalInput = document.querySelector('#modalInput');
  elements.inputModalError = document.querySelector('#inputModalError');
  elements.inputCancelButton = document.querySelector('#inputCancelButton');
  elements.inputConfirmButton = document.querySelector('#inputConfirmButton');

  elements.confirmModal = document.querySelector('#confirmModal');
  elements.confirmModalTitle = document.querySelector('#confirmModalTitle');
  elements.confirmModalMessage = document.querySelector('#confirmModalMessage');
  elements.confirmCancelButton = document.querySelector('#confirmCancelButton');
  elements.confirmOkButton = document.querySelector('#confirmOkButton');
}

function bindEvents() {
  elements.addPersonButton.addEventListener('click', openAddPersonDialog);
  elements.openQuickPanelButton.addEventListener('click', openQuickPanel);
  elements.closeQuickPanelButton.addEventListener('click', closeQuickPanel);
  elements.resetAllButton.addEventListener('click', resetAllPeople);
  elements.clearAllButton.addEventListener('click', clearAllPeople);
  elements.sortToggleButton.addEventListener('click', toggleSortMode);
  elements.copyShareLinkButton.addEventListener('click', copyShareLink);
  elements.editProfileButton.addEventListener('click', openProfileDialog);
  elements.addQuickAmountButton.addEventListener('click', addQuickAmountFromInput);
  elements.restoreDefaultButton.addEventListener('click', restoreDefaultQuickAmounts);

  elements.peopleList.addEventListener('click', handlePeopleListClick);
  elements.quickAmountList.addEventListener('click', handleQuickListClick);
  elements.inputCancelButton.addEventListener('click', closeInputDialog);
  elements.inputConfirmButton.addEventListener('click', submitInputDialog);
  elements.confirmCancelButton.addEventListener('click', closeConfirmDialog);
  elements.confirmOkButton.addEventListener('click', submitConfirmDialog);

  elements.modalInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      submitInputDialog();
    }
  });

  elements.quickAmountInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      addQuickAmountFromInput();
    }
  });

  elements.quickPanel.addEventListener('click', (event) => {
    if (event.target === elements.quickPanel) {
      closeQuickPanel();
    }
  });

  elements.inputModal.addEventListener('click', (event) => {
    if (event.target === elements.inputModal) {
      closeInputDialog();
    }
  });

  elements.confirmModal.addEventListener('click', (event) => {
    if (event.target === elements.confirmModal) {
      closeConfirmDialog();
    }
  });

  window.addEventListener('storage', syncFromStorage);
}

function generateId(prefix) {
  const random = Math.random().toString(36).slice(2, 9);
  return `${prefix}_${Date.now()}_${random}`;
}

function formatCupsByQuarters(quarters) {
  const normalizedQuarters = Math.max(0, Number.isFinite(Number(quarters)) ? Math.round(Number(quarters)) : 0);
  const cups = normalizedQuarters / 4;
  return Number.isInteger(cups) ? String(cups) : String(cups).replace(/0+$/, '').replace(/\.$/, '');
}

function parseCupInputToQuarters(input) {
  const text = String(input || '').trim();
  if (!text) {
    return null;
  }

  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  const quarters = Math.round(value * 4);
  if (Math.abs(value * 4 - quarters) > 0.000001 || quarters <= 0) {
    return null;
  }

  return quarters;
}

function savePeople() {
  try {
    localStorage.setItem(PEOPLE_STORAGE_KEY, JSON.stringify(state.people));
  } catch (error) {
    showToast('人员记录保存失败');
  }
}

function loadPeople() {
  try {
    const raw = localStorage.getItem(PEOPLE_STORAGE_KEY);
    const parsed = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item, index) => normalizePerson(item, index))
      .filter(Boolean);
  } catch (error) {
    return [];
  }
}

function saveQuickAmounts() {
  try {
    localStorage.setItem(QUICK_STORAGE_KEY, JSON.stringify(state.quickAmounts));
  } catch (error) {
    showToast('快捷酒量保存失败');
  }
}

function getClientId() {
  try {
    const cachedId = localStorage.getItem(SYNC_CLIENT_STORAGE_KEY);
    if (cachedId) {
      return cachedId;
    }

    const clientId = generateId('client');
    localStorage.setItem(SYNC_CLIENT_STORAGE_KEY, clientId);
    return clientId;
  } catch (error) {
    return generateId('client');
  }
}

function getRoomId() {
  try {
    const params = new URLSearchParams(window.location.search);
    const rawRoom = params.get('room') || DEFAULT_ROOM_ID;
    const normalized = rawRoom.trim().replace(/[^\w\u4e00-\u9fa5-]/g, '-').slice(0, 48);
    return normalized || DEFAULT_ROOM_ID;
  } catch (error) {
    return DEFAULT_ROOM_ID;
  }
}

function canUseRealtimeSync() {
  return Boolean(window.DRINK_SYNC_ENDPOINT);
}

function loadProfile() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) || '{}');
    const name = String(parsed.name || '').trim();
    return { name: name || '访客' };
  } catch (error) {
    return { name: '访客' };
  }
}

function saveProfile() {
  try {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(state.profile));
  } catch (error) {
    showToast('名称保存失败');
  }
}

function loadQuickAmounts() {
  try {
    const raw = localStorage.getItem(QUICK_STORAGE_KEY);
    const parsed = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed)) {
      return cloneDefaultQuickAmounts();
    }

    const normalized = parsed
      .map((item, index) => normalizeQuickAmount(item, index))
      .filter(Boolean);

    return normalized.length ? normalized : cloneDefaultQuickAmounts();
  } catch (error) {
    return cloneDefaultQuickAmounts();
  }
}

function getStats() {
  const totalPeople = state.people.length;
  const totalQuarters = state.people.reduce((sum, person) => sum + person.quarters, 0);
  const topPerson = state.people.reduce((currentTop, person) => {
    if (!currentTop || person.quarters > currentTop.quarters) {
      return person;
    }
    return currentTop;
  }, null);

  const hasTopPerson = topPerson && topPerson.quarters > 0;

  return {
    totalPeople,
    totalCups: formatCupsByQuarters(totalQuarters),
    topName: hasTopPerson ? topPerson.name : '暂无',
    topCups: hasTopPerson ? `${formatCupsByQuarters(topPerson.quarters)} 杯` : '0 杯'
  };
}

function normalizePerson(item, index) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const name = String(item.name || '').trim();
  const quarters = Number(item.quarters);
  const createdAt = Number(item.createdAt);

  return {
    id: typeof item.id === 'string' && item.id ? item.id : generateId(`person_${index}`),
    name: name || '未命名',
    quarters: Number.isFinite(quarters) && quarters > 0 ? Math.round(quarters) : 0,
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now() + index
  };
}

function normalizeQuickAmount(item, index) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const quarters = Number(item.quarters);
  if (!Number.isFinite(quarters) || quarters <= 0 || !Number.isInteger(quarters)) {
    return null;
  }

  return {
    id: typeof item.id === 'string' && item.id ? item.id : generateId(`quick_${index}`),
    label: formatCupsByQuarters(quarters),
    quarters
  };
}

function cloneDefaultQuickAmounts() {
  return DEFAULT_QUICK_AMOUNTS.map((item) => ({ ...item }));
}

function render() {
  renderStats();
  renderSortButton();
  renderSyncStatus();
  renderPeopleList();
  renderQuickAmounts();
}

function renderStats() {
  const stats = getStats();
  elements.statPeopleCount.textContent = stats.totalPeople;
  elements.statTotalCups.textContent = stats.totalCups;
  elements.statTopPerson.textContent = stats.topName;
  elements.statTopCups.textContent = stats.topCups;
}

function renderSortButton() {
  elements.sortToggleText.textContent = state.sortMode === 'created'
    ? '排序：添加顺序'
    : '排序：酒量从高到低';
}

function renderSyncStatus() {
  if (!elements.syncCluster) {
    return;
  }

  const statusMap = {
    local: '本地模式',
    connecting: '连接中',
    connected: '已同步',
    offline: '同步断开'
  };

  elements.syncStatusLabel.textContent = statusMap[state.sync.status] || statusMap.local;
  elements.syncRoomLabel.textContent = state.sync.enabled ? `房间：${state.sync.roomId}` : '单机本地';
  elements.editProfileButton.textContent = `我：${state.profile.name}`;
  elements.syncCluster.classList.toggle('is-connecting', state.sync.status === 'connecting');
  elements.syncCluster.classList.toggle('is-connected', state.sync.status === 'connected');
  elements.syncCluster.classList.toggle('is-offline', state.sync.status === 'offline');
}

function renderPeopleList() {
  if (!state.people.length) {
    elements.peopleList.innerHTML = `
      <section class="empty-card">
        <div class="empty-glass" aria-hidden="true"></div>
        <h3>还没有参与者</h3>
        <p>点击添加人员开始记录</p>
        <button class="press-button add-button" type="button" data-action="empty-add">
          <span class="button-symbol">+</span>
          <span>添加人员</span>
        </button>
      </section>
    `;
    return;
  }

  const sortedPeople = getSortedPeople();
  elements.peopleList.innerHTML = sortedPeople.map(renderPersonCard).join('');
}

function renderPersonCard(person) {
  const quickAddButtons = state.quickAmounts
    .map((amount) => renderAmountButton(person.id, amount, 'add'))
    .join('');
  const quickMinusButtons = state.quickAmounts
    .map((amount) => renderAmountButton(person.id, amount, 'minus'))
    .join('');

  return `
    <article class="person-card">
      <div class="card-top">
        <div class="person-name-wrap">
          <span class="avatar-badge">${escapeHtml(getNameInitial(person.name))}</span>
          <div>
            <h3 title="${escapeHtml(person.name)}">${escapeHtml(person.name)}</h3>
            <p>${formatCreatedAt(person.createdAt)}</p>
          </div>
        </div>
        <div class="amount-plaque" aria-label="${escapeHtml(person.name)} 当前累计杯数">
          <strong>${formatCupsByQuarters(person.quarters)}</strong>
          <span>杯</span>
        </div>
      </div>

      <section class="amount-section">
        <p class="amount-section-title">增加</p>
        <div class="quick-grid">${quickAddButtons}</div>
      </section>

      <section class="amount-section">
        <p class="amount-section-title">减少</p>
        <div class="quick-grid">${quickMinusButtons}</div>
      </section>

      <div class="card-actions">
        <button class="press-button leather-button" type="button" data-action="reset-person" data-person-id="${escapeHtml(person.id)}">清零</button>
        <button class="press-button danger-button" type="button" data-action="delete-person" data-person-id="${escapeHtml(person.id)}">删除</button>
      </div>
    </article>
  `;
}

function renderAmountButton(personId, amount, operation) {
  const sign = operation === 'add' ? '+' : '-';
  const buttonClass = operation === 'add' ? 'add-button' : 'minus-button';

  return `
    <button
      class="press-button amount-button ${buttonClass}"
      type="button"
      data-action="${operation}-amount"
      data-person-id="${escapeHtml(personId)}"
      data-quarters="${amount.quarters}"
    >${sign}${escapeHtml(amount.label)} 杯</button>
  `;
}

function renderQuickAmounts() {
  elements.quickAmountList.innerHTML = state.quickAmounts.map((amount) => `
    <li class="quick-item">
      <div class="quick-value">
        <span>${escapeHtml(amount.label)} 杯</span>
        <small>${amount.quarters} quarters</small>
      </div>
      <button class="press-button brass-button mini-button" type="button" data-action="edit-quick" data-quick-id="${escapeHtml(amount.id)}">编辑</button>
      <button class="press-button danger-button mini-button" type="button" data-action="delete-quick" data-quick-id="${escapeHtml(amount.id)}">删除</button>
    </li>
  `).join('');
}

function getSortedPeople() {
  return [...state.people].sort((a, b) => {
    if (state.sortMode === 'amount') {
      if (b.quarters !== a.quarters) {
        return b.quarters - a.quarters;
      }
    }
    return a.createdAt - b.createdAt;
  });
}

function openAddPersonDialog() {
  openInputDialog({
    title: '添加人员',
    subtitle: '可以允许重名，长姓名会自动省略显示。',
    label: '姓名',
    value: '',
    placeholder: '例如：老王',
    confirmText: '添加',
    validate(value) {
      const name = value.trim();
      if (!name) {
        return { ok: false, message: '姓名不能为空' };
      }
      return { ok: true, value: name };
    },
    onConfirm(name) {
      const person = {
        id: generateId('person'),
        name,
        quarters: 0,
        createdAt: Date.now()
      };
      state.people.push(person);
      savePeople();
      render();
      publishOperation({ type: 'addPerson', person });
      showToast('添加成功');
    }
  });
}

function handlePeopleListClick(event) {
  const button = event.target.closest('button');
  if (!button) {
    return;
  }

  const action = button.dataset.action;
  const personId = button.dataset.personId;

  if (action === 'empty-add') {
    openAddPersonDialog();
    return;
  }

  if (action === 'add-amount' || action === 'minus-amount') {
    const quarters = Number(button.dataset.quarters);
    updatePersonQuarters(personId, action === 'add-amount' ? quarters : -quarters);
    return;
  }

  if (action === 'reset-person') {
    resetPerson(personId);
    return;
  }

  if (action === 'delete-person') {
    deletePerson(personId);
  }
}

function updatePersonQuarters(personId, delta) {
  const person = state.people.find((item) => item.id === personId);
  if (!person || !Number.isFinite(delta)) {
    return;
  }

  person.quarters = Math.max(0, person.quarters + delta);
  savePeople();
  render();
  publishOperation({ type: 'updatePersonQuarters', personId, delta });
}

function resetPerson(personId) {
  const person = state.people.find((item) => item.id === personId);
  if (!person) {
    return;
  }

  person.quarters = 0;
  savePeople();
  render();
  publishOperation({ type: 'resetPerson', personId });
  showToast('已清零');
}

function deletePerson(personId) {
  const person = state.people.find((item) => item.id === personId);
  if (!person) {
    return;
  }

  openConfirmDialog({
    title: '删除人员',
    message: `确认删除「${person.name}」吗？`,
    confirmText: '删除',
    danger: true,
    onConfirm() {
      const originalLength = state.people.length;
      state.people = state.people.filter((item) => item.id !== personId);
      if (state.people.length !== originalLength) {
        savePeople();
        render();
        publishOperation({ type: 'deletePerson', personId });
        showToast('已删除');
      }
    }
  });
}

function resetAllPeople() {
  if (!state.people.length) {
    showToast('暂无人员');
    return;
  }

  openConfirmDialog({
    title: '全部清零',
    message: '确认把所有人的累计杯数清零吗？',
    confirmText: '全部清零',
    danger: false,
    onConfirm() {
      state.people = state.people.map((person) => ({ ...person, quarters: 0 }));
      savePeople();
      render();
      publishOperation({ type: 'resetAllPeople' });
      showToast('全部已清零');
    }
  });
}

function clearAllPeople() {
  if (!state.people.length) {
    showToast('暂无人员');
    return;
  }

  openConfirmDialog({
    title: '清空全部人员',
    message: '确认删除所有参与者和杯数记录吗？这个操作不可撤回。',
    confirmText: '清空',
    danger: true,
    onConfirm() {
      state.people = [];
      try {
        localStorage.removeItem(PEOPLE_STORAGE_KEY);
      } catch (error) {
        savePeople();
      }
      render();
      publishOperation({ type: 'clearAllPeople' });
      showToast('已清空');
    }
  });
}

function toggleSortMode() {
  state.sortMode = state.sortMode === 'created' ? 'amount' : 'created';
  render();
}

function openProfileDialog() {
  openInputDialog({
    title: '编辑我的名称',
    subtitle: '普通网页不能读取真实设备 ID；这里使用浏览器本地匿名身份和你设置的显示名。',
    label: '显示名称',
    value: state.profile.name === '访客' ? '' : state.profile.name,
    placeholder: '例如：阿宁',
    confirmText: '保存',
    validate(value) {
      const name = value.trim();
      if (!name) {
        return { ok: false, message: '名称不能为空' };
      }
      return { ok: true, value: name.slice(0, 18) };
    },
    onConfirm(name) {
      state.profile.name = name;
      saveProfile();
      renderSyncStatus();
      showToast('名称已保存');
    }
  });
}

function copyShareLink() {
  const url = new URL(window.location.href);
  url.searchParams.set('room', state.sync.roomId);
  const text = url.toString();

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text)
      .then(() => showToast('链接已复制'))
      .catch(() => showToast(text));
    return;
  }

  showToast(text);
}

function startRealtimeSync() {
  state.sync.status = state.sync.enabled ? 'offline' : 'local';
  renderSyncStatus();
}

function publishOperation() {
  // Realtime publishing is wired when a deployable sync service is selected.
}

function openQuickPanel() {
  elements.quickPanel.classList.remove('is-hidden');
  elements.quickPanel.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  window.setTimeout(() => elements.quickAmountInput.focus(), 40);
}

function closeQuickPanel() {
  elements.quickPanel.classList.add('is-hidden');
  elements.quickPanel.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
}

function addQuickAmountFromInput() {
  const quarters = parseCupInputToQuarters(elements.quickAmountInput.value);
  if (!quarters) {
    showToast(INVALID_AMOUNT_MESSAGE);
    return;
  }

  const amount = {
    id: generateId('quick'),
    label: formatCupsByQuarters(quarters),
    quarters
  };
  state.quickAmounts.push(amount);
  elements.quickAmountInput.value = '';
  saveQuickAmounts();
  render();
  publishOperation({ type: 'addQuickAmount', amount });
  showToast('新增成功');
}

function handleQuickListClick(event) {
  const button = event.target.closest('button');
  if (!button) {
    return;
  }

  const action = button.dataset.action;
  const quickId = button.dataset.quickId;

  if (action === 'edit-quick') {
    editQuickAmount(quickId);
    return;
  }

  if (action === 'delete-quick') {
    deleteQuickAmount(quickId);
  }
}

function editQuickAmount(quickId) {
  const amount = state.quickAmounts.find((item) => item.id === quickId);
  if (!amount) {
    return;
  }

  openInputDialog({
    title: '修改快捷酒量',
    subtitle: '杯数必须大于 0，且是 0.25 的整数倍。',
    label: '杯数',
    value: amount.label,
    placeholder: '例如：0.75',
    confirmText: '保存',
    validate(value) {
      const quarters = parseCupInputToQuarters(value);
      if (!quarters) {
        return { ok: false, message: INVALID_AMOUNT_MESSAGE };
      }
      return { ok: true, value: quarters };
    },
    onConfirm(quarters) {
      const target = state.quickAmounts.find((item) => item.id === quickId);
      if (!target) {
        return;
      }

      target.quarters = quarters;
      target.label = formatCupsByQuarters(quarters);
      saveQuickAmounts();
      render();
      publishOperation({ type: 'editQuickAmount', quickId, quarters });
      showToast('修改成功');
    }
  });
}

function deleteQuickAmount(quickId) {
  if (state.quickAmounts.length <= 1) {
    showToast('至少保留一个快捷酒量');
    return;
  }

  const amount = state.quickAmounts.find((item) => item.id === quickId);
  if (!amount) {
    return;
  }

  openConfirmDialog({
    title: '删除快捷酒量',
    message: `确认删除「${amount.label} 杯」吗？`,
    confirmText: '删除',
    danger: true,
    onConfirm() {
      const originalLength = state.quickAmounts.length;
      state.quickAmounts = state.quickAmounts.filter((item) => item.id !== quickId);
      if (state.quickAmounts.length !== originalLength) {
        saveQuickAmounts();
        render();
        publishOperation({ type: 'deleteQuickAmount', quickId });
        showToast('已删除');
      }
    }
  });
}

function restoreDefaultQuickAmounts() {
  openConfirmDialog({
    title: '恢复默认快捷酒量',
    message: '确认恢复为 0.25 杯、0.5 杯、1 杯吗？',
    confirmText: '恢复默认',
    danger: false,
    onConfirm() {
      state.quickAmounts = cloneDefaultQuickAmounts();
      saveQuickAmounts();
      render();
      publishOperation({ type: 'restoreDefaultQuickAmounts', quickAmounts: state.quickAmounts });
      showToast('已恢复默认');
    }
  });
}

function openInputDialog(options) {
  state.inputDialog = options;
  elements.inputModalTitle.textContent = options.title;
  elements.inputModalSubtitle.textContent = options.subtitle || '';
  elements.inputModalLabel.textContent = options.label || '内容';
  elements.modalInput.placeholder = options.placeholder || '';
  elements.modalInput.value = options.value || '';
  elements.inputConfirmButton.textContent = options.confirmText || '确认';
  elements.inputModalError.textContent = '';
  elements.inputModal.classList.remove('is-hidden');
  elements.inputModal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  window.setTimeout(() => {
    elements.modalInput.focus();
    elements.modalInput.select();
  }, 40);
}

function closeInputDialog() {
  state.inputDialog = null;
  elements.inputModal.classList.add('is-hidden');
  elements.inputModal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
}

function submitInputDialog() {
  if (!state.inputDialog) {
    return;
  }

  const value = elements.modalInput.value;
  const result = state.inputDialog.validate(value);
  if (!result.ok) {
    elements.inputModalError.textContent = result.message || '输入不正确';
    return;
  }

  const onConfirm = state.inputDialog.onConfirm;
  closeInputDialog();
  onConfirm(result.value);
}

function openConfirmDialog(options) {
  state.confirmDialog = options;
  elements.confirmModalTitle.textContent = options.title || '确认操作';
  elements.confirmModalMessage.textContent = options.message || '';
  elements.confirmOkButton.textContent = options.confirmText || '确认';
  elements.confirmOkButton.classList.toggle('danger-button', options.danger !== false);
  elements.confirmOkButton.classList.toggle('brass-button', options.danger === false);
  elements.confirmModal.classList.remove('is-hidden');
  elements.confirmModal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
}

function closeConfirmDialog() {
  state.confirmDialog = null;
  elements.confirmModal.classList.add('is-hidden');
  elements.confirmModal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
}

function submitConfirmDialog() {
  if (!state.confirmDialog) {
    return;
  }

  const onConfirm = state.confirmDialog.onConfirm;
  closeConfirmDialog();
  onConfirm();
}

function syncFromStorage(event) {
  if (event.key !== PEOPLE_STORAGE_KEY && event.key !== QUICK_STORAGE_KEY) {
    return;
  }

  state.people = loadPeople();
  state.quickAmounts = loadQuickAmounts();
  render();
}

function showToast(message) {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add('is-visible');
  state.toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove('is-visible');
  }, 1800);
}

function getNameInitial(name) {
  return String(name || '人').trim().slice(0, 1) || '人';
}

function formatCreatedAt(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return '添加顺序';
  }

  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${month}-${day} ${hour}:${minute}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
