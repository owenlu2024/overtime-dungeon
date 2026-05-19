(function (window) {
  const K = {
    users: "oq_v7_users",
    current: "oq_v7_current",
    records: "oq_v7_records",
    view: "oq_v7_view",
    rankMode: "oq_v7_rank_mode",
    session: "oq_session_token",
    roleMeta: "oq_v7_role_meta"
  };

  const state = {
    users: [],
    records: [],
    currentUser: null,
    loaded: false,
    lastError: ""
  };
  const apiBase = window.FEISHU_CONFIG?.apiBase || "/api/store";

  function read(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch {
      return fallback;
    }
  }

  function write(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function readText(key, fallback = "") {
    const value = localStorage.getItem(key);
    return value == null ? fallback : value;
  }

  function writeText(key, value) {
    localStorage.setItem(key, value);
  }

  function remove(key) {
    localStorage.removeItem(key);
  }

  function sessionToken() {
    return readText(K.session).trim();
  }

  function setSessionToken(token) {
    writeText(K.session, token || "");
  }

  function roleMeta() {
    return read(K.roleMeta, {});
  }

  function rememberRole(user) {
    if (!user?.username || !user.roleKey) return;
    write(K.roleMeta, {
      ...roleMeta(),
      [user.username]: { role: user.role, roleKey: user.roleKey }
    });
  }

  function applyRoleMeta(user) {
    const meta = user?.username ? roleMeta()[user.username] : null;
    return meta ? { ...user, role: meta.role || user.role, roleKey: meta.roleKey || user.roleKey } : user;
  }

  function applyRoleMetaList(users) {
    return (users || []).map(applyRoleMeta);
  }

  function configured() {
    return true;
  }

  async function api(action, payload = {}) {
    const res = await fetch(apiBase, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...payload })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body?.ok === false) {
      const err = new Error(body?.message || `飞书同步失败：${res.status}`);
      err.status = res.status;
      throw err;
    }
    return body.data;
  }

  function cacheLocal() {
    write(K.users, state.users);
    write(K.records, state.records);
    if (state.currentUser) writeText(K.current, state.currentUser.id);
  }

  function chinaDate(date = new Date()) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(date);
  }

  function sameWeek(dateText, base = new Date()) {
    const date = new Date(dateText);
    const start = new Date(base);
    const day = start.getDay() || 7;
    start.setDate(start.getDate() - day + 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 7);
    return date >= start && date < end;
  }

  function sum(records) {
    return Math.round(records.reduce((total, record) => total + Number(record.duration || 0), 0) * 100) / 100;
  }

  function updateCurrentUserTotals() {
    const user = state.currentUser;
    if (!user) return;
    const now = new Date();
    const own = state.records.filter((record) => record.userId === user.id);
    const totalHours = sum(own);
    const next = {
      ...user,
      totalHours,
      todayHours: sum(own.filter((record) => record.date === chinaDate(now))),
      weekHours: sum(own.filter((record) => sameWeek(record.date, now))),
      monthHours: sum(own.filter((record) => {
        const date = new Date(record.date);
        return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
      })),
      yearHours: sum(own.filter((record) => new Date(record.date).getFullYear() === now.getFullYear())),
      totalExp: Math.round(totalHours * 10)
    };
    state.currentUser = next;
    state.users = [next, ...state.users.filter((item) => item.id !== next.id)];
  }

  async function refreshLeaderboard(mode = "all") {
    const rows = await api("leaderboard", { token: sessionToken(), mode });
    state.users = applyRoleMetaList(rows || []);
    if (state.currentUser && !state.users.some((user) => user.id === state.currentUser.id)) {
      state.users = [state.currentUser, ...state.users];
    }
    cacheLocal();
    return state.users;
  }

  async function loadRemote() {
    const token = sessionToken();
    if (!token) {
      state.currentUser = null;
      state.users = [];
      state.records = [];
      cacheLocal();
      return;
    }

    const data = await api("bootstrap", { token });
    state.currentUser = applyRoleMeta(data.user || null);
    state.records = data.records || [];
    state.users = applyRoleMetaList(data.users || []);
    cacheLocal();
  }

  async function init() {
    state.users = read(K.users, []);
    state.records = read(K.records, []);
    state.currentUser = state.users.find((user) => user.id === readText(K.current)) || null;
    state.lastError = "";

    try {
      await loadRemote();
      state.loaded = true;
    } catch (error) {
      state.lastError = error.message || "飞书数据同步失败";
      state.loaded = true;
    }
  }

  async function login(username, password) {
    const result = await api("login", { username, password });
    if (!result?.sessionToken || !result?.user) throw new Error("账号或密码错误");
    setSessionToken(result.sessionToken);
    state.currentUser = applyRoleMeta(result.user);
    state.records = result.records || [];
    state.users = applyRoleMetaList(result.users || [state.currentUser]);
    writeText(K.current, state.currentUser.id);
    cacheLocal();
    return state.currentUser;
  }

  async function register(user) {
    const result = await api("register", { user });
    if (!result?.sessionToken || !result?.user) throw new Error("注册失败");
    setSessionToken(result.sessionToken);
    rememberRole(result.user);
    state.currentUser = applyRoleMeta(result.user);
    state.records = [];
    state.users = [state.currentUser, ...state.users.filter((item) => item.id !== result.user.id)];
    writeText(K.current, state.currentUser.id);
    cacheLocal();
    return state.currentUser;
  }

  function users() {
    return state.users;
  }

  async function saveUser(user) {
    const saved = await api("saveUser", { token: sessionToken(), user });
    state.currentUser = state.currentUser?.id === saved.id ? saved : state.currentUser;
    await loadRemote();
  }

  async function saveUsers(nextUsers) {
    for (const user of nextUsers) await saveUser(user);
    await loadRemote();
  }

  function currentUser() {
    return state.currentUser;
  }

  function setCurrentUser(userId) {
    writeText(K.current, userId);
  }

  function clearCurrentUser() {
    remove(K.current);
    remove(K.session);
    state.currentUser = null;
    state.records = [];
    state.users = [];
    cacheLocal();
  }

  function allRecords() {
    return state.records;
  }

  async function saveRecord(record) {
    const previous = state.records;
    state.records = [...state.records.filter((item) => item.id !== record.id), record];
    updateCurrentUserTotals();
    cacheLocal();
    try {
      const saved = await api("saveRecord", { token: sessionToken(), record });
      state.records = [...state.records.filter((item) => item.id !== record.id && item.id !== saved.id), saved];
      updateCurrentUserTotals();
      cacheLocal();
      return saved;
    } catch (error) {
      state.records = previous;
      updateCurrentUserTotals();
      cacheLocal();
      throw error;
    }
  }

  async function saveRecords(nextRecords) {
    for (const record of nextRecords) await saveRecord(record);
    await loadRemote();
  }

  async function deleteRecord(recordId) {
    const previous = state.records;
    state.records = state.records.filter((item) => item.id !== recordId);
    updateCurrentUserTotals();
    cacheLocal();
    try {
      await api("deleteRecord", { token: sessionToken(), recordId });
    } catch (error) {
      state.records = previous;
      updateCurrentUserTotals();
      cacheLocal();
      throw error;
    }
  }

  async function deleteUser(userId) {
    await api("deleteUser", { token: sessionToken(), userId });
    state.users = state.users.filter((item) => item.id !== userId);
    state.records = state.records.filter((record) => record.userId !== userId);
    cacheLocal();
  }

  async function clearRecordsForUser(userId) {
    await api("clearRecords", { token: sessionToken(), userId });
    if (state.currentUser?.id === userId) state.records = [];
    await refreshLeaderboard("all");
    cacheLocal();
  }

  async function leaderboardRows(mode) {
    if (state.users.length) return state.users;
    return api("leaderboard", { token: sessionToken(), mode });
  }

  function recordsForCurrentUser() {
    const user = currentUser();
    return user ? allRecords().filter((record) => record.userId === user.id) : [];
  }

  function viewMode() {
    return readText(K.view, "list");
  }

  function setViewMode(mode) {
    writeText(K.view, mode);
  }

  function rankMode() {
    return readText(K.rankMode, "day");
  }

  function setRankModeValue(mode) {
    writeText(K.rankMode, mode);
  }

  window.OvertimeStore = {
    K,
    read,
    write,
    readText,
    writeText,
    remove,
    sessionToken,
    configured,
    init,
    syncRemote: loadRemote,
    login,
    register,
    leaderboardRows,
    refreshLeaderboard,
    lastError: () => state.lastError,
    users,
    saveUser,
    saveUsers,
    currentUser,
    setCurrentUser,
    clearCurrentUser,
    allRecords,
    saveRecord,
    saveRecords,
    deleteRecord,
    deleteUser,
    clearRecordsForUser,
    recordsForCurrentUser,
    viewMode,
    setViewMode,
    rankMode,
    setRankMode: setRankModeValue
  };
})(window);
