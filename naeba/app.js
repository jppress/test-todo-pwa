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

// 21번: 한 줄 1프롬프트 → 목록(빈 줄·중복 제거, 최대 30). 12번: 서울 벽시계 ts 기준 최근 N분 행.
const IMG_MAX_PROMPTS = 30, IMG_MAX_LEN = 600;
// 서버(imgq.py PRESET_SIZES)와 같은 목록. 1080 은 서버가 16배수(1088)로 생성 후 요청 크기로 크롭한다.
const IMG_SIZES = [[1024, 1024, "1024×1024 정사각"], [768, 768, "768×768 정사각"], [1920, 1080, "1920×1080 가로 FHD"], [1080, 720, "1080×720 가로 3:2"],
  [1280, 720, "1280×720 가로 HD"], [720, 1280, "720×1280 세로"], [720, 480, "720×480 가로"], [480, 720, "480×720 세로"]];
// 모델 선택 규칙: 선택 체크 시 체크된 id 들(콤마), 아니면 라디오(기본="" / 전체="all")
function modelSpec(selectMode, radio, checkedIds) { return selectMode ? checkedIds.join(",") : radio === "all" ? "all" : ""; }
function parsePrompts(text) {
  const seen = new Set(), out = [];
  for (const l of String(text || "").split(/\r?\n/)) { const t = l.trim(); if (t && !seen.has(t)) { seen.add(t); out.push(t); } }
  return { prompts: out.slice(0, IMG_MAX_PROMPTS), truncated: out.length > IMG_MAX_PROMPTS, tooLong: out.some((p) => p.length > IMG_MAX_LEN) };
}
function recentRows(points, minutes, nowTs) {
  const cut = new Date(new Date(nowTs + "Z").getTime() - minutes * 60000).toISOString().slice(0, 19);
  return points.filter((p) => p.ts >= cut && p.ts <= nowTs).slice().reverse();
}
function fmtEta(sec) { if (!sec || sec < 60) return sec ? "1분 미만" : "–"; const m = Math.round(sec / 60); return m >= 60 ? Math.floor(m / 60) + "시간 " + (m % 60) + "분" : m + "분"; }
function metricNum(v, d = 0) { return v === null || v === undefined ? "–" : Number(v).toFixed(d); }

if (typeof module !== "undefined") module.exports = { slotsOfPage, isInternalNo, clampPage, pageCount, pctClass, chartX, fmtPct, parsePrompts, recentRows, fmtEta, metricNum, IMG_SIZES, modelSpec };

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


  // ----- 공용 선 차트(12번): 시리즈 N개, 값 null 은 끊김 -----
  function lineChart(title, pts, series, { min = 0, max = null, unit = "" } = {}) {
    const W = 640, H = 170, padL = 34, padB = 20, padT = 8, pw = W - padL - 6, ph = H - padT - padB;
    const vals = pts.flatMap((p) => series.map((s) => p[s.key])).filter((v) => v !== null && v !== undefined);
    const hi = max !== null ? max : Math.max(1, Math.ceil(Math.max(...(vals.length ? vals : [1])) * 1.1));
    const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", role: "img", "aria-label": title });
    for (const g of [0, 0.5, 1]) { const y = padT + ph * (1 - g), v = min + (hi - min) * g; s.append(svg("line", { class: "grid", x1: padL, x2: W - 6, y1: y, y2: y })); const t = svg("text", { x: 2, y: y + 3 }); t.textContent = Math.round(v); s.append(t); }
    if (pts.length < 2) { const t = svg("text", { x: W / 2, y: H / 2, "text-anchor": "middle" }); t.textContent = "데이터 수집 중"; s.append(t); return s; }
    const X = (i) => padL + chartX(i, pts.length, pw), Y = (v) => padT + ph * (1 - (Math.min(hi, Math.max(min, v)) - min) / (hi - min || 1));
    for (const sr of series) {
      let d = "", pen = false;
      pts.forEach((p, i) => { const v = p[sr.key]; if (v === null || v === undefined) { pen = false; return; } d += (pen ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1); pen = true; });
      if (d) s.append(svg("path", { d, fill: "none", stroke: sr.color, "stroke-width": 1.6 }));
    }
    for (const i of [0, Math.floor(pts.length / 2), pts.length - 1]) { const t = svg("text", { class: "axis-t", x: X(i), y: H - 5, "text-anchor": i === 0 ? "start" : i === pts.length - 1 ? "end" : "middle" }); t.textContent = pts[i].ts.slice(5, 16).replace("T", " "); s.append(t); }
    return el("div", { class: "card" }, el("h2", {}, title, el("span", { class: "note", style: "margin:0 0 0 auto" }, unit)), s,
      el("div", { class: "legend" }, series.map((x) => el("span", {}, el("i", { style: "background:" + x.color }), x.name))));
  }

  // ----- 12번: my-50 사용량 (기존 클로드 사용량 패턴 — 24시간 분단위 그래프 + 최근 30분 표) -----
  async function loadMy50() {
    if (INTERNAL) { const r = await fetchJson("api/my50/usage?hours=24"); if (r.ok === false) throw new Error(r.error); return r.points || []; }
    const api = CFG.my21api || {};
    if (!api.url) throw new Error("my21api 연동이 아직 설정되지 않았습니다.");
    return (await fetchJson(api.url.replace(/\/$/, "") + "/l2?hours=24", { headers: { Authorization: "Bearer " + api.readToken } })).points || [];
  }

  async function renderMy50() {
    const body = el("div", {}, el("div", { class: "note" }, "불러오는 중…"));
    $app.replaceChildren(topbar("🖥️ my-50 사용량", true), el("div", { class: "view" }, body));
    let timer = null;
    async function load() {
      try {
        const pts = await loadMy50();
        const last = pts[pts.length - 1];
        if (!last) { body.replaceChildren(el("div", { class: "card state-off" }, "아직 수집된 데이터가 없습니다(샘플러 기동 후 1~5분 뒤 표시).")); return; }
        const tile = (l, v, sub, color) => el("div", { class: "tile" }, el("div", { class: "l" }, el("i", { class: "d", style: "background:" + color }), l), el("div", { class: "n" }, v), el("div", { class: "s" }, sub || ""));
        const hot = last.temp !== null && last.temp >= 80;
        const tiles = el("div", { class: "tiles" },
          tile("CPU", metricNum(last.cpu) + "%", "", "var(--s1)"), tile("GPU", metricNum(last.gpu) + "%", "", "var(--s2)"),
          tile("온도", metricNum(last.temp) + "℃", hot ? "⚠ 과열 구간" : "", "var(--s3)"),
          tile("내장 여유", metricNum(last.disk_in) + "GB", "", "var(--s1)"), tile("외장 여유", metricNum(last.disk_ex) + "GB", "", "var(--s2)"));
        const C = ["var(--s1)", "var(--s2)", "var(--s3)"];
        const rows = recentRows(pts, 30, last.ts);
        const th = ["시각", "CPU%", "GPU%", "온도℃", "메모리여유%", "내장GB", "외장GB", "생성큐"];
        const table = el("table", { class: "tbl" }, el("thead", {}, el("tr", {}, th.map((h) => el("th", {}, h)))),
          el("tbody", {}, rows.map((p) => el("tr", {}, [p.ts.slice(11, 16), metricNum(p.cpu), metricNum(p.gpu), metricNum(p.temp, 1), metricNum(p.mem_free), metricNum(p.disk_in, 1), metricNum(p.disk_ex, 1),
            (p.q_run || 0) + "/" + (p.q_wait || 0)].map((v) => el("td", {}, v))))));
        body.replaceChildren(el("div", { class: "gen-at" }, `최근 샘플 ${last.ts.replace("T", " ").slice(0, 16)} · 최근 24시간 ${pts.length}건`), tiles,
          lineChart("CPU · GPU 사용률", pts, [{ key: "cpu", name: "CPU", color: C[0] }, { key: "gpu", name: "GPU", color: C[1] }], { max: 100, unit: "%" }),
          lineChart("온도 (SoC 최고)", pts, [{ key: "temp", name: "온도", color: C[2] }], { min: 20, max: 100, unit: "℃ · 80↑ 대기 중단, 88↑ 강제정지" }),
          lineChart("디스크 여유", pts, [{ key: "disk_in", name: "내장", color: C[0] }, { key: "disk_ex", name: "외장", color: C[1] }], { unit: "GB" }),
          el("div", { class: "card" }, el("h2", {}, "최근 30분 데이터 (1분 단위)"), el("div", { class: "tblwrap" }, table), el("div", { class: "note" }, "큐 = 실행 중/대기 중 이미지 작업 수")));
      } catch (e) { body.replaceChildren(el("div", { class: "card state-err" }, "조회 실패: " + e.message)); }
      clearTimeout(timer);
      if (location.hash.startsWith("#/12")) timer = setTimeout(load, 60000);
    }
    await load();
  }

  // ----- 21번: 이미지 생성 (my-50 큐 · 부하 자동 조절 · 이력) -----
  const IMG_SNAP = "naeba_imggen.json";
  const IMG_STATUS = { queued: "대기", running: "생성 중", done: "완료", error: "실패", canceled: "취소" };
  const driveBlobCache = new Map();

  async function driveBlobUrl(fileId) {
    if (driveBlobCache.has(fileId)) return driveBlobCache.get(fileId);
    const tok = await driveToken();
    const r = await fetch("https://www.googleapis.com/drive/v3/files/" + fileId + "?alt=media", { headers: { Authorization: "Bearer " + tok } });
    if (!r.ok) { if (r.status === 401) sessionStorage.removeItem(DRIVE_TOKEN_KEY); throw new Error("이미지 HTTP " + r.status); }
    const url = URL.createObjectURL(await r.blob()); driveBlobCache.set(fileId, url); return url;
  }

  async function postImgRequest(prompts, models, w, h) {
    const tok = await driveToken(); const folder = (CFG.drive || {}).folderId;
    if (!folder) throw new Error("Drive 폴더 설정이 없습니다.");
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const meta = { name: "naeba_img_req_" + id + ".json", parents: [folder], mimeType: "application/json" };
    const boundary = "naebaimg" + id;
    const payload = "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(meta) + "\r\n--" + boundary + "\r\nContent-Type: application/json\r\n\r\n" + JSON.stringify({ id, prompts, models, w, h, ts: new Date().toISOString() }) + "\r\n--" + boundary + "--";
    const r = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "multipart/related; boundary=" + boundary }, body: payload });
    if (!r.ok) { if (r.status === 401) sessionStorage.removeItem(DRIVE_TOKEN_KEY); throw new Error("등록 실패 HTTP " + r.status); }
    return id;
  }

  async function renderImggen() {
    const post = (url, body) => fetchJson(url, { method: "POST", headers: { "Content-Type": "application/json", "X-Naeba-Confirm": "1" }, body: JSON.stringify(body) });
    let models = [], defaultModel = "", snap = null, jobs = [], total = 0, timer = null, userClicked = false, offset = 0;
    const PAGE = 24;
    const msg = el("div", { class: "note" });
    const area = el("textarea", { class: "arena-input", rows: "5", placeholder: "한 줄에 프롬프트 1개 (최대 30개, 영어 권장)\n예) a red apple on a wooden table, studio light" });
    const count = el("div", { class: "note" });
    const modelBox = el("div", { style: "margin:6px 0" });
    const sizeSel = el("select", { class: "arena-input", style: "width:auto" }, IMG_SIZES.map(([w, h, label], i) => el("option", { value: w + "x" + h, selected: i === 0 }, label)));
    const progress = el("div", { class: "card" }, el("div", { class: "note" }, "진행 상태 불러오는 중…"));
    const histBox = el("div", { class: "imggrid" });
    const moreBtn = el("button", { class: "ghost", style: "display:none", onclick: () => { offset += PAGE; loadHist(true); } }, "더 보기");
    const q = el("input", { class: "arena-input", type: "text", placeholder: "프롬프트 검색", style: "flex:2;min-width:140px;margin:0", oninput: () => { offset = 0; loadHist(); } });
    const dt = el("input", { class: "arena-input", type: "date", style: "flex:1;min-width:130px;margin:0", onchange: () => { offset = 0; loadHist(); } });
    const st = el("select", { class: "arena-input", style: "flex:1;min-width:90px;margin:0", onchange: () => { offset = 0; loadHist(); } },
      el("option", { value: "" }, "전체 상태"), Object.entries(IMG_STATUS).map(([k, v]) => el("option", { value: k }, v)));
    const checks = () => [...modelBox.querySelectorAll("input[data-m]")];
    let modelSig = "";
    function drawModels() {
      // 기본(기본 모델 1개) / 전체(사용 가능 전부) / '선택 모델' 체크 시 설치된 모델 목록에서 다중 선택
      const usable = models.filter((m) => m.usable), def = models.find((m) => m.id === defaultModel) || usable[0];
      const keep = new Set(checks().filter((c) => c.checked).map((c) => c.dataset.m));
      const list = el("div", { class: "modellist", style: "display:none" }, models.map((m) => el("label", { class: "chk" + (m.usable ? "" : " state-off") },
        el("input", { type: "checkbox", "data-m": m.id, disabled: !m.usable, checked: keep.has(m.id) }), m.label + (m.usable ? "" : m.installed ? " (설치됨·기본 제외, 선택 불가)" : " (미설치)"))));
      const sel = el("input", { type: "checkbox", id: "selmode", onchange: (e) => { list.style.display = e.target.checked ? "" : "none"; modelBox.querySelectorAll("input[name=mm]").forEach((r) => (r.disabled = e.target.checked)); } });
      modelBox.replaceChildren(
        el("div", { class: "row", style: "margin:0;align-items:center" },
          el("label", { class: "chk" }, el("input", { type: "radio", name: "mm", value: "", checked: true }), "기본" + (def ? "(" + def.label.split(" (")[0] + ")" : "")),
          el("label", { class: "chk" }, el("input", { type: "radio", name: "mm", value: "all" }), "전체(" + usable.length + ")"),
          el("label", { class: "chk" }, sel, "선택 모델")), list);
    }
    function currentSpec() {
      const selMode = !!(modelBox.querySelector("#selmode") || {}).checked;
      const radio = (modelBox.querySelector("input[name=mm]:checked") || {}).value || "";
      return modelSpec(selMode, radio, checks().filter((c) => c.checked).map((c) => c.dataset.m));
    }
    function upd() { const r = parsePrompts(area.value); count.textContent = r.prompts.length + "개 인식" + (r.truncated ? " — 30개 초과분은 제외됩니다" : "") + (r.tooLong ? " — 600자 넘는 줄이 있습니다" : ""); }
    area.addEventListener("input", upd); upd();

    async function submit() {
      const r = parsePrompts(area.value); const spec = currentSpec();
      const selMode = !!(modelBox.querySelector("#selmode") || {}).checked;
      if (!r.prompts.length) { msg.textContent = "프롬프트를 입력하세요."; return; }
      if (r.tooLong) { msg.textContent = "600자 넘는 줄이 있습니다."; return; }
      if (selMode && !spec) { msg.textContent = "선택 모델을 하나 이상 체크하세요."; return; }
      const [w, h] = sizeSel.value.split("x").map((v) => parseInt(v, 10));
      sub.disabled = true;
      try {
        if (INTERNAL) { const res = await post("api/imggen/submit", { prompts: r.prompts, models: spec, w, h }); if (!res.ok) throw new Error(res.error); msg.textContent = `✅ ${res.job_ids.length}건 예약됨 (프롬프트 ${res.prompts} × 모델 ${res.models.length}, ${w}×${h}) — my-50 부하를 보며 순차 생성합니다.`; tick(); }
        else { await postImgRequest(r.prompts, spec, w, h); msg.textContent = "✅ 요청 등록됨 — 집 와이파이 쪽 내바가 2분 안에 접수해 순차 생성합니다. 진행 상태는 몇 분 간격으로 갱신됩니다."; }
        area.value = ""; upd();
      } catch (e) { msg.textContent = "오류: " + e.message; }
      sub.disabled = false;
    }
    const sub = el("button", { onclick: submit }, "예약 등록");

    async function loadStatus() {
      if (INTERNAL) {
        const s = await fetchJson("api/imggen/status"); if (s.ok === false) throw new Error(s.error); return s;
      }
      snap = await loadDriveJson(IMG_SNAP, true);
      if (snap.models && JSON.stringify(snap.models) !== modelSig) { modelSig = JSON.stringify(snap.models); models = snap.models; defaultModel = snap.default_model || ""; drawModels(); }
      return { overall_pct: snap.overall_pct, eta_sec: snap.eta_sec, counts: snap.counts, paused: snap.paused, worker: snap.worker, running: (snap.jobs.find((j) => j.status === "running") || null), snapAt: snap.generated_at };
    }
    function drawProgress(s) {
      const c = s.counts || {}, run = s.running, w = s.worker || {};
      const act = { run: "생성 중", rest: "휴식(부하 조절)", hold: "대기 — " + (w.reason || ""), idle: "대기 작업 없음", paused: "일시정지" }[w.action] || "알 수 없음(워커 미가동?)";
      const bar = el("div", { class: "bar" }, el("i", { class: pctClass(s.overall_pct || 0), style: `width:${s.overall_pct || 0}%` }));
      const kids = [el("h2", {}, "생성 진행"), el("div", { class: "metric" }, el("span", { class: "k" }, "전체"), bar, el("span", { class: "v" }, Math.round(s.overall_pct || 0) + "%")),
        el("div", { class: "note" }, `대기 ${c.queued || 0} · 생성 중 ${c.running || 0} · 완료 ${c.done || 0} · 실패 ${c.error || 0} · 남은 시간 약 ${fmtEta(s.eta_sec)}`),
        el("div", { class: "note" }, "my-50 상태: ", el("b", {}, act), w.temp ? ` · ${w.temp}℃` : "")];
      if (run) kids.push(el("div", { class: "note" }, `지금: #${run.id} ${run.model} ${run.step || 0}/${run.steps || "?"}단계 (${Math.round(run.pct || 0)}%) — ${run.prompt.slice(0, 60)}`));
      if (s.snapAt) kids.push(el("div", { class: "note" }, "외부 보기는 몇 분 간격 갱신: " + s.snapAt.replace("T", " ").slice(0, 16)));
      if (INTERNAL) kids.push(el("div", { class: "row" }, el("button", { class: "ghost", onclick: async () => { await post("api/imggen/pause", { on: !s.paused }); tick(); } }, s.paused ? "▶ 재개" : "⏸ 일시정지"),
        el("button", { class: "danger", onclick: async () => { if (confirm("대기 중인 작업을 모두 취소할까요?")) { await post("api/imggen/cancel", { all: true }); tick(); } } }, "대기 전체 취소")));
      progress.replaceChildren(...kids);
      return (c.queued || 0) + (c.running || 0) > 0;
    }
    function card(j) {
      const img = el("img", { class: "thumb", alt: "", loading: "lazy" });
      const open = async () => {
        try { const u = INTERNAL ? "api/imggen/img/" + j.id + "/full" : await driveBlobUrl(j.f); window.open(u, "_blank"); } catch (e) { msg.textContent = "열기 실패: " + e.message; }
      };
      if (j.status === "done") {
        if (INTERNAL) img.src = "api/imggen/img/" + j.id + "/thumb";
        else if (j.t) driveBlobUrl(j.t).then((u) => (img.src = u)).catch(() => (img.alt = "로그인 필요"));
      }
      const cls = j.status === "error" ? "state-err" : j.status === "done" ? "" : "state-off";
      return el("div", { class: "imgcard" }, j.status === "done" ? el("div", { onclick: open, style: "cursor:pointer" }, img) : el("div", { class: "thumb ph " + cls }, IMG_STATUS[j.status] + (j.status === "running" ? " " + Math.round(j.pct || 0) + "%" : "")),
        el("div", { class: "cap" }, j.prompt), el("div", { class: "note" }, `#${j.id} ${j.model} · ${(j.created || "").replace("T", " ").slice(5, 16)}` + (j.dur_sec ? ` · ${Math.round(j.dur_sec)}초` : "")),
        j.status === "error" ? el("div", { class: "note state-err" }, (j.error || "").slice(0, 80)) : null);
    }
    async function loadHist(append) {
      try {
        let list;
        if (INTERNAL) {
          const p = new URLSearchParams({ limit: PAGE, offset }); if (q.value.trim()) p.set("q", q.value.trim()); if (dt.value) p.set("date", dt.value); if (st.value) p.set("status", st.value);
          const r = await fetchJson("api/imggen/jobs?" + p); if (r.ok === false) throw new Error(r.error); list = r.jobs; total = r.total;
        } else {
          if (!snap) return;
          const kw = q.value.trim().toLowerCase();
          const all = snap.jobs.filter((j) => (!kw || j.prompt.toLowerCase().includes(kw)) && (!dt.value || (j.created || "").startsWith(dt.value)) && (!st.value || j.status === st.value));
          total = all.length; list = all.slice(offset, offset + PAGE);
        }
        jobs = append ? jobs.concat(list) : list;
        histBox.replaceChildren(...(jobs.length ? jobs.map(card) : [el("div", { class: "note" }, "조건에 맞는 이력이 없습니다.")]));
        moreBtn.style.display = offset + PAGE < total ? "" : "none";
      } catch (e) { histBox.replaceChildren(el("div", { class: "card state-err" }, "이력 조회 실패: " + e.message)); }
    }
    async function tick() {
      let busy = false;
      try {
        if (!INTERNAL && !sessionStorage.getItem(DRIVE_TOKEN_KEY) && !userClicked) {
          progress.replaceChildren(el("button", { onclick: () => { userClicked = true; tick(); } }, "구글 로그인하고 진행·이력 보기")); return;
        }
        busy = drawProgress(await loadStatus());
        if (!jobs.length || busy || !INTERNAL) await loadHist(false);
      } catch (e) { userClicked = false; progress.replaceChildren(el("div", { class: "state-err" }, "조회 실패: " + e.message), el("button", { onclick: () => { userClicked = true; tick(); } }, "다시 시도")); }
      clearTimeout(timer);
      if (location.hash.startsWith("#/21")) timer = setTimeout(tick, busy ? (INTERNAL ? 3000 : 60000) : 30000);
    }

    const form = el("div", { class: "card" }, el("h2", {}, "새 이미지"), area, count, modelBox,
      el("div", { class: "row", style: "align-items:center" }, sizeSel, sub), msg,
      el("div", { class: "note" }, "예약된 작업은 my-50 이 온도·메모리·부하를 보면서 한 장씩 천천히 만듭니다(과열 시 자동 대기). 빠르게 만드는 것보다 my-50 보호가 우선입니다."));
    $app.replaceChildren(topbar("🎨 이미지 생성", true), el("div", { class: "view" }, form, progress, el("h2", {}, "이력"), el("div", { class: "row", style: "margin:0 0 10px" }, q, dt, st), histBox, el("div", { class: "row" }, moreBtn)));
    if (INTERNAL) { try { const m = await fetchJson("api/imggen/models"); if (m.ok === false) throw new Error(m.error); models = m.models; defaultModel = m.default || ""; } catch (e) { msg.textContent = "모델 목록 실패: " + e.message; } }
    else models = [{ id: "", label: "서버 기본 모델", usable: true, installed: true }];   // 로그인 후 스냅샷의 실제 목록으로 교체
    drawModels();
    await tick();
  }

  // ----- 라우팅 -----
  function route() {
    const no = parseInt((location.hash.match(/^#\/(\d+)/) || [])[1], 10);
    const m = MENUS.menus.find((x) => x.no === no);
    if (!m) return renderHome();
    if (isInternalNo(no, MENUS.internalMax) && !INTERNAL) return renderHome();
    return m.view === "laptop" ? renderLaptop() : m.view === "padctl" ? renderPadctl() : m.view === "claude" ? renderClaude() : m.view === "arena" ? renderArena() : m.view === "my50" ? renderMy50() : m.view === "imggen" ? renderImggen() : renderHome();
  }

  fetchJson("menus.json").then((m) => { MENUS = m; window.addEventListener("hashchange", route); route(); })
    .catch((e) => $app.replaceChildren(el("div", { class: "view state-err" }, "메뉴를 불러오지 못했습니다: " + e.message)));
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) navigator.serviceWorker.register("sw.js").catch(() => {});
}
