(function (window) {
  const K = {
    users: "oq_v7_users",
    current: "oq_v7_current",
    records: "oq_v7_records",
    view: "oq_v7_view",
    rankMode: "oq_v7_rank_mode"
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

  function users() {
    return read(K.users, []);
  }

  function saveUsers(nextUsers) {
    write(K.users, nextUsers);
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
    return read(K.records, []);
  }

  function saveRecords(nextRecords) {
    write(K.records, nextRecords);
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
    users,
    saveUsers,
    currentUser,
    setCurrentUser,
    clearCurrentUser,
    allRecords,
    saveRecords,
    recordsForCurrentUser,
    viewMode,
    setViewMode,
    rankMode,
    setRankMode: setRankModeValue
  };
})(window);
