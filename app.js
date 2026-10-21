const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const state = {
  settings: null,
  teams: [],
  matches: [],
  tab: "schedule",
  follow: localStorage.getItem("vv-follow") || "",
  search: "",
  filter: "all",
  csrfToken: null,
  adminAuthenticated: false,
  dataLoaded: false,
  adminTab: "settings"
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("show"), 3200);
}

async function apiRequest(action, {method = "GET", body, csrf = true} = {}) {
  const headers = {Accept: "application/json"};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (csrf && state.csrfToken) headers["X-CSRF-Token"] = state.csrfToken;
  let response;
  try {
    response = await fetch(`api.php?action=${encodeURIComponent(action)}`, {
      method,
      headers,
      credentials: "same-origin",
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch {
    throw new Error("Could not reach the club server. Run the site through PHP and check the server.");
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("The server returned an unreadable response. Check the PHP server logs.");
  }
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
  return result;
}

function teamById(id) {
  return state.teams.find(team => team.id === id);
}

function safeTeamColor(team) {
  return /^#[0-9a-f]{6}$/i.test(team?.color || "") ? team.color : "#aeb3ba";
}

function teamDot(id) {
  const team = teamById(id);
  return `<i class="team-dot" style="background:${safeTeamColor(team)}"></i>`;
}

function displayTime(time) {
  if (!time) return "";
  const [hour, minute] = time.slice(0, 5).split(":").map(Number);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return time;
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}

function displayDate(date, options = {weekday: "long", month: "long", day: "numeric", year: "numeric"}) {
  if (!date) return "";
  const parsed = new Date(`${date.slice(0, 10)}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? date : new Intl.DateTimeFormat(undefined, options).format(parsed);
}

function completed(match) {
  return ["completed", "official"].includes(match.status) && match.score_a !== null && match.score_b !== null;
}

function stats(teamId) {
  const result = {won: 0, lost: 0, pf: 0, pa: 0};
  state.matches.filter(completed).forEach(match => {
    if (match.team_a_id === teamId) {
      result.pf += match.score_a;
      result.pa += match.score_b;
      if (match.score_a > match.score_b) result.won++;
      else result.lost++;
    } else if (match.team_b_id === teamId) {
      result.pf += match.score_b;
      result.pa += match.score_a;
      if (match.score_b > match.score_a) result.won++;
      else result.lost++;
    }
  });
  const played = result.won + result.lost;
  return {...result, rate: played ? Math.round(result.won / played * 100) : 0};
}

function ranking() {
  return state.teams.map(team => ({team, ...stats(team.id)}))
    .sort((left, right) => right.won - left.won || right.pf - left.pf);
}

function ordinal(position) {
  const suffix = position % 100 >= 11 && position % 100 <= 13 ? "th" : ({1: "st", 2: "nd", 3: "rd"}[position % 10] || "th");
  return `${position}${suffix}`;
}

function renderSettings() {
  const settings = state.settings;
  if (!settings) return;
  $("#clubName").textContent = settings.club_name;
  $("#footerClubName").textContent = settings.club_name;
  $("#clubLogo").alt = `${settings.club_name} logo`;
  document.title = `${settings.club_name} | Match Center`;
  $("#eventDateTime").innerHTML = `${escapeHtml(displayDate(settings.event_date))}<br />${escapeHtml(displayTime(settings.start_time))}–${escapeHtml(displayTime(settings.end_time))}`;
  $("#eventVenue").textContent = settings.venue;
  $("#eventFee").textContent = `PHP ${settings.court_fee}`;
  $("#paymentFee").textContent = `PHP ${settings.court_fee}`;
  $("#paymentFeeAmount").textContent = `PHP ${Number(settings.court_fee).toFixed(2)}`;
  $("#paymentClubName").textContent = settings.club_name;
  $("#heroEyebrow").textContent = settings.hero_eyebrow;
  const headlineLines = String(settings.hero_headline || "").split(/\r?\n/);
  $("#heroHeadline").innerHTML = `${escapeHtml(headlineLines.shift() || "")}<br /><span>${escapeHtml(headlineLines.join(" "))}</span>`;
  $("#heroDescription").textContent = settings.hero_description;
  const hasQr = Boolean(settings.payment_qr_url);
  $("#paymentQrSection").hidden = !hasQr;
  $("#paymentProviderName").textContent = settings.payment_provider || "";
  if (hasQr) {
    $("#paymentQrImage").src = settings.payment_qr_url;
    $("#paymentQrOpen").href = settings.payment_qr_url;
  } else {
    $("#paymentQrImage").removeAttribute("src");
    $("#paymentQrOpen").removeAttribute("href");
  }
}

function renderFinal() {
  const ranks = ranking();
  $("#finalResults").innerHTML = ranks.length ? ranks.map((row, index) => `
    <div class="result-row">
      <div class="rank ${index === 0 ? "first" : ""}">${ordinal(index + 1)}</div>
      <div><div class="team-line">${teamDot(row.team.id)} ${escapeHtml(row.team.name)}</div>
      <div class="team-record">${index === 0 ? "Tournament leader" : "Final placement"}</div></div>
      <div class="record">${row.won}–${row.lost}</div>
    </div>`).join("") : `<p class="admin-empty">Add teams to show standings.</p>`;
}

function renderFeatured() {
  const match = [...state.matches].sort((a, b) => b.match_number - a.match_number)[0];
  const scoreboard = $("#featuredScore");
  const footer = $("#featuredFooter");
  if (!match) {
    scoreboard.innerHTML = `<p class="admin-empty">No matches have been added yet.</p>`;
    $("#matchCaption").textContent = "Create a match to show the featured result.";
    $("#featuredStatus").textContent = "NO MATCHES";
    footer.innerHTML = "<span>—</span><span>SCORE</span><span>—</span>";
    return;
  }
  const teamA = teamById(match.team_a_id);
  const teamB = teamById(match.team_b_id);
  if (!teamA || !teamB) return;
  const hasScores = match.score_a !== null && match.score_b !== null;
  const isFinal = completed(match);
  const winner = isFinal ? (match.score_a > match.score_b ? teamA.id : teamB.id) : "";
  scoreboard.innerHTML = `
    <div class="score-team ${winner === teamA.id ? "winner" : ""}"><div class="team-line">${teamDot(teamA.id)} ${escapeHtml(teamA.name)}</div><div class="big-score">${hasScores ? match.score_a : "—"}</div></div>
    <div class="vs">VS</div>
    <div class="score-team ${winner === teamB.id ? "winner" : ""}"><div class="team-line">${teamDot(teamB.id)} ${escapeHtml(teamB.name)}</div><div class="big-score">${hasScores ? match.score_b : "—"}</div></div>`;
  $("#matchCaption").textContent = isFinal
    ? `${state.teams.find(team => team.id === winner).name} win. Match ${match.match_number} is in the books.`
    : `${match.status.replace("_", " ")} · Match ${match.match_number}`;
  $("#featuredStatus").textContent = match.status.replace("_", " ").toUpperCase();
  footer.innerHTML = `<span>${teamDot(teamA.id)} ${escapeHtml(teamA.name)}</span><span>${isFinal ? "OFFICIAL SCORE" : "SCORE"}</span><span>${teamDot(teamB.id)} ${escapeHtml(teamB.name)}</span>`;
}

function renderMatches() {
  const filtered = state.matches.filter(match => {
    const teamA = teamById(match.team_a_id);
    const teamB = teamById(match.team_b_id);
    const referee = match.referee || "";
    const searchable = `${match.match_number} ${teamA?.name || ""} ${teamB?.name || ""} ${referee}`.toLowerCase();
    return searchable.includes(state.search.toLowerCase())
      && (state.filter === "all" || match.team_a_id === state.filter || match.team_b_id === state.filter);
  });
  $("#matchCount").textContent = filtered.length;
  $("#matchList").innerHTML = filtered.length ? filtered.map(match => {
    const teamA = teamById(match.team_a_id);
    const teamB = teamById(match.team_b_id);
    if (!teamA || !teamB) return "";
    const hasScores = match.score_a !== null && match.score_b !== null;
    const isFinal = completed(match);
    const aWins = isFinal && match.score_a > match.score_b;
    const bWins = isFinal && match.score_b > match.score_a;
    const followed = isFollowing(match, teamA, teamB);
    const schedule = [match.match_date && displayDate(match.match_date, {month: "short", day: "numeric"}), displayTime(match.match_time)].filter(Boolean).join(" · ");
    const statusLabel = match.status.replace("_", " ");
    return `<article class="match-item ${followed ? "followed" : ""}">
      <div class="match-number">${String(match.match_number).padStart(2, "0")}</div>
      <div><div class="match-teams"><div class="match-side ${aWins ? "winner" : isFinal ? "loser" : ""}">${teamDot(teamA.id)}<span class="team-name">${escapeHtml(teamA.name)}</span></div>
      <div class="match-side ${bWins ? "winner" : isFinal ? "loser" : ""}">${teamDot(teamB.id)}<span class="team-name">${escapeHtml(teamB.name)}</span></div></div>
      <div class="referee">${schedule ? `${escapeHtml(schedule)} · ` : ""}Referee: <strong>${escapeHtml(match.referee || "—")}</strong></div></div>
      <div class="score-pair"><div class="${aWins || !isFinal ? "" : "loser-score"}">${hasScores ? match.score_a : "—"}</div><div class="${bWins || !isFinal ? "" : "loser-score"}">${hasScores ? match.score_b : "—"}</div></div>
      <span class="official status-${escapeHtml(match.status)}">${escapeHtml(statusLabel)}</span></article>`;
  }).join("") : `<div class="no-results">No matches found. Try another team or search.</div>`;
}

function isFollowing(match, teamA, teamB) {
  const followedTeam = state.teams.find(team => team.id === state.follow || team.name === state.follow);
  if (followedTeam) return match.team_a_id === followedTeam.id || match.team_b_id === followedTeam.id;
  if (state.follow.startsWith("player:")) {
    const player = state.follow.slice(7).toLowerCase();
    return [teamA, teamB].some(team => team.players.some(name => name.toLowerCase() === player));
  }
  return [teamA, teamB].some(team => team.players.some(name => name.toLowerCase() === state.follow.toLowerCase()));
}

function renderStandings() {
  $("#standingsList").innerHTML = ranking().map((row, index) => `
    <div class="standing-row"><div class="standing-team"><span class="standing-rank">${String(index + 1).padStart(2, "0")}</span>${teamDot(row.team.id)}${escapeHtml(row.team.name)}</div>
    <div>${row.won}–${row.lost}</div><div class="winrate">${row.rate}%</div><div class="stat">${row.pf}</div><div class="stat">${row.pa}</div></div>`).join("");
}

function renderTeams() {
  $("#teamsGrid").innerHTML = state.teams.map(team => {
    const result = stats(team.id);
    return `<article class="team-card" style="--team-color:${safeTeamColor(team)}"><div class="team-card-top">
      <div class="team-emblem">${escapeHtml(team.name.slice(0, 3))}</div><div><h3>${escapeHtml(team.name)}</h3><div class="team-sub">${escapeHtml(team.tagline || "")}</div></div></div>
      <div class="team-card-stats"><div class="team-stat"><strong>${result.won}</strong><span>Wins</span></div><div class="team-stat"><strong>${result.lost}</strong><span>Losses</span></div><div class="team-stat"><strong>${result.rate}%</strong><span>Win rate</span></div></div>
      <button data-follow-team="${escapeHtml(team.id)}">${state.follow === team.id ? "✓ Following team" : `Follow ${escapeHtml(team.name)} →`}</button></article>`;
  }).join("");
}

function renderSelectors() {
  const filter = $("#resultFilter");
  const follow = $("#followSelect");
  const oldFilter = state.filter;
  const oldFollow = state.follow;
  filter.innerHTML = `<option value="all">All teams</option>${state.teams.map(team => `<option value="${escapeHtml(team.id)}">${escapeHtml(team.name)}</option>`).join("")}`;
  follow.innerHTML = `<option value="">Choose a team or player…</option><optgroup label="Teams">${state.teams.map(team => `<option value="${escapeHtml(team.id)}">${escapeHtml(team.name)}</option>`).join("")}</optgroup><optgroup label="Players">${state.teams.flatMap(team => team.players.map(player => `<option value="${escapeHtml(`player:${player}`)}">${escapeHtml(player)} (${escapeHtml(team.name)})</option>`)).join("")}</optgroup>`;
  if (state.teams.some(team => team.id === oldFilter)) filter.value = oldFilter;
  else state.filter = filter.value = "all";
  if ([...follow.options].some(option => option.value === oldFollow)) follow.value = oldFollow;
  else if (oldFollow) {
    const legacyTeam = state.teams.find(team => team.name === oldFollow);
    const legacyPlayer = state.teams.find(team => team.players.some(player => player.toLowerCase() === oldFollow.toLowerCase()));
    state.follow = legacyTeam?.id || (legacyPlayer ? `player:${oldFollow}` : "");
    localStorage.setItem("vv-follow", state.follow);
    follow.value = state.follow;
  }
  $("#introTeamCount").textContent = state.teams.length;
}

function renderAll() {
  renderSettings();
  renderSelectors();
  renderFinal();
  renderFeatured();
  renderMatches();
  renderStandings();
  renderTeams();
  const matchCount = state.matches.length;
  $("#introMatchCount").textContent = matchCount;
  const seasonComplete = state.matches.length > 0 && state.matches.every(completed);
  $("#championNote").hidden = state.matches.length === 0;
  $("#championTitle").textContent = seasonComplete ? "That’s a wrap!" : "Tournament in progress";
  $("#championMessage").textContent = seasonComplete ? "Thanks for bringing the energy to the court." : "Follow the schedule as scores come in.";
  $("#seasonStatus").innerHTML = `<span class="pulse"></span>${seasonComplete ? "SEASON COMPLETE" : "SEASON IN PROGRESS"}`;
  $("#introSeasonStatus").textContent = seasonComplete ? "Season recap" : "Live schedule";
  $("#scheduleStatusTitle").textContent = seasonComplete ? "We’re between seasons" : "Tournament schedule";
  $("#scheduleStatusText").textContent = seasonComplete
    ? "All official scores are in. Browse the match history and final table."
    : "Browse upcoming matches, live scores, and official results.";
  if (state.dataLoaded) {
    $("#dataNotice").hidden = true;
  }
}

function setBackendError(message) {
  const notice = $("#dataNotice");
  notice.textContent = `${message} Tournament edits are disabled until the server is available.`;
  notice.hidden = false;
  $("#seasonStatus").textContent = "SERVER OFFLINE";
  $("#matchCaption").textContent = "Saved scores are unavailable until the tournament server connects.";
}

async function loadPublicData({notify = false} = {}) {
  try {
    const data = await apiRequest("public-data", {csrf: false});
    if (!data.settings || !Array.isArray(data.teams) || !Array.isArray(data.matches)) {
      throw new Error("Tournament data is incomplete. Apply schema.sql and reload.");
    }
    state.settings = data.settings;
    state.teams = data.teams.map(team => ({...team, players: Array.isArray(team.players) ? team.players : []}));
    state.matches = data.matches;
    state.dataLoaded = true;
    renderAll();
    return true;
  } catch (error) {
    setBackendError(error.message);
    if (notify) toast(error.message);
    return false;
  }
}

function syncAdminForms() {
  if (state.settings) {
    const form = $("#settingsForm");
    Object.entries(state.settings).forEach(([name, value]) => {
      if (form.elements[name]) form.elements[name].value = String(value ?? "").slice(0, name.includes("time") ? 5 : undefined);
    });
    form.dataset.dirty = "false";
    $("#paymentProviderInput").value = state.settings.payment_provider || "GCash";
    $("#paymentProviderInput").dataset.savedProvider = $("#paymentProviderInput").value;
    $("#adminQrPreviewWrap").hidden = !state.settings.payment_qr_url;
    $("#removePaymentQr").hidden = !state.settings.payment_qr_url;
    if (state.settings.payment_qr_url) {
      $("#adminQrPreview").src = state.settings.payment_qr_url;
      $("#adminQrLabel").textContent = `Current QR: ${state.settings.payment_provider || "Payment provider"}`;
    } else {
      $("#adminQrPreview").removeAttribute("src");
      $("#adminQrLabel").textContent = "";
    }
  }
  renderAdminTeams();
  renderAdminMatches();
  renderMatchTeamSelectors();
}

function adminMessage(text, type = "") {
  const element = $("#adminMessage");
  element.textContent = text;
  element.className = `admin-message ${type}`.trim();
}

function setAdminLoading(loading, message = "Loading…") {
  $("#adminLoading").hidden = !loading;
  $("#adminLoading").textContent = message;
  $$("#adminDashboard button, #adminDashboard input, #adminDashboard select, #adminDashboard textarea").forEach(element => {
    if (element.id !== "adminLogout" && !element.closest(".admin-tabs")) element.disabled = loading;
  });
}

function showAdminTab(tab) {
  state.adminTab = tab;
  $$(".admin-tab").forEach(button => button.classList.toggle("active", button.dataset.adminTab === tab));
  $$(".admin-section").forEach(section => {
    const active = section.id === `admin${tab[0].toUpperCase()}${tab.slice(1)}Section`;
    section.hidden = !active;
    section.classList.toggle("active", active);
  });
}

function renderAdminTeams() {
  $("#adminTeamList").innerHTML = state.teams.length ? state.teams.map(team => `
    <div class="admin-list-item"><span class="admin-team-color" style="background:${safeTeamColor(team)}"></span><div class="admin-list-copy"><strong>${escapeHtml(team.name)}</strong><small>${escapeHtml(team.tagline || "No tagline")}</small></div>
    <button class="ghost-button" type="button" data-edit-team="${escapeHtml(team.id)}">Edit</button><button class="ghost-button danger" type="button" data-delete-team="${escapeHtml(team.id)}">Remove</button></div>`).join("") : `<p class="admin-empty">No teams yet.</p>`;
}

function renderAdminMatches() {
  $("#adminMatchList").innerHTML = state.matches.length ? [...state.matches].sort((a, b) => a.match_number - b.match_number).map(match => `
    <div class="admin-list-item"><span class="admin-match-number">${String(match.match_number).padStart(2, "0")}</span><div class="admin-list-copy"><strong>${escapeHtml(teamById(match.team_a_id)?.name || "Unknown")} vs ${escapeHtml(teamById(match.team_b_id)?.name || "Unknown")}</strong>
    <small>${match.score_a === null ? "—" : match.score_a} : ${match.score_b === null ? "—" : match.score_b} · ${escapeHtml(match.status.replace("_", " "))}</small></div>
    <button class="ghost-button" type="button" data-edit-match="${escapeHtml(match.id)}">Edit</button><button class="ghost-button danger" type="button" data-delete-match="${escapeHtml(match.id)}">Remove</button></div>`).join("") : `<p class="admin-empty">No matches yet.</p>`;
}

function renderMatchTeamSelectors() {
  const form = $("#matchForm");
  ["team_a_id", "team_b_id"].forEach(name => {
    const select = form.elements[name];
    const previous = select.value;
    select.innerHTML = `<option value="">Choose a team…</option>${state.teams.map(team => `<option value="${escapeHtml(team.id)}">${escapeHtml(team.name)}</option>`).join("")}`;
    if (state.teams.some(team => team.id === previous)) select.value = previous;
  });
}

function setFormValues(form, values) {
  Object.entries(values).forEach(([name, value]) => {
    if (form.elements[name]) form.elements[name].value = value ?? "";
  });
  form.dataset.dirty = "false";
}

function formHasChanges(form) {
  return form.dataset.dirty === "true";
}

function cancelForm(form) {
  if (formHasChanges(form) && !window.confirm("Discard unsaved changes?")) return false;
  form.reset();
  form.dataset.dirty = "false";
  form.hidden = true;
  if (form.id === "settingsForm") syncAdminForms();
  return true;
}

function discardUnsavedAdminForms() {
  const dirtyForms = $$("#adminDashboard form").filter(formHasChanges);
  const provider = $("#paymentProviderInput");
  const hasPendingQr = $("#paymentQrUpload").files.length > 0 || provider.value !== provider.dataset.savedProvider;
  if (!dirtyForms.length && !hasPendingQr) return true;
  if (!window.confirm("Discard unsaved changes?")) return false;
  dirtyForms.forEach(form => {
    form.reset();
    form.dataset.dirty = "false";
    if (form.id !== "settingsForm") form.hidden = true;
  });
  $("#paymentQrUpload").value = "";
  provider.value = provider.dataset.savedProvider || "GCash";
  if (dirtyForms.some(form => form.id === "settingsForm")) syncAdminForms();
  return true;
}

function applyServerData(data) {
  if (!data || !Array.isArray(data.teams) || !Array.isArray(data.matches)) {
    throw new Error("The server response did not include updated tournament data.");
  }
  state.teams = data.teams.map(team => ({...team, players: Array.isArray(team.players) ? team.players : []}));
  state.matches = data.matches;
  if (data.settings) state.settings = data.settings;
  state.dataLoaded = true;
  renderAll();
  syncAdminForms();
}

async function paymentQrMutation(remove = false) {
  const fileInput = $("#paymentQrUpload");
  const file = fileInput.files[0];
  if (!remove && !file) {
    $("#paymentQrMessage").textContent = "Choose a QR image to upload.";
    $("#paymentQrMessage").className = "admin-message error";
    return;
  }
  const formData = new FormData();
  formData.set("operation", remove ? "remove" : "upload");
  formData.set("provider", $("#paymentProviderInput").value);
  if (file) formData.set("qr_image", file);
  setAdminLoading(true, remove ? "Removing payment QR…" : "Uploading payment QR…");
  $("#paymentQrMessage").textContent = "";
  try {
    const response = await fetch("api.php?action=payment-qr", {
      method: "POST",
      headers: {"X-CSRF-Token": state.csrfToken, Accept: "application/json"},
      credentials: "same-origin",
      body: formData
    });
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error("The server returned an unreadable response. Check the PHP server logs.");
    }
    if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
    state.settings = result.settings;
    renderSettings();
    syncAdminForms();
    fileInput.value = "";
    const message = remove ? "Payment QR removed." : "Payment QR uploaded.";
    $("#paymentQrMessage").textContent = message;
    $("#paymentQrMessage").className = "admin-message success";
    toast(message);
  } catch (error) {
    $("#paymentQrMessage").textContent = error.message;
    $("#paymentQrMessage").className = "admin-message error";
    if (error.message.includes("security token expired") || error.message.includes("Admin sign-in is required")) {
      state.adminAuthenticated = false;
      state.csrfToken = null;
      showAdminLogin(error.message);
    }
  } finally {
    setAdminLoading(false);
  }
}

async function adminMutation(action, body, successMessage) {
  setAdminLoading(true, "Saving changes…");
  adminMessage("");
  try {
    const data = await apiRequest(action, {method: "POST", body});
    if (data.settings && !data.teams) {
      state.settings = data.settings;
      renderSettings();
      syncAdminForms();
    } else {
      applyServerData(data);
    }
    adminMessage(successMessage, "success");
    toast(successMessage);
    return true;
  } catch (error) {
    if (error.message.includes("security token expired") || error.message.includes("Admin sign-in is required")) {
      state.adminAuthenticated = false;
      state.csrfToken = null;
      showAdminLogin(error.message);
    }
    adminMessage(error.message, "error");
    return false;
  } finally {
    setAdminLoading(false);
  }
}

function showAdminLogin(message = "") {
  state.adminAuthenticated = false;
  state.csrfToken = null;
  $("#adminDashboard").hidden = true;
  $("#adminLoginView").hidden = false;
  $("#adminLoginMessage").textContent = message;
  $("#adminPassword").value = "";
}

function showAdminDashboard() {
  state.adminAuthenticated = true;
  $("#adminLoginView").hidden = true;
  $("#adminDashboard").hidden = false;
  showAdminTab(state.adminTab);
  syncAdminForms();
  adminMessage("");
}

async function openAdmin() {
  if (!$("#adminDialog").open) $("#adminDialog").showModal();
  $("#adminLoginView").hidden = false;
  $("#adminDashboard").hidden = true;
  $("#adminLoginMessage").textContent = "Checking admin session…";
  try {
    const session = await apiRequest("session", {csrf: false});
    state.adminAuthenticated = session.authenticated;
    state.csrfToken = session.csrfToken;
    if (session.authenticated) {
      setAdminLoading(true, "Loading saved tournament data…");
      if (!await loadPublicData()) {
        showAdminLogin("Could not load saved tournament data.");
        return;
      }
      showAdminDashboard();
    } else {
      showAdminLogin();
    }
  } catch (error) {
    showAdminLogin(error.message);
  } finally {
    setAdminLoading(false);
  }
}

$("#adminOpen").addEventListener("click", openAdmin);
$("#adminClose").addEventListener("click", () => {
  if (!discardUnsavedAdminForms()) return;
  $("#adminDialog").close();
});
$("#adminDialog").addEventListener("cancel", event => {
  if (!discardUnsavedAdminForms()) event.preventDefault();
});

$("#adminLoginForm").addEventListener("submit", async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type=submit]");
  button.disabled = true;
  $("#adminLoginMessage").textContent = "Signing in…";
  try {
    const result = await apiRequest("login", {method: "POST", body: {password: $("#adminPassword").value}, csrf: false});
    state.csrfToken = result.csrfToken;
    state.adminAuthenticated = true;
    const loaded = await loadPublicData();
    if (!loaded) throw new Error("Sign-in succeeded, but tournament data could not be loaded.");
    showAdminDashboard();
  } catch (error) {
    $("#adminLoginMessage").textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$("#adminLogout").addEventListener("click", async () => {
  if (!discardUnsavedAdminForms()) return;
  try {
    await apiRequest("logout", {method: "POST", body: {}});
    state.csrfToken = null;
    showAdminLogin("You have signed out.");
  } catch (error) {
    adminMessage(error.message, "error");
  }
});

$$(".admin-tab").forEach(button => button.addEventListener("click", () => {
  if (button.dataset.adminTab === state.adminTab || !discardUnsavedAdminForms()) return;
  showAdminTab(button.dataset.adminTab);
}));
$$("[data-cancel-form]").forEach(button => button.addEventListener("click", () => cancelForm(document.getElementById(button.dataset.cancelForm))));
$$("#adminDashboard form").forEach(form => form.addEventListener("input", () => { form.dataset.dirty = "true"; }));

$("#settingsForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const values = Object.fromEntries(new FormData(form).entries());
  const saved = await adminMutation("settings", values, "Event settings saved.");
  if (saved) form.dataset.dirty = "false";
});
$("#paymentQrUpload").addEventListener("change", event => {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 4 * 1024 * 1024) {
    event.target.value = "";
    $("#paymentQrMessage").textContent = "The image must be 4 MB or smaller.";
    $("#paymentQrMessage").className = "admin-message error";
    return;
  }
  if (file.type && !["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    event.target.value = "";
    $("#paymentQrMessage").textContent = "Choose a PNG, JPG, or WebP image.";
    $("#paymentQrMessage").className = "admin-message error";
    return;
  }
  $("#paymentQrMessage").textContent = `${file.name} is ready to upload.`;
  $("#paymentQrMessage").className = "admin-message";
});
$("#savePaymentQr").addEventListener("click", () => paymentQrMutation());
$("#removePaymentQr").addEventListener("click", () => {
  if (window.confirm("Remove the current payment QR code? Visitors will no longer see it.")) paymentQrMutation(true);
});

$("#newTeamButton").addEventListener("click", () => {
  const form = $("#teamForm");
  if (!cancelForm(form)) return;
  form.reset();
  setFormValues(form, {id: crypto.randomUUID(), name: "", color: "#d2aa42", tagline: "", players: ""});
  $("#teamFormTitle").textContent = "Add team";
  form.hidden = false;
  form.elements.name.focus();
});

$("#adminTeamList").addEventListener("click", async event => {
  const edit = event.target.closest("[data-edit-team]");
  const remove = event.target.closest("[data-delete-team]");
  if (edit) {
    const team = teamById(edit.dataset.editTeam);
    if (!team) return;
    const form = $("#teamForm");
    if (!cancelForm(form)) return;
    setFormValues(form, {...team, players: team.players.join("\n")});
    $("#teamFormTitle").textContent = `Edit ${team.name}`;
    form.hidden = false;
    form.elements.name.focus();
  }
  if (remove) {
    const team = teamById(remove.dataset.deleteTeam);
    if (!team || !window.confirm(`Remove ${team.name}? Teams with match history cannot be deleted.`)) return;
    await adminMutation("team", {operation: "delete", id: team.id}, "Team removed.");
  }
});

$("#teamForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const values = Object.fromEntries(new FormData(form).entries());
  const saved = await adminMutation("team", {
    ...values,
    players: values.players.split(/\r?\n/).map(name => name.trim()).filter(Boolean)
  }, "Team saved.");
  if (saved) {
    form.dataset.dirty = "false";
    form.hidden = true;
  }
});

$("#newMatchButton").addEventListener("click", () => {
  const form = $("#matchForm");
  if (!cancelForm(form)) return;
  form.reset();
  renderMatchTeamSelectors();
  setFormValues(form, {
    id: crypto.randomUUID(),
    team_a_id: "",
    team_b_id: "",
    status: "scheduled",
    match_date: state.settings?.event_date || "",
    match_time: "",
    referee: "",
    score_a: "",
    score_b: ""
  });
  $("#matchFormTitle").textContent = "Add match";
  form.hidden = false;
  form.elements.team_a_id.focus();
});

$("#adminMatchList").addEventListener("click", async event => {
  const edit = event.target.closest("[data-edit-match]");
  const remove = event.target.closest("[data-delete-match]");
  if (edit) {
    const match = state.matches.find(item => item.id === edit.dataset.editMatch);
    if (!match) return;
    const form = $("#matchForm");
    if (!cancelForm(form)) return;
    setFormValues(form, match);
    $("#matchFormTitle").textContent = `Edit match ${match.match_number}`;
    form.hidden = false;
    form.elements.team_a_id.focus();
  }
  if (remove) {
    const match = state.matches.find(item => item.id === remove.dataset.deleteMatch);
    if (!match || !window.confirm(`Delete match ${match.match_number} and its recorded score? This cannot be undone.`)) return;
    await adminMutation("match", {operation: "delete", id: match.id}, "Match removed.");
  }
});

$("#matchForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const values = Object.fromEntries(new FormData(form).entries());
  if (values.team_a_id === values.team_b_id) {
    adminMessage("A team cannot play against itself.", "error");
    return;
  }
  const saved = await adminMutation("match", values, "Match saved. Standings recalculated.");
  if (saved) {
    form.dataset.dirty = "false";
    form.hidden = true;
  }
});

$("#matchSearch").addEventListener("input", event => {
  state.search = event.target.value;
  renderMatches();
});
$("#resultFilter").addEventListener("change", event => {
  state.filter = event.target.value;
  renderMatches();
});
$("#followForm").addEventListener("submit", event => {
  event.preventDefault();
  const selection = $("#followSelect").value;
  if (!selection) {
    toast("Choose a team or player first.");
    return;
  }
  state.follow = selection;
  localStorage.setItem("vv-follow", selection);
  $("#followMessage").textContent = `Following ${$("#followSelect").selectedOptions[0].textContent} — matching matches are highlighted.`;
  renderMatches();
  renderTeams();
  toast("Your follow preference was saved on this device.");
});
$("#teamsGrid").addEventListener("click", event => {
  const button = event.target.closest("[data-follow-team]");
  if (!button) return;
  state.follow = button.dataset.followTeam;
  localStorage.setItem("vv-follow", state.follow);
  $("#followSelect").value = state.follow;
  $("#followMessage").textContent = `Following ${teamById(state.follow)?.name || ""} — matching matches are highlighted.`;
  renderMatches();
  renderTeams();
});
$("#themeToggle").addEventListener("click", () => {
  document.body.classList.toggle("light");
  localStorage.setItem("vv-theme", document.body.classList.contains("light") ? "light" : "dark");
});
if (localStorage.getItem("vv-theme") === "light") document.body.classList.add("light");
$("#payFee").addEventListener("click", () => $("#payDialog").showModal());
$("#shareResults").addEventListener("click", async () => {
  const text = `${state.settings?.club_name || "Club"} — Final standings\n${ranking().map((row, index) => `${index + 1}. ${row.team.name} (${row.won}–${row.lost})`).join("\n")}`;
  if (navigator.share) {
    try {
      await navigator.share({title: `${state.settings?.club_name || "Club"} Final Results`, text});
    } catch (error) {
      if (error.name !== "AbortError") toast("Could not share results.");
    }
  } else if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      toast("Final results copied to clipboard.");
    } catch {
      toast("Clipboard access was denied.");
    }
  } else {
    toast("Use your browser’s print option to save results.");
  }
});
$("#popOut").addEventListener("click", () => {
  const match = [...state.matches].sort((a, b) => b.match_number - a.match_number)[0];
  if (!match) {
    toast("Add a match before opening the featured score.");
    return;
  }
  const teamA = teamById(match.team_a_id);
  const teamB = teamById(match.team_b_id);
  const popup = window.open("", "Afterhours Volleyball Club result", "width=680,height=500");
  if (!popup) {
    toast("Allow pop-ups to open the match result.");
    return;
  }
  popup.document.write(`<title>${escapeHtml(state.settings?.club_name || "Club")} — Featured Result</title><body style="background:#0c0d0f;color:#f3f4f5;font:16px Arial;padding:40px;text-align:center"><h2>${escapeHtml(state.settings?.club_name || "Club")} · MATCH ${match.match_number}</h2><div style="font-size:70px;font-weight:bold;margin:45px">${escapeHtml(teamA?.name)} ${match.score_a ?? "—"} — ${match.score_b ?? "—"} ${escapeHtml(teamB?.name)}</div><p>${escapeHtml($("#matchCaption").textContent)}</p></body>`);
  popup.document.close();
});
$("#fullscreen").addEventListener("click", async () => {
  try {
    if (!document.fullscreenElement) await $(".featured-match").requestFullscreen();
    else await document.exitFullscreen();
  } catch {
    toast("Full screen is not available in this browser.");
  }
});
$("#resetData").addEventListener("click", () => {
  localStorage.removeItem("vv-follow");
  localStorage.removeItem("vv-theme");
  state.follow = "";
  state.filter = "all";
  state.search = "";
  document.body.classList.remove("light");
  $("#matchSearch").value = "";
  $("#followSelect").value = "";
  $("#followMessage").textContent = "";
  renderSelectors();
  renderMatches();
  renderTeams();
  toast("Local preferences reset.");
});
$$(".tab").forEach(button => button.addEventListener("click", () => {
  state.tab = button.dataset.tab;
  $$(".tab").forEach(tab => tab.classList.toggle("active", tab === button));
  $$(".view").forEach(view => view.classList.toggle("active", view.id === `${state.tab}View`));
  if (state.tab === "standings") renderStandings();
  if (state.tab === "teams") renderTeams();
  window.scrollTo({top: $(".tabs").offsetTop - 10, behavior: "smooth"});
}));
$$("[data-tab]").filter(button => !button.classList.contains("tab")).forEach(button => button.addEventListener("click", () => {
  const target = $(`.tab[data-tab="${button.dataset.tab}"]`);
  if (target) target.click();
}));

loadPublicData();
setInterval(() => {
  if (!document.hidden && state.dataLoaded && !$$(".admin-dashboard form").some(formHasChanges)) loadPublicData();
}, 45000);
