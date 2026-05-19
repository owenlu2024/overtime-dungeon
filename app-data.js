(function (window) {
  const K = {
    users: "oq_v7_users",
    current: "oq_v7_current",
    records: "oq_v7_records",
    view: "oq_v7_view",
    rankMode: "oq_v7_rank_mode",
    session: "oq_session_token"
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

  async function refreshLeaderboard(mode = "all") {
    const rows = await api("leaderboard", { token: sessionToken(), mode });
    state.users = rows || [];
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
    state.currentUser = data.user || null;
    state.records = data.records || [];
    state.users = data.users || [];
    cacheLocal();
  }

  async function init() {
    state.users = read(K.users, []);
    state.records = read(K.records, []);
    state.currentUser = state.users.find((user) => user.id === readText(K.current)) || null;
    state.lastError = "";

    try {
      await api("ensureAdmin", {});
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
    state.currentUser = result.user;
    writeText(K.current, state.currentUser.id);
    await loadRemote();
    return state.currentUser;
  }

  async function register(user) {
    const result = await api("register", { user });
    if (!result?.sessionToken || !result?.user) throw new Error("注册失败");
    setSessionToken(result.sessionToken);
    state.currentUser = result.user;
    state.records = [];
    state.users = [result.user, ...state.users.filter((item) => item.id !== result.user.id)];
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
    const saved = await api("saveRecord", { token: sessionToken(), record });
    state.records = [...state.records.filter((item) => item.id !== record.id && item.id !== saved.id), saved];
    cacheLocal();
  }

  async function saveRecords(nextRecords) {
    for (const record of nextRecords) await saveRecord(record);
    await loadRemote();
  }

  async function deleteRecord(recordId) {
    await api("deleteRecord", { token: sessionToken(), recordId });
    state.records = state.records.filter((item) => item.id !== recordId);
    await refreshLeaderboard("all");
    cacheLocal();
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
    login,
    register,
    leaderboardRows,
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
