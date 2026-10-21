// Recetario para 2 — lógica de la web.
// Modo local: sin config de Supabase, usa recetas.js y guarda favoritas en el navegador.
// Modo cuentas: con config, recetas/favoritas/comentarios/fotos viven en Supabase.

const CFG = window.RECETARIO_CONFIG || {};
const sb = (CFG.url && CFG.anonKey && window.supabase) ? window.supabase.createClient(CFG.url, CFG.anonKey) : null;
const BUCKET = "fotos";

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const store = {
  get(k, d){ try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
};

let R = RECETAS.slice();
let user = null, profile = null;
let favs = new Set(store.get("rec-favs", []));
let filter = "todas";
let current = null;          // id de la receta abierta
let screen = "home";         // home | recipe | editor
const canPrint = !/claude\.ai|claudeusercontent/.test(location.hostname);

// ---------- utilidades ----------
function norm(s){ return String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,""); }
function slug(s){ return norm(s).replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,60) || "receta"; }
function toast(msg){ const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2600); }
function photoUrl(path){ if(!path || !sb) return ""; return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl; }
function when(iso){
  const d = new Date(iso), diff = (Date.now() - d) / 1000;
  if(diff < 60) return "ahora";
  if(diff < 3600) return `hace ${Math.floor(diff/60)} min`;
  if(diff < 86400) return `hace ${Math.floor(diff/3600)} h`;
  return d.toLocaleDateString("es-ES", {day:"numeric", month:"short", year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined});
}
function fromRow(r){
  return {id:r.id, cat:r.cat, t:r.title, time:r.time, lvl:r.lvl, light:r.light, blurb:r.blurb,
    ing:r.ing || [], steps:r.steps || [], tip:r.tip, link:r.link, src:r.src, photo:r.photo_path, pos:r.pos};
}
function toRow(r){
  return {id:r.id, cat:r.cat, title:r.t, time:r.time, lvl:r.lvl, light:!!r.light, blurb:r.blurb || "",
    ing:r.ing, steps:r.steps, tip:r.tip || null, link:r.link || null, src:r.src || null, photo_path:r.photo || null};
}
function matches(r, q){
  if(!q) return true;
  const hay = norm([r.t, r.blurb, ...r.ing.flatMap(g => g.items)].join(" "));
  return norm(q).split(/\s+/).every(w => hay.includes(w));
}

// ---------- datos ----------
async function loadRecipes(){
  if(!sb) return;
  const { data, error } = await sb.from("recipes").select("*").order("pos", {ascending:true}).order("created_at", {ascending:true});
  if(error){ console.warn(error); $("#mode").textContent = "Sin conexión con la base de datos: mostrando la copia local."; return; }
  if(data.length) R = data.map(fromRow);
}
async function loadFavs(){
  if(sb && user){
    const { data, error } = await sb.from("favorites").select("recipe_id");
    if(!error) favs = new Set(data.map(d => d.recipe_id));
  } else {
    favs = new Set(store.get("rec-favs", []));
  }
}
async function toggleFav(id){
  const on = !favs.has(id);
  on ? favs.add(id) : favs.delete(id);
  if(sb && user){
    const q = on ? sb.from("favorites").insert({recipe_id:id}) : sb.from("favorites").delete().eq("recipe_id", id);
    const { error } = await q;
    if(error){ on ? favs.delete(id) : favs.add(id); toast("No se pudo guardar la favorita"); }
  } else {
    store.set("rec-favs", [...favs]);
  }
  return favs.has(id);
}

// ---------- cuenta ----------
function renderAcct(){
  const a = $("#acct");
  if(!sb){ a.innerHTML = ""; $("#addbar").hidden = true; return; }
  if(user){
    const n = (profile?.name || user.email || "?").trim();
    a.innerHTML = `<button class="avatar" type="button" id="avatar" aria-label="Cuenta de ${esc(n)}">${esc(n[0].toUpperCase())}</button>`;
    $("#avatar").onclick = () => toggleMenu();
    $("#addbar").hidden = false;
  } else {
    a.innerHTML = `<button class="btn" type="button" id="loginBtn">Entrar</button>`;
    $("#loginBtn").onclick = openLogin;
    $("#addbar").hidden = true;
  }
}
function toggleMenu(force){
  const m = $("#menu");
  const show = force ?? m.hidden;
  if(!show){ m.hidden = true; return; }
  m.innerHTML = `<p>${esc(profile?.name || "")}<br>${esc(user?.email || "")}</p>
    <button type="button" id="mFavs">★ Mis favoritas</button>
    <button type="button" id="mName">Cambiar mi nombre</button>
    <button type="button" id="mOut">Cerrar sesión</button>`;
  m.hidden = false;
  $("#mFavs").onclick = () => { toggleMenu(false); filter = "favoritas"; goHome(); };
  $("#mName").onclick = () => { toggleMenu(false); askName(true); };
  $("#mOut").onclick = async () => { toggleMenu(false); await sb.auth.signOut(); toast("Sesión cerrada"); };
}
document.addEventListener("click", e => { if(!$("#menu").hidden && !e.target.closest("#menu,#avatar")) toggleMenu(false); });

function modal(html){ $("#modal").innerHTML = html ? `<div class="overlay">${html}</div>` : ""; }

function openLogin(){
  modal(`<form class="sheet" id="loginForm">
    <h2>Entrar</h2>
    <p>Con tu email y contraseña del recetario.</p>
    <label class="field" for="lEmail"><span>Email</span><input id="lEmail" type="email" autocomplete="username" required></label>
    <label class="field" for="lPass"><span>Contraseña</span><input id="lPass" type="password" autocomplete="current-password" required></label>
    <p class="err" id="lErr" hidden></p>
    <div class="actions"><button class="btn ghost" type="button" id="lCancel">Cancelar</button><button class="btn primary" type="submit" id="lGo">Entrar</button></div>
  </form>`);
  $("#lEmail").focus();
  $("#lCancel").onclick = () => modal("");
  $("#loginForm").onsubmit = async e => {
    e.preventDefault();
    $("#lGo").disabled = true; $("#lErr").hidden = true;
    const { error } = await sb.auth.signInWithPassword({ email: $("#lEmail").value.trim(), password: $("#lPass").value });
    $("#lGo").disabled = false;
    if(error){
      $("#lErr").textContent = /invalid/i.test(error.message) ? "Email o contraseña incorrectos." : "No se pudo entrar: " + error.message;
      $("#lErr").hidden = false;
    } else modal("");
  };
}

function askName(editing){
  modal(`<form class="sheet" id="nameForm">
    <h2>${editing ? "Tu nombre" : "¿Cómo te llamas?"}</h2>
    <p>Es el nombre que aparecerá en tus comentarios.</p>
    <label class="field" for="nName"><span>Nombre</span><input id="nName" maxlength="30" required value="${esc(profile?.name || "")}"></label>
    <p class="err" id="nErr" hidden></p>
    <div class="actions">${editing ? '<button class="btn ghost" type="button" id="nCancel">Cancelar</button>' : ""}<button class="btn primary" type="submit">Guardar</button></div>
  </form>`);
  $("#nName").focus();
  if(editing) $("#nCancel").onclick = () => modal("");
  $("#nameForm").onsubmit = async e => {
    e.preventDefault();
    const name = $("#nName").value.trim();
    const { data, error } = await sb.from("profiles").upsert({ id: user.id, name }).select().single();
    if(error){ $("#nErr").textContent = "No se pudo guardar el nombre."; $("#nErr").hidden = false; return; }
    profile = data; modal(""); renderAcct(); toast("Nombre guardado");
  };
}

async function onSession(session){
  user = session?.user || null;
  profile = null;
  if(user){
    const { data } = await sb.from("profiles").select("*").eq("id", user.id).maybeSingle();
    profile = data;
    if(!profile) askName(false);
  }
  await loadFavs();
  renderAcct();
  refresh();
}

// ---------- listado ----------
function renderChips(){
  const counts = {todas:R.length, favoritas:favs.size, ligeras:R.filter(r=>r.light).length, maite:R.filter(r=>r.src && /maiterodon/.test(r.src)).length};
  for(const r of R) counts[r.cat] = (counts[r.cat]||0)+1;
  const opts = [["todas","Todas"], ...Object.entries(CATS).map(([k,v]) => [k, v.name]), ["ligeras","Ligeras"], ["maite","De Maite Rodón"], ["favoritas", user ? "★ Mis favoritas" : "★ Favoritas"]];
  $("#chips").innerHTML = opts.map(([k,n]) =>
    `<button class="chip" type="button" data-f="${k}" aria-pressed="${filter===k}">${n}<span class="n">${counts[k]||0}</span></button>`).join("");
}
function card(r){
  const img = photoUrl(r.photo);
  return `<button class="card${img?" has-photo":""}" type="button" data-id="${esc(r.id)}">
    ${img?`<div class="thumb"><img src="${esc(img)}" alt="" loading="lazy"></div>`:""}
    <h3>${esc(r.t)}</h3><p>${esc(r.blurb)}</p>
    <div class="meta"><span class="tag">${esc(r.time)}</span><span class="tag lvl">${esc(r.lvl)}</span>${r.light?'<span class="tag lite">Ligera</span>':""}${r.src && /maiterodon/.test(r.src)?'<span class="tag src">Maite Rodón</span>':""}${favs.has(r.id)?'<span class="fav" aria-label="Favorita">★</span>':""}</div>
  </button>`;
}
function renderList(){
  const q = $("#q").value.trim();
  const special = ["todas","favoritas","ligeras","maite"].includes(filter);
  const cats = special ? Object.keys(CATS) : [filter];
  const pass = r => filter==="favoritas" ? favs.has(r.id) : filter==="ligeras" ? !!r.light : filter==="maite" ? !!(r.src && /maiterodon/.test(r.src)) : true;
  let html = "";
  for(const c of cats){
    const items = R.filter(r => r.cat===c && matches(r,q) && pass(r));
    if(!items.length) continue;
    html += `<section class="section"><h2>${CATS[c].name} <small>${items.length}</small></h2><p class="lede">${CATS[c].lede}</p><div class="grid">${items.map(card).join("")}</div></section>`;
  }
  if(!html) html = filter==="favoritas" && !q
    ? `<p class="empty">Aún no hay favoritas. Abre una receta y márcala con la estrella.</p>`
    : `<p class="empty">Nada coincide con “${esc(q)}”. Prueba con un ingrediente, como “yogur” o “pollo”.</p>`;
  $("#list").innerHTML = html;
  $("#pantrySec").hidden = !!q || filter!=="todas";
  $("#count").textContent = `${R.filter(r=>r.cat!=="salsas").length} recetas y ${R.filter(r=>r.cat==="salsas").length} salsas`;
}
function renderPantry(){
  $("#pantry").innerHTML = PANTRY.map(([a,b]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join("");
}
function show(which){
  screen = which;
  $("#home").hidden = which !== "home";
  $("#view").hidden = which !== "recipe";
  $("#editor").hidden = which !== "editor";
}
function goHome(){
  current = null;
  if(location.hash) history.replaceState(null, "", location.pathname + location.search);
  show("home"); document.title = "Recetario para 2";
  renderChips(); renderList();
}
function refresh(){
  if(screen === "recipe" && current) showRecipe(current, true);
  else if(screen === "home"){ renderChips(); renderList(); }
}

// ---------- receta ----------
let wakeLock = null, wantWake = false;
async function toggleWake(btn){
  try{
    if(wakeLock){ wantWake = false; await wakeLock.release(); wakeLock = null; }
    else if("wakeLock" in navigator){ wantWake = true; wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => { wakeLock = null; syncWake(); }); }
    else { btn.textContent = "No disponible en este navegador"; return; }
  }catch(e){ wakeLock = null; btn.textContent = "No se pudo mantener la pantalla"; return; }
  syncWake();
}
function syncWake(){
  const b = $("#wake"); if(!b) return;
  b.setAttribute("aria-pressed", !!wakeLock);
  b.textContent = wakeLock ? "Pantalla encendida" : "Mantener pantalla encendida";
}

function showRecipe(id, keepScroll){
  const r = R.find(x => x.id===id);
  if(!r){ goHome(); return; }
  current = id;
  const checked = new Set(store.get("rec-check-"+r.id, []));
  const link = r.link ? R.find(x => x.id===r.link) : null;
  const img = photoUrl(r.photo);
  const srcLabel = r.src ? (/maiterodon/.test(r.src) ? "Receta original de Maite Rodón · <a href=\"" + esc(r.src) + "\" target=\"_blank\" rel=\"noopener\">verla en maiterodon.com</a>" : `Fuente: <a href="${esc(r.src)}" target="_blank" rel="noopener">${esc(r.src.replace(/^https?:\/\/(www\.)?/,"").split("/")[0])}</a>`) : "";
  let i = 0;
  $("#view").innerHTML = `<div class="recipe">
    <button class="back" type="button" id="back">← Todas las recetas</button>
    <h1>${esc(r.t)}</h1>
    ${img?`<img class="hero-photo" src="${esc(img)}" alt="${esc(r.t)}">`:""}
    <div class="meta"><span class="tag">${esc(r.time)}</span><span class="tag lvl">${esc(r.lvl)}</span><span class="tag">2 personas</span>${r.light?'<span class="tag lite">Ligera</span>':""}<span class="tag">${CATS[r.cat]?.name || ""}</span></div>
    <div class="actions">
      <button class="btn" type="button" id="favBtn" aria-pressed="${favs.has(r.id)}">${favs.has(r.id)?"★ Favorita":"☆ Añadir a favoritas"}</button>
      <button class="btn" type="button" id="wake" aria-pressed="false">Mantener pantalla encendida</button>
      ${canPrint?'<button class="btn primary" type="button" id="pdf">Exportar PDF</button>':""}
      <button class="btn" type="button" id="reset">Desmarcar todo</button>
      ${sb && user ? '<button class="btn" type="button" id="editBtn">Editar</button><button class="btn danger" type="button" id="delBtn">Borrar</button>' : ""}
    </div>
    <div id="delConfirm"></div>
    <div class="cols">
      <section class="ing"><h2>Ingredientes</h2>
        ${r.ing.map(g => `${g.label?`<h3>${esc(g.label)}</h3>`:""}<ul>${g.items.map(it => { const k=i++; return `<li><label><input type="checkbox" id="i-${esc(r.id)}-${k}" data-k="${k}" ${checked.has(k)?"checked":""}><span>${esc(it)}</span></label></li>`; }).join("")}</ul>`).join("")}
      </section>
      <section class="steps"><h2>Pasos</h2>
        <ol>${r.steps.map((s,n) => `<li data-s="${n}" class="${checked.has("s"+n)?"done":""}">${esc(s)}</li>`).join("")}</ol>
        <p class="hint">Toca un paso para marcarlo como hecho.</p>
        ${r.tip?`<div class="tip"><b>Truco.</b> ${esc(r.tip)}</div>`:""}
        ${link?`<div class="tip"><b>Va con:</b> <a href="#${esc(link.id)}" style="color:inherit">${esc(link.t)}</a></div>`:""}
        ${srcLabel?`<p class="source">${srcLabel}</p>`:""}
      </section>
    </div>
    ${sb ? `<section class="comments" id="comments"><h2>Comentarios</h2><div id="clist"><p class="status">Cargando…</p></div><div id="cbox"></div></section>` : ""}
  </div>`;
  show("recipe");
  document.title = r.t + " · Recetario para 2";
  if(!keepScroll) window.scrollTo(0,0);

  const save = () => store.set("rec-check-"+r.id, [...checked]);
  $("#view").querySelectorAll(".ing input").forEach(cb => cb.addEventListener("change", () => {
    const k = +cb.dataset.k; cb.checked ? checked.add(k) : checked.delete(k); save();
  }));
  $("#view").querySelectorAll(".steps li").forEach(li => li.addEventListener("click", () => {
    const k = "s"+li.dataset.s; li.classList.toggle("done"); li.classList.contains("done") ? checked.add(k) : checked.delete(k); save();
  }));
  $("#back").onclick = goHome;
  $("#favBtn").onclick = async e => {
    const b = e.currentTarget; b.disabled = true;
    const on = await toggleFav(r.id); b.disabled = false;
    b.setAttribute("aria-pressed", on); b.textContent = on ? "★ Favorita" : "☆ Añadir a favoritas";
  };
  $("#wake").onclick = e => toggleWake(e.currentTarget);
  $("#reset").onclick = () => { checked.clear(); save(); showRecipe(r.id, true); };
  if(canPrint) $("#pdf").onclick = () => window.print();
  if(sb && user){
    $("#editBtn").onclick = () => openEditor(r);
    $("#delBtn").onclick = () => {
      $("#delConfirm").innerHTML = `<div class="confirm"><span>¿Borrar “${esc(r.t)}” para los dos? No se puede deshacer.</span><button class="btn danger" type="button" id="delYes">Sí, borrar</button><button class="btn ghost" type="button" id="delNo">Cancelar</button></div>`;
      $("#delNo").onclick = () => $("#delConfirm").innerHTML = "";
      $("#delYes").onclick = () => deleteRecipe(r);
    };
  }
  syncWake();
  if(sb) loadComments(r.id);
}

async function deleteRecipe(r){
  const { error } = await sb.from("recipes").delete().eq("id", r.id);
  if(error){ toast("No se pudo borrar: " + error.message); return; }
  if(r.photo) await sb.storage.from(BUCKET).remove([r.photo]);
  R = R.filter(x => x.id !== r.id);
  favs.delete(r.id);
  toast("Receta borrada");
  goHome();
}

// ---------- comentarios ----------
async function loadComments(id){
  const box = $("#clist"), form = $("#cbox");
  if(!user){
    box.innerHTML = "";
    form.innerHTML = `<p class="status">Entra con tu cuenta para ver y escribir comentarios.</p>`;
    return;
  }
  const { data, error } = await sb.from("comments").select("id, body, created_at, user_id, profiles(name)").eq("recipe_id", id).order("created_at", {ascending:true});
  if(current !== id) return;
  if(error){ box.innerHTML = `<p class="status">No se pudieron cargar los comentarios.</p>`; return; }
  box.innerHTML = data.length ? data.map(c => `<div class="comment">
      <header><b>${esc(c.profiles?.name || "Alguien")}</b><span>${when(c.created_at)}</span>${c.user_id===user.id?`<button type="button" data-del="${c.id}">Borrar</button>`:""}</header>
      <p>${esc(c.body)}</p></div>`).join("")
    : `<p class="status">Aún no hay comentarios. Apunta aquí cómo os salió o qué cambiaríais.</p>`;
  box.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
    const { error } = await sb.from("comments").delete().eq("id", b.dataset.del);
    if(error) toast("No se pudo borrar el comentario"); else loadComments(id);
  });
  form.innerHTML = `<form class="cform" id="cform">
    <label class="field" for="cBody"><span>Añadir comentario</span></label>
    <textarea id="cBody" maxlength="1000" placeholder="La próxima vez, menos sal y 5 min más de horno" required></textarea>
    <div class="actions" style="margin:0"><button class="btn primary" type="submit" id="cSend">Publicar</button></div>
  </form>`;
  $("#cform").onsubmit = async e => {
    e.preventDefault();
    if(!profile){ askName(false); return; }
    const body = $("#cBody").value.trim(); if(!body) return;
    $("#cSend").disabled = true;
    const { error } = await sb.from("comments").insert({ recipe_id:id, body });
    $("#cSend").disabled = false;
    if(error){ toast("No se pudo publicar: " + error.message); return; }
    loadComments(id);
  };
}

// ---------- editor ----------
function ingToText(ing){
  return ing.map(g => (g.label ? `## ${g.label}\n` : "") + g.items.join("\n")).join("\n");
}
function textToIng(txt){
  const groups = []; let cur = null;
  for(const raw of txt.split("\n")){
    const line = raw.trim(); if(!line) continue;
    if(line.startsWith("#")){ cur = { label: line.replace(/^#+\s*/,""), items: [] }; groups.push(cur); continue; }
    if(!cur){ cur = { items: [] }; groups.push(cur); }
    cur.items.push(line.replace(/^[-•*]\s*/,""));
  }
  return groups.filter(g => g.items.length);
}
async function resizeImage(file, max = 1600){
  const url = URL.createObjectURL(file);
  try{
    const img = await new Promise((ok, ko) => { const im = new Image(); im.onload = () => ok(im); im.onerror = ko; im.src = url; });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return await new Promise(ok => c.toBlob(ok, "image/jpeg", 0.82));
  } finally { URL.revokeObjectURL(url); }
}

function openEditor(r){
  const isNew = !r;
  r = r || { cat:"diario", lvl:"Fácil", ing:[], steps:[] };
  let newPhoto = null, removePhoto = false;
  const opt = (v, cur) => `<option value="${esc(v)}" ${v===cur?"selected":""}>${esc(v)}</option>`;
  $("#editor").innerHTML = `<form class="editor" id="edForm">
    <button class="back" type="button" id="edBack">← ${isNew ? "Volver" : "Volver a la receta"}</button>
    <h1>${isNew ? "Nueva receta" : "Editar receta"}</h1>
    <label class="field" for="eTitle"><span>Nombre</span><input id="eTitle" required maxlength="90" value="${esc(r.t || "")}"></label>
    <div class="row2">
      <label class="field" for="eCat"><span>Tipo</span><select id="eCat">${Object.entries(CATS).map(([k,v]) => `<option value="${k}" ${k===r.cat?"selected":""}>${esc(v.name)}</option>`).join("")}</select></label>
      <label class="field" for="eLvl"><span>Dificultad</span><select id="eLvl">${["Fácil","Fácil-media","Media","Difícil"].map(v => opt(v, r.lvl)).join("")}</select></label>
    </div>
    <div class="row2">
      <label class="field" for="eTime"><span>Tiempo</span><input id="eTime" required placeholder="30 min" value="${esc(r.time || "")}"></label>
      <label class="check" for="eLight"><input id="eLight" type="checkbox" ${r.light?"checked":""}> Es ligera</label>
    </div>
    <label class="field" for="eBlurb"><span>Descripción corta</span><input id="eBlurb" maxlength="160" placeholder="Una frase que se ve en la tarjeta" value="${esc(r.blurb || "")}"></label>
    <div class="field"><span>Foto</span>
      <div class="photo-pick">
        <img id="ePrev" alt="" ${r.photo ? `src="${esc(photoUrl(r.photo))}"` : "hidden"}>
        <input id="ePhoto" type="file" accept="image/*">
        <button class="btn ghost" type="button" id="eNoPhoto" ${r.photo ? "" : "hidden"}>Quitar foto</button>
      </div>
    </div>
    <label class="field" for="eIng"><span>Ingredientes</span><small>Uno por línea. Para agrupar, escribe una línea que empiece por ## (por ejemplo: ## Salsa).</small>
      <textarea id="eIng" required rows="9" placeholder="2 pechugas de pollo&#10;1 cebolla&#10;## Salsa&#10;150 g de yogur griego">${esc(ingToText(r.ing))}</textarea></label>
    <label class="field" for="eSteps"><span>Pasos</span><small>Uno por línea, en orden.</small>
      <textarea id="eSteps" required rows="8">${esc(r.steps.join("\n"))}</textarea></label>
    <label class="field" for="eTip"><span>Truco (opcional)</span><input id="eTip" value="${esc(r.tip || "")}"></label>
    <label class="field" for="eSrc"><span>Enlace a la receta original (opcional)</span><input id="eSrc" type="url" placeholder="https://…" value="${esc(r.src || "")}"></label>
    <p class="err" id="eErr" hidden></p>
    <div class="actions"><button class="btn ghost" type="button" id="eCancel">Cancelar</button><button class="btn primary" type="submit" id="eSave">${isNew ? "Guardar receta" : "Guardar cambios"}</button></div>
  </form>`;
  show("editor"); window.scrollTo(0,0);
  const back = () => isNew ? goHome() : showRecipe(r.id);
  $("#edBack").onclick = back; $("#eCancel").onclick = back;
  $("#ePhoto").onchange = async e => {
    const f = e.target.files[0]; if(!f) return;
    newPhoto = await resizeImage(f).catch(() => null);
    if(!newPhoto){ toast("No se pudo leer esa imagen"); return; }
    $("#ePrev").src = URL.createObjectURL(newPhoto); $("#ePrev").hidden = false; $("#eNoPhoto").hidden = false; removePhoto = false;
  };
  $("#eNoPhoto").onclick = () => { newPhoto = null; removePhoto = true; $("#ePrev").hidden = true; $("#eNoPhoto").hidden = true; $("#ePhoto").value = ""; };
  $("#edForm").onsubmit = async e => {
    e.preventDefault();
    const err = m => { $("#eErr").textContent = m; $("#eErr").hidden = false; $("#eSave").disabled = false; };
    $("#eSave").disabled = true; $("#eErr").hidden = true;
    const ing = textToIng($("#eIng").value);
    const steps = $("#eSteps").value.split("\n").map(s => s.trim()).filter(Boolean);
    if(!ing.length) return err("Añade al menos un ingrediente.");
    if(!steps.length) return err("Añade al menos un paso.");
    const rec = { ...r,
      t: $("#eTitle").value.trim(), cat: $("#eCat").value, lvl: $("#eLvl").value, time: $("#eTime").value.trim(),
      light: $("#eLight").checked, blurb: $("#eBlurb").value.trim(), ing, steps,
      tip: $("#eTip").value.trim(), src: $("#eSrc").value.trim() };
    if(isNew){
      let id = slug(rec.t);
      if(R.some(x => x.id === id)) id += "-" + Date.now().toString(36).slice(-4);
      rec.id = id;
    }
    const oldPhoto = r.photo;
    if(newPhoto){
      const path = `${rec.id}/${Date.now()}.jpg`;
      const { error } = await sb.storage.from(BUCKET).upload(path, newPhoto, { contentType:"image/jpeg" });
      if(error) return err("No se pudo subir la foto: " + error.message);
      rec.photo = path;
    } else if(removePhoto) rec.photo = null;
    const row = toRow(rec);
    const { data, error } = isNew
      ? await sb.from("recipes").insert({ ...row, pos: 10000 }).select().single()
      : await sb.from("recipes").update(row).eq("id", rec.id).select().single();
    if(error) return err("No se pudo guardar: " + error.message);
    if(oldPhoto && oldPhoto !== rec.photo) sb.storage.from(BUCKET).remove([oldPhoto]);
    const saved = fromRow(data);
    R = isNew ? [...R, saved] : R.map(x => x.id === saved.id ? saved : x);
    toast(isNew ? "Receta guardada" : "Cambios guardados");
    location.hash = saved.id;
    showRecipe(saved.id);
  };
}

// ---------- eventos y arranque ----------
function route(){
  const id = decodeURIComponent(location.hash.slice(1));
  id ? showRecipe(id) : goHome();
}
$("#chips").addEventListener("click", e => {
  const b = e.target.closest(".chip"); if(!b) return;
  filter = b.dataset.f; renderChips(); renderList();
});
$("#list").addEventListener("click", e => {
  const c = e.target.closest(".card"); if(!c) return;
  location.hash = c.dataset.id;
});
$("#q").addEventListener("input", () => { if(screen !== "home") goHome(); else renderList(); });
$("#brand").addEventListener("click", () => { $("#q").value=""; filter="todas"; goHome(); });
$("#addBtn").addEventListener("click", () => openEditor(null));
window.addEventListener("hashchange", route);
document.addEventListener("visibilitychange", async () => {
  if(document.visibilityState==="visible" && wantWake && !wakeLock){
    try{ wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => { wakeLock = null; syncWake(); }); syncWake(); }catch(e){}
  }
});

(async function start(){
  renderPantry();
  renderAcct();
  route();
  if(!sb){ $("#mode").textContent = ""; return; }
  await loadRecipes();
  const { data } = await sb.auth.getSession();
  await onSession(data.session);
  sb.auth.onAuthStateChange((event, session) => {
    if(event === "SIGNED_IN" || event === "SIGNED_OUT") onSession(session);
  });
  route();
})();
