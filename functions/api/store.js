const FEISHU_HOST = "https://open.feishu.cn";

let cachedTenantToken = "";
let cachedTenantTokenExpiresAt = 0;
let canSaveRoleFields = true;

function env(name, bindings) {
  const value = bindings && bindings[name];
  if (value == null || value === "") {
    throw new Error("缺少 Cloudflare Pages 环境变量：" + name);
  }
  return String(value);
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

async function readBody(request) {
  const raw = await request.text();
  return raw ? JSON.parse(raw) : {};
}

function base64UrlEncode(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  let base64 = String(value).replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) base64 += "=";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function hmacSignature(payload, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload)
  );
  return base64UrlEncode(new Uint8Array(signature));
}

function constantTimeEqual(left, right) {
  const a = new TextEncoder().encode(String(left));
  const b = new TextEncoder().encode(String(right));
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    difference |= (a[i] || 0) ^ (b[i] || 0);
  }
  return difference === 0;
}

async function signSession(username, secret) {
  const payload = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify({ u: username, t: Date.now() }))
  );
  const signature = await hmacSignature(payload, secret);
  return payload + "." + signature;
}

async function readSession(token, secret) {
  if (!token || !String(token).includes(".")) {
    throw new Error("登录已失效，请重新登录");
  }

  const parts = String(token).split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error("登录已失效，请重新登录");
  }

  const payload = parts[0];
  const signature = parts[1];
  const expected = await hmacSignature(payload, secret);

  if (!constantTimeEqual(signature, expected)) {
    throw new Error("登录已失效，请重新登录");
  }

  let data;
  try {
    data = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload)));
  } catch {
    throw new Error("登录已失效，请重新登录");
  }

  if (!data || !data.u) throw new Error("登录已失效，请重新登录");
  return data.u;
}

async function tenantToken(bindings) {
  if (cachedTenantToken && Date.now() < cachedTenantTokenExpiresAt) {
    return cachedTenantToken;
  }

  const response = await fetch(
    FEISHU_HOST + "/open-apis/auth/v3/tenant_access_token/internal",
    {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        app_id: env("FEISHU_APP_ID", bindings),
        app_secret: env("FEISHU_APP_SECRET", bindings)
      })
    }
  );

  const body = await response.json();
  if (!response.ok || body.code !== 0) {
    throw new Error(body.msg || "获取飞书访问令牌失败");
  }

  cachedTenantToken = body.tenant_access_token;
  cachedTenantTokenExpiresAt =
    Date.now() + Math.max(60, Number(body.expire || 7200) - 300) * 1000;

  return cachedTenantToken;
}

async function feishu(path, options, bindings) {
  const token = await tenantToken(bindings);
  const response = await fetch(FEISHU_HOST + path, {
    ...(options || {}),
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json; charset=utf-8",
      ...((options && options.headers) || {})
    }
  });

  const text = await response.text();
  const body = text ? JSON.parse(text) : {};

  if (!response.ok || body.code !== 0) {
    throw new Error(body.msg || "飞书请求失败：" + response.status);
  }

  return body.data || {};
}

function bitablePath(tableId, suffix, bindings) {
  return (
    "/open-apis/bitable/v1/apps/" +
    env("FEISHU_APP_TOKEN", bindings) +
    "/tables/" +
    tableId +
    "/records" +
    (suffix || "")
  );
}

async function listRecords(tableId, bindings) {
  const items = [];
  let pageToken = "";

  do {
    const params = new URLSearchParams({ page_size: "500" });
    if (pageToken) params.set("page_token", pageToken);

    const data = await feishu(
      bitablePath(tableId, "", bindings) + "?" + params.toString(),
      { method: "GET" },
      bindings
    );

    items.push(...(data.items || []));
    pageToken = data.page_token || "";
    if (!data.has_more) break;
  } while (pageToken);

  return items;
}

async function createRecord(tableId, fields, bindings) {
  const data = await feishu(
    bitablePath(tableId, "", bindings),
    { method: "POST", body: JSON.stringify({ fields }) },
    bindings
  );
  return data.record;
}

async function createRecordWithOptionalFields(
  tableId,
  fields,
  optionalFieldNames,
  bindings
) {
  if (!canSaveRoleFields) {
    const requiredFields = { ...fields };
    optionalFieldNames.forEach((name) => delete requiredFields[name]);
    return createRecord(tableId, requiredFields, bindings);
  }

  try {
    return await createRecord(tableId, fields, bindings);
  } catch (error) {
    canSaveRoleFields = false;
    const requiredFields = { ...fields };
    optionalFieldNames.forEach((name) => delete requiredFields[name]);
    return createRecord(tableId, requiredFields, bindings);
  }
}

async function updateRecord(tableId, recordId, fields, bindings) {
  const data = await feishu(
    bitablePath(tableId, "/" + recordId, bindings),
    { method: "PUT", body: JSON.stringify({ fields }) },
    bindings
  );
  return data.record;
}

async function updateRecordWithOptionalFields(
  tableId,
  recordId,
  fields,
  optionalFieldNames,
  bindings
) {
  if (!canSaveRoleFields) {
    const requiredFields = { ...fields };
    optionalFieldNames.forEach((name) => delete requiredFields[name]);
    return updateRecord(tableId, recordId, requiredFields, bindings);
  }

  try {
    return await updateRecord(tableId, recordId, fields, bindings);
  } catch (error) {
    canSaveRoleFields = false;
    const requiredFields = { ...fields };
    optionalFieldNames.forEach((name) => delete requiredFields[name]);
    return updateRecord(tableId, recordId, requiredFields, bindings);
  }
}

async function deleteRecordFromTable(tableId, recordId, bindings) {
  await feishu(
    bitablePath(tableId, "/" + recordId, bindings),
    { method: "DELETE" },
    bindings
  );
}

function fieldText(value) {
  if (Array.isArray(value)) {
    return value.map((item) => item.text || item.name || item).join("");
  }
  if (value && typeof value === "object") {
    return value.text || value.name || String(value.value || "");
  }
  return value == null ? "" : String(value);
}

function fieldBool(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    return !["", "false", "0", "否"].includes(value.toLowerCase());
  }
  return Boolean(value);
}

function normalizeUsername(value) {
  return String(value || "").trim();
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
  return new Date(value + "T00:00:00+08:00").getTime();
}

function userFromRecord(record, fallback) {
  const defaults = fallback || {};
  const fields = record.fields || {};
  const username = fieldText(fields.username || fields.users).trim();
  const roleValue = fieldText(fields.role).trim();
  const isAdmin = roleValue === "admin";
  const active = fields.active == null ? true : fieldBool(fields.active);
  const roleName = fieldText(
    fields.roleName || fields.role_name || fields.profession || fields.job
  ).trim();
  const roleKey = fieldText(
    fields.roleKey || fields.role_key || fields.avatar || fields.avatarKey
  ).trim();

  return {
    id: username,
    recordId: record.record_id,
    username,
    password: fieldText(fields.password),
    role: isAdmin ? "admin" : roleName || defaults.role || "勇者",
    roleKey: isAdmin ? "hero" : roleKey || defaults.roleKey || "hero",
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

function sameWeek(dateText, base) {
  const date = new Date(dateText);
  const start = new Date(base || new Date());
  const day = start.getDay() || 7;
  start.setDate(start.getDate() - day + 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return date >= start && date < end;
}

function chinaDate(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date || new Date());
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
  const found = titles.find((item) => exp >= item[1] && exp <= item[2]);
  return (found || titles[titles.length - 1])[0];
}

function levelFromExp(exp) {
  const ranges = [
    [0, 49], [50, 99], [100, 199], [200, 399],
    [400, 599], [600, 899], [900, 1199], [1200, 1599],
    [1600, 1999], [2000, 2499], [2500, 3199], [3200, Infinity]
  ];
  return ranges.findIndex(([min, max]) => exp >= min && exp <= max) + 1 || 12;
}

function sum(records) {
  return Math.round(
    records.reduce((total, record) => total + Number(record.duration || 0), 0) * 100
  ) / 100;
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
      return date.getFullYear() === now.getFullYear() &&
        date.getMonth() === now.getMonth();
    }));
    const yearHours = sum(own.filter((record) =>
      new Date(record.date).getFullYear() === now.getFullYear()
    ));
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

async function allData(bindings) {
  const usersTableId = env("FEISHU_USERS_TABLE_ID", bindings);
  const recordsTableId = env("FEISHU_RECORDS_TABLE_ID", bindings);
  const [userRows, recordRows] = await Promise.all([
    listRecords(usersTableId, bindings),
    listRecords(recordsTableId, bindings)
  ]);

  const users = userRows
    .map((record) => userFromRecord(record))
    .filter((user) => user.username && user.active);
  const records = recordRows
    .map(recordFromBitable)
    .filter((record) => record.userId);

  return { users: addTotals(users, records), records };
}

async function allUsers(bindings) {
  const rows = await listRecords(env("FEISHU_USERS_TABLE_ID", bindings), bindings);
  return rows
    .map((record) => userFromRecord(record))
    .filter((user) => user.username && user.active);
}

async function allRecords(bindings) {
  const rows = await listRecords(env("FEISHU_RECORDS_TABLE_ID", bindings), bindings);
  return rows.map(recordFromBitable).filter((record) => record.userId);
}

async function requireUserOnly(token, bindings) {
  const username = await readSession(
    token,
    env("FEISHU_APP_SECRET", bindings)
  );
  const users = await allUsers(bindings);
  const user = users.find((item) => item.username === username);
  if (!user) throw new Error("账号不存在或已停用");
  return user;
}

async function requireUser(token, bindings) {
  const username = await readSession(
    token,
    env("FEISHU_APP_SECRET", bindings)
  );
  const data = await allData(bindings);
  const user = data.users.find((item) => item.username === username);
  if (!user) throw new Error("账号不存在或已停用");
  return { ...data, user };
}

async function handle(action, body, bindings) {
  if (action === "ensureAdmin") {
    const tableId = env("FEISHU_USERS_TABLE_ID", bindings);
    const users = (await listRecords(tableId, bindings)).map((record) =>
      userFromRecord(record)
    );

    if (!users.some((user) => user.username === "owenlu")) {
      await createRecord(tableId, {
        username: "owenlu",
        password: "110110",
        role: "admin",
        active: true
      }, bindings);
    }
    return true;
  }

  if (action === "login") {
    const username = normalizeUsername(body.username);
    const password = String(body.password || "");
    const users = await allUsers(bindings);
    const user = users.find((item) =>
      item.username === username &&
      item.password === password &&
      item.active
    );
    if (!user) throw new Error("账号或密码错误");

    return {
      sessionToken: await signSession(
        user.username,
        env("FEISHU_APP_SECRET", bindings)
      ),
      user,
      users,
      records: []
    };
  }

  if (action === "register") {
    const user = body.user || {};
    const username = normalizeUsername(user.username);
    const password = String(user.password || "");
    const roleName = String(user.role || "勇者").trim() || "勇者";
    const roleKey = String(user.roleKey || "hero").trim() || "hero";

    if (!username || !password) throw new Error("请输入用户名和密码");

    const existing = (await allUsers(bindings)).find(
      (item) => normalizeUsername(item.username) === username
    );
    if (existing) throw new Error("用户名已存在");

    const tableId = env("FEISHU_USERS_TABLE_ID", bindings);
    const created = await createRecordWithOptionalFields(
      tableId,
      {
        username,
        password,
        role: "user",
        roleName,
        roleKey,
        active: true
      },
      ["roleName", "roleKey"],
      bindings
    );

    const saved = userFromRecord(created, { role: roleName, roleKey });
    return {
      sessionToken: await signSession(
        username,
        env("FEISHU_APP_SECRET", bindings)
      ),
      user: saved
    };
  }

  if (action === "bootstrap") {
    const user = await requireUserOnly(body.token, bindings);
    try {
      const data = await allData(bindings);
      const freshUser =
        data.users.find((item) => item.username === user.username) || user;

      return {
        user: freshUser,
        users: data.users,
        records: freshUser.isAdmin
          ? data.records
          : data.records.filter((record) => record.userId === freshUser.id)
      };
    } catch (error) {
      return {
        user,
        users: [user],
        records: [],
        partial: true,
        message: error.message || "飞书记录同步失败"
      };
    }
  }

  if (action === "leaderboard") {
    const result = await requireUser(body.token, bindings);
    return result.users;
  }

  if (action === "saveUser") {
    const { user: actor, users } = await requireUser(body.token, bindings);
    if (!actor.isAdmin) throw new Error("没有管理员权限");

    const next = body.user || {};
    const target = users.find((item) =>
      item.id === next.id || item.username === next.username
    );
    if (!target) throw new Error("没有找到用户");

    const saved = await updateRecordWithOptionalFields(
      env("FEISHU_USERS_TABLE_ID", bindings),
      target.recordId,
      {
        username: target.username,
        password: next.password || target.password,
        role: target.isAdmin ? "admin" : "user",
        roleName: next.role || target.role || "勇者",
        roleKey: next.roleKey || target.roleKey || "hero",
        active: true
      },
      ["roleName", "roleKey"],
      bindings
    );

    return userFromRecord(saved, {
      role: next.role || target.role,
      roleKey: next.roleKey || target.roleKey
    });
  }

  if (action === "saveRecord") {
    const actor = await requireUserOnly(body.token, bindings);
    const record = body.record || {};
    const isExistingRecord =
      record.id && !String(record.id).startsWith("rec_");
    const records = isExistingRecord ? await allRecords(bindings) : [];
    const existing = records.find((item) => item.id === record.id);

    if (existing && !actor.isAdmin && existing.userId !== actor.id) {
      throw new Error("没有权限修改这条记录");
    }

    const username =
      actor.isAdmin && record.userId ? record.userId : actor.username;
    const fields = feishuRecordFields(record, username);
    const tableId = env("FEISHU_RECORDS_TABLE_ID", bindings);
    const saved = existing
      ? await updateRecord(tableId, existing.id, fields, bindings)
      : await createRecord(tableId, fields, bindings);

    return recordFromBitable(saved);
  }

  if (action === "deleteRecord") {
    const { user, records } = await requireUser(body.token, bindings);
    const record = records.find((item) => item.id === body.recordId);
    if (!record) return true;

    if (!user.isAdmin && record.userId !== user.id) {
      throw new Error("没有权限删除这条记录");
    }

    await deleteRecordFromTable(
      env("FEISHU_RECORDS_TABLE_ID", bindings),
      record.id,
      bindings
    );
    return true;
  }

  if (action === "clearRecords") {
    const { user, records } = await requireUser(body.token, bindings);
    const userId = user.isAdmin ? body.userId : user.id;

    await Promise.all(
      records
        .filter((record) => record.userId === userId)
        .map((record) =>
          deleteRecordFromTable(
            env("FEISHU_RECORDS_TABLE_ID", bindings),
            record.id,
            bindings
          )
        )
    );
    return true;
  }

  if (action === "deleteUser") {
    const { user: actor, users, records } = await requireUser(
      body.token,
      bindings
    );
    if (!actor.isAdmin) throw new Error("没有管理员权限");

    const target = users.find((item) => item.id === body.userId);
    if (!target || target.isAdmin) throw new Error("不能删除这个用户");

    const recordsTableId = env("FEISHU_RECORDS_TABLE_ID", bindings);
    await Promise.all(
      records
        .filter((record) => record.userId === target.id)
        .map((record) =>
          deleteRecordFromTable(recordsTableId, record.id, bindings)
        )
    );

    await deleteRecordFromTable(
      env("FEISHU_USERS_TABLE_ID", bindings),
      target.recordId,
      bindings
    );
    return true;
  }

  throw new Error("未知操作");
}

async function handlePost(context) {
  try {
    const body = await readBody(context.request);
    const data = await handle(body.action, body, context.env || {});
    return json(200, { ok: true, data });
  } catch (error) {
    return json(400, {
      ok: false,
      message: (error && error.message) || "请求失败"
    });
  }
}

export async function onRequestPost(context) {
  return handlePost(context);
}

export async function onRequest(context) {
  if (context.request.method !== "POST") {
    return json(405, { ok: false, message: "Method Not Allowed" });
  }
  return handlePost(context);
}
