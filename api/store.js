const crypto = require("crypto");

let cachedTenantToken = "";
let cachedTenantTokenExpiresAt = 0;

const FEISHU_HOST = "https://open.feishu.cn";

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`缺少 Vercel 环境变量：${name}`);
  return value;
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function tenantToken() {
  if (cachedTenantToken && Date.now() < cachedTenantTokenExpiresAt) return cachedTenantToken;

  const res = await fetch(`${FEISHU_HOST}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      app_id: env("FEISHU_APP_ID"),
      app_secret: env("FEISHU_APP_SECRET")
    })
  });
  const body = await res.json();
  if (!res.ok || body.code !== 0) throw new Error(body.msg || "获取飞书访问令牌失败");

  cachedTenantToken = body.tenant_access_token;
  cachedTenantTokenExpiresAt = Date.now() + Math.max(60, Number(body.expire || 7200) - 300) * 1000;
  return cachedTenantToken;
}

async function feishu(path, options = {}) {
  const token = await tenantToken();
  const res = await fetch(`${FEISHU_HOST}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok || body.code !== 0) throw new Error(body.msg || `飞书请求失败：${res.status}`);
  return body.data || {};
}

function bitablePath(tableId, suffix = "") {
  return `/open-apis/bitable/v1/apps/${env("FEISHU_APP_TOKEN")}/tables/${tableId}/records${suffix}`;
}

async function listRecords(tableId) {
  const items = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({ page_size: "500" });
    if (pageToken) params.set("page_token", pageToken);
    const data = await feishu(`${bitablePath(tableId)}?${params.toString()}`, { method: "GET" });
    items.push(...(data.items || []));
    pageToken = data.page_token || "";
    if (!data.has_more) break;
  } while (pageToken);
  return items;
}

async function createRecord(tableId, fields) {
  const data = await feishu(bitablePath(tableId), {
    method: "POST",
    body: JSON.stringify({ fields })
  });
  return data.record;
}

async function updateRecord(tableId, recordId, fields) {
  const data = await feishu(bitablePath(tableId, `/${recordId}`), {
    method: "PUT",
    body: JSON.stringify({ fields })
  });
  return data.record;
}

async function deleteRecordFromTable(tableId, recordId) {
  await feishu(bitablePath(tableId, `/${recordId}`), { method: "DELETE" });
}

function fieldText(value) {
  if (Array.isArray(value)) return value.map((item) => item.text || item.name || item).join("");
  if (value && typeof value === "object") return value.text || value.name || String(value.value || "");
  return value == null ? "" : String(value);
}

function fieldBool(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return !["", "false", "0", "否"].includes(value.toLowerCase());
  return Boolean(value);
}

function parseDate(value) {
  if (typeof value === "number") {
    const date = new Date(value + 8 * 60 * 60 * 1000);
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }
  return fieldText(value).slice(0, 10);
}

function toFeishuDate(value) {
  if (!value) return undefined;
  return new Date(`${value}T00:00:00+08:00`).getTime();
}

function userFromRecord(record) {
  const fields = record.fields || {};
  const username = fieldText(fields.username || fields.users).trim();
  const roleValue = fieldText(fields.role).trim();
  const isAdmin = roleValue === "admin";
  const active = fields.active == null ? true : fieldBool(fields.active);

  return {
    id: username,
    recordId: record.record_id,
    username,
    password: fieldText(fields.password),
    role: isAdmin ? "admin" : "勇者",
    roleKey: "hero",
    isAdmin,
    active,
    createdAt: "",
    expOverride: null,
    totalHours: 0,
    todayHours: 0,
    weekHours: 0,
    monthHours: 0,
    yearHours: 0,
    totalExp: 0,
    level: 1,
    title: ""
  };
}

function recordFromBitable(record) {
  const fields = record.fields || {};
  const username = fieldText(fields.username || fields.user).trim();
  return {
    id: record.record_id,
    userId: username,
    date: parseDate(fields.date),
    startTime: fieldText(fields.startTime),
    endTime: fieldText(fields.endTime),
    duration: Number(fields.hours || fields.duration || 0),
    type: fieldText(fields.type),
    remark: fieldText(fields.note || fields.remark),
    createdAt: "",
    updatedAt: ""
  };
}

function feishuRecordFields(record, username) {
  return {
    username: username || record.userId,
    date: toFeishuDate(record.date),
    startTime: record.startTime || "",
    endTime: record.endTime || "",
    hours: Number(record.duration || 0),
    type: record.type || "",
    note: record.remark || ""
  };
}

function signSession(username) {
  const payload = Buffer.from(JSON.stringify({ u: username, t: Date.now() })).toString("base64url");
  const signature = crypto.createHmac("sha256", env("FEISHU_APP_SECRET")).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function readSession(token) {
  if (!token || !token.includes(".")) throw new Error("登录已失效，请重新登录");
  const [payload, signature] = token.split(".");
  const expected = crypto.createHmac("sha256", env("FEISHU_APP_SECRET")).update(payload).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    throw new Error("登录已失效，请重新登录");
  }
  const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (!data.u) throw new Error("登录已失效，请重新登录");
  return data.u;
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

function chinaDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function titleFromExp(exp) {
  const titles = [
    ["摸鱼见习生", 0, 49],
    ["工位巡逻员", 50, 99],
    ["咖啡续命师", 100, 199],
    ["表格搬砖侠", 200, 399],
    ["键盘小怪兽", 400, 599],
    ["会议幸存者", 600, 899],
    ["需求驯兽师", 900, 1199],
    ["深夜副本王", 1200, 1599],
    ["方案爆改侠", 1600, 1999],
    ["甲方终结者", 2000, 2499],
    ["通宵守门人", 2500, 3199],
    ["加班大魔王", 3200, Infinity]
  ];
  return (titles.find((item) => exp >= item[1] && exp <= item[2]) || titles[titles.length - 1])[0];
}

function levelFromExp(exp) {
  const ranges = [[0,49],[50,99],[100,199],[200,399],[400,599],[600,899],[900,1199],[1200,1599],[1600,1999],[2000,2499],[2500,3199],[3200,Infinity]];
  return ranges.findIndex(([min, max]) => exp >= min && exp <= max) + 1 || 12;
}

function addTotals(users, records) {
  const now = new Date();
  const today = chinaDate(now);
  return users.map((user) => {
    const own = records.filter((record) => record.userId === user.id);
    const totalHours = sum(own);
    const todayHours = sum(own.filter((record) => record.date === today));
    const weekHours = sum(own.filter((record) => sameWeek(record.date, now)));
    const monthHours = sum(own.filter((record) => {
      const date = new Date(record.date);
      return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
    }));
    const yearHours = sum(own.filter((record) => new Date(record.date).getFullYear() === now.getFullYear()));
    const totalExp = Math.round(totalHours * 10);
    return {
      ...user,
      totalHours,
      todayHours,
      weekHours,
      monthHours,
      yearHours,
      totalExp,
      level: levelFromExp(totalExp),
      title: titleFromExp(totalExp)
    };
  });
}

function sum(records) {
  return Math.round(records.reduce((total, record) => total + Number(record.duration || 0), 0) * 100) / 100;
}

async function allData() {
  const [userRows, recordRows] = await Promise.all([
    listRecords(env("FEISHU_USERS_TABLE_ID")),
    listRecords(env("FEISHU_RECORDS_TABLE_ID"))
  ]);
  const users = userRows.map(userFromRecord).filter((user) => user.username && user.active);
  const records = recordRows.map(recordFromBitable).filter((record) => record.userId);
  return { users: addTotals(users, records), records };
}

async function allUsers() {
  const rows = await listRecords(env("FEISHU_USERS_TABLE_ID"));
  return rows.map(userFromRecord).filter((user) => user.username && user.active);
}

async function allRecords() {
  const rows = await listRecords(env("FEISHU_RECORDS_TABLE_ID"));
  return rows.map(recordFromBitable).filter((record) => record.userId);
}

async function requireUserOnly(token) {
  const username = readSession(token);
  const users = await allUsers();
  const user = users.find((item) => item.username === username);
  if (!user) throw new Error("账号不存在或已停用");
  return user;
}

async function requireUser(token) {
  const username = readSession(token);
  const data = await allData();
  const user = data.users.find((item) => item.username === username);
  if (!user) throw new Error("账号不存在或已停用");
  return { ...data, user };
}

async function handle(action, body) {
  if (action === "ensureAdmin") {
    const users = (await listRecords(env("FEISHU_USERS_TABLE_ID"))).map(userFromRecord);
    if (!users.some((user) => user.username === "owenlu")) {
      await createRecord(env("FEISHU_USERS_TABLE_ID"), {
        username: "owenlu",
        password: "110110",
        role: "admin",
        active: true
      });
    }
    return true;
  }

  if (action === "login") {
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    const { users } = await allData();
    const user = users.find((item) => item.username === username && item.password === password && item.active);
    if (!user) throw new Error("账号或密码错误");
    return { sessionToken: signSession(user.username), user };
  }

  if (action === "register") {
    const user = body.user || {};
    const username = String(user.username || "").trim();
    const password = String(user.password || "");
    if (!username || !password) throw new Error("请输入用户名和密码");
    const existing = (await allUsers()).find((item) => item.username === username);
    if (existing) throw new Error("用户名已存在");
    const created = await createRecord(env("FEISHU_USERS_TABLE_ID"), {
      username,
      password,
      role: "user",
      active: true
    });
    const saved = userFromRecord(created);
    return { sessionToken: signSession(username), user: saved };
  }

  if (action === "bootstrap") {
    const { user, users, records } = await requireUser(body.token);
    return {
      user,
      users,
      records: user.isAdmin ? records : records.filter((record) => record.userId === user.id)
    };
  }

  if (action === "leaderboard") {
    const { users } = await requireUser(body.token);
    return users;
  }

  if (action === "saveUser") {
    const { user: actor, users } = await requireUser(body.token);
    if (!actor.isAdmin) throw new Error("没有管理员权限");
    const next = body.user || {};
    const target = users.find((item) => item.id === next.id || item.username === next.username);
    if (!target) throw new Error("没有找到用户");
    const saved = await updateRecord(env("FEISHU_USERS_TABLE_ID"), target.recordId, {
      username: target.username,
      password: next.password || target.password,
      role: target.isAdmin ? "admin" : "user",
      active: true
    });
    return userFromRecord(saved);
  }

  if (action === "saveRecord") {
    const actor = await requireUserOnly(body.token);
    const record = body.record || {};
    const isExistingRecord = record.id && !String(record.id).startsWith("rec_");
    const records = isExistingRecord ? await allRecords() : [];
    const existing = records.find((item) => item.id === record.id);
    if (existing && !actor.isAdmin && existing.userId !== actor.id) throw new Error("没有权限修改这条记录");
    const username = actor.isAdmin && record.userId ? record.userId : actor.username;
    const fields = feishuRecordFields(record, username);
    const saved = existing
      ? await updateRecord(env("FEISHU_RECORDS_TABLE_ID"), existing.id, fields)
      : await createRecord(env("FEISHU_RECORDS_TABLE_ID"), fields);
    return recordFromBitable(saved);
  }

  if (action === "deleteRecord") {
    const { user, records } = await requireUser(body.token);
    const record = records.find((item) => item.id === body.recordId);
    if (!record) return true;
    if (!user.isAdmin && record.userId !== user.id) throw new Error("没有权限删除这条记录");
    await deleteRecordFromTable(env("FEISHU_RECORDS_TABLE_ID"), record.id);
    return true;
  }

  if (action === "clearRecords") {
    const { user, records } = await requireUser(body.token);
    const userId = user.isAdmin ? body.userId : user.id;
    await Promise.all(records.filter((record) => record.userId === userId).map((record) => deleteRecordFromTable(env("FEISHU_RECORDS_TABLE_ID"), record.id)));
    return true;
  }

  if (action === "deleteUser") {
    const { user: actor, users, records } = await requireUser(body.token);
    if (!actor.isAdmin) throw new Error("没有管理员权限");
    const target = users.find((item) => item.id === body.userId);
    if (!target || target.isAdmin) throw new Error("不能删除这个用户");
    await Promise.all(records.filter((record) => record.userId === target.id).map((record) => deleteRecordFromTable(env("FEISHU_RECORDS_TABLE_ID"), record.id)));
    await deleteRecordFromTable(env("FEISHU_USERS_TABLE_ID"), target.recordId);
    return true;
  }

  throw new Error("未知操作");
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, message: "Method Not Allowed" });
  try {
    const body = await readBody(req);
    const data = await handle(body.action, body);
    json(res, 200, { ok: true, data });
  } catch (error) {
    json(res, 400, { ok: false, message: error.message || "请求失败" });
  }
};
