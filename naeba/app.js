// 내바 프런트 — 빌드 없는 바닐라 JS. 내부(Flask, http) / 외부(정적 PWA, https+Drive JSON) 겸용.
"use strict";

const PAGE_KEY = "naeba_page";
const FETCH_TIMEOUT_MS = 15000;

// ---------- 순수 로직(노드 시험 대상) ----------
function slotsOfPage(page, pageSize) {
  const start = (page - 1) * pageSize + 1;
  return Array.from({ length: pageSize }, (_, i) => start + i);
}
function isInternalNo(no, internalMax) { return no <= internalMax; }
function clampPage(v, pages) { const n = parseInt(v, 10); return n >= 1 && n <= pages ? n : 1; }
function pctClass(p) { return p >= 90 ? "crit" : p >= 75 ? "hi" : ""; }
function chartX(i, n, w) { return n <= 1 ? 0 : (i / (n - 1)) * w; }
// 페이지 수 = max(menus.json 의 pages(최소치), 가장 큰 메뉴 번호가 들어가는 페이지) — 25 초과 시 버튼 자동 확장
function pageCount(menus) {
  const maxNo = menus.menus.reduce((a, m) => Math.max(a, m.no), 0);
  return Math.max(menus.pages || 1, Math.ceil(maxNo / menus.pageSize));
}
function fmtPct(v) { return v === null || v === undefined ? "–" : Math.round(v) + "%"; }

if (typeof module !== "undefined") module.exports = { slotsOfPage, isInternalNo, clampPage, pageCount, pctClass, chartX, fmtPct };

// ---------- 화면 ----------
if (typeof document !== "undefined") {
  const CFG = window.NAEBA_CONFIG || { mode: "external" };
  const INTERNAL = CFG.mode === "internal";
  const $app = document.getElementById("app");
  let MENUS = null;

  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v; else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (v !== false && v !== null && v !== undefined) n.setAttribute(k, v);
    }
    for (const c of kids.flat()) if (c !== null && c !== undefined) n.append(c.nodeType ? c : document.createTextNode(String(c)));
    return n;
  };
  const svg = (tag, attrs = {}) => { const n = document.createElementNS("http://www.w3.org/2000/svg", tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };

  async function fetchJson(url, opts = {}) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    try { const r = await fetch(url, { ...opts, signal: ctl.signal }); if (!r.ok) throw new Error("HTTP " + r.status); return await r.json(); }
    finally { clearTimeout(t); }
  }

  const TODO_URL = CFG.todoUrl || "https://jppress.github.io/test-todo-pwa/"; // 같은 origin 의 todo PWA(외부 모드 홈에서만 노출)

  function topbar(title, back) {
    return el("div", { class: "topbar" },
      back ? el("button", { class: "ghost", onclick: () => { location.hash = ""; } }, "‹ 홈") : null,
      el("h1", {}, title),
      el("span", { class: "badge" + (INTERNAL ? "" : " pub") }, INTERNAL ? "내부 와이파이" : "외부(조회 전용)"));
  }

  // ----- 홈 -----
  function renderHome() {
    const page = clampPage(localStorage.getItem(PAGE_KEY), pageCount(MENUS));
    const byNo = Object.fromEntries(MENUS.menus.map((m) => [m.no, m]));
    const col = el("div", { class: "menu-col" }, slotsOfPage(page, MENUS.pageSize).map((no) => {
      const m = byNo[no];
      if (!m) return el("div", { class: "menu-item empty" }, el("span", { class: "no" }, no + "."));
      const internal = isInternalNo(no, MENUS.internalMax);
      return el("button", { class: "menu-item", onclick: () => openMenu(m, internal) },
        el("span", { class: "no" }, no + "."), el("span", { class: "txt" }, m.icon + " " + m.label),
        internal ? el("span", { class: "badge" }, "내부 전용") : null);
    }));
    const pages = el("div", { class: "page-col" }, Array.from({ length: pageCount(MENUS) }, (_, i) => {
      const p = i + 1, a = (p - 1) * MENUS.pageSize + 1;
      return el("button", { class: p === page ? "active" : "", onclick: () => { localStorage.setItem(PAGE_KEY, p); renderHome(); } }, a + "~" + (a + MENUS.pageSize - 1));
    }));
    const todoLink = INTERNAL ? null : el("a", { class: "ghost", href: TODO_URL, style: "display:block;padding:8px 12px;text-align:center;text-decoration:none" }, "‹ 할일(todo)로 돌아가기");
    $app.replaceChildren(topbar("내바"), todoLink, el("div", { class: "home" }, col, pages));
  }

  function openMenu(m, internal) {
    if (internal && !INTERNAL) return externalLink(m);
    location.hash = "#/" + m.no;
  }

  // 외부 PWA(https)에서 내부 http 로의 fetch 는 혼합콘텐츠로 막히므로, 최상위 이동 링크만 쓴다.
  function externalLink(m) {
    const dlg = el("dialog", {});
    const url = CFG.lanUrl ? CFG.lanUrl.replace(/\/$/, "") + "/#/" + m.no : "";
    dlg.append(el("h2", {}, m.icon + " " + m.label), el("p", { class: "note" }, "내부 와이파이 전용 메뉴입니다. 집/사무실 와이파이에 연결돼 있을 때만 열립니다. 외부망(LTE)에서는 연결이 안 되고 브라우저 오류가 뜹니다(약 5초 후 실패) — 뒤로 가기로 돌아오세요."),
      url ? null : el("p", { class: "note state-err" }, "내부 주소가 설정되지 않았습니다."),
      el("div", { class: "row" }, el("button", { class: "ghost", onclick: () => dlg.close() }, "닫기"),
        url ? el("a", { href: url }, el("button", {}, "내부로 이동")) : null));
    dlg.addEventListener("close", () => dlg.remove());
    document.body.append(dlg); dlg.showModal();
  }

  // ----- 1번: 노트북 사용 -----
  const METRICS = [["cpu_pct", "CPU"], ["mem_pct", "메모리"], ["gpu_pct", "GPU"], ["disk_pct", "디스크"]];

  function deviceCard(d) {
    const head = el("h2", {}, d.label, d.state === "on" ? null : el("span", { class: d.state === "off" ? "state-off" : "state-err" }, d.state === "off" ? "꺼짐" : "조회 오류"));
    const card = el("div", { class: "card" }, head);
    if (d.state === "on") {
      for (const [k, name] of METRICS) {
        const v = d.metrics[k];
        card.append(el("div", { class: "metric" }, el("span", { class: "k" }, name),
          v === null || v === undefined ? el("span", { class: "na" }, "측정 불가")
            : [el("div", { class: "bar" }, el("i", { class: pctClass(v), style: "width:" + Math.min(100, v) + "%" })), el("span", { class: "v" }, fmtPct(v))]));
      }
    } else if (d.state === "error") card.append(el("div", { class: "note" }, d.error || ""));
    return card;
  }

  function confirmDialog(text, onOk) {
    const dlg = el("dialog", {}, el("p", {}, text), el("div", { class: "row" },
      el("button", { class: "ghost", onclick: () => dlg.close() }, "취소"),
      el("button", { class: "danger", onclick: () => { dlg.close(); onOk(); } }, "실행")));
    dlg.addEventListener("close", () => dlg.remove());
    document.body.append(dlg); dlg.showModal();
  }

  async function screenAction(target, action, out, btns) {
    btns.forEach((b) => (b.disabled = true)); out.textContent = "실행 중…";
    try {
      const r = await fetchJson("api/laptop/screen", { method: "POST", headers: { "Content-Type": "application/json", "X-Naeba-Confirm": "1" }, body: JSON.stringify({ target, action }) });
      out.textContent = r.ok ? r.text : "오류: " + r.error;
    } catch (e) { out.textContent = "오류: " + e.message; }
    btns.forEach((b) => (b.disabled = false));
  }

  async function renderLaptop() {
    const list = el("div", {}, el("div", { class: "note" }, "불러오는 중…"));
    const out = el("pre", { class: "out" }, "(버튼을 누르세요)");
    const btns = [];
    const mk = (label, target, action, warn) => { const b = el("button", { class: action === "off" ? "danger" : "ghost", onclick: () => confirmDialog(warn, () => screenAction(target, action, out, btns)) }, label); btns.push(b); return b; };
    const screen = el("div", { class: "card" }, el("h2", {}, "🌙 화면 끄기"),
      el("div", { class: "row" }, mk("노트북 끄기", "laptop", "off", "부팅된 노트북(my-80/my-85) 화면만 끕니다. 시스템은 꺼지지 않습니다."), mk("노트북 깨우기", "laptop", "wake", "노트북 화면을 깨웁니다(마우스 미세 이동).")),
      el("div", { class: "row" }, mk("my-70 끄기", "my-70", "off", "my-70 콘솔 화면을 끕니다."), mk("my-70 깨우기", "my-70", "wake", "my-70 콘솔 화면을 깨웁니다.")),
      el("div", { class: "note" }, "노트북은 지금 부팅된 쪽(my-80/my-85)만 대상입니다. my-70 은 X 화면이 없는 텍스트 콘솔이라 콘솔 블랭크로 끄고, 내장 패널 백라이트는 건드리지 않습니다."), out);
    const refresh = el("button", { class: "ghost", onclick: load }, "새로고침");
    $app.replaceChildren(topbar("💻 노트북 사용", true), el("div", { class: "view" }, el("div", { class: "row", style: "margin:0 0 12px" }, refresh), list, screen));
    async function load() {
      list.replaceChildren(el("div", { class: "note" }, "불러오는 중…"));
      try { const d = await fetchJson("api/laptop/usage?force=1"); list.replaceChildren(...d.devices.map(deviceCard)); }
      catch (e) { list.replaceChildren(el("div", { class: "card state-err" }, "조회 실패: " + e.message)); }
    }
    load();
  }

  // ----- 2번: 패드 화면 제어 -----
  const PADCTL_ORDER = ["padview", "hlsview", "ytrelay"];

  async function padctlAction(name, action, out, btns) {
    btns.forEach((b) => (b.disabled = true)); out.textContent = "실행 중…";
    try {
      const r = await fetchJson("api/padctl/" + name + "/" + action, { method: "POST" });
      out.textContent = r.ok ? (r.text || "완료") : "오류: " + (r.error || r.text || "실패");
    } catch (e) { out.textContent = "오류: " + e.message; }
    btns.forEach((b) => (b.disabled = false));
  }

  function padctlCard(name, meta) {
    const out = el("pre", { class: "out" }, "(상태조회를 누르세요)");
    const btns = [];
    const mk = (label, action, cls) => { const b = el("button", { class: cls || "ghost", onclick: () => padctlAction(name, action, out, btns) }, label); btns.push(b); return b; };
    const statusBtn = el("button", { class: "ghost", onclick: async () => {
      statusBtn.disabled = true; out.textContent = "조회 중…";
      try { const r = await fetchJson("api/padctl/status"); const s = r.status[name];
        out.textContent = (s.running ? "가동 중" : "정지됨") + (s.text ? "\n" + s.text : ""); }
      catch (e) { out.textContent = "오류: " + e.message; }
      statusBtn.disabled = false;
    } }, "상태조회");
    btns.push(statusBtn);
    return el("div", { class: "card" }, el("h2", {}, meta.label),
      el("div", { class: "row" }, mk("시작", "start"), mk("종료", "stop", "danger"), statusBtn),
      el("div", { class: "note" }, el("a", { href: meta.url, target: "_blank" }, meta.url)), out);
  }

  async function renderPadctl() {
    const cards = el("div", {}, el("div", { class: "note" }, "불러오는 중…"));
    $app.replaceChildren(topbar("📺 패드 화면 제어", true), el("div", { class: "view" }, cards));
    try {
      const r = await fetchJson("api/padctl/status");
      cards.replaceChildren(...PADCTL_ORDER.map((name) => padctlCard(name, r.apps[name])));
    } catch (e) { cards.replaceChildren(el("div", { class: "card state-err" }, "조회 실패: " + e.message)); }
  }

  // ----- 11번: 클로드 사용량 -----
  const SERIES = [["session_pct", "현재 세션", "var(--s1)"], ["weekly_pct", "주간 한도", "var(--s2)"], ["credit_pct", "크레딧", "var(--s3)"]];
  const _WD = "일월화수목금토";
  const _MON_NUM = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };

  // 계정 슬롯 표시 라벨 — 내부 id(acct1/acct2, my21api의 browser_vm/browser_vm2)는 그대로 두고
  // 화면 표시 텍스트만 "1번"/"2번"으로 통일한다(용도·경로 노출 최소화, 2026-09-23).
  function displaySlotLabel(a) {
    if (a.id === "acct1" || a.id === "browser_vm") return "1번";
    if (a.id === "acct2" || a.id === "browser_vm2") return "2번";
    return a.label || a.id;
  }

  // "2026-09-23T01:26[:38]" (서울 벽시계, 타임존 표기 없음) → "23일(수) 1시 26분"
  function fmtGenAt(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s || "");
    if (!m) return s || "";
    const [, y, mo, d, h, mi] = m;
    const wd = _WD[new Date(Date.UTC(+y, +mo - 1, +d)).getUTCDay()];
    return `${+d}일(${wd}) ${+h}시 ${+mi}분`;
  }

  // "Sep 23, 5pm (Asia/Seoul)" / "Sep 23, 5:30pm (Asia/Seoul)" → {wd, h(12시간제 숫자), mi|null}
  function _parseResetStr(s) {
    const m = /^([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{1,2})(?::(\d{2}))?\s*([ap])m/.exec(s || "");
    if (!m) return null;
    const [, mon, day, h, mi] = m;
    const monNum = _MON_NUM[mon];
    if (!monNum) return null;
    const now = new Date();
    let year = now.getUTCFullYear();
    if (monNum < now.getUTCMonth() + 1 - 6) year += 1; // 연말→연초로 넘어가는 리셋 보정
    const wd = _WD[new Date(Date.UTC(year, monNum - 1, +day)).getUTCDay()];
    return { wd, h: +h, mi: mi ? +mi : null };
  }
  function fmtSessionReset(s) {
    const p = _parseResetStr(s);
    if (!p) return s || "";
    return p.mi ? `${p.h}시 ${p.mi}분` : `${p.h}시`;
  }
  function fmtWeeklyReset(s) {
    const p = _parseResetStr(s);
    if (!p) return s || "";
    return p.mi ? `${p.wd} ${p.h}시 ${p.mi}분` : `${p.wd} ${p.h}시`;
  }

  function chart(acct) {
    const W = 640, H = 220, padL = 30, padB = 22, padT = 8, pw = W - padL - 6, ph = H - padT - padB, pts = acct.points;
    const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", role: "img", "aria-label": acct.label + " 사용량 차트" });
    for (const g of [0, 25, 50, 75, 100]) {
      const y = padT + ph * (1 - g / 100);
      s.append(svg("line", { class: "grid", x1: padL, x2: W - 6, y1: y, y2: y })); const t = svg("text", { x: 2, y: y + 3 }); t.textContent = g; s.append(t);
    }
    if (pts.length < 2) { const t = svg("text", { x: W / 2, y: H / 2, "text-anchor": "middle" }); t.textContent = "데이터 수집 중 — 다음 갱신에 표시됩니다"; s.append(t); return s; }
    const X = (i) => padL + chartX(i, pts.length, pw), Y = (v) => padT + ph * (1 - v / 100);
    const idx = Object.fromEntries(pts.map((p, i) => [p.t, i]));
    for (const r of acct.resets) {
      if (!(r.t in idx)) continue; const x = X(idx[r.t]);
      s.append(svg("line", { class: "reset", x1: x, x2: x, y1: padT, y2: padT + ph }));
      const t = svg("text", { x: x + 2, y: padT + 10 }); t.textContent = (r.kind === "weekly" ? "주간" : "세션") + "리셋"; s.append(t);
    }
    for (const [key, , color] of SERIES) {
      let d = "", pen = false;
      pts.forEach((p, i) => { if (p[key] === null || p[key] === undefined) { pen = false; return; } d += (pen ? "L" : "M") + X(i).toFixed(1) + " " + Y(p[key]).toFixed(1); pen = true; });
      if (d) s.append(svg("path", { d, fill: "none", stroke: color, "stroke-width": 2 }));
    }
    for (const i of [0, Math.floor(pts.length / 2), pts.length - 1]) { const t = svg("text", { class: "axis-t", x: X(i), y: H - 6, "text-anchor": i === 0 ? "start" : i === pts.length - 1 ? "end" : "middle" }); t.textContent = pts[i].t.slice(11, 16); s.append(t); }
    return s;
  }

  function acctBlock(a) {
    const l = a.latest;
    const tiles = el("div", { class: "tiles" }, SERIES.map(([k, name, color]) => el("div", { class: "tile" },
      el("div", { class: "l" }, el("i", { class: "d", style: "background:" + color }), name), el("div", { class: "n" }, l ? fmtPct(l[k]) : "–"),
      el("div", { class: "s" }, k === "session_pct" && l && l.session_reset ? fmtSessionReset(l.session_reset) : k === "weekly_pct" && l && l.weekly_reset ? fmtWeeklyReset(l.weekly_reset) : ""))));
    return el("div", { class: "card" }, el("h2", {}, displaySlotLabel(a)), tiles, chart(a),
      el("div", { class: "legend" }, SERIES.map(([, n, c]) => el("span", {}, el("i", { style: "background:" + c }), n)), el("span", {}, "┆ 점선=리셋 시점")));
  }

  // 외부: Drive 공유 JSON (todo PWA 와 같은 GIS 토큰 방식). 미설정이면 안내만 표시.
  const DRIVE_TOKEN_KEY = "naeba.gtoken";
  async function driveToken() {
    const clientId = (CFG.drive || {}).clientId;
    if (!clientId) throw new Error("Drive 연동이 아직 설정되지 않았습니다(배포 승인 대기).");
    let tok = sessionStorage.getItem(DRIVE_TOKEN_KEY);
    if (!tok) {
      if (!window.google || !window.google.accounts) await new Promise((res, rej) => { const s = document.createElement("script"); s.src = "https://accounts.google.com/gsi/client"; s.onload = res; s.onerror = () => rej(new Error("구글 로그인 스크립트 로드 실패")); document.head.append(s); });
      tok = await new Promise((res, rej) => window.google.accounts.oauth2.initTokenClient({ client_id: clientId, scope: "https://www.googleapis.com/auth/drive", callback: (r) => (r.access_token ? res(r.access_token) : rej(new Error("로그인 취소/실패"))) }).requestAccessToken({ prompt: "" }));
      sessionStorage.setItem(DRIVE_TOKEN_KEY, tok);
    }
    return tok;
  }

  // 외부 질문 등록: 폴더 소유자 Drive 폴더에 요청 파일 1개를 만든다(todo PWA 와 같은 폴더·토큰). macmini publisher 가 수집해 내바 서버에 접수한다.
  async function postArenaRequest(kind, text) {
    const tok = await driveToken();
    const folder = (CFG.drive || {}).folderId;
    if (!folder) throw new Error("Drive 폴더 설정이 없습니다.");
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const meta = { name: "naeba_arena_req_" + id + ".json", parents: [folder], mimeType: "application/json" };
    const body = JSON.stringify({ id, kind, text, ts: new Date().toISOString() });
    const boundary = "naebaarena" + id;
    const payload = "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(meta) + "\r\n--" + boundary + "\r\nContent-Type: application/json\r\n\r\n" + body + "\r\n--" + boundary + "--";
    const r = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "multipart/related; boundary=" + boundary }, body: payload });
    if (!r.ok) { if (r.status === 401) sessionStorage.removeItem(DRIVE_TOKEN_KEY); throw new Error("등록 실패 HTTP " + r.status); }
    return id;
  }

  async function loadDriveJson(fileName, anyFolder) {
    fileName = fileName || CFG.drive.fileName;
    const clientId = (CFG.drive || {}).clientId;
    if (!clientId) throw new Error("Drive 연동이 아직 설정되지 않았습니다(배포 승인 대기).");
    const tok = await driveToken();
    const H = { headers: { Authorization: "Bearer " + tok } };
    const inFolder = CFG.drive.folderId && !anyFolder ? " and '" + CFG.drive.folderId + "' in parents" : "";
    const q = encodeURIComponent("name='" + fileName + "' and trashed=false" + inFolder);
    const list = await fetchJson("https://www.googleapis.com/drive/v3/files?q=" + q + "&fields=files(id)&orderBy=modifiedTime desc&pageSize=1", H).catch((e) => { sessionStorage.removeItem(DRIVE_TOKEN_KEY); throw e; });
    if (!list.files.length) throw new Error("Drive 에 " + fileName + " 파일이 없습니다.");
    return fetchJson("https://www.googleapis.com/drive/v3/files/" + list.files[0].id + "?alt=media", H);
  }

  // my-21 외부 API 소스(Drive 대체 옵션) — my-70 browser-vm 자기 자신의 사용량, /l1(구 /usage,
  // 2026-09-23 개명 — 외부에 기능명을 노출하지 않는다)을 device_label 별로 묶어 기존 Drive/내부
  // 스냅샷과 같은 모양(accounts[].points/resets/latest)으로 변환한다.
  async function loadMy21ApiUsage() {
    const api = CFG.my21api || {};
    if (!api.url) throw new Error("my21api 연동이 아직 설정되지 않았습니다.");
    const data = await fetchJson(api.url.replace(/\/$/, "") + "/l1?hours=10", { headers: { Authorization: "Bearer " + api.readToken } });
    return toSnapshotShape(data.points || []);
  }

  function toSnapshotShape(points) {
    const byLabel = {};
    for (const p of points) (byLabel[p.device_label] ||= []).push(p);
    const accounts = Object.keys(byLabel).sort().map((label) => {
      const pts = byLabel[label].slice().sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
      const resets = [];
      let prev = null;
      for (const p of pts) {
        if (prev) {
          for (const [kind, key] of [["session", "session_pct"], ["weekly", "weekly_pct"]]) {
            if (prev[key] != null && p[key] != null && p[key] < prev[key]) resets.push({ t: p.ts, kind });
          }
        }
        prev = p;
      }
      const last = pts[pts.length - 1] || null;
      return {
        id: label, label,
        points: pts.map((p) => ({ t: p.ts, session_pct: p.session_pct, weekly_pct: p.weekly_pct, credit_pct: p.credit_pct })),
        resets,
        latest: last ? { t: last.ts, session_pct: last.session_pct, weekly_pct: last.weekly_pct, credit_pct: last.credit_pct,
                          session_reset: last.session_reset, weekly_reset: last.weekly_reset } : null,
      };
    });
    // generated_at 은 내부(usage_snapshot.py) 스냅샷과 같은 모양(서울 벽시계, 타임존 표기 없음)
    // 으로 맞춘다 — fmtGenAt() 가 소스에 상관없이 그대로 서울 시각으로 해석하게 하기 위함.
    const seoulNow = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .format(new Date()).replace(" ", "T");
    return { generated_at: seoulNow, window_hours: 10, step_min: 1, accounts };
  }

  async function fetchUsageSnapshot() {
    if (INTERNAL) return fetchJson("api/claude_usage");
    return (CFG.usageSource || "drive") === "my21api" ? loadMy21ApiUsage() : loadDriveJson();
  }

  async function renderClaude() {
    const body = el("div", {}, el("div", { class: "note" }, "불러오는 중…"));
    $app.replaceChildren(topbar("📈 클로드 사용량", true), el("div", { class: "view" }, body));
    try {
      const snap = await fetchUsageSnapshot();
      body.replaceChildren(el("div", { class: "gen-at" }, `갱신 ${fmtGenAt(snap.generated_at)}`), ...snap.accounts.map(acctBlock));
    } catch (e) { body.replaceChildren(el("div", { class: "card state-err" }, "조회 실패: " + e.message)); }
  }


  // ----- 17번: 아레나 AI -----
  const ARENA_FILE = "naeba_arena.json";
  const KIND_LABEL = { general: "일반", three: "Three.js" };
  const STATUS_LABEL = { queued: "대기", running: "생성 중", done: "완료", error: "실패" };

  function arenaFrame(html) {
    // 샌드박스(allow-scripts 만, same-origin 없음) — 모델이 만든 코드가 내바 저장소·쿠키에 접근하지 못하게 한다.
    return el("iframe", { class: "arena-frame", sandbox: "allow-scripts", srcdoc: html, loading: "lazy" });
  }

  function shotButton(job, side) {
    // 서버가 그 쪽 HTML 을 헤드리스로 렌더해 텔레그램으로 사진 전송(내부 와이파이에서만).
    const note = el("span", { class: "note" });
    const btn = el("button", { class: "ghost", onclick: async () => {
      btn.disabled = true; note.textContent = " 캡처 중…";
      try {
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 90000);  // 렌더+전송 10~20초
        const r = await (await fetch("api/arena/" + job.id + "/shot", { method: "POST", headers: { "Content-Type": "application/json", "X-Naeba-Confirm": "1" }, body: JSON.stringify({ side }), signal: ctl.signal })).json();
        clearTimeout(t);
        note.textContent = r.sent ? " 전송했습니다" : " 실패: " + (r.error || "");
      } catch (e) { note.textContent = " 실패: " + e.message; }
      btn.disabled = false;
    } }, "📷 캡처 전송");
    return el("div", { class: "row", style: "margin:6px 0" }, btn, note);
  }

  function arenaDetail(job) {
    const box = el("div", { class: "card" });
    const isThree = job.kind === "three";
    const sides = ["a", "b"].filter((k) => job["text_" + k]);
    let cur = job.chosen || "a";
    const body = el("div", {});
    const tabs = el("div", { class: "row", style: "margin:0 0 8px" });
    function draw() {
      tabs.replaceChildren(...sides.map((k) => el("button", { class: k === cur ? "" : "ghost", onclick: () => { cur = k; draw(); } },
        k.toUpperCase() + (k === job.chosen ? " ✓선택" : ""))));
      const html = job["html_" + cur], text = job["text_" + cur], model = job["model_" + cur];
      const kids = [el("div", { class: "note" }, "모델: ", el("b", {}, model || "?"), k_of(cur) )];
      if (isThree) {
        kids.push(html ? arenaFrame(html) : el("div", { class: "note state-err" }, "실행 가능한 코드를 찾지 못했습니다."));
        if (html && INTERNAL) kids.push(shotButton(job, cur));
        if (html) kids.push(el("details", {}, el("summary", {}, "코드 보기"), el("pre", { class: "out" }, html)));
        kids.push(el("details", {}, el("summary", {}, "답변 원문"), el("pre", { class: "out" }, text)));
      } else kids.push(el("pre", { class: "out arena-text" }, text));
      body.replaceChildren(...kids);
    }
    function k_of(k) { return k === job.chosen ? " (무작위 선택)" : ""; }
    box.append(el("h2", {}, (KIND_LABEL[job.kind] || job.kind) + " · " + job.input),
      el("div", { class: "note" }, "선택: " + (job.vote || "?") + " → ", el("b", {}, job.best_model || "?"), " · " + (job.finished || "").replace("T", " ").slice(0, 16)),
      tabs, body);
    draw();
    return box;
  }

  async function renderArena(openId) {
    const detail = el("div", {});
    const list = el("div", {}, el("div", { class: "note" }, "불러오는 중…"));
    const status = el("div", { class: "note" });
    let jobs = [], timer = null, userClicked = false;

    async function loadList() {
      try {
        if (INTERNAL) jobs = (await fetchJson("api/arena/list")).jobs;
        else {
          // 외부: 구글 로그인 팝업은 사용자 클릭 없이는 브라우저가 막으므로, 토큰이 없으면 버튼을 먼저 보여준다.
          if (!sessionStorage.getItem(DRIVE_TOKEN_KEY) && !userClicked) {
            list.replaceChildren(el("button", { onclick: () => { userClicked = true; tick(); } }, "구글 로그인하고 이력 보기"));
            return false;
          }
          jobs = (await loadDriveJson(ARENA_FILE, true)).jobs.map((j) => ({ ...j, _full: true }));
        }
      } catch (e) {
        userClicked = false;
        list.replaceChildren(el("div", { class: "card state-err" }, "조회 실패: " + e.message), el("button", { onclick: () => { userClicked = true; tick(); } }, "다시 로그인"));
        return false;
      }
      list.replaceChildren(...(jobs.length ? jobs.map(item) : [el("div", { class: "note" }, "이력이 없습니다.")]));
      const busy = jobs.some((j) => j.status === "queued" || j.status === "running");
      status.textContent = busy ? "⏳ 생성 중… (Three.js 는 수 분~30분 이상 걸릴 수 있습니다, 자동 갱신)" : "";
      return busy;
    }
    function item(j) {
      const cls = j.status === "error" ? "state-err" : j.status === "done" ? "" : "state-off";
      return el("button", { class: "menu-item arena-item", onclick: () => show(j) },
        el("span", { class: "txt" }, (j.kind === "three" ? "🧊 " : "💬 ") + j.input),
        el("span", { class: "note " + cls }, (STATUS_LABEL[j.status] || j.status) + (j.best_model ? " · " + j.best_model : "") + " · " + (j.created || "").replace("T", " ").slice(5, 16)));
    }
    async function show(j) {
      if (j.status === "error") { detail.replaceChildren(el("div", { class: "card state-err" }, "실패: " + (j.error || ""))); return; }
      if (j.status !== "done") { detail.replaceChildren(el("div", { class: "note" }, "아직 생성 중입니다.")); return; }
      try { const full = j._full ? j : await fetchJson("api/arena/" + j.id); detail.replaceChildren(arenaDetail(full)); detail.scrollIntoView({ behavior: "smooth" }); }
      catch (e) { detail.replaceChildren(el("div", { class: "card state-err" }, "조회 실패: " + e.message)); }
    }
    async function tick() {
      const busy = await loadList();
      clearTimeout(timer);
      if (busy && location.hash.startsWith("#/17")) timer = setTimeout(tick, 5000);
    }
    async function ask(kind) {
      const text = input.value.trim(); if (!text) { status.textContent = "내용을 입력하세요."; return; }
      btns.forEach((b) => (b.disabled = true));
      try {
        if (INTERNAL) {
          const r = await fetchJson("api/arena/ask", { method: "POST", headers: { "Content-Type": "application/json", "X-Naeba-Confirm": "1" }, body: JSON.stringify({ kind, text }) });
          if (!r.ok) throw new Error(r.error);
          input.value = ""; tick();
        } else {
          await postArenaRequest(kind, text);
          input.value = "";
          status.textContent = "✅ 등록됨 — 노트북이 켜져 있으면 2분 안에 접수되고, 생성(수 분~30분+) 후 이력에 나타납니다. 이력은 새로고침하면 갱신됩니다.";
        }
      } catch (e) { status.textContent = "오류: " + e.message; }
      btns.forEach((b) => (b.disabled = false));
    }
    const input = el("input", { class: "arena-input", type: "text", maxlength: "200", placeholder: "질문 또는 만들 물체(예: 사과)" });
    const btns = [el("button", { onclick: () => ask("general") }, "질문"), el("button", { onclick: () => ask("three") }, "three.js 만들기")];
    const form = el("div", { class: "card" }, input, el("div", { class: "row" }, ...btns),
      el("div", { class: "note" }, "질문=입력 그대로 / three.js 만들기=“Three.js로 ○○ 만들어줘”로 바꿔 질문. Arena 두 답 중 하나를 무작위로 골라 모델명을 확인합니다." + (INTERNAL ? "" : " (외부: 구글 로그인 후 등록, 부팅된 노트북 my-80/my-85 가 처리)")));
    $app.replaceChildren(topbar("🏟️ 아레나 AI", true), el("div", { class: "view" }, form, status, detail, el("h2", {}, "이력"), list));
    await tick();
    if (openId) { const j = jobs.find((x) => x.id === openId); if (j) show(j); }
  }

  // ----- 라우팅 -----
  function route() {
    const no = parseInt((location.hash.match(/^#\/(\d+)/) || [])[1], 10);
    const m = MENUS.menus.find((x) => x.no === no);
    if (!m) return renderHome();
    if (isInternalNo(no, MENUS.internalMax) && !INTERNAL) return renderHome();
    return m.view === "laptop" ? renderLaptop() : m.view === "padctl" ? renderPadctl() : m.view === "claude" ? renderClaude() : m.view === "arena" ? renderArena() : renderHome();
  }

  fetchJson("menus.json").then((m) => { MENUS = m; window.addEventListener("hashchange", route); route(); })
    .catch((e) => $app.replaceChildren(el("div", { class: "view state-err" }, "메뉴를 불러오지 못했습니다: " + e.message)));
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) navigator.serviceWorker.register("sw.js").catch(() => {});
}
