(function(){
  "use strict";

  // ---------- State ----------
  let RAW = [];          // raw parsed rows
  let FILTERED = [];     // after filters
  let sortKey = "Kitchen ID";
  let sortDir = 1;
  let page = 0;
  const PAGE_SIZE = 25;
  let atRiskOnly = false;

  const NUMERIC_FIELDS = ["Monthly GMV (KWD)", "Monthly Orders", "Processing Fee (KWD)", "Floor Price (KWD)"];

  // ---------- CSV parsing ----------
  function parseCSV(text){
    const rows = [];
    let i = 0, field = "", row = [], inQuotes = false;
    const len = text.length;
    while(i < len){
      const c = text[i];
      if(inQuotes){
        if(c === '"'){
          if(text[i+1] === '"'){ field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += c; i++; continue;
      } else {
        if(c === '"'){ inQuotes = true; i++; continue; }
        if(c === ','){ row.push(field); field = ""; i++; continue; }
        if(c === '\r'){ i++; continue; }
        if(c === '\n'){ row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
        field += c; i++; continue;
      }
    }
    if(field.length || row.length){ row.push(field); rows.push(row); }
    if(!rows.length) return [];
    const headers = rows[0].map(h => h.trim());
    const out = [];
    for(let r = 1; r < rows.length; r++){
      if(rows[r].length === 1 && rows[r][0] === "") continue;
      const obj = {};
      headers.forEach((h, idx) => { obj[h] = (rows[r][idx] !== undefined ? rows[r][idx] : "").trim(); });
      out.push(obj);
    }
    return out;
  }

  function num(v){
    const n = parseFloat(String(v).replace(/,/g, ""));
    return isNaN(n) ? 0 : n;
  }

  function fmtKWD(n){
    return Math.round(n).toLocaleString("en-US");
  }

  function fmtPct(n, decimals){
    decimals = decimals === undefined ? 0 : decimals;
    return n.toFixed(decimals) + "%";
  }

  function tenureLabel(days){
    if(days <= 0) return "—";
    const years = Math.floor(days / 365);
    const months = Math.round((days % 365) / 30);
    if(years > 0) return `${years}y ${months}m`;
    return `${months}m`;
  }

  // ---------- Data source persistence ----------
  const LS_KEY = "kp_csv_url";

  function loadSavedUrl(){
    try { return localStorage.getItem(LS_KEY) || ""; } catch(e){ return ""; }
  }
  function saveUrl(url){
    try { localStorage.setItem(LS_KEY, url); } catch(e){}
  }
  function clearUrl(){
    try { localStorage.removeItem(LS_KEY); } catch(e){}
  }

  async function fetchData(){
    const url = loadSavedUrl();
    const banner = document.getElementById("sampleBanner");
    const label = document.getElementById("dataSourceLabel");
    if(!url){
      RAW = (window.SAMPLE_DATA || []).slice();
      banner.style.display = "flex";
      label.textContent = "Sample data";
      finishLoad();
      return;
    }
    try {
      const res = await fetch(url, {cache: "no-store"});
      if(!res.ok) throw new Error("Fetch failed: " + res.status);
      const text = await res.text();
      const parsed = parseCSV(text);
      if(!parsed.length) throw new Error("Sheet returned no rows");
      RAW = parsed;
      banner.style.display = "none";
      label.textContent = "Live from your Google Sheet";
      finishLoad();
    } catch(err){
      console.error(err);
      RAW = (window.SAMPLE_DATA || []).slice();
      banner.style.display = "flex";
      banner.innerHTML = `⚠️ Couldn't load your Google Sheet (${escapeHtml(err.message)}). Showing sample data instead. <button class="linklike" id="bannerSettingsBtn2">Check data source →</button>`;
      label.textContent = "Sample data (fallback)";
      finishLoad();
      const btn = document.getElementById("bannerSettingsBtn2");
      if(btn) btn.addEventListener("click", openSettings);
    }
  }

  function finishLoad(){
    document.getElementById("updatedTime").textContent = new Date().toLocaleTimeString([], {hour: "2-digit", minute:"2-digit"});
    populateFacilityFilter();
    applyFilters();
  }

  function escapeHtml(s){
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  // ---------- Filters ----------
  function populateFacilityFilter(){
    const sel = document.getElementById("filterFacility");
    const current = sel.value;
    const facilities = Array.from(new Set(RAW.map(r => r["Facility"]).filter(Boolean))).sort();
    sel.innerHTML = '<option value="">All facilities</option>' +
      facilities.map(f => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join("");
    sel.value = current;
  }

  function applyFilters(){
    const facility = document.getElementById("filterFacility").value;
    const status = document.getElementById("filterStatus").value;
    const type = document.getElementById("filterType").value;
    const grade = document.getElementById("filterGrade").value;
    const search = document.getElementById("searchBox").value.trim().toLowerCase();

    FILTERED = RAW.filter(r => {
      if(facility && r["Facility"] !== facility) return false;
      if(status && r["Status"] !== status) return false;
      if(type && r["Licensee Type"] !== type) return false;
      if(grade && r["Grade"] !== grade) return false;
      if(atRiskOnly){
        const risk = r["Churn Risk"];
        const isChurning = r["Status"] === "Churning";
        if(!(risk === "High" || isChurning)) return false;
      }
      if(search){
        const hay = `${r["Kitchen ID"]} ${r["Licensee Name"]} ${r["Facility"]}`.toLowerCase();
        if(!hay.includes(search)) return false;
      }
      return true;
    });

    page = 0;
    renderAll();
  }

  // ---------- Metrics ----------
  function computeMetrics(rows){
    const total = rows.length;
    const occupied = rows.filter(r => r["Status"] === "Occupied");
    const vacant = rows.filter(r => r["Status"] === "Vacant");
    const churning = rows.filter(r => r["Status"] === "Churning");
    const active = occupied.concat(churning); // licensees currently in a unit

    const occPct = total ? (occupied.length / total * 100) : 0;
    const vacantPct = total ? (vacant.length / total * 100) : 0;

    const hotCold = active.reduce((acc, r) => {
      if(r["Churn Risk"] === "High" || r["Status"] === "Churning") acc.cold++;
      else acc.hot++;
      return acc;
    }, {hot:0, cold:0});

    const highRiskCount = rows.filter(r => r["Churn Risk"] === "High").length;

    const totalGMV = active.reduce((s,r) => s + num(r["Monthly GMV (KWD)"]), 0);
    const totalPF = active.reduce((s,r) => s + num(r["Processing Fee (KWD)"]), 0);
    const totalOrders = active.reduce((s,r) => s + num(r["Monthly Orders"]), 0);

    const pfTakeRate = totalGMV > 0 ? (totalPF / totalGMV * 100) : 0;

    function byType(field, fn){
      const types = ["Start-up","Independent","Growth","Enterprise"];
      const out = {};
      types.forEach(t => {
        const subset = active.filter(r => r["Licensee Type"] === t);
        out[t] = fn(subset);
      });
      return out;
    }

    const avgGMVByType = byType(null, (subset) => {
      if(!subset.length) return 0;
      return subset.reduce((s,r) => s + num(r["Monthly GMV (KWD)"]), 0) / subset.length;
    });
    const avgOrdersByType = byType(null, (subset) => {
      if(!subset.length) return 0;
      return Math.round(subset.reduce((s,r) => s + num(r["Monthly Orders"]), 0) / subset.length);
    });
    const avgPFByType = byType(null, (subset) => {
      if(!subset.length) return 0;
      return subset.reduce((s,r) => s + num(r["Processing Fee (KWD)"]), 0) / subset.length;
    });

    // tenure
    const now = new Date();
    function tenureDays(r){
      if(!r["Move-in Date"]) return null;
      const d = new Date(r["Move-in Date"]);
      if(isNaN(d.getTime())) return null;
      return Math.floor((now - d) / 86400000);
    }
    const avgTenureByType = byType(null, (subset) => {
      const days = subset.map(tenureDays).filter(d => d !== null);
      if(!days.length) return 0;
      return days.reduce((a,b)=>a+b,0) / days.length;
    });
    const allTenureDays = active.map(tenureDays).filter(d => d !== null);
    const avgTenureOverall = allTenureDays.length ? allTenureDays.reduce((a,b)=>a+b,0)/allTenureDays.length : 0;

    // grade mix across all kitchens (not just active) — useful facility-quality signal
    const gradeCount = {A:0, B:0, C:0};
    rows.forEach(r => { if(gradeCount[r["Grade"]] !== undefined) gradeCount[r["Grade"]]++; });
    const gradeTotal = gradeCount.A + gradeCount.B + gradeCount.C;
    const gradePct = {
      A: gradeTotal ? gradeCount.A/gradeTotal*100 : 0,
      B: gradeTotal ? gradeCount.B/gradeTotal*100 : 0,
      C: gradeTotal ? gradeCount.C/gradeTotal*100 : 0,
    };

    const avgOrdersPerLicensee = active.length ? totalOrders/active.length : 0;
    const avgGMVPerLicensee = active.length ? totalGMV/active.length : 0;
    const avgPFPerKitchen = total ? totalPF/total : 0;

    return {
      total, occupiedCount: occupied.length, vacantCount: vacant.length, churningCount: churning.length,
      occPct, vacantPct, hotCold, highRiskCount, totalGMV, totalPF, pfTakeRate,
      avgGMVByType, avgOrdersByType, avgPFByType, avgTenureByType, avgTenureOverall,
      gradeCount, gradePct, gradeTotal,
      avgOrdersPerLicensee, avgGMVPerLicensee, avgPFPerKitchen,
      activeCount: active.length
    };
  }

  // ---------- Render: KPI cards ----------
  function renderKPIs(m){
    const g1 = document.getElementById("kpiGrid1");
    g1.innerHTML = `
      <div class="kpi-card">
        <div class="kpi-label">Kitchens</div>
        <div class="kpi-value">${m.total}</div>
        <div class="kpi-detail">across all Kuwait facilities</div>
      </div>
      <div class="kpi-card good">
        <div class="kpi-label">Occupancy</div>
        <div class="kpi-value">${fmtPct(m.occPct)}</div>
        <div class="kpi-detail">${m.occupiedCount} of ${m.total} occupied</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Vacant</div>
        <div class="kpi-value">${m.vacantCount}</div>
        <div class="kpi-detail">${fmtPct(m.vacantPct)} of base</div>
      </div>
      <div class="kpi-card ${m.churningCount > 0 ? 'warn':''}">
        <div class="kpi-label">Churning</div>
        <div class="kpi-value">${m.churningCount}</div>
        <div class="kpi-detail">high churn risk: ${m.highRiskCount}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Hot / Cold</div>
        <div class="kpi-value">${m.hotCold.hot} <span style="color:#B8BFB9; font-size:18px;">/</span> ${m.hotCold.cold}</div>
        <div class="kpi-detail">stable vs. at-risk licensees</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">PF take rate</div>
        <div class="kpi-value">${fmtPct(m.pfTakeRate, 1)}</div>
        <div class="kpi-detail">of GMV collected as processing fee</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Total GMV · last month</div>
        <div class="kpi-value num" style="font-size:22px;">KWD ${fmtKWD(m.totalGMV)}</div>
        <div class="kpi-detail">across ${m.activeCount} licensees</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Total processing fee</div>
        <div class="kpi-value num" style="font-size:22px;">KWD ${fmtKWD(m.totalPF)}</div>
        <div class="kpi-detail">${m.pfTakeRate.toFixed(1)}% of GMV</div>
      </div>
    `;

    const g2 = document.getElementById("kpiGrid2");
    g2.innerHTML = `
      <div class="kpi-card">
        <div class="kpi-label">Avg GMV / licensee</div>
        <div class="kpi-value num">KWD ${fmtKWD(m.avgGMVPerLicensee)}</div>
        <div class="kpi-breakdown">
          <div>Start-up<b>${fmtKWD(m.avgGMVByType["Start-up"])}</b></div>
          <div>Indep.<b>${fmtKWD(m.avgGMVByType["Independent"])}</b></div>
          <div>Growth<b>${fmtKWD(m.avgGMVByType["Growth"])}</b></div>
          <div>Enterprise<b>${fmtKWD(m.avgGMVByType["Enterprise"])}</b></div>
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Avg orders / licensee</div>
        <div class="kpi-value num">${fmtKWD(m.avgOrdersPerLicensee)}</div>
        <div class="kpi-breakdown">
          <div>Start-up<b>${fmtKWD(m.avgOrdersByType["Start-up"])}</b></div>
          <div>Indep.<b>${fmtKWD(m.avgOrdersByType["Independent"])}</b></div>
          <div>Growth<b>${fmtKWD(m.avgOrdersByType["Growth"])}</b></div>
          <div>Enterprise<b>${fmtKWD(m.avgOrdersByType["Enterprise"])}</b></div>
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Grade mix</div>
        <div class="kpi-value">${fmtPct(m.gradePct.A,0)}<span style="font-size:13px; color:#8A9390; font-weight:600;">&nbsp;Grade A</span></div>
        <div class="kpi-detail">${m.gradeCount.A} A · ${m.gradeCount.B} B · ${m.gradeCount.C} C across ${m.gradeTotal} kitchens</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Avg tenure</div>
        <div class="kpi-value">${tenureLabel(m.avgTenureOverall)}</div>
        <div class="kpi-breakdown">
          <div>Start-up<b>${tenureLabel(m.avgTenureByType["Start-up"])}</b></div>
          <div>Indep.<b>${tenureLabel(m.avgTenureByType["Independent"])}</b></div>
          <div>Growth<b>${tenureLabel(m.avgTenureByType["Growth"])}</b></div>
          <div>Enterprise<b>${tenureLabel(m.avgTenureByType["Enterprise"])}</b></div>
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Avg processing fee / kitchen</div>
        <div class="kpi-value num">KWD ${fmtKWD(m.avgPFPerKitchen)}</div>
        <div class="kpi-breakdown">
          <div>Start-up<b>${fmtKWD(m.avgPFByType["Start-up"])}</b></div>
          <div>Indep.<b>${fmtKWD(m.avgPFByType["Independent"])}</b></div>
          <div>Growth<b>${fmtKWD(m.avgPFByType["Growth"])}</b></div>
          <div>Enterprise<b>${fmtKWD(m.avgPFByType["Enterprise"])}</b></div>
        </div>
      </div>
    `;
  }

  // ---------- Render: facility strip ----------
  function renderFacilityStrip(){
    const wrap = document.getElementById("facilityStrip");
    const facilities = Array.from(new Set(RAW.map(r => r["Facility"]).filter(Boolean))).sort();
    if(!facilities.length){
      wrap.innerHTML = `<div class="empty-state">No facilities found in the data.</div>`;
      return;
    }
    wrap.innerHTML = facilities.map(fac => {
      const rows = RAW.filter(r => r["Facility"] === fac);
      const m = computeMetrics(rows);
      const occShare = m.total ? (m.occupiedCount / m.total * 100) : 0;
      const churnShare = m.total ? (m.churningCount / m.total * 100) : 0;
      const gradeCount = {A:0,B:0,C:0};
      rows.forEach(r => { if(gradeCount[r["Grade"]] !== undefined) gradeCount[r["Grade"]]++; });
      const topGrade = Object.entries(gradeCount).sort((a,b)=>b[1]-a[1])[0][0] || "B";

      return `
        <div class="facility-row" data-facility="${escapeHtml(fac)}">
          <div class="facility-name">${escapeHtml(fac)}<span class="count">${m.total} kitchens</span></div>
          <div class="occ-bar-wrap">
            <div class="occ-bar-track">
              <div class="occ-bar-seg occ" style="width:${occShare}%"></div>
              <div class="occ-bar-seg churn" style="width:${churnShare}%"></div>
            </div>
            <div class="occ-pct">${fmtPct(occShare)}</div>
          </div>
          <div class="mini-stat"><div class="v">${m.vacantCount}</div><div class="l">Vacant</div></div>
          <div class="mini-stat"><div class="v">${m.churningCount}</div><div class="l">Churning</div></div>
          <div class="mini-stat"><div class="v num">${fmtPct(m.pfTakeRate,1)}</div><div class="l">PF rate</div></div>
          <div class="mini-stat"><div class="v num">${fmtKWD(m.totalGMV)}</div><div class="l">GMV (KWD)</div></div>
          <div class="grade-pill ${topGrade}">${topGrade}</div>
        </div>
      `;
    }).join("");

    wrap.querySelectorAll(".facility-row").forEach(el => {
      el.addEventListener("click", () => {
        document.getElementById("filterFacility").value = el.dataset.facility;
        applyFilters();
        document.querySelector(".table-wrap").scrollIntoView({behavior:"smooth", block:"start"});
      });
    });
  }

  // ---------- Render: table ----------
  const COLUMNS = [
    {key:"Kitchen ID", label:"Kitchen"},
    {key:"Facility", label:"Facility"},
    {key:"Status", label:"Status"},
    {key:"Licensee Name", label:"Licensee"},
    {key:"Licensee Type", label:"Type"},
    {key:"Grade", label:"Grade"},
    {key:"Monthly GMV (KWD)", label:"GMV (KWD)"},
    {key:"Monthly Orders", label:"Orders"},
    {key:"Processing Fee (KWD)", label:"PF (KWD)"},
    {key:"Churn Risk", label:"Risk"},
  ];

  function renderTableHead(){
    const head = document.getElementById("tableHead");
    head.innerHTML = COLUMNS.map(c => {
      const arrow = sortKey === c.key ? (sortDir === 1 ? "↑" : "↓") : "";
      return `<th data-key="${c.key}">${c.label}<span class="arrow">${arrow}</span></th>`;
    }).join("");
    head.querySelectorAll("th").forEach(th => {
      th.addEventListener("click", () => {
        const key = th.dataset.key;
        if(sortKey === key) sortDir *= -1;
        else { sortKey = key; sortDir = 1; }
        renderTable();
      });
    });
  }

  function sortRows(rows){
    const isNumeric = NUMERIC_FIELDS.includes(sortKey);
    return rows.slice().sort((a,b) => {
      let av = a[sortKey] || "", bv = b[sortKey] || "";
      if(isNumeric){ av = num(av); bv = num(bv); }
      if(av < bv) return -1 * sortDir;
      if(av > bv) return 1 * sortDir;
      return 0;
    });
  }

  function renderTable(){
    renderTableHead();
    const sorted = sortRows(FILTERED);
    const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    if(page >= totalPages) page = totalPages - 1;
    if(page < 0) page = 0;
    const start = page * PAGE_SIZE;
    const pageRows = sorted.slice(start, start + PAGE_SIZE);

    const body = document.getElementById("tableBody");
    if(!pageRows.length){
      body.innerHTML = `<tr><td colspan="${COLUMNS.length}"><div class="empty-state"><div class="big">No kitchens match your filters</div>Try clearing a filter or the search box.</div></td></tr>`;
    } else {
      body.innerHTML = pageRows.map((r, idx) => {
        const realIdx = RAW.indexOf(r);
        return `
        <tr data-idx="${realIdx}">
          <td><b>${escapeHtml(r["Kitchen ID"]||"")}</b></td>
          <td>${escapeHtml(r["Facility"]||"")}</td>
          <td><span class="status-pill ${r["Status"]}">${escapeHtml(r["Status"]||"")}</span></td>
          <td>${escapeHtml(r["Licensee Name"]||"—")}</td>
          <td>${escapeHtml(r["Licensee Type"]||"")}</td>
          <td>${escapeHtml(r["Grade"]||"")}</td>
          <td class="num">${r["Monthly GMV (KWD)"] ? fmtKWD(num(r["Monthly GMV (KWD)"])) : "—"}</td>
          <td class="num">${r["Monthly Orders"] ? fmtKWD(num(r["Monthly Orders"])) : "—"}</td>
          <td class="num">${r["Processing Fee (KWD)"] ? fmtKWD(num(r["Processing Fee (KWD)"])) : "—"}</td>
          <td>${r["Churn Risk"] ? `<span class="risk-dot ${r["Churn Risk"]}"></span>${r["Churn Risk"]}` : "—"}</td>
        </tr>`;
      }).join("");
    }

    body.querySelectorAll("tr[data-idx]").forEach(tr => {
      tr.addEventListener("click", () => openDetail(RAW[parseInt(tr.dataset.idx)]));
    });

    document.getElementById("pageInfo").textContent =
      sorted.length ? `Showing ${start+1}–${Math.min(start+PAGE_SIZE, sorted.length)} of ${sorted.length}` : "No results";
    document.getElementById("prevPage").disabled = page === 0;
    document.getElementById("nextPage").disabled = page >= totalPages - 1;
    document.getElementById("resultCount").textContent = `${FILTERED.length} of ${RAW.length} kitchens`;
  }

  // ---------- Detail modal ----------
  function openDetail(r){
    document.getElementById("detailTitle").textContent = r["Licensee Name"] || "Vacant unit";
    document.getElementById("detailSub").textContent = `${r["Kitchen ID"]} · ${r["Facility"]}`;
    const body = document.getElementById("detailBody");
    body.innerHTML = `
      <div class="modal-grid">
        <div class="modal-field"><div class="l">Status</div><div class="v"><span class="status-pill ${r["Status"]}">${escapeHtml(r["Status"]||"")}</span></div></div>
        <div class="modal-field"><div class="l">Grade</div><div class="v">${escapeHtml(r["Grade"]||"—")}</div></div>
        <div class="modal-field"><div class="l">Licensee type</div><div class="v">${escapeHtml(r["Licensee Type"]||"—")}</div></div>
        <div class="modal-field"><div class="l">Churn risk</div><div class="v">${r["Churn Risk"] ? `<span class="risk-dot ${r["Churn Risk"]}"></span>${r["Churn Risk"]}` : "—"}</div></div>
        <div class="modal-field"><div class="l">Move-in date</div><div class="v">${escapeHtml(r["Move-in Date"]||"—")}</div></div>
        <div class="modal-field"><div class="l">Floor price</div><div class="v num">KWD ${fmtKWD(num(r["Floor Price (KWD)"]))}</div></div>
        <div class="modal-field"><div class="l">Monthly GMV</div><div class="v num">KWD ${fmtKWD(num(r["Monthly GMV (KWD)"]))}</div></div>
        <div class="modal-field"><div class="l">Monthly orders</div><div class="v num">${fmtKWD(num(r["Monthly Orders"]))}</div></div>
        <div class="modal-field"><div class="l">Processing fee</div><div class="v num">KWD ${fmtKWD(num(r["Processing Fee (KWD)"]))}</div></div>
      </div>
      ${r["Notes"] ? `<div class="modal-notes">📝 ${escapeHtml(r["Notes"])}</div>` : ""}
    `;
    document.getElementById("detailModal").classList.add("show");
  }

  // ---------- Export ----------
  function exportCSV(){
    const headers = Object.keys(RAW[0] || {});
    const lines = [headers.join(",")];
    FILTERED.forEach(r => {
      lines.push(headers.map(h => {
        const v = (r[h]||"").toString().replace(/"/g,'""');
        return /[,"\n]/.test(v) ? `"${v}"` : v;
      }).join(","));
    });
    const blob = new Blob([lines.join("\n")], {type:"text/csv"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `kitchens-export-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // ---------- Settings modal ----------
  function openSettings(){
    document.getElementById("csvUrlInput").value = loadSavedUrl();
    document.getElementById("settingsModal").classList.add("show");
  }
  function closeSettings(){
    document.getElementById("settingsModal").classList.remove("show");
  }

  // ---------- Render all ----------
  function renderAll(){
    const m = computeMetrics(FILTERED);
    renderKPIs(m);
    renderFacilityStrip();
    renderTable();
  }

  // ---------- Wire up events ----------
  function init(){
    ["filterFacility","filterStatus","filterType","filterGrade"].forEach(id => {
      document.getElementById(id).addEventListener("change", applyFilters);
    });
    let searchTimer;
    document.getElementById("searchBox").addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(applyFilters, 180);
    });
    document.getElementById("atRiskToggle").addEventListener("click", (e) => {
      atRiskOnly = !atRiskOnly;
      e.target.classList.toggle("active", atRiskOnly);
      applyFilters();
    });
    document.getElementById("prevPage").addEventListener("click", () => { page--; renderTable(); });
    document.getElementById("nextPage").addEventListener("click", () => { page++; renderTable(); });
    document.getElementById("exportBtn").addEventListener("click", exportCSV);

    document.getElementById("closeDetail").addEventListener("click", () => document.getElementById("detailModal").classList.remove("show"));
    document.getElementById("detailModal").addEventListener("click", (e) => { if(e.target.id === "detailModal") e.currentTarget.classList.remove("show"); });

    document.getElementById("settingsBtn").addEventListener("click", openSettings);
    document.getElementById("bannerSettingsBtn").addEventListener("click", openSettings);
    document.getElementById("closeSettings").addEventListener("click", closeSettings);
    document.getElementById("settingsModal").addEventListener("click", (e) => { if(e.target.id === "settingsModal") closeSettings(); });
    document.getElementById("saveCsvUrl").addEventListener("click", () => {
      const url = document.getElementById("csvUrlInput").value.trim();
      if(url) saveUrl(url);
      else clearUrl();
      closeSettings();
      fetchData();
    });
    document.getElementById("useSampleBtn").addEventListener("click", () => {
      clearUrl();
      document.getElementById("csvUrlInput").value = "";
      closeSettings();
      fetchData();
    });

    fetchData();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
