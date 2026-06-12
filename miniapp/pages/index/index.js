const app = getApp();

const PEOPLE_STORAGE_KEY = 'drink_people_records';
const QUICK_STORAGE_KEY = 'drink_quick_amounts';
const PROFILE_STORAGE_KEY = 'drink_user_profile';
const CLIENT_STORAGE_KEY = 'drink_sync_client_id';
const INVALID_AMOUNT_MESSAGE = '请输入 0.25 的整数倍，例如 0.25、0.5、0.75、1';
const DEFAULT_ROOM_ID = 'party';

const DEFAULT_QUICK_AMOUNTS = [
  { id: 'default_025', label: '0.25', quarters: 1 },
  { id: 'default_05', label: '0.5', quarters: 2 },
  { id: 'default_1', label: '1', quarters: 4 }
];

Page({
  data: {
    people: [],
    displayPeople: [],
    quickAmounts: [],
    sortMode: 'created',
    sortText: '排序：添加顺序',
    quickInputValue: '',
    showQuickPanel: false,
    stats: {
      totalPeople: 0,
      totalCups: '0',
      topName: '暂无',
      topCups: '0 杯'
    },
    profile: {
      name: '访客',
      avatarUrl: '',
      identityProvider: 'guest',
      identityToken: ''
    },
    profileInitial: '访',
    sync: {
      apiBase: '',
      roomId: DEFAULT_ROOM_ID,
      clientId: '',
      status: 'local',
      lastActivity: '',
      socketOpen: false
    },
    syncStatusText: '本地模式',
    inputDialog: {
      visible: false,
      mode: '',
      targetId: '',
      title: '',
      subtitle: '',
      label: '',
      value: '',
      placeholder: '',
      confirmText: '确认',
      error: ''
    }
  },

  onLoad(options) {
    const apiBase = app.globalData.apiBase || '';
    const roomId = normalizeRoomId(options.room || app.globalData.defaultRoomId || DEFAULT_ROOM_ID);
    const profile = loadProfile();
    const sync = {
      ...this.data.sync,
      apiBase,
      roomId,
      clientId: getClientId(),
      status: apiBase ? 'connecting' : 'local'
    };

    this.setData({
      people: loadPeople(),
      quickAmounts: loadQuickAmounts(),
      profile,
      profileInitial: getNameInitial(profile.name),
      sync
    }, () => {
      this.refreshView();
      this.startRealtimeSync();
    });
  },

  onShow() {
    this.setData({
      people: loadPeople(),
      quickAmounts: loadQuickAmounts(),
      profile: loadProfile()
    }, () => this.refreshView());
  },

  onUnload() {
    this.closeSyncSocket();
  },

  onShareAppMessage() {
    return {
      title: '一起记录饮酒杯数',
      path: `/pages/index/index?room=${encodeURIComponent(this.data.sync.roomId || DEFAULT_ROOM_ID)}`
    };
  },

  noop() {},

  refreshView() {
    const stats = getStats(this.data.people);
    const displayPeople = getDisplayPeople(this.data.people, this.data.sortMode);
    this.setData({
      stats,
      displayPeople,
      sortText: this.data.sortMode === 'created' ? '排序：添加顺序' : '排序：酒量从高到低',
      profileInitial: getNameInitial(this.data.profile.name),
      syncStatusText: getSyncStatusText(this.data.sync.status)
    });
  },

  openAddPersonDialog() {
    this.openInputDialog({
      mode: 'addPerson',
      title: '添加人员',
      subtitle: '可以允许重名，长姓名会自动省略显示。',
      label: '姓名',
      value: '',
      placeholder: '例如：老王',
      confirmText: '添加'
    });
  },

  changePersonAmount(event) {
    const personId = event.currentTarget.dataset.personId;
    const delta = Number(event.currentTarget.dataset.delta);
    const person = this.data.people.find((item) => item.id === personId);
    if (!person || !Number.isFinite(delta)) {
      return;
    }

    person.quarters = Math.max(0, person.quarters + delta);
    this.commitPeople(this.data.people);
    this.publishOperation({
      type: 'updatePersonQuarters',
      personId,
      personName: person.name,
      delta
    });
  },

  resetPerson(event) {
    const personId = event.currentTarget.dataset.personId;
    const person = this.data.people.find((item) => item.id === personId);
    if (!person) {
      return;
    }

    person.quarters = 0;
    this.commitPeople(this.data.people);
    this.publishOperation({ type: 'resetPerson', personId, personName: person.name });
    wx.showToast({ title: '已清零', icon: 'success' });
  },

  deletePerson(event) {
    const personId = event.currentTarget.dataset.personId;
    const person = this.data.people.find((item) => item.id === personId);
    if (!person) {
      return;
    }

    wx.showModal({
      title: '删除人员',
      content: `确认删除「${person.name}」吗？`,
      confirmText: '删除',
      confirmColor: '#b33a2e',
      success: (res) => {
        if (!res.confirm) {
          return;
        }

        const nextPeople = this.data.people.filter((item) => item.id !== personId);
        this.commitPeople(nextPeople);
        this.publishOperation({ type: 'deletePerson', personId, personName: person.name });
        wx.showToast({ title: '已删除', icon: 'success' });
      }
    });
  },

  resetAllPeople() {
    if (!this.data.people.length) {
      wx.showToast({ title: '暂无人员', icon: 'none' });
      return;
    }

    wx.showModal({
      title: '全部清零',
      content: '确认把所有人的累计杯数清零吗？',
      confirmText: '清零',
      confirmColor: '#7a4b2a',
      success: (res) => {
        if (!res.confirm) {
          return;
        }

        const nextPeople = this.data.people.map((person) => ({ ...person, quarters: 0 }));
        this.commitPeople(nextPeople);
        this.publishOperation({ type: 'resetAllPeople', count: nextPeople.length });
        wx.showToast({ title: '全部已清零', icon: 'success' });
      }
    });
  },

  clearAllPeople() {
    if (!this.data.people.length) {
      wx.showToast({ title: '暂无人员', icon: 'none' });
      return;
    }

    wx.showModal({
      title: '清空全部人员',
      content: '确认删除所有参与者和杯数记录吗？这个操作不可撤回。',
      confirmText: '清空',
      confirmColor: '#b33a2e',
      success: (res) => {
        if (!res.confirm) {
          return;
        }

        this.commitPeople([]);
        this.publishOperation({ type: 'clearAllPeople' });
        wx.showToast({ title: '已清空', icon: 'success' });
      }
    });
  },

  toggleSortMode() {
    const sortMode = this.data.sortMode === 'created' ? 'amount' : 'created';
    this.setData({ sortMode }, () => this.refreshView());
  },

  openQuickPanel() {
    this.setData({ showQuickPanel: true });
  },

  closeQuickPanel() {
    this.setData({ showQuickPanel: false, quickInputValue: '' });
  },

  handleQuickInput(event) {
    this.setData({ quickInputValue: event.detail.value });
  },

  addQuickAmountFromInput() {
    const quarters = parseCupInputToQuarters(this.data.quickInputValue);
    if (!quarters) {
      wx.showToast({ title: INVALID_AMOUNT_MESSAGE, icon: 'none' });
      return;
    }

    const amount = {
      id: generateId('quick'),
      label: formatCupsByQuarters(quarters),
      quarters
    };
    const quickAmounts = [...this.data.quickAmounts, amount];
    this.commitQuickAmounts(quickAmounts);
    this.setData({ quickInputValue: '' });
    this.publishOperation({ type: 'addQuickAmount', amount });
    wx.showToast({ title: '新增成功', icon: 'success' });
  },

  editQuickAmount(event) {
    const quickId = event.currentTarget.dataset.quickId;
    const amount = this.data.quickAmounts.find((item) => item.id === quickId);
    if (!amount) {
      return;
    }

    this.openInputDialog({
      mode: 'editQuick',
      targetId: quickId,
      title: '修改快捷酒量',
      subtitle: '杯数必须大于 0，且是 0.25 的整数倍。',
      label: '杯数',
      value: amount.label,
      placeholder: '例如：0.75',
      confirmText: '保存'
    });
  },

  deleteQuickAmount(event) {
    const quickId = event.currentTarget.dataset.quickId;
    if (this.data.quickAmounts.length <= 1) {
      wx.showToast({ title: '至少保留一个快捷酒量', icon: 'none' });
      return;
    }

    const amount = this.data.quickAmounts.find((item) => item.id === quickId);
    if (!amount) {
      return;
    }

    wx.showModal({
      title: '删除快捷酒量',
      content: `确认删除「${amount.label} 杯」吗？`,
      confirmText: '删除',
      confirmColor: '#b33a2e',
      success: (res) => {
        if (!res.confirm) {
          return;
        }

        const quickAmounts = this.data.quickAmounts.filter((item) => item.id !== quickId);
        this.commitQuickAmounts(quickAmounts);
        this.publishOperation({ type: 'deleteQuickAmount', quickId, label: amount.label });
        wx.showToast({ title: '已删除', icon: 'success' });
      }
    });
  },

  restoreDefaultQuickAmounts() {
    wx.showModal({
      title: '恢复默认快捷酒量',
      content: '确认恢复为 0.25 杯、0.5 杯、1 杯吗？',
      confirmText: '恢复',
      confirmColor: '#7a4b2a',
      success: (res) => {
        if (!res.confirm) {
          return;
        }

        const quickAmounts = cloneDefaultQuickAmounts();
        this.commitQuickAmounts(quickAmounts);
        this.publishOperation({ type: 'restoreDefaultQuickAmounts', quickAmounts });
        wx.showToast({ title: '已恢复默认', icon: 'success' });
      }
    });
  },

  openInputDialog(options) {
    this.setData({
      inputDialog: {
        visible: true,
        mode: options.mode,
        targetId: options.targetId || '',
        title: options.title,
        subtitle: options.subtitle || '',
        label: options.label,
        value: options.value || '',
        placeholder: options.placeholder || '',
        confirmText: options.confirmText || '确认',
        error: ''
      }
    });
  },

  closeInputDialog() {
    this.setData({ 'inputDialog.visible': false });
  },

  handleDialogInput(event) {
    this.setData({
      'inputDialog.value': event.detail.value,
      'inputDialog.error': ''
    });
  },

  submitInputDialog() {
    const dialog = this.data.inputDialog;
    const value = String(dialog.value || '').trim();

    if (dialog.mode === 'addPerson') {
      if (!value) {
        this.setData({ 'inputDialog.error': '姓名不能为空' });
        return;
      }

      const person = {
        id: generateId('person'),
        name: value,
        quarters: 0,
        createdAt: Date.now()
      };
      this.commitPeople([...this.data.people, person]);
      this.publishOperation({ type: 'addPerson', person });
      this.closeInputDialog();
      wx.showToast({ title: '添加成功', icon: 'success' });
      return;
    }

    if (dialog.mode === 'editQuick') {
      const quarters = parseCupInputToQuarters(value);
      if (!quarters) {
        this.setData({ 'inputDialog.error': INVALID_AMOUNT_MESSAGE });
        return;
      }

      const quickAmounts = this.data.quickAmounts.map((item) => (
        item.id === dialog.targetId
          ? { ...item, quarters, label: formatCupsByQuarters(quarters) }
          : item
      ));
      this.commitQuickAmounts(quickAmounts);
      this.publishOperation({
        type: 'editQuickAmount',
        quickId: dialog.targetId,
        quarters,
        label: formatCupsByQuarters(quarters)
      });
      this.closeInputDialog();
      wx.showToast({ title: '修改成功', icon: 'success' });
    }
  },

  handleNicknameInput(event) {
    this.setData({
      'profile.name': String(event.detail.value || '').trim().slice(0, 18)
    });
  },

  chooseAvatar(event) {
    this.setData({
      'profile.avatarUrl': event.detail.avatarUrl || ''
    }, () => this.saveProfileName());
  },

  saveProfileName() {
    const name = String(this.data.profile.name || '').trim().slice(0, 18) || '访客';
    const profile = {
      ...this.data.profile,
      name,
      identityProvider: this.data.profile.identityToken ? 'miniprogram' : 'guest'
    };
    this.setData({ profile, profileInitial: getNameInitial(name) });
    saveProfile(profile);
    wx.showToast({ title: '身份已保存', icon: 'success' });
  },

  loginWithWechat() {
    if (!this.data.sync.apiBase) {
      wx.showToast({ title: '未配置后端地址', icon: 'none' });
      return;
    }

    wx.login({
      success: (loginRes) => {
        if (!loginRes.code) {
          wx.showToast({ title: '微信登录失败', icon: 'none' });
          return;
        }

        wx.request({
          url: `${this.data.sync.apiBase}/api/auth/miniprogram/login`,
          method: 'POST',
          data: { code: loginRes.code },
          success: (res) => {
            const payload = res.data || {};
            if (res.statusCode !== 200 || !payload.identityToken) {
              wx.showToast({ title: '后端登录失败', icon: 'none' });
              return;
            }

            const profile = {
              ...this.data.profile,
              name: this.data.profile.name || '微信用户',
              identityProvider: 'miniprogram',
              identityToken: payload.identityToken
            };
            this.setData({ profile }, () => {
              saveProfile(profile);
              wx.showToast({ title: '微信登录成功', icon: 'success' });
            });
          },
          fail: () => wx.showToast({ title: '无法连接登录服务', icon: 'none' })
        });
      },
      fail: () => wx.showToast({ title: '微信登录失败', icon: 'none' })
    });
  },

  startRealtimeSync() {
    if (!this.data.sync.apiBase) {
      this.setData({ 'sync.status': 'local' }, () => this.refreshView());
      return;
    }

    this.loadRemoteSnapshot();
    this.connectSyncSocket();
  },

  loadRemoteSnapshot() {
    wx.request({
      url: `${this.data.sync.apiBase}${this.buildRoomPath('/state')}`,
      method: 'GET',
      success: (res) => {
        if (res.statusCode !== 200 || !res.data || !res.data.room) {
          this.setData({ 'sync.status': 'offline' }, () => this.refreshView());
          return;
        }

        this.applyRemoteSnapshot(res.data.room);
        this.setData({ 'sync.status': 'connected' }, () => this.refreshView());
      },
      fail: () => {
        this.setData({ 'sync.status': 'offline' }, () => this.refreshView());
      }
    });
  },

  connectSyncSocket() {
    this.closeSyncSocket();
    const socketUrl = `${this.data.sync.apiBase.replace(/^http/, 'ws')}${this.buildRoomPath('/socket')}?clientId=${encodeURIComponent(this.data.sync.clientId)}`;
    this.socketTask = wx.connectSocket({ url: socketUrl });

    this.socketTask.onOpen(() => {
      this.setData({ 'sync.status': 'connected', 'sync.socketOpen': true }, () => this.refreshView());
    });

    this.socketTask.onMessage((event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'snapshot') {
          this.applyRemoteSnapshot(payload.room);
        }
      } catch (error) {
        // Ignore stale socket messages.
      }
    });

    this.socketTask.onClose(() => {
      this.setData({ 'sync.status': 'offline', 'sync.socketOpen': false }, () => this.refreshView());
    });

    this.socketTask.onError(() => {
      this.setData({ 'sync.status': 'offline', 'sync.socketOpen': false }, () => this.refreshView());
    });
  },

  closeSyncSocket() {
    if (this.socketTask) {
      this.socketTask.close();
      this.socketTask = null;
    }
  },

  buildRoomPath(suffix) {
    return `/api/rooms/${encodeURIComponent(this.data.sync.roomId || DEFAULT_ROOM_ID)}${suffix}`;
  },

  publishOperation(payload) {
    const operation = {
      ...payload,
      id: generateId('op'),
      clientId: this.data.sync.clientId,
      actor: {
        clientId: this.data.sync.clientId,
        name: this.data.profile.name || '访客',
        avatarUrl: this.data.profile.avatarUrl || '',
        identityProvider: this.data.profile.identityProvider || 'guest'
      },
      createdAt: Date.now()
    };
    this.recordActivity(operation);

    if (!this.data.sync.apiBase) {
      return;
    }

    wx.request({
      url: `${this.data.sync.apiBase}${this.buildRoomPath('/operations')}`,
      method: 'POST',
      data: {
        clientId: this.data.sync.clientId,
        identityToken: this.data.profile.identityToken,
        operation
      },
      success: (res) => {
        if (res.statusCode === 200 && res.data && res.data.room) {
          this.applyRemoteSnapshot(res.data.room);
          this.setData({ 'sync.status': 'connected' }, () => this.refreshView());
        }
      },
      fail: () => {
        this.setData({ 'sync.status': 'offline' }, () => this.refreshView());
      }
    });
  },

  recordActivity(operation) {
    this.setData({
      'sync.lastActivity': describeOperation(operation)
    });
  },

  applyRemoteSnapshot(room) {
    if (!room || typeof room !== 'object') {
      return;
    }

    const people = Array.isArray(room.people)
      ? room.people.map(normalizePerson).filter(Boolean)
      : [];
    const quickAmounts = Array.isArray(room.quickAmounts)
      ? room.quickAmounts.map(normalizeQuickAmount).filter(Boolean)
      : cloneDefaultQuickAmounts();
    const lastActivity = room.lastActivity ? describeOperation(room.lastActivity) : this.data.sync.lastActivity;

    savePeople(people);
    saveQuickAmounts(quickAmounts.length ? quickAmounts : cloneDefaultQuickAmounts());
    this.setData({
      people,
      quickAmounts: quickAmounts.length ? quickAmounts : cloneDefaultQuickAmounts(),
      'sync.lastActivity': lastActivity
    }, () => this.refreshView());
  },

  commitPeople(people) {
    const normalized = people.map(normalizePerson).filter(Boolean);
    savePeople(normalized);
    this.setData({ people: normalized }, () => this.refreshView());
  },

  commitQuickAmounts(quickAmounts) {
    const normalized = quickAmounts.map(normalizeQuickAmount).filter(Boolean);
    const safeAmounts = normalized.length ? normalized : cloneDefaultQuickAmounts();
    saveQuickAmounts(safeAmounts);
    this.setData({ quickAmounts: safeAmounts }, () => this.refreshView());
  }
});

function generateId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function formatCupsByQuarters(quarters) {
  const normalizedQuarters = Math.max(0, Number.isFinite(Number(quarters)) ? Math.round(Number(quarters)) : 0);
  const cups = normalizedQuarters / 4;
  return Number.isInteger(cups) ? String(cups) : String(cups).replace(/0+$/, '').replace(/\.$/, '');
}

function parseCupInputToQuarters(input) {
  const value = Number(String(input || '').trim());
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  const quarters = Math.round(value * 4);
  if (Math.abs(value * 4 - quarters) > 0.000001 || quarters <= 0) {
    return null;
  }
  return quarters;
}

function savePeople(people) {
  wx.setStorageSync(PEOPLE_STORAGE_KEY, people);
}

function loadPeople() {
  try {
    const parsed = wx.getStorageSync(PEOPLE_STORAGE_KEY);
    return Array.isArray(parsed) ? parsed.map(normalizePerson).filter(Boolean) : [];
  } catch (error) {
    return [];
  }
}

function saveQuickAmounts(quickAmounts) {
  wx.setStorageSync(QUICK_STORAGE_KEY, quickAmounts);
}

function loadQuickAmounts() {
  try {
    const parsed = wx.getStorageSync(QUICK_STORAGE_KEY);
    const normalized = Array.isArray(parsed) ? parsed.map(normalizeQuickAmount).filter(Boolean) : [];
    return normalized.length ? normalized : cloneDefaultQuickAmounts();
  } catch (error) {
    return cloneDefaultQuickAmounts();
  }
}

function getStats(people) {
  const totalPeople = people.length;
  const totalQuarters = people.reduce((sum, person) => sum + person.quarters, 0);
  const topPerson = people.reduce((currentTop, person) => {
    if (!currentTop || person.quarters > currentTop.quarters) {
      return person;
    }
    return currentTop;
  }, null);
  const hasTop = topPerson && topPerson.quarters > 0;

  return {
    totalPeople,
    totalCups: formatCupsByQuarters(totalQuarters),
    topName: hasTop ? topPerson.name : '暂无',
    topCups: hasTop ? `${formatCupsByQuarters(topPerson.quarters)} 杯` : '0 杯'
  };
}

function getDisplayPeople(people, sortMode) {
  return [...people].sort((a, b) => {
    if (sortMode === 'amount' && b.quarters !== a.quarters) {
      return b.quarters - a.quarters;
    }
    return a.createdAt - b.createdAt;
  }).map((person) => ({
    ...person,
    initial: getNameInitial(person.name),
    cups: formatCupsByQuarters(person.quarters),
    createdText: formatCreatedAt(person.createdAt)
  }));
}

function normalizePerson(item, index = 0) {
  if (!item || typeof item !== 'object') {
    return null;
  }
  const name = String(item.name || '').trim();
  return {
    id: String(item.id || generateId(`person_${index}`)),
    name: name || '未命名',
    quarters: Math.max(0, Math.round(Number(item.quarters) || 0)),
    createdAt: Number.isFinite(Number(item.createdAt)) ? Number(item.createdAt) : Date.now() + index
  };
}

function normalizeQuickAmount(item, index = 0) {
  if (!item || typeof item !== 'object') {
    return null;
  }
  const quarters = Math.round(Number(item.quarters));
  if (!Number.isFinite(quarters) || quarters <= 0) {
    return null;
  }
  return {
    id: String(item.id || generateId(`quick_${index}`)),
    label: formatCupsByQuarters(quarters),
    quarters
  };
}

function cloneDefaultQuickAmounts() {
  return DEFAULT_QUICK_AMOUNTS.map((item) => ({ ...item }));
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

function saveProfile(profile) {
  wx.setStorageSync(PROFILE_STORAGE_KEY, profile);
}

function loadProfile() {
  try {
    const profile = wx.getStorageSync(PROFILE_STORAGE_KEY) || {};
    const name = String(profile.name || '').trim();
    return {
      name: name || '访客',
      avatarUrl: String(profile.avatarUrl || ''),
      identityProvider: String(profile.identityProvider || 'guest'),
      identityToken: String(profile.identityToken || '')
    };
  } catch (error) {
    return {
      name: '访客',
      avatarUrl: '',
      identityProvider: 'guest',
      identityToken: ''
    };
  }
}

function getClientId() {
  const cached = wx.getStorageSync(CLIENT_STORAGE_KEY);
  if (cached) {
    return cached;
  }
  const clientId = generateId('client');
  wx.setStorageSync(CLIENT_STORAGE_KEY, clientId);
  return clientId;
}

function normalizeRoomId(input) {
  const roomId = String(input || DEFAULT_ROOM_ID).trim().replace(/[^\w\u4e00-\u9fa5-]/g, '-').slice(0, 48);
  return roomId || DEFAULT_ROOM_ID;
}

function getSyncStatusText(status) {
  const statusMap = {
    local: '本地模式',
    connecting: '连接中',
    connected: '已同步',
    offline: '同步断开'
  };
  return statusMap[status] || statusMap.local;
}

function describeOperation(operation) {
  const actorName = operation.actor && operation.actor.name ? operation.actor.name : '有人';
  const personName = operation.personName || (operation.person && operation.person.name) || '成员';
  switch (operation.type) {
    case 'addPerson':
      return `${actorName} 添加了 ${personName}`;
    case 'updatePersonQuarters': {
      const sign = operation.delta >= 0 ? '+' : '-';
      return `${actorName} 给 ${personName} ${sign}${formatCupsByQuarters(Math.abs(operation.delta || 0))} 杯`;
    }
    case 'resetPerson':
      return `${actorName} 清零了 ${personName}`;
    case 'deletePerson':
      return `${actorName} 删除了 ${personName}`;
    case 'resetAllPeople':
      return `${actorName} 清零了全部杯数`;
    case 'clearAllPeople':
      return `${actorName} 清空了酒单`;
    case 'addQuickAmount':
      return `${actorName} 新增了快捷量`;
    case 'editQuickAmount':
      return `${actorName} 修改了快捷量`;
    case 'deleteQuickAmount':
      return `${actorName} 删除了快捷量`;
    case 'restoreDefaultQuickAmounts':
      return `${actorName} 恢复了默认快捷量`;
    default:
      return `${actorName} 更新了酒单`;
  }
}
