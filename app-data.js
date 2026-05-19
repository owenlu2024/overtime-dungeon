(function (window) {
  const K = {
    users: "oq_v7_users",
    current: "oq_v7_current",
    records: "oq_v7_records",
    view: "oq_v7_view",
    rankMode: "oq_v7_rank_mode",
    token: "oq_supabase_anon_key",
    url: "oq_supabase_url"
  };

  const tableUsers = "overtime_users";
  const tableRecords = "overtime_records";
  const config = window.SUPABASE_CONFIG || {};
  const state = {
    users: [],
    records: [],
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
    return String(config.url || readText(K.url)).trim().replace(/\/+$/, "");
  }

  function supabaseAnonKey() {
    return String(config.anonKey || readText(K.token)).trim();
  }

  function setSupabaseUrl(url) {
    writeText(K.url, String(url || "").trim().replace(/\/+$/, ""));
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
      Prefer: "return=representation",
      ...extra
    };
  }

  async function api(path, options = {}) {
    if (!configured()) {
      throw new Error("请先填写 Supabase URL 和 anon key");
    }
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

  function toDbUser(user) {
    return {
      id: user.id,
      username: user.username,
      password: user.password,
      role: user.role || "",
      role_key: user.roleKey || "hero",
      is_admin: Boolean(user.isAdmin),
      created_at: user.createdAt || new Date().toISOString(),
      exp_override: user.expOverride == null ? null : Number(user.expOverride)
    };
  }

  function fromDbUser(row) {
    return {
      id: row.id,
      username: row.username,
      password: row.password,
      role: row.role || "",
      roleKey: row.role_key || "hero",
      isAdmin: Boolean(row.is_admin),
      createdAt: row.created_at,
      expOverride: row.exp_override == null ? null : Number(row.exp_override)
    };
  }

  function toDbRecord(record) {
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
      updated_at: record.updatedAt || record.createdAt || new Date().toISOString()
    };
  }

  function fromDbRecord(row) {
    return {
      id: row.id,
      userId: row.user_id,
      date: row.date,
      startTime: row.start_time,
      endTime: row.end_time,
      duration: Number(row.duration || 0),
      type: row.type || "",
      remark: row.remark || "",
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  function cacheLocal() {
    write(K.users, state.users);
    write(K.records, state.records);
  }

  async function loadRemote() {
    const [remoteUsers, remoteRecords] = await Promise.all([
      api(`${tableUsers}?select=*&order=created_at.asc`),
      api(`${tableRecords}?select=*&order=date.desc,start_time.desc`)
    ]);
    state.users = (remoteUsers || []).map(fromDbUser);
    state.records = (remoteRecords || []).map(fromDbRecord);
    cacheLocal();
  }

  async function uploadLocalIfRemoteEmpty(localUsers, localRecords) {
    if (state.users.length || state.records.length) return;
    const usersToUpload = (localUsers || []).filter((user) => user?.id && user?.username);
    const recordsToUpload = (localRecords || []).filter((record) => record?.id && record?.userId);
    if (!usersToUpload.length && !recordsToUpload.length) return;
    if (usersToUpload.length) {
      await api(`${tableUsers}?on_conflict=id`, {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(usersToUpload.map(toDbUser))
      });
    }
    if (recordsToUpload.length) {
      await api(`${tableRecords}?on_conflict=id`, {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(recordsToUpload.map(toDbRecord))
      });
    }
    await loadRemote();
  }

  async function init() {
    const localUsers = read(K.users, []);
    const localRecords = read(K.records, []);
    state.users = localUsers;
    state.records = localRecords;
    state.lastError = "";

    if (!configured()) {
      state.loaded = true;
      state.lastError = "请先填写 Supabase URL 和 anon key，才能跨浏览器同步";
      return;
    }

    try {
      await loadRemote();
      await uploadLocalIfRemoteEmpty(localUsers, localRecords);
      state.loaded = true;
    } catch (error) {
      state.lastError = error.message || "Supabase 数据同步失败";
      state.loaded = true;
    }
  }

  async function upsertUser(user) {
    const rows = await api(`${tableUsers}?on_conflict=id`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(toDbUser(user))
    });
    return fromDbUser((rows || [])[0] || toDbUser(user));
  }

  async function upsertRecord(record) {
    const rows = await api(`${tableRecords}?on_conflict=id`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(toDbRecord(record))
    });
    return fromDbRecord((rows || [])[0] || toDbRecord(record));
  }

  async function deleteRows(table, query) {
    await api(`${table}?${query}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" }
    });
  }

  function users() {
    return state.users;
  }

  async function saveUser(user) {
    const saved = await upsertUser(user);
    const next = state.users.filter((item) => item.id !== saved.id && item.username !== saved.username);
    state.users = [...next, saved];
    cacheLocal();
  }

  async function saveUsers(nextUsers) {
    for (const user of nextUsers) {
      await upsertUser(user);
    }
    await loadRemote();
  }

  function currentUser() {
    const currentId = readText(K.current);
    return users().find((user) => user.id === currentId) || null;
  }

  function setCurrentUser(userId) {
    writeText(K.current, userId);
  }

  function clearCurrentUser() {
    remove(K.current);
  }

  function allRecords() {
    return state.records;
  }

  async function saveRecord(record) {
    const saved = await upsertRecord(record);
    state.records = [...state.records.filter((item) => item.id !== saved.id), saved];
    cacheLocal();
  }

  async function saveRecords(nextRecords) {
    for (const record of nextRecords) {
      await upsertRecord(record);
    }
    await loadRemote();
  }

  async function deleteRecord(recordId) {
    await deleteRows(tableRecords, `id=eq.${encodeURIComponent(recordId)}`);
    state.records = state.records.filter((item) => item.id !== recordId);
    cacheLocal();
  }

  async function deleteUser(userId) {
    await deleteRows(tableRecords, `user_id=eq.${encodeURIComponent(userId)}`);
    await deleteRows(tableUsers, `id=eq.${encodeURIComponent(userId)}`);
    state.users = state.users.filter((item) => item.id !== userId);
    state.records = state.records.filter((record) => record.userId !== userId);
    cacheLocal();
  }

  async function clearRecordsForUser(userId) {
    await deleteRows(tableRecords, `user_id=eq.${encodeURIComponent(userId)}`);
    state.records = state.records.filter((record) => record.userId !== userId);
    cacheLocal();
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
    tableUsers,
    tableRecords,
    read,
    write,
    readText,
    writeText,
    remove,
    supabaseUrl: configuredUrl,
    setSupabaseUrl,
    supabaseAnonKey,
    setSupabaseAnonKey,
    githubToken: supabaseAnonKey,
    setGithubToken: setSupabaseAnonKey,
    configured,
    init,
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
