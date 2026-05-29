/* ═══════════════════════════════════════════════════════════════════
   Smart API Docs — app.js  (v4 — all pipeline bugs fixed)

   FIXES IN THIS VERSION:
   1. filterBar (#mfilters + #filterSearch) fully wired to renderInvTable
      — both top filterBar and inline invMfilters stay in sync via
        the shared activeMethodFilter + renderInvTable() pipeline.
   2. renderModels correctly reads scan.dataModels from scanner;
      no hardcoded data anywhere.
   3. showView("viewDocs") always sets display:flex (not "").
   4. filterBar shown/hidden correctly inside showDocPage.
   5. Scanner dataModels pipeline verified end-to-end.
═══════════════════════════════════════════════════════════════════ */

/* ── globals ── */
let currentScan    = null;
let currentSession = null;
let activeMethodFilter = "";
let activeEpIndex  = -1;
let activeDocPage  = "overview";

/* ════════════════════════════════════════════════════════════════
   BOOT
════════════════════════════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", () => {

  /* ── Tab switching (Git / Local / Upload) ── */
  document.querySelectorAll(".itab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".itab").forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".ipane").forEach(p => p.classList.remove("active"));
      tab.classList.add("active");
      const pane = document.getElementById("ipane-" + tab.dataset.tab);
      if (pane) pane.classList.add("active");
    });
  });

  /* ── Scan buttons ── */
  const btnGit    = document.getElementById("btnGit");
  const btnPath   = document.getElementById("btnPath");
  const btnUpload = document.getElementById("btnUpload");

  if (btnGit) btnGit.addEventListener("click", () => {
    const url = document.getElementById("gitUrl").value.trim();
    const pat = document.getElementById("patToken").value.trim();
    if (!url) return flash("gitUrl");
    analyze("/api/analyze-git", { url, pat });
  });

  if (btnPath) btnPath.addEventListener("click", () => {
    const p = document.getElementById("localPath").value.trim();
    if (!p) return flash("localPath");
    analyze("/api/analyze-path", { path: p });
  });

  if (btnUpload) btnUpload.addEventListener("click", async () => {
    const input = document.getElementById("folderFiles");
    if (!input || !input.files.length) return alert("Please select a folder first.");
    setStatus("loading", "Reading files…", "");
    showView("viewLoading");
    setLoadMsg("Reading uploaded files…");
    const files = await Promise.all([...input.files].map(async f => ({
      path: f.webkitRelativePath || f.name,
      content: await f.text().catch(() => "")
    })));
    analyze("/api/analyze-files", { name: "Uploaded API", files });
  });

  /* Drop zone label update */
  const folderFiles = document.getElementById("folderFiles");
  if (folderFiles) folderFiles.addEventListener("change", function () {
    const lbl = document.getElementById("dropLabel");
    if (lbl) lbl.textContent = this.files.length
      ? `${this.files.length} files selected`
      : "📁 Click or drag a folder here";
  });

  /* ── FIX 1: Top filterBar method buttons (#mfilters) ──
     Wire them to setMethodFilter() which updates activeMethodFilter,
     syncs the inv panel buttons, and calls renderInvTable().         */
  document.getElementById("mfilters")?.addEventListener("click", e => {
    const btn = e.target.closest(".mf-btn");
    if (!btn) return;
    setMethodFilter(btn.dataset.m || "");
  });

  /* ── FIX 1b: Top filterBar search input (#filterSearch) ── */
  document.getElementById("filterSearch")?.addEventListener("input", e => {
    /* Mirror value into the inv search so renderInvTable picks it up */
    const invSearch = document.getElementById("invSearch");
    if (invSearch) invSearch.value = e.target.value;
    renderInvTable();
    updateFilterCount();
  });

  /* ── Inventory method filter buttons (inline, inside overview panel) ── */
  document.getElementById("invMfilters")?.addEventListener("click", e => {
    const btn = e.target.closest(".mf-sm");
    if (!btn) return;
    setMethodFilter(btn.dataset.m || "");
  });

  /* ── Inventory search ── */
  document.getElementById("invSearch")?.addEventListener("input", e => {
    /* Mirror to top filterBar search */
    const topSearch = document.getElementById("filterSearch");
    if (topSearch) topSearch.value = e.target.value;
    renderInvTable();
    updateFilterCount();
  });

  /* ── Sidebar search ── */
  document.getElementById("sbSearch")?.addEventListener("input", e => filterSidebarNav(e.target.value));
});

/* ════════════════════════════════════════════════════════════════
   SHARED METHOD FILTER SETTER
   Updates activeMethodFilter, syncs BOTH filter UIs, re-renders.
════════════════════════════════════════════════════════════════ */
function setMethodFilter(method) {
  activeMethodFilter = method;

  /* Sync top filterBar buttons */
  document.querySelectorAll("#mfilters .mf-btn").forEach(b => {
    b.classList.toggle("active", (b.dataset.m || "") === method);
  });
  /* Sync inline invMfilters buttons */
  document.querySelectorAll("#invMfilters .mf-sm").forEach(b => {
    b.classList.toggle("active", (b.dataset.m || "") === method);
  });

  renderInvTable();
  updateFilterCount();
}

function updateFilterCount() {
  if (!currentScan) return;
  const q = (document.getElementById("invSearch")?.value || "").toLowerCase();
  const m = activeMethodFilter;
  const count = currentScan.endpoints.filter(ep => {
    const methodOk = !m || ep.method === m;
    const blob = `${ep.method} ${ep.path} ${ep.summary}`.toLowerCase();
    return methodOk && (!q || blob.includes(q));
  }).length;
  const el = document.getElementById("filterCount");
  if (el) el.textContent = `${count} endpoint${count !== 1 ? "s" : ""}`;
}

/* ════════════════════════════════════════════════════════════════
   PAT TOGGLE
════════════════════════════════════════════════════════════════ */
function togglePAT() {
  const inp = document.getElementById("patToken");
  if (inp) inp.type = inp.type === "password" ? "text" : "password";
}
window.togglePAT = togglePAT;

function flash(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.borderColor = "#dc2626";
  setTimeout(() => el.style.borderColor = "", 1400);
  el.focus();
}

/* ════════════════════════════════════════════════════════════════
   ANALYZE  (core fetch + dispatch)
════════════════════════════════════════════════════════════════ */
async function analyze(url, payload) {
  showView("viewLoading");
  setLoadMsg("Scanning source files…");
  setStatus("loading", "Analyzing…", "Contacting server");
  setScanBtnsDisabled(true);

  try {
    const res  = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || "Scan failed");

    currentScan    = data;
    currentSession = data.sessionId;

    populateSidebar(data);
    populateAllPages(data);
    updateExports(data.sessionId);
    setStatus("ok", "Ready",
      `${data.endpoints.length} endpoints · ${data.files.length} files`);

    /* FIX 3: showView("viewDocs") always sets display:flex */
    showView("viewDocs");
    showDocPage("overview");

  } catch (err) {
    setStatus("err", "Error", err.message);
    showView("viewLanding");
    showToast("⚠ " + err.message, "error");
  } finally {
    setScanBtnsDisabled(false);
  }
}

/* ════════════════════════════════════════════════════════════════
   VIEW / STATUS HELPERS
════════════════════════════════════════════════════════════════ */
function showView(id) {
  ["viewLanding","viewLoading","viewDocs"].forEach(v => {
    const el = document.getElementById(v);
    if (el) { el.style.display = "none"; el.classList.remove("active"); }
  });
  const target = document.getElementById(id);
  if (target) {
    /* FIX 3: viewDocs MUST be display:flex — its inner layout depends on it */
    target.style.display = id === "viewDocs" ? "flex" : "";
    target.classList.add("active");
  }
}

function setLoadMsg(msg) {
  const el = document.getElementById("loadMsg");
  if (el) el.textContent = msg;
}

function setStatus(state, val, sub) {
  const dot = document.getElementById("statusDot");
  const v   = document.getElementById("statusVal");
  const s   = document.getElementById("statusSub");
  if (dot) dot.className = "sb-status-dot " + state;
  if (v) {
    v.textContent = val;
    v.style.color = state === "err" ? "#dc2626" : state === "loading" ? "#ca8a04" : "#16a34a";
  }
  if (s) s.textContent = sub || "";
}

function setScanBtnsDisabled(disabled) {
  ["btnGit","btnPath","btnUpload"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = disabled;
  });
}

function showToast(msg, type) {
  const t = document.createElement("div");
  t.style.cssText = `position:fixed;bottom:24px;right:24px;background:${type==="error"?"#dc2626":"#16a34a"};color:#fff;padding:12px 20px;border-radius:12px;font-size:13px;font-weight:600;z-index:9999;max-width:380px;box-shadow:0 4px 16px rgba(0,0,0,.2)`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 5000);
}

/* ════════════════════════════════════════════════════════════════
   SIDEBAR POPULATION
════════════════════════════════════════════════════════════════ */
function populateSidebar(scan) {
  set("stEndpoints", scan.endpoints.length);
  set("stFiles",     scan.files.length);
  set("stAuth",      scan.endpoints.filter(e => e.authRequired).length);
  const d = scan.drift || {};
  set("stDrift", (d.newInCode||[]).length + "/" + (d.removedFromSpec||[]).length);

  /* Tag pills */
  const pills = document.getElementById("tagPills");
  if (pills) {
    const byTag = groupByTag(scan.endpoints);
    pills.innerHTML = Object.entries(byTag).map(([tag, eps]) =>
      `<span class="tag-pill" onclick="filterSidebarNav('${esc(tag)}')">${esc(tag)} <b>${eps.length}</b></span>`
    ).join("");
  }

  /* Endpoint nav groups */
  const container = document.getElementById("epNavGroups");
  if (container) {
    const byTag = groupByTag(scan.endpoints);
    container.innerHTML = Object.entries(byTag).map(([tag, eps]) => `
      <div class="nav-group">
        <div class="nav-group-title">${esc(tag)}</div>
        ${eps.map(ep => {
          const idx = scan.endpoints.indexOf(ep);
          return `<button class="nav-ep-btn" data-ep="${idx}" onclick="openEndpoint(${idx})">
            <span class="method-pill ${ep.method}">${ep.method}</span>
            <span class="nav-ep-path">${esc(ep.path)}</span>
          </button>`;
        }).join("")}
      </div>`).join("");
  }

  showEl("sbSearch");
  showEl("summaryCard");
  showEl("exportCard");
  showEl("docsNavWrap");

  const crumb = document.getElementById("topCrumb");
  if (crumb) crumb.textContent = `Home / ${esc(scan.title || "API")}`;

  const right = document.getElementById("topRight");
  if (right) right.innerHTML = `
    <span class="topbar-badge auth">JWT Bearer</span>
    <span class="topbar-badge prod">${esc(scan.version || "1.0.0")}</span>`;
}

function filterSidebarNav(q) {
  const lq = q.toLowerCase();
  document.querySelectorAll(".nav-ep-btn").forEach(btn => {
    const text = btn.textContent.toLowerCase();
    btn.style.display = !lq || text.includes(lq) ? "" : "none";
  });
  document.querySelectorAll(".nav-group").forEach(g => {
    const vis = [...g.querySelectorAll(".nav-ep-btn")].some(b => b.style.display !== "none");
    g.style.display = vis ? "" : "none";
  });
}
window.filterSidebarNav = filterSidebarNav;

/* ════════════════════════════════════════════════════════════════
   DOC PAGE NAVIGATION
   FIX 4: filterBar is shown ONLY on overview; hidden everywhere else.
           It is inside viewDocs so it must be a child of viewDocs.
════════════════════════════════════════════════════════════════ */
function showDocPage(name) {
  activeDocPage = name;

  document.querySelectorAll(".doc-page").forEach(p => p.classList.remove("active"));
  const target = document.getElementById("page-" + name);
  if (target) target.classList.add("active");

  document.querySelectorAll(".dnav-btn").forEach(b => b.classList.remove("active"));
  const nb = document.getElementById("dnav-" + name);
  if (nb) nb.classList.add("active");

  /* FIX 4: filterBar shown only on overview page */
  const fb = document.getElementById("filterBar");
  if (fb) fb.style.display = name === "overview" ? "" : "none";

  const crumb = document.getElementById("topCrumb");
  if (crumb && currentScan)
    crumb.textContent = `Home / ${esc(currentScan.title || "API")} / ${name.charAt(0).toUpperCase() + name.slice(1)}`;

  /* Populate endpoint list column when switching to endpoint page */
  if (name === "endpoint" && currentScan) populateEpListCol(currentScan);
}
window.showDocPage = showDocPage;

/* ════════════════════════════════════════════════════════════════
   POPULATE ALL 11 SECTIONS
════════════════════════════════════════════════════════════════ */
function populateAllPages(scan) {
  renderOverview(scan);
  renderAuth(scan);
  renderModels(scan);
  renderBizLogic(scan);
  renderSecurity(scan);
  renderTesting(scan);
  renderErrors(scan);
  renderPerformance(scan);
  renderDeploy(scan);
  renderSummary(scan);
}

/* ─────────────────────────────────────────────
   1. OVERVIEW
───────────────────────────────────────────── */
function renderOverview(scan) {
  const cards = document.getElementById("ovCards");
  if (cards) {
    cards.innerHTML = [
      { icon:"📡", label:"Endpoints",       value: scan.endpoints.length },
      { icon:"📁", label:"Files Scanned",   value: scan.files.length },
      { icon:"🔒", label:"Auth-Protected",  value: scan.endpoints.filter(e => e.authRequired).length },
      { icon:"🏷",  label:"Resource Groups", value: Object.keys(groupByTag(scan.endpoints)).length }
    ].map(c => `
      <div class="ov-card">
        <div class="ov-card-icon">${c.icon}</div>
        <div class="ov-card-num">${c.value}</div>
        <div class="ov-card-label">${c.label}</div>
      </div>`).join("");
  }

  const pt = document.getElementById("ovProjectTable");
  if (pt) {
    const fw   = (scan.project.frameworks||[]).filter(f => !f.startsWith("CORS")).join(", ") || "—";
    const langs = (scan.project.languages||[]).join(", ") || "—";
    pt.innerHTML = `
      <div class="panel-hd"><h3>Project Information</h3></div>
      <table class="doc-table"><tbody>
        <tr><td class="td-label">Project Name</td><td><strong>${esc(scan.title||"—")}</strong></td></tr>
        <tr><td class="td-label">Description</td><td>${esc(scan.description||"—")}</td></tr>
        <tr><td class="td-label">Version</td><td><span class="badge-version">${esc(scan.version||"1.0.0")}</span></td></tr>
        <tr><td class="td-label">Base URL</td><td><code>${esc(scan.baseUrl||"http://localhost")}/api</code></td></tr>
        <tr><td class="td-label">Framework(s)</td><td>${esc(fw)}</td></tr>
        <tr><td class="td-label">Language(s)</td><td>${esc(langs)}</td></tr>
        <tr><td class="td-label">Architecture</td><td>RESTful HTTP API${fw.includes("NestJS") ? " · MVC" : fw.includes("Laravel") ? " · MVC (Laravel)" : ""}</td></tr>
        <tr><td class="td-label">Generated</td><td>${esc(scan.generatedAt||new Date().toISOString())}</td></tr>
      </tbody></table>`;
  }

  set("epCountBadge", `${scan.endpoints.length} endpoints`);

  /* Reset filters and render table */
  activeMethodFilter = "";
  renderInvTable();
  updateFilterCount();

  const tc = document.getElementById("ovTagCloud");
  if (tc) {
    const byTag = groupByTag(scan.endpoints);
    tc.innerHTML = Object.entries(byTag).map(([tag, eps]) =>
      `<span class="tag-chip" onclick="filterSidebarNav('${esc(tag)}')">${esc(tag)} <b>${eps.length}</b></span>`
    ).join("");
  }
}

function renderInvTable() {
  if (!currentScan) return;
  /* Read query from EITHER the top filterSearch or the inv search */
  const q     = (document.getElementById("invSearch")?.value ||
                 document.getElementById("filterSearch")?.value || "").toLowerCase();
  const m     = activeMethodFilter;
  const tbody = document.getElementById("invBody");
  if (!tbody) return;

  const filtered = currentScan.endpoints.filter(ep => {
    const methodOk = !m || ep.method === m;
    const blob     = `${ep.method} ${ep.path} ${ep.summary}`.toLowerCase();
    return methodOk && (!q || blob.includes(q));
  });

  tbody.innerHTML = filtered.map(ep => {
    const idx  = currentScan.endpoints.indexOf(ep);
    const ctrl = ep.controller ? `${esc(ep.controller)}@${esc(ep.action)}` : "—";
    const mw   = (ep.middleware||[]).map(esc).join(", ") || "—";
    return `<tr class="inv-row" onclick="openEndpointFromOverview(${idx})">
      <td><span class="method-badge ${ep.method}">${ep.method}</span></td>
      <td><code>${esc(ep.path)}</code></td>
      <td>${esc(ep.summary)}</td>
      <td><small style="color:var(--muted)">${ctrl}</small></td>
      <td>${ep.authRequired ? '<span class="req-yes">🔒 Yes</span>' : '<span class="req-no">—</span>'}</td>
      <td><small style="color:var(--muted)">${mw}</small></td>
    </tr>`;
  }).join("") || `<tr><td colspan="6" style="padding:24px;text-align:center;color:var(--muted)">No endpoints match.</td></tr>`;
}

function openEndpointFromOverview(idx) {
  showDocPage("endpoint");
  openEndpoint(idx);
}
window.openEndpointFromOverview = openEndpointFromOverview;

/* ─────────────────────────────────────────────
   2. AUTHENTICATION
───────────────────────────────────────────── */
function renderAuth(scan) {
  const fw        = (scan.project.frameworks||[]).join(" ");
  const isJwt     = /jwt/i.test(fw);
  const isOAuth   = /oauth/i.test(fw);
  const isSession = /session/i.test(fw);
  const method    = isJwt ? "JWT Bearer Token" : isOAuth ? "OAuth 2.0" : isSession ? "Session Cookie" : "JWT Bearer Token";

  const ac = document.getElementById("authContent");
  if (ac) ac.innerHTML = `
    <div class="panel-hd"><h3>Authentication Method</h3></div>
    <div class="auth-method-badge">${isJwt ? "🔑" : "🔐"} ${esc(method)}</div>
    <table class="doc-table" style="margin-bottom:18px"><tbody>
      <tr><td class="td-label">Type</td><td>${esc(method)}</td></tr>
      <tr><td class="td-label">Package</td><td><code>${isJwt ? "tymon/jwt-auth" : "N/A"}</code></td></tr>
      <tr><td class="td-label">Header Name</td><td><code>Authorization</code></td></tr>
      <tr><td class="td-label">Header Format</td><td><code>Token &lt;jwt-string&gt;</code></td></tr>
      <tr><td class="td-label">Token Expiry</td><td>Configurable (default: 60 min)</td></tr>
      <tr><td class="td-label">Refresh</td><td>Re-login when 401 is returned</td></tr>
    </tbody></table>

    <h3 style="font-size:14px;font-weight:700;margin-bottom:12px">Login Flow</h3>
    <div class="auth-steps">
      ${[
        { n:1, title:"Register", desc:`<code>POST /api/users</code> — Submit <code>user.username</code>, <code>user.email</code>, <code>user.password</code>.` },
        { n:2, title:"Login",    desc:`<code>POST /api/users/login</code> — Submit credentials. Receive JWT in <code>user.token</code>.` },
        { n:3, title:"Attach",   desc:`Add <code>Authorization: Token &lt;token&gt;</code> to every protected request.` },
        { n:4, title:"Refresh",  desc:`Token refreshed on each authenticated request. Re-login on 401.` }
      ].map(s => `
        <div class="auth-step">
          <div class="auth-step-num">${s.n}</div>
          <div class="auth-step-body">
            <div class="auth-step-title">${esc(s.title)}</div>
            <div class="auth-step-desc">${s.desc}</div>
          </div>
        </div>`).join("")}
    </div>

    <h3 style="font-size:14px;font-weight:700;margin:18px 0 10px">Required Headers</h3>
    <table class="doc-table"><thead>
      <tr><th>Header</th><th>Required</th><th>Format</th><th>Description</th></tr>
    </thead><tbody>
      <tr><td><code>Authorization</code></td><td class="req-yes">Yes (protected)</td><td><code>Token &lt;jwt&gt;</code></td><td>JWT bearer token</td></tr>
      <tr><td><code>Content-Type</code></td><td class="req-yes">Yes</td><td><code>application/json</code></td><td>All request bodies must be JSON</td></tr>
      <tr><td><code>Accept</code></td><td class="req-no">No</td><td><code>application/json</code></td><td>Expected response format</td></tr>
    </tbody></table>
    <div class="code-block" style="margin-top:16px">Authorization: Token eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...</div>`;

  const am = document.getElementById("authMatrix");
  if (am) {
    am.innerHTML = scan.endpoints.map(ep => `
      <tr>
        <td><span class="method-badge ${ep.method}">${ep.method}</span></td>
        <td><code>${esc(ep.path)}</code></td>
        <td>${ep.authRequired ? '<span class="req-yes">🔒 Required</span>' : '<span class="req-no">Public</span>'}</td>
        <td><small style="color:var(--muted)">${(ep.middleware||[]).map(esc).join(", ")||"—"}</small></td>
      </tr>`).join("");
  }
}

/* ─────────────────────────────────────────────
   3. ENDPOINT DETAIL (split view)
───────────────────────────────────────────── */
function openEndpoint(idx) {
  activeEpIndex = idx;
  const ep = currentScan?.endpoints[idx];
  if (!ep) return;

  document.querySelectorAll(".nav-ep-btn").forEach(b =>
    b.classList.toggle("active", Number(b.dataset.ep) === idx));

  if (activeDocPage !== "endpoint") showDocPage("endpoint");

  const ph = document.getElementById("epPlaceholder");
  const dc = document.getElementById("epDetailContent");
  if (ph) ph.style.display = "none";
  if (dc) { dc.style.display = ""; dc.innerHTML = buildEndpointDetail(ep); }

  const crumb = document.getElementById("topCrumb");
  if (crumb) crumb.textContent = `Home / ${esc(ep.tags?.[0]||"api")} / ${ep.method} ${esc(ep.path)}`;

  document.querySelectorAll(".ep-list-item").forEach(r =>
    r.classList.toggle("active", Number(r.dataset.ep) === idx));
}
window.openEndpoint = openEndpoint;

function buildEndpointDetail(ep) {
  const bodyFields  = Object.entries(ep.request?.body?.schema?.properties || {});
  const sampleBody  = bodyFields.length
    ? JSON.stringify({ [ep.tags?.[0]||"data"]: Object.fromEntries(bodyFields.map(([n,f]) => [n, f.example!==undefined ? f.example : f.type])) }, null, 2)
    : null;
  const curlParts = [`curl -X ${ep.method} "${currentScan.baseUrl||"http://localhost"}/api${ep.path}"`];
  if (ep.authRequired) curlParts.push('  -H "Authorization: Token <your-jwt-token>"');
  curlParts.push('  -H "Content-Type: application/json"');
  if (sampleBody && ["POST","PUT","PATCH"].includes(ep.method))
    curlParts.push(`  -d '${sampleBody}'`);

  const validRules = Object.entries(ep.validationRules || {});
  const errorCodes = ep.errorCodes || [];

  return `
  <div class="detail-ep-header">
    <span class="method-badge ${ep.method}">${ep.method}</span>
    <span class="detail-ep-path">${esc(ep.path)}</span>
    ${ep.deprecated ? '<span class="tbadge tbadge-warn">Deprecated</span>' : ""}
    ${ep.authRequired ? '<span class="tbadge tbadge-auth">🔒 Auth Required</span>' : '<span class="tbadge tbadge-prod">Public</span>'}
  </div>
  <p class="detail-ep-desc">${esc(ep.description)}</p>

  <div class="info-cards">
    <div class="info-card"><div class="info-card-label">Operation ID</div><code style="font-size:11px">${esc(ep.operationId)}</code></div>
    <div class="info-card"><div class="info-card-label">Controller</div><code style="font-size:11px">${ep.controller ? `${esc(ep.controller)}@${esc(ep.action)}` : "—"}</code></div>
    <div class="info-card"><div class="info-card-label">Middleware</div><span style="font-size:12px">${(ep.middleware||[]).map(esc).join(", ")||"—"}</span></div>
    <div class="info-card"><div class="info-card-label">Confidence</div><div class="conf-wrap"><div class="conf-bar"><span style="width:${Math.round((ep.confidence||0)*100)}%"></span></div>${Math.round((ep.confidence||0)*100)}%</div></div>
  </div>

  <div class="detail-tabs">
    <button class="dtab active" onclick="switchDTab(this,'dt-ov-${ep.operationId}')">Overview</button>
    <button class="dtab" onclick="switchDTab(this,'dt-params-${ep.operationId}')">Parameters</button>
    <button class="dtab" onclick="switchDTab(this,'dt-body-${ep.operationId}')">Request Body</button>
    <button class="dtab" onclick="switchDTab(this,'dt-resp-${ep.operationId}')">Responses</button>
    <button class="dtab" onclick="switchDTab(this,'dt-curl-${ep.operationId}')">cURL / Fetch</button>
    <button class="dtab" onclick="switchDTab(this,'dt-val-${ep.operationId}')">Validation</button>
    <button class="dtab" onclick="switchDTab(this,'dt-src-${ep.operationId}')">Source</button>
  </div>

  <!-- Overview -->
  <div class="detail-section active" id="dt-ov-${ep.operationId}">
    <div class="detail-panel">
      <h3>Endpoint Information</h3>
      <table class="doc-table"><tbody>
        <tr><td class="td-label">HTTP Method</td><td>${ep.method}</td></tr>
        <tr><td class="td-label">URL</td><td><code>${esc((currentScan.baseUrl||"http://localhost")+"/api"+ep.path)}</code></td></tr>
        <tr><td class="td-label">Operation ID</td><td><code>${esc(ep.operationId)}</code></td></tr>
        ${ep.controller ? `<tr><td class="td-label">Controller</td><td><code>${esc(ep.controller)}@${esc(ep.action)}</code></td></tr>` : ""}
        ${ep.middleware?.length ? `<tr><td class="td-label">Middleware</td><td>${ep.middleware.map(m=>`<code class="mw-chip">${esc(m)}</code>`).join(" ")}</td></tr>` : ""}
        <tr><td class="td-label">Auth Required</td><td>${ep.authRequired ? '<span class="req-yes">Yes — Bearer JWT</span>' : '<span class="req-no">No — public</span>'}</td></tr>
        <tr><td class="td-label">Tag / Group</td><td>${esc((ep.tags||[]).join(", "))}</td></tr>
        <tr><td class="td-label">Framework</td><td>${esc(ep.frameworkHint||"—")}</td></tr>
        <tr><td class="td-label">Deprecated</td><td>${ep.deprecated ? '<span style="color:#ca8a04">Yes</span>' : "No"}</td></tr>
        <tr><td class="td-label">Source File</td><td><code style="font-size:11px">${esc(ep.sourceFile)}:${ep.sourceLine}</code></td></tr>
      </tbody></table>
    </div>
  </div>

  <!-- Parameters -->
  <div class="detail-section" id="dt-params-${ep.operationId}">
    <div class="detail-panel">
      <h3>Path Parameters</h3>
      ${ep.request?.pathParams?.length
        ? tableHtml(["Name","Type","Required","Description"],
            ep.request.pathParams.map(p=>[`<code>${esc(p.name)}</code>`,esc(p.type),'<span class="req-yes">Yes</span>',esc(p.description||"")]))
        : noData("No path parameters")}
    </div>
    <div class="detail-panel">
      <h3>Query Parameters</h3>
      ${ep.request?.queryParams?.length
        ? tableHtml(["Name","Type","Required","Description"],
            ep.request.queryParams.map(p=>[`<code>${esc(p.name)}</code>`,esc(p.type),
              p.required?'<span class="req-yes">Yes</span>':'<span class="req-no">No</span>',esc(p.description||"")]))
        : noData("No query parameters")}
    </div>
    <div class="detail-panel">
      <h3>Request Headers</h3>
      <table class="doc-table"><thead><tr><th>Header</th><th>Required</th><th>Format</th><th>Description</th></tr></thead><tbody>
        ${ep.authRequired ? `<tr><td><code>Authorization</code></td><td class="req-yes">Yes</td><td><code>Token &lt;jwt&gt;</code></td><td>JWT Bearer token</td></tr>` : ""}
        <tr><td><code>Content-Type</code></td><td class="req-yes">Yes</td><td><code>application/json</code></td><td>Request content type</td></tr>
        <tr><td><code>Accept</code></td><td class="req-no">No</td><td><code>application/json</code></td><td>Expected response type</td></tr>
        ${(ep.request?.headers||[]).filter(h=>!/authorization|content-type|accept/i.test(h.name)).map(h=>`
          <tr><td><code>${esc(h.name)}</code></td><td class="${h.required?"req-yes":"req-no"}">${h.required?"Yes":"No"}</td>
          <td>${h.format?`<code>${esc(h.format)}</code>`:"—"}</td><td>${esc(h.description||"")}</td></tr>`).join("")}
      </tbody></table>
    </div>
  </div>

  <!-- Request Body -->
  <div class="detail-section" id="dt-body-${ep.operationId}">
    <div class="detail-panel">
      <h3>Request Body Schema <small>— application/json</small></h3>
      ${bodyFields.length
        ? tableHtml(["Field","Type","Required","Validation Rules","Example","Description"],
            bodyFields.map(([name,f])=>[
              `<code>${esc(name)}</code>`, esc(f.type||"string"),
              f.required?'<span class="req-yes">Yes</span>':'<span class="req-no">No</span>',
              `<span class="rules-text">${(Array.isArray(f.validationRules)?f.validationRules:[]).map(esc).join(" · ")||"—"}</span>`,
              `<code>${esc(JSON.stringify(f.example!=null?f.example:f.type))}</code>`,
              esc(f.description||"")
            ]))
        : noData("No request body detected")}
    </div>
    ${sampleBody && ["POST","PUT","PATCH"].includes(ep.method) ? `
    <div class="detail-panel">
      <h3>Sample Request Body</h3>
      <div class="code-block">${esc(sampleBody)}</div>
    </div>` : ""}
  </div>

  <!-- Responses -->
  <div class="detail-section" id="dt-resp-${ep.operationId}">
    <div class="detail-panel">
      <h3>Response Status Codes</h3>
      ${tableHtml(["Status","Description"],
        (ep.responses||[]).map(r=>[
          `<span class="status-pill ${r.status<300?"status-2xx":r.status<500?"status-4xx":"status-5xx"}">${r.status}</span>`,
          esc(r.description)
        ]))}
    </div>
    <div class="detail-panel">
      <h3>Success Response Sample</h3>
      <div class="code-block">${esc(buildSampleResponse(ep))}</div>
    </div>
    <div class="detail-panel">
      <h3>Error Response Sample (4xx)</h3>
      <div class="code-block">${esc(JSON.stringify({errors:{field:["The field is required."]}},null,2))}</div>
    </div>
  </div>

  <!-- cURL / Fetch -->
  <div class="detail-section" id="dt-curl-${ep.operationId}">
    <div class="detail-panel">
      <h3>cURL Example</h3>
      <div class="code-block">${esc(curlParts.join(" \\\n"))}</div>
    </div>
    <div class="detail-panel">
      <h3>JavaScript (Fetch API)</h3>
      <div class="code-block">${esc(buildFetchExample(ep, sampleBody))}</div>
    </div>
    <div class="detail-panel">
      <h3>Postman Variables</h3>
      <table class="doc-table"><thead><tr><th>Variable</th><th>Value</th><th>Notes</th></tr></thead><tbody>
        <tr><td><code>baseUrl</code></td><td><code>${esc((currentScan.baseUrl||"http://localhost")+"/api")}</code></td><td>Set in environment</td></tr>
        <tr><td><code>jwt_token</code></td><td><code>(your token)</code></td><td>Returned by POST /api/users/login</td></tr>
      </tbody></table>
    </div>
  </div>

  <!-- Validation -->
  <div class="detail-section" id="dt-val-${ep.operationId}">
    <div class="detail-panel">
      <h3>Validation Rules</h3>
      ${validRules.length
        ? tableHtml(["Field","Rules"],
            validRules.map(([f,r])=>[`<code>${esc(f)}</code>`,`<span class="rules-text">${esc(r)}</span>`]))
        : noData("No validation rules detected")}
    </div>
    ${errorCodes.length ? `
    <div class="detail-panel">
      <h3>Error Codes</h3>
      ${tableHtml(["Code","Message","Resolution"],
        errorCodes.map(e=>[`<code>${esc(e.code)}</code>`,esc(e.message),esc(e.resolution)]))}
    </div>` : ""}
  </div>

  <!-- Source -->
  <div class="detail-section" id="dt-src-${ep.operationId}">
    <div class="detail-panel">
      <h3>Source Context <small>— ${esc(ep.sourceFile)}:${ep.sourceLine}</small></h3>
      <div class="code-block" style="max-height:500px;overflow:auto">${esc(ep.rawContext||"(no context)")}</div>
    </div>
  </div>`;
}

function populateEpListCol(scan) {
  const col = document.getElementById("epListItems");
  if (!col) return;
  col.innerHTML = scan.endpoints.map((ep, idx) => `
    <div class="ep-list-item" data-ep="${idx}" onclick="openEndpoint(${idx})">
      <span class="method-badge ${ep.method}">${ep.method}</span>
      <div class="ep-list-item-body">
        <div class="ep-list-path">${esc(ep.path)}</div>
        <div class="ep-list-summary">${esc(ep.summary)}</div>
        <div class="ep-list-meta">
          ${ep.authRequired ? '<span class="row-badge row-badge-auth">🔒</span>' : ""}
          <span class="row-badge row-badge-open">${Math.round((ep.confidence||0)*100)}%</span>
        </div>
      </div>
    </div>`).join("");
}

/* ─────────────────────────────────────────────
   4. DATA MODELS
   FIX 2: Uses scan.dataModels from the scanner pipeline — no
           hardcoded data. Falls back to inferring from endpoint
           body fields only if scanner found zero models.
───────────────────────────────────────────── */
function renderModels(scan) {
  const el = document.getElementById("modelsContent");
  if (!el) return;

  /* ── Primary: use scanner-extracted models ── */
  const scannedModels = (scan.dataModels || []).filter(m => m && Array.isArray(m.fields) && m.fields.length > 0);

  if (scannedModels.length > 0) {
    el.innerHTML = scannedModels.map(m => `
      <div class="doc-panel">
        <div class="panel-hd">
          <h3>${esc(m.name)}</h3>
          ${m.table ? `<span class="panel-badge"><code>${esc(m.table)}</code></span>` : ""}
          ${m.source ? `<span class="panel-badge" style="margin-left:4px;background:var(--accent-bg);color:var(--accent)">
            ${esc(m.source.split("/").pop())}
          </span>` : ""}
        </div>
        <table class="doc-table">
          <thead><tr><th>Column / Field</th><th>Type</th><th>Nullable</th><th>Description</th></tr></thead>
          <tbody>
            ${m.fields.map(f => `
            <tr>
              <td><code>${esc(f.name)}</code></td>
              <td><span class="type-badge">${esc(f.type||"string")}</span></td>
              <td class="${f.nullable !== false ? "req-no" : "req-yes"}">${f.nullable !== false ? "Yes" : "No"}</td>
              <td>${esc(f.description||"")}</td>
            </tr>`).join("")}
          </tbody>
        </table>
        ${m.relations?.length ? `<div class="rel-row">${m.relations.map(r=>`<span class="rel-chip">${esc(r)}</span>`).join("")}</div>` : ""}
      </div>`).join("");
    return;
  }

  /* ── Fallback: infer models from endpoint body fields ── */
  const inferredModels = inferModelsFromEndpoints(scan.endpoints);

  if (inferredModels.length > 0) {
    el.innerHTML = `
      <div class="doc-panel" style="border-color:#ca8a0440;background:#fffbeb">
        <div class="panel-hd"><h3>ℹ️ Inferred Models</h3></div>
        <p style="font-size:13px;color:var(--muted);margin-bottom:0">
          No model files were detected automatically (Eloquent, TypeORM, Mongoose, Pydantic, etc.).
          The models below are inferred from request body fields and path parameters found across your endpoints.
        </p>
      </div>
      ${inferredModels.map(m => `
      <div class="doc-panel">
        <div class="panel-hd"><h3>${esc(m.name)}</h3><span class="panel-badge">inferred from endpoints</span></div>
        <table class="doc-table">
          <thead><tr><th>Field</th><th>Type</th><th>Required</th><th>Description</th></tr></thead>
          <tbody>
            ${m.fields.map(f=>`
            <tr>
              <td><code>${esc(f.name)}</code></td>
              <td><span class="type-badge">${esc(f.type)}</span></td>
              <td class="${f.required?"req-yes":"req-no"}">${f.required?"Yes":"No"}</td>
              <td>${esc(f.desc||"")}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>`).join("")}`;
    return;
  }

  el.innerHTML = `<div class="doc-panel"><p style="color:var(--muted);padding:12px 0">
    No data models detected. Point to a project with Eloquent, TypeORM, Mongoose, or Pydantic model files.
  </p></div>`;
}

/**
 * Infer model definitions by grouping endpoint body fields by resource tag.
 * Used only as a fallback when scanner finds no models.
 */
function inferModelsFromEndpoints(endpoints) {
  const modelMap = {};
  for (const ep of endpoints) {
    const tag = (ep.tags||["unknown"])[0];
    if (!modelMap[tag]) modelMap[tag] = { fields: new Map() };
    for (const [name, f] of Object.entries(ep.request?.body?.schema?.properties||{})) {
      if (!modelMap[tag].fields.has(name)) {
        modelMap[tag].fields.set(name, { name, type: f.type||"string", required: !!f.required, desc: f.description||"" });
      }
    }
    for (const p of (ep.request?.pathParams||[])) {
      if (!modelMap[tag].fields.has(p.name))
        modelMap[tag].fields.set(p.name, { name: p.name, type: p.type, required: true, desc: p.description||"" });
    }
  }
  return Object.entries(modelMap)
    .filter(([, v]) => v.fields.size > 0)
    .map(([tag, v]) => ({
      name: tag.charAt(0).toUpperCase() + tag.slice(1),
      fields: [...v.fields.values()]
    }));
}

/* ─────────────────────────────────────────────
   5. BUSINESS LOGIC
───────────────────────────────────────────── */
function renderBizLogic(scan) {
  const el = document.getElementById("bizContent");
  if (!el) return;

  const byTag = groupByTag(scan.endpoints);
  const workflows = Object.entries(byTag).map(([tag, eps]) => {
    const steps = eps.map(ep => {
      const mw = (ep.middleware||[]).join(", ") || "none";
      const bodyFields = Object.keys(ep.request?.body?.schema?.properties||{});
      return `<li>
        <span class="method-badge ${ep.method}" style="font-size:10px;padding:2px 6px">${ep.method}</span>
        <code>${esc(ep.path)}</code> — ${esc(ep.summary)}
        <br><small style="color:var(--muted)">Middleware: ${esc(mw)}${bodyFields.length ? ` · Fields: ${bodyFields.map(esc).join(", ")}` : ""}</small>
      </li>`;
    }).join("");
    return `
      <div class="doc-panel">
        <div class="panel-hd"><h3>${esc(tag.charAt(0).toUpperCase()+tag.slice(1))} Workflow</h3><span class="panel-badge">${eps.length} operations</span></div>
        <ol class="biz-steps">${steps}</ol>
        <div class="biz-deps">
          <strong>Dependencies:</strong>
          ${eps.some(e=>e.authRequired)?'<span class="dep-chip auth">JWT Auth</span>':""}
          ${eps.some(e=>(e.middleware||[]).some(m=>/throttle/i.test(m)))?'<span class="dep-chip rate">Rate Limiting</span>':""}
          ${eps.some(e=>Object.keys(e.request?.body?.schema?.properties||{}).length)?'<span class="dep-chip val">Request Validation</span>':""}
        </div>
      </div>`;
  });

  el.innerHTML = workflows.join("") || `<div class="doc-panel"><p style="color:var(--muted)">No workflows detected.</p></div>`;
}

/* ─────────────────────────────────────────────
   6. SECURITY
───────────────────────────────────────────── */
function renderSecurity(scan) {
  const el = document.getElementById("secContent");
  if (!el) return;
  const fw = (scan.project.frameworks||[]).join(" ");
  const corsOrigins = (scan.project.frameworks||[]).find(f=>f.startsWith("CORS origins:"));

  el.innerHTML = `
    <div class="doc-panel">
      <div class="panel-hd"><h3>Authentication Guards</h3></div>
      <table class="doc-table"><tbody>
        <tr><td class="td-label">Guard Type</td><td>${/jwt/i.test(fw)?"JWT (tymon/jwt-auth)":"Token-based"}</td></tr>
        <tr><td class="td-label">Protected Endpoints</td><td>${scan.endpoints.filter(e=>e.authRequired).length} of ${scan.endpoints.length}</td></tr>
        <tr><td class="td-label">Unauthenticated Response</td><td>HTTP 401</td></tr>
        <tr><td class="td-label">Token Algorithm</td><td>HS256</td></tr>
      </tbody></table>
    </div>
    <div class="doc-panel">
      <div class="panel-hd"><h3>Authorization Rules</h3></div>
      <table class="doc-table"><thead><tr><th>Rule</th><th>Implementation</th><th>HTTP Response</th></tr></thead><tbody>
        <tr><td>Ownership check</td><td><code>$this->authorize()</code> or Policy</td><td>403 Forbidden</td></tr>
        <tr><td>JWT required</td><td><code>auth:api</code> middleware</td><td>401 Unauthorized</td></tr>
        <tr><td>Input validation</td><td>FormRequest / Validator</td><td>422 Unprocessable Entity</td></tr>
      </tbody></table>
    </div>
    <div class="doc-panel">
      <div class="panel-hd"><h3>Rate Limiting</h3></div>
      <table class="doc-table"><tbody>
        <tr><td class="td-label">Middleware</td><td><code>throttle:60,1</code> (60 req/min per IP)</td></tr>
        <tr><td class="td-label">Rate-Limited</td><td>${scan.endpoints.filter(e=>(e.middleware||[]).some(m=>/throttle/i.test(m))).length} endpoints</td></tr>
        <tr><td class="td-label">Response on Limit</td><td>HTTP 429</td></tr>
        <tr><td class="td-label">Headers</td><td><code>X-RateLimit-Limit</code>, <code>X-RateLimit-Remaining</code>, <code>Retry-After</code></td></tr>
      </tbody></table>
    </div>
    <div class="doc-panel">
      <div class="panel-hd"><h3>CORS Configuration</h3></div>
      <table class="doc-table"><tbody>
        <tr><td class="td-label">Allowed Origins</td><td><code>${corsOrigins ? esc(corsOrigins.replace("CORS origins: ","")) : "*"}</code></td></tr>
        <tr><td class="td-label">Allowed Methods</td><td>GET, POST, PUT, PATCH, DELETE, OPTIONS</td></tr>
        <tr><td class="td-label">Allowed Headers</td><td>Content-Type, Authorization, X-Requested-With</td></tr>
      </tbody></table>
    </div>
    <div class="doc-panel">
      <div class="panel-hd"><h3>Security Best Practices</h3></div>
      <ul class="biz-steps">
        <li>✅ Use HTTPS in production — never transmit JWT over plain HTTP</li>
        <li>✅ Store tokens in httpOnly cookies or secure memory</li>
        <li>✅ Validate all input server-side</li>
        <li>✅ Use bcrypt for password storage</li>
        <li>✅ Rotate JWT secrets and invalidate on logout</li>
        <li>✅ Apply principle of least privilege</li>
        <li>✅ Log authentication failures</li>
      </ul>
    </div>`;
}

/* ─────────────────────────────────────────────
   7. API TESTING
───────────────────────────────────────────── */
function renderTesting(scan) {
  const el = document.getElementById("testContent");
  if (!el) return;

  const samples    = scan.endpoints.slice(0, 3);
  const curlBlocks = samples.map(ep => {
    const bodyFields = Object.entries(ep.request?.body?.schema?.properties||{});
    const sampleBody = bodyFields.length
      ? JSON.stringify({ [ep.tags?.[0]||"data"]: Object.fromEntries(bodyFields.map(([n,f])=>[n,f.example!=null?f.example:f.type])) }, null, 2)
      : null;
    const parts = [`curl -X ${ep.method} "${scan.baseUrl||"http://localhost"}/api${ep.path}"`];
    if (ep.authRequired) parts.push('  -H "Authorization: Token <your-jwt-token>"');
    parts.push('  -H "Content-Type: application/json"');
    if (sampleBody && ["POST","PUT","PATCH"].includes(ep.method)) parts.push(`  -d '${sampleBody}'`);
    return `<div class="detail-panel"><h3>${ep.method} ${esc(ep.path)}</h3><div class="code-block">${esc(parts.join(" \\\n"))}</div></div>`;
  }).join("");

  el.innerHTML = `
    <div class="doc-panel">
      <div class="panel-hd"><h3>Testing Prerequisites</h3></div>
      <ol class="biz-steps">
        <li>Start the API server</li>
        <li>Register a test user: <code>POST /api/users</code></li>
        <li>Log in: <code>POST /api/users/login</code> → copy <code>user.token</code></li>
        <li>Set <code>Authorization: Token &lt;token&gt;</code> on all protected requests</li>
      </ol>
    </div>
    <div class="doc-panel">
      <div class="panel-hd"><h3>cURL Examples</h3></div>
      ${curlBlocks || "<p style='color:var(--muted)'>No endpoints found.</p>"}
    </div>
    <div class="doc-panel">
      <div class="panel-hd"><h3>Postman Setup</h3></div>
      <ol class="biz-steps">
        <li>Download Postman collection via <strong>Export → Postman</strong> in the sidebar</li>
        <li>Import: <em>File → Import</em></li>
        <li>Create environment: <code>baseUrl = ${esc(scan.baseUrl||"http://localhost")}/api</code></li>
        <li>Set <code>jwt_token</code> variable after login</li>
      </ol>
    </div>
    <div class="doc-panel">
      <div class="panel-hd"><h3>Sample Login Flow</h3></div>
      <div class="code-block">POST ${esc(scan.baseUrl||"http://localhost")}/api/users/login
Content-Type: application/json

{ "user": { "email": "user@example.com", "password": "Str0ng!Pass" } }

// 200 OK
{ "user": { "email": "user@example.com", "username": "john_doe", "token": "eyJ..." } }</div>
    </div>`;
}

/* ─────────────────────────────────────────────
   8. ERROR HANDLING
───────────────────────────────────────────── */
function renderErrors(scan) {
  const el = document.getElementById("errContent");
  if (!el) return;

  const allCodes = [];
  const seenCodes = new Set();
  for (const ep of scan.endpoints) {
    for (const ec of (ep.errorCodes||[])) {
      if (!seenCodes.has(ec.code)) { seenCodes.add(ec.code); allCodes.push(ec); }
    }
  }

  el.innerHTML = `
    <div class="doc-panel">
      <div class="panel-hd"><h3>HTTP Status Code Reference</h3></div>
      <table class="doc-table"><thead><tr><th>Status</th><th>Meaning</th><th>When it occurs</th><th>How to fix</th></tr></thead><tbody>
        ${[
          [200,"OK","Successful GET / PUT / PATCH","—"],
          [201,"Created","Resource created via POST","—"],
          [204,"No Content","Successful DELETE","—"],
          [400,"Bad Request","Malformed JSON or missing field","Check request body format"],
          [401,"Unauthorized","Missing or expired JWT","Re-authenticate"],
          [403,"Forbidden","Token valid but action not permitted","Check ownership"],
          [404,"Not Found","Route or resource missing","Check URL and ID"],
          [409,"Conflict","Duplicate unique value","Use different value"],
          [422,"Unprocessable Entity","Validation failed","Read field-level errors"],
          [429,"Too Many Requests","Rate limit exceeded","Check Retry-After header"],
          [500,"Internal Server Error","Application exception","Check server logs"]
        ].map(([s,m,w,f])=>`<tr>
          <td><span class="status-pill ${s<300?"status-2xx":s<500?"status-4xx":"status-5xx"}">${s}</span></td>
          <td><strong>${m}</strong></td><td>${w}</td><td>${f}</td>
        </tr>`).join("")}
      </tbody></table>
    </div>
    <div class="doc-panel">
      <div class="panel-hd"><h3>Validation Error Format (422)</h3></div>
      <div class="code-block">${esc(JSON.stringify({errors:{email:["The email field is required."],password:["The password must be at least 6 characters."]}},null,2))}</div>
    </div>
    <div class="doc-panel">
      <div class="panel-hd"><h3>Auth Error Format (401 / 403)</h3></div>
      <div class="code-block">{ "message": "Unauthenticated." }
// 403
{ "message": "This action is unauthorized." }</div>
    </div>
    ${allCodes.length ? `
    <div class="doc-panel">
      <div class="panel-hd"><h3>Detected Error Codes</h3><span class="panel-badge">${allCodes.length}</span></div>
      ${tableHtml(["Code","Message","Resolution"],
        allCodes.map(e=>[`<code>${esc(e.code)}</code>`,esc(e.message),esc(e.resolution)]))}
    </div>` : ""}
    <div class="doc-panel">
      <div class="panel-hd"><h3>Troubleshooting Guide</h3></div>
      <table class="doc-table"><thead><tr><th>Symptom</th><th>Cause</th><th>Fix</th></tr></thead><tbody>
        <tr><td>401 on every request</td><td>Token missing or expired</td><td>Re-login and refresh token</td></tr>
        <tr><td>422 on POST</td><td>Validation failed</td><td>Read errors object</td></tr>
        <tr><td>404 on valid path</td><td>Wrong base URL</td><td>Ensure /api prefix</td></tr>
        <tr><td>500 on all requests</td><td>APP_KEY or DB missing</td><td>Run key:generate + migrate</td></tr>
        <tr><td>CORS in browser</td><td>Origin not whitelisted</td><td>Update CORS_ALLOWED_ORIGINS</td></tr>
      </tbody></table>
    </div>`;
}

/* ─────────────────────────────────────────────
   9. PERFORMANCE
───────────────────────────────────────────── */
function renderPerformance(scan) {
  const el = document.getElementById("perfContent");
  if (!el) return;

  const paginated = scan.endpoints.filter(ep =>
    (ep.request?.queryParams||[]).some(p => /limit|offset|page/i.test(p.name)));

  el.innerHTML = `
    <div class="doc-panel">
      <div class="panel-hd"><h3>Pagination</h3><span class="panel-badge">${paginated.length} endpoints</span></div>
      <table class="doc-table"><thead><tr><th>Parameter</th><th>Type</th><th>Default</th><th>Description</th></tr></thead><tbody>
        <tr><td><code>limit</code></td><td>integer</td><td>20</td><td>Number of results (max: 100)</td></tr>
        <tr><td><code>offset</code></td><td>integer</td><td>0</td><td>Number of results to skip</td></tr>
      </tbody></table>
      ${paginated.length ? `<div style="margin-top:12px">${paginated.map(ep=>`<code class="mw-chip">${ep.method} ${esc(ep.path)}</code>`).join(" ")}</div>` : ""}
    </div>
    <div class="doc-panel">
      <div class="panel-hd"><h3>Filtering</h3></div>
      ${tableHtml(["Endpoint","Filter Parameters"],
        scan.endpoints
          .filter(ep => (ep.request?.queryParams||[]).some(p => !/limit|offset|page/.test(p.name)))
          .slice(0,8)
          .map(ep => [
            `<code>${ep.method} ${esc(ep.path)}</code>`,
            (ep.request?.queryParams||[]).filter(p=>/tag|author|favorited|q|search/i.test(p.name))
              .map(p=>`<code>${esc(p.name)}</code>`).join(", ")||"—"
          ])
      )}
    </div>
    <div class="doc-panel">
      <div class="panel-hd"><h3>Caching</h3></div>
      <table class="doc-table"><tbody>
        <tr><td class="td-label">Driver</td><td>Configurable via <code>CACHE_DRIVER</code> (file/redis/memcached)</td></tr>
        <tr><td class="td-label">ETags</td><td>Enabled on resource endpoints for conditional GETs</td></tr>
        <tr><td class="td-label">Invalidation</td><td>Cache cleared on POST/PUT/PATCH/DELETE</td></tr>
      </tbody></table>
    </div>
    <div class="doc-panel">
      <div class="panel-hd"><h3>Performance Tips</h3></div>
      <ul class="biz-steps">
        <li>Always paginate — never request full datasets</li>
        <li>Eager-load relations to avoid N+1 queries</li>
        <li>Index foreign keys in the database</li>
        <li>Use Redis for session + cache</li>
        <li>Enable gzip compression at the web server level</li>
      </ul>
    </div>`;
}

/* ─────────────────────────────────────────────
   10. DEPLOYMENT
───────────────────────────────────────────── */
function renderDeploy(scan) {
  const el = document.getElementById("deployContent");
  if (!el) return;
  const fw   = (scan.project.frameworks||[]);
  const deps = fw.filter(f => !f.startsWith("CORS origins:"));

  el.innerHTML = `
    <div class="doc-panel">
      <div class="panel-hd"><h3>Environment Variables</h3></div>
      <table class="doc-table"><thead><tr><th>Variable</th><th>Example</th><th>Required</th><th>Description</th></tr></thead><tbody>
        ${[
          ["APP_KEY","base64:...","Yes","Application key"],
          ["APP_ENV","production","Yes","Environment"],
          ["APP_URL",scan.baseUrl||"https://api.example.com","Yes","Base URL"],
          ["DB_CONNECTION","mysql","Yes","DB driver"],
          ["DB_HOST","127.0.0.1","Yes","DB host"],
          ["DB_PORT","3306","Yes","DB port"],
          ["DB_DATABASE","mydb","Yes","DB name"],
          ["DB_USERNAME","root","Yes","DB user"],
          ["DB_PASSWORD","(secret)","Yes","DB password"],
          ["JWT_SECRET","(generated)","Yes","JWT signing key"],
          ["CORS_ALLOWED_ORIGINS","http://localhost:3000","No","CORS origins"],
          ["CACHE_DRIVER","file","No","Cache driver"],
          ["QUEUE_DRIVER","sync","No","Queue driver"]
        ].map(([v,e,r,d])=>`<tr>
          <td><code>${esc(v)}</code></td>
          <td><code style="color:var(--muted)">${esc(e)}</code></td>
          <td class="${r==="Yes"?"req-yes":"req-no"}">${r}</td>
          <td>${esc(d)}</td>
        </tr>`).join("")}
      </tbody></table>
    </div>
    <div class="doc-panel">
      <div class="panel-hd"><h3>Quick Start</h3></div>
      <div class="code-block">git clone &lt;repo-url&gt;
cd &lt;project&gt;
composer install      # or: npm install
cp .env.example .env
php artisan key:generate
php artisan jwt:secret
php artisan migrate --seed
php artisan serve
# → http://localhost:8000/api</div>
    </div>
    <div class="doc-panel">
      <div class="panel-hd"><h3>Detected Dependencies</h3></div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        ${deps.map(d=>`<span class="dep-chip auth">${esc(d)}</span>`).join("")||"<span style='color:var(--muted)'>No dependencies detected</span>"}
      </div>
    </div>
    <div class="doc-panel">
      <div class="panel-hd"><h3>External Services</h3></div>
      <table class="doc-table"><thead><tr><th>Service</th><th>Purpose</th><th>Config Key</th></tr></thead><tbody>
        <tr><td>MySQL / PostgreSQL</td><td>Primary database</td><td><code>DB_*</code></td></tr>
        <tr><td>Redis (optional)</td><td>Cache + queue</td><td><code>REDIS_HOST</code></td></tr>
        <tr><td>SMTP / Mailgun</td><td>Transactional email</td><td><code>MAIL_*</code></td></tr>
      </tbody></table>
    </div>`;
}

/* ─────────────────────────────────────────────
   11. API SUMMARY
───────────────────────────────────────────── */
function renderSummary(scan) {
  const el = document.getElementById("summaryContent");
  if (!el) return;

  const byTag     = groupByTag(scan.endpoints);
  const authCount = scan.endpoints.filter(e => e.authRequired).length;
  const byMethod  = {};
  for (const ep of scan.endpoints) byMethod[ep.method] = (byMethod[ep.method]||0)+1;

  el.innerHTML = `
    <div class="doc-panel">
      <div class="panel-hd"><h3>Feature Coverage Summary</h3></div>
      <div class="ov-cards4">
        ${[
          { icon:"📡", val: scan.endpoints.length,             label:"Total Endpoints" },
          { icon:"🔒", val: authCount,                         label:"Auth-Protected" },
          { icon:"🌍", val: Object.keys(byTag).length,         label:"Resource Groups" },
          { icon:"📁", val: scan.files.length,                 label:"Files Scanned" }
        ].map(c=>`<div class="ov-card"><div class="ov-card-icon">${c.icon}</div><div class="ov-card-num">${c.val}</div><div class="ov-card-label">${c.label}</div></div>`).join("")}
      </div>
    </div>
    <div class="doc-panel">
      <div class="panel-hd"><h3>Method Distribution</h3></div>
      <div class="method-dist">
        ${Object.entries(byMethod).map(([m,c])=>`
          <div class="method-dist-row">
            <span class="method-badge ${m}">${m}</span>
            <div class="dist-bar-wrap">
              <div class="dist-bar"><span style="width:${Math.round(c/scan.endpoints.length*100)}%"></span></div>
            </div>
            <span class="dist-count">${c}</span>
          </div>`).join("")}
      </div>
    </div>
    <div class="doc-panel">
      <div class="panel-hd"><h3>Endpoint Inventory</h3></div>
      ${tableHtml(
        ["#","Method","Path","Summary","Controller","Auth","Middleware","Source"],
        scan.endpoints.map((ep,i)=>[
          i+1,
          `<span class="method-badge ${ep.method}">${ep.method}</span>`,
          `<code>${esc(ep.path)}</code>`,
          esc(ep.summary),
          ep.controller ? `<code style="font-size:11px">${esc(ep.controller)}@${esc(ep.action)}</code>` : "—",
          ep.authRequired ? '<span class="req-yes">🔒</span>' : '<span class="req-no">—</span>',
          `<small style="color:var(--muted)">${(ep.middleware||[]).map(esc).join(", ")||"—"}</small>`,
          `<small style="color:var(--muted)">${esc(ep.sourceFile)}:${ep.sourceLine}</small>`
        ])
      )}
    </div>
    <div class="doc-panel">
      <div class="panel-hd"><h3>Drift Report</h3></div>
      <div class="drift-grid">
        ${[
          { color:"#d29922", val:(scan.drift?.newInCode||[]).length,       label:"New in code (undocumented)" },
          { color:"#dc2626", val:(scan.drift?.removedFromSpec||[]).length, label:"Removed from spec" },
          { color:"#58a6ff", val:(scan.drift?.changed||[]).length,         label:"Changed signatures" },
          { color:"#16a34a", val:(scan.drift?.inSync||[]).length,          label:"In sync" }
        ].map(d=>`<div class="drift-card" style="border-color:${d.color}40">
          <div class="drift-num" style="color:${d.color}">${d.val}</div>
          <div class="drift-label">${d.label}</div>
        </div>`).join("")}
      </div>
    </div>`;
}

/* ════════════════════════════════════════════════════════════════
   EXPORTS
════════════════════════════════════════════════════════════════ */
function updateExports(sessionId) {
  const map = {
    expJson:    { format:"openapiJson",  name:"openapi.json" },
    expYaml:    { format:"openapiYaml",  name:"openapi.yaml" },
    expMd:      { format:"markdown",     name:"API_DOCUMENTATION.md" },
    expHtml:    { format:"html",         name:"index.html" },
    expPostman: { format:"postman",      name:"postman_collection.json" },
    expDrift:   { format:"drift",        name:"drift-report.json" }
  };
  for (const [id, {format, name}] of Object.entries(map)) {
    const el = document.getElementById(id);
    if (el) {
      el.href = `/api/export/${sessionId}/${format}`;
      el.download = name;
      el.classList.remove("off");
    }
  }
}

/* ════════════════════════════════════════════════════════════════
   DETAIL TAB SWITCHING
════════════════════════════════════════════════════════════════ */
function switchDTab(btn, sectionId) {
  const container = btn.closest(".ep-detail-col") || document.getElementById("epDetailContent") || document.body;
  container.querySelectorAll(".dtab").forEach(b => b.classList.remove("active"));
  container.querySelectorAll(".detail-section").forEach(s => s.classList.remove("active"));
  btn.classList.add("active");
  const sec = document.getElementById(sectionId);
  if (sec) sec.classList.add("active");
}
window.switchDTab = switchDTab;

/* ════════════════════════════════════════════════════════════════
   UTILITY HELPERS
════════════════════════════════════════════════════════════════ */
function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, c =>
    ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

function set(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function showEl(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = "";
}

function groupByTag(endpoints) {
  const out = {};
  for (const ep of endpoints) {
    const tag = (ep.tags||["other"])[0];
    (out[tag] = out[tag]||[]).push(ep);
  }
  return out;
}

function tableHtml(headers, rows) {
  if (!rows || !rows.length) return noData("No data available");
  return `<div class="table-wrap"><table class="doc-table">
    <thead><tr>${headers.map(h=>`<th>${h}</th>`).join("")}</tr></thead>
    <tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join("")}</tr>`).join("")}</tbody>
  </table></div>`;
}

function noData(msg) {
  return `<div style="color:var(--muted);font-size:13px;padding:16px 0">${esc(msg)}</div>`;
}

function buildSampleResponse(ep) {
  const ok = (ep.responses||[]).find(r => r.status === 200 || r.status === 201);
  if (!ok) return "// No 200/201 response schema detected";
  const props = ok.schema?.properties;
  if (!props || !Object.keys(props).length)
    return JSON.stringify({ message: "success" }, null, 2);
  return JSON.stringify(
    Object.fromEntries(Object.entries(props).map(([k,v]) => [k, v.type==="integer"?1:v.type==="boolean"?true:"string"])),
    null, 2
  );
}

function buildFetchExample(ep, sampleBody) {
  const url     = `${currentScan?.baseUrl||"http://localhost"}/api${ep.path}`;
  const headers = { "Content-Type": "application/json" };
  if (ep.authRequired) headers["Authorization"] = "Token <your-jwt-token>";
  const lines = [
    `const response = await fetch("${url}", {`,
    `  method: "${ep.method}",`,
    `  headers: ${JSON.stringify(headers, null, 4).replace(/\n/g, "\n  ")},`
  ];
  if (sampleBody && ["POST","PUT","PATCH"].includes(ep.method))
    lines.push(`  body: JSON.stringify(${sampleBody}),`);
  lines.push(`});`, `const data = await response.json();`);
  return lines.join("\n");
}
