(function (window) {
  const K = {
    users: "oq_v7_users",
    current: "oq_v7_current",
    records: "oq_v7_records",
    view: "oq_v7_view",
    rankMode: "oq_v7_rank_mode",
    token: "oq_supabase_anon_key",
    url: "oq_supabase_url",
    session: "oq_session_token"
  };

  const config = window.SUPABASE_CONFIG || {};
  const state = {
    users: [],
    records: [],
    currentUser: null,
    loaded: false,
    lastError: ""
  };

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

  function configuredUrl() {
    return String(config.url || readText(K.url)).trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
  }

  function supabaseAnonKey() {
    return String(config.anonKey || readText(K.token)).trim();
  }

  function sessionToken() {
    return readText(K.session).trim();
  }

  function setSessionToken(token) {
    writeText(K.session, token || "");
  }

  function setSupabaseUrl(url) {
    writeText(K.url, String(url || "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, ""));
  }

  function setSupabaseAnonKey(key) {
    writeText(K.token, String(key || "").trim());
  }

  function configured() {
    return Boolean(configuredUrl() && supabaseAnonKey());
  }

  function headers(extra = {}) {
    const key = supabaseAnonKey();
    return {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...extra
    };
  }

  async function api(path, options = {}) {
    if (!configured()) throw new Error("请先填写 Supabase URL 和 anon key");
    const res = await fetch(`${configuredUrl()}/rest/v1/${path}`, {
      ...options,
      headers: headers(options.headers || {})
    });
    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const message = body?.message || body?.hint || `Supabase 请求失败：${res.status}`;
      const err = new Error(message);
      err.status = res.status;
      throw err;
    }
    return body;
  }

  async function rpc(name, payload = {}) {
    return api(`rpc/${name}`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  function fromUser(row) {
    if (!row) return null;
    return {
      id: row.id,
      username: row.username,
      password: row.password || "",
      role: row.role || "",
      roleKey: row.role_key || row.roleKey || "hero",
      isAdmin: Boolean(row.is_admin ?? row.isAdmin),
      createdAt: row.created_at || row.createdAt,
      expOverride: row.exp_override == null ? null : Number(row.exp_override),
      totalHours: Number(row.total_hours || row.totalHours || 0),
      todayHours: Number(row.today_hours || row.todayHours || 0),
      weekHours: Number(row.week_hours || row.weekHours || 0),
      monthHours: Number(row.month_hours || row.monthHours || 0),
      yearHours: Number(row.year_hours || row.yearHours || 0),
      totalExp: Number(row.total_exp || row.totalExp || 0),
      level: Number(row.level || 0),
      title: row.title || ""
    };
  }

  function fromRecord(row) {
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id || row.userId,
      date: row.date,
      startTime: row.start_time || row.startTime,
      endTime: row.end_time || row.endTime,
      duration: Number(row.duration || 0),
      type: row.type || "",
      remark: row.remark || "",
      createdAt: row.created_at || row.createdAt,
      updatedAt: row.updated_at || row.updatedAt
    };
  }

  function toRecord(record) {
    return {
      id: record.id,
      user_id: record.userId,
      date: record.date,
      start_time: record.startTime,
      end_time: record.endTime,
      duration: Number(record.duration || 0),
      type: record.type || "",
      remark: record.remark || "",
      created_at: record.createdAt || new Date().toISOString(),
      updated_at: record.updatedAt || new Date().toISOString()
    };
  }

  function cacheLocal() {
    write(K.users, state.users);
    write(K.records, state.records);
    if (state.currentUser) writeText(K.current, state.currentUser.id);
  }

  async function refreshLeaderboard(mode = "all") {
    const rows = await rpc("app_leaderboard", { p_token: sessionToken(), p_mode: mode });
    state.users = (rows || []).map(fromUser);
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
    const [user, records] = await Promise.all([
      rpc("app_current_user", { p_token: token }),
      rpc("app_my_records", { p_token: token })
    ]);
    state.currentUser = fromUser(Array.isArray(user) ? user[0] : user);
    state.records = (records || []).map(fromRecord);
    await refreshLeaderboard("all");
    cacheLocal();
  }

  async function init() {
    state.users = read(K.users, []);
    state.records = read(K.records, []);
    state.currentUser = state.users.find((user) => user.id === readText(K.current)) || null;
    state.lastError = "";

    if (!configured()) {
      state.loaded = true;
      state.lastError = "请先填写 Supabase URL 和 anon key，才能跨浏览器同步";
      return;
    }

    try {
      await rpc("app_ensure_admin", {});
      await loadRemote();
      state.loaded = true;
    } catch (error) {
      state.lastError = error.message || "Supabase 数据同步失败";
      state.loaded = true;
    }
  }

  async function login(username, password) {
    const result = await rpc("app_login", { p_username: username, p_password: password });
    if (!result?.session_token || !result?.user) throw new Error("账号或密码错误");
    setSessionToken(result.session_token);
    state.currentUser = fromUser(result.user);
    writeText(K.current, state.currentUser.id);
    await loadRemote();
    return state.currentUser;
  }

  async function register(user) {
    const result = await rpc("app_register", {
      p_id: user.id,
      p_username: user.username,
      p_password: user.password,
      p_role: user.role || "",
      p_role_key: user.roleKey || "hero"
    });
    if (!result?.session_token || !result?.user) throw new Error("注册失败");
    setSessionToken(result.session_token);
    state.currentUser = fromUser(result.user);
    writeText(K.current, state.currentUser.id);
    await loadRemote();
    return state.currentUser;
  }

  function users() {
    return state.users;
  }

  async function saveUser(user) {
    const saved = await rpc("app_save_user", { p_token: sessionToken(), p_user: user });
    state.currentUser = state.currentUser?.id === saved.id ? fromUser(saved) : state.currentUser;
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
    const saved = await rpc("app_save_record", { p_token: sessionToken(), p_record: toRecord(record) });
    const next = fromRecord(saved);
    state.records = [...state.records.filter((item) => item.id !== next.id), next];
    await refreshLeaderboard("all");
    cacheLocal();
  }

  async function saveRecords(nextRecords) {
    for (const record of nextRecords) await saveRecord(record);
    await loadRemote();
  }

  async function deleteRecord(recordId) {
    await rpc("app_delete_record", { p_token: sessionToken(), p_record_id: recordId });
    state.records = state.records.filter((item) => item.id !== recordId);
    await refreshLeaderboard("all");
    cacheLocal();
  }

  async function deleteUser(userId) {
    await rpc("app_delete_user", { p_token: sessionToken(), p_user_id: userId });
    state.users = state.users.filter((item) => item.id !== userId);
    state.records = state.records.filter((record) => record.userId !== userId);
    cacheLocal();
  }

  async function clearRecordsForUser(userId) {
    await rpc("app_clear_records", { p_token: sessionToken(), p_user_id: userId });
    if (state.currentUser?.id === userId) state.records = [];
    await refreshLeaderboard("all");
    cacheLocal();
  }

  async function leaderboardRows(mode) {
    const rows = await rpc("app_leaderboard", { p_token: sessionToken(), p_mode: mode });
    return (rows || []).map(fromUser);
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
    supabaseUrl: configuredUrl,
    setSupabaseUrl,
    supabaseAnonKey,
    setSupabaseAnonKey,
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
