/* ====== Config ====== */
const DEFAULT_USERNAME = (window.PORTFOLIO_CONFIG && window.PORTFOLIO_CONFIG.username) || "Dan7Arievlis";
const GH_USERNAME  = new URLSearchParams(location.search).get("user")?.trim() || DEFAULT_USERNAME;
const PAGE_SIZE = (window.PORTFOLIO_CONFIG && (window.PORTFOLIO_CONFIG.pageSize || window.PORTFOLIO_CONFIG.perPage)) || 12; //quantos por página (UI)
const GH_PER_PAGE  = 100; // quantos baixar da API do GitHub (máx 100 por request)

/* ====== Estado para paginação ====== */
let TOTAL_PUBLIC_REPOS = null;

let ALL_REPOS = [];
let FILTERED_REPOS = [];
let CURRENT_PAGE = 1;

/* Cores por linguagem (baseadas no GitHub Linguist + ajustes p/ dark UI) */
const LANGUAGE_COLORS = {
  "Java": "#b07219",
  "Python": "#3572A5",
  "JavaScript": "#f1e05a",
  "TypeScript": "#3178c6",
  "HTML": "#e34c26",
  "CSS": "#563d7c",
  "Shell": "#89e051",
  "Dockerfile": "#384d54",
  "Go": "#00ADD8",
  "Rust": "#dea584",
  "C": "#555555",
  "C++": "#f34b7d",
  "C#": "#178600",
  "PHP": "#4F5D95",
  "Ruby": "#701516",
  "Kotlin": "#A97BFF",
  "Swift": "#F05138",
  "Haskell": "#5e5086",
  "Scala": "#c22d40",
  "R": "#198CE7",
  "Dart": "#00B4AB",
  "Elixir": "#6e4a7e",
  "Perl": "#0298c3",
  "Objective-C": "#438eff",
  "TeX": "#3D6117",
  "Jupyter Notebook": "#DA5B0B",
  "Google Apps Script": "#00acc1",
  "SQL": "#e38c00",
  "PLpgSQL": "#336790",
  "TSQL": "#205b9f",
  "Vim Script": "#199f4b",
  "Makefile": "#427819",
  "GDScript": "#478cbf",
  // fallbacks p/ nomes não mapeados:
  "SCSS": "#c6538c", "Sass": "#a53b70", "Vue": "#41B883", "Lua": "#000080"
};

const TECH_BADGES_LIMIT = 24; // limite total de badges (somando linguagens + tópicos)

function extractTechFromRepos(repos){
  const langCount = new Map();
  const topicCount = new Map();

  for (const r of (repos||[])){
    const L = (r.language || "").trim();
    if (L) langCount.set(L, (langCount.get(L) || 0) + 1);

    const topics = Array.isArray(r.topics) ? r.topics : [];
    for (const t of topics){
      const T = String(t).trim().toLowerCase();
      if (T) topicCount.set(T, (topicCount.get(T) || 0) + 1);
    }
  }

  const langs = [...langCount.entries()]
    .sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0], "pt-BR"))
    .map(([name]) => name);

  const topics = [...topicCount.entries()]
    .sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0], "pt-BR"))
    .map(([name]) => name);

  // corta pelo limite total (prioriza linguagens)
  const langsCut = langs.slice(0, TECH_BADGES_LIMIT);
  const rest = Math.max(0, TECH_BADGES_LIMIT - langsCut.length);
  const topicsCut = topics.slice(0, rest);

  return { langs: langsCut, topics: topicsCut };
}

function renderTopTechBadgesForOtherUser(repos){
  const wrap = document.getElementById("tech-badges");
  const ulLangs = document.querySelector(".tech-langs");
  const ulTopics = document.querySelector(".tech-topics");
  const topicsGroup = document.querySelector(".tech-topics-group");
  if (!wrap || !ulLangs || !ulTopics || !topicsGroup) return;

  const { langs, topics } = extractTechFromRepos(repos);

  // linguagens (substitui sua lista manual quando for outro usuário)
  ulLangs.innerHTML = langs.map(l => `<li class="badge" data-type="lang">${l}</li>`).join("");

  // tópicos
  ulTopics.innerHTML = topics.map(t => `<li class="badge" data-type="topic">#${t}</li>`).join("");

  // some com a linha de "Tópicos" se não houver itens
  topicsGroup.style.display = topics.length ? "" : "none";

  colorizeTopBadges(); // pinta cores só para linguagens
}


/* Atualiza as tecnologias do topo:
   - Dono padrão: mantém a lista manual (só colore).
   - Outro usuário: gera a partir dos repositórios e esconde o bloco se não houver tópicos. */
function maybeUpdateTopTechBadges(repos){
  const topicsGroup = document.querySelector(".tech-topics-group");
  if (GH_USERNAME === DEFAULT_USERNAME){
    // você: mantém lista manual, esconde "Tópicos" se estiver vazia
    if (topicsGroup){
      const hasTopics = !!document.querySelector(".tech-topics li");
      topicsGroup.style.display = hasTopics ? "" : "none";
    }
    colorizeTopBadges();
  } else {
    renderTopTechBadgesForOtherUser(repos);
  }
}


function getLangColor(name){
  if (!name) return null;
  return LANGUAGE_COLORS[name] || null;
}

/* ====== Helpers ====== */
const el = sel => document.querySelector(sel);
const fmtDate = iso => new Date(iso).toLocaleDateString("pt-BR", { year:"numeric", month:"short", day:"2-digit" });
const sorters = {
  updated: (a,b) => new Date(b.updated_at) - new Date(a.updated_at),
  stars: (a,b) => (b.stargazers_count||0) - (a.stargazers_count||0),
  name: (a,b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity:"base" })
};

// === Cache simples em localStorage (30 min) ===
const CACHE_KEY = `gh-repos:${GH_USERNAME}`;
const CACHE_TTL_MS = 30 * 60 * 1000;

function cacheGet(key){
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL_MS) return null;
    return data;
  } catch { return null; }
}

function cacheSet(key, data){
  try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })); } catch {}
}

/* ====== Template ====== */
function repoCardTemplate(repo) {
  const desc = repo.description ? repo.description : "Sem descrição.";
  const homepage = repo.homepage && repo.homepage.trim() ? repo.homepage.trim() : null;

  const langMain  = repo.language || null;
  const langColor = getLangColor(langMain) || null;
  const topics    = (repo.topics || []).slice(0, 4);

  const pillsTop = [
    ...(langMain ? [`<span class="pill lang" title="Linguagem principal">${langMain}</span>`] : []),
    ...topics.map(t => `<span class="pill">#${t}</span>`)
  ].join("");

  const styleStripe = langColor ? `--lang-color:${langColor};` : "";

  return `
    <article class="card clickable" role="link" tabindex="0"
             aria-label="Abrir repositório ${repo.name} no GitHub"
             data-href="${repo.html_url}"
             data-lang="${langMain || ''}"
             style="${styleStripe}">
      <h3 class="title">${repo.name}</h3>
      <p class="desc">${desc}</p>

      <div class="meta">
        <div class="pills">${pillsTop}</div>
        <div class="meta-bottom">
          <span class="pill updated" title="Última atualização">Atualizado: ${fmtDate(repo.updated_at)}</span>
          <span class="star" title="Stars">⭐ <strong>${repo.stargazers_count || 0}</strong></span>
        </div>
      </div>
    </article>
  `;
}

function updateRepoCounter(){
  const elCounter = document.getElementById("repo-counter");
  if (!elCounter) return;

  const totalFiltered = FILTERED_REPOS?.length || 0;
  const totalPublic   = (TOTAL_PUBLIC_REPOS ?? totalFiltered);

  let start = 0, end = 0;
  if (totalFiltered > 0){
    start = (CURRENT_PAGE - 1) * PAGE_SIZE + 1;
    end   = Math.min(CURRENT_PAGE * PAGE_SIZE, totalFiltered);
  }

  // “quais” estão na página atual = range start–end
  const rangeTxt = totalFiltered ? `${start}–${end} de ${totalFiltered}` : `0 de 0`;
  // total públicos do perfil (pode ser maior que o filtrado/carregado)
  const totalTxt = (totalPublic !== totalFiltered) ? ` • Total públicos: ${totalPublic}` : "";

  elCounter.textContent = `Exibindo ${rangeTxt}${totalTxt}`;
}

// === Carrega e renderiza repositórios (1 request) ===
async function loadRepos(){
  const grid  = document.querySelector("#repo-grid");
  const empty = document.querySelector("#empty");
  const error = document.querySelector("#error");

  grid.setAttribute("aria-busy","true");
  empty.classList.add("hidden");
  error.classList.add("hidden");

  // 1) tenta cache para render imediato
  const cached = cacheGet(CACHE_KEY);
  if (cached) {
    renderRepos(cached);
    grid.setAttribute("aria-busy","false");
  }

  // 2) busca online (atualiza UI; se falhar e não havia cache, mostra erro)
  try{
    const url = `https://api.github.com/users/${GH_USERNAME}/repos?per_page=${GH_PER_PAGE}&sort=updated`;
    const res = await fetch(url, {
      headers: {
        "Accept":"application/vnd.github+json",
        "X-GitHub-Api-Version":"2022-11-28"
      },
      cache: "no-store"
    });

    if (!res.ok) {
      // trata casos comuns com mensagem melhor
      const remaining = res.headers.get("X-RateLimit-Remaining");
      const reset = res.headers.get("X-RateLimit-Reset");
      const status = res.status;

      if (status === 403 && remaining === "0" && reset) {
        const waitMs = (+reset * 1000) - Date.now();
        const mins = Math.max(1, Math.ceil(waitMs / 60000));
        throw new Error(`Limite de requisições da API do GitHub atingido. Tente novamente em ~${mins} min.`);
      }
      if (status === 404) throw new Error(`Usuário "${GH_USERNAME}" não encontrado.`);
      if (!navigator.onLine) throw new Error(`Você está offline. Verifique a conexão e tente novamente.`);

      const text = await res.text().catch(()=>"");
      throw new Error(`Falha ao carregar: HTTP ${status}. ${text}`);
    }

    const repos = await res.json();
    repos.sort((a,b) => new Date(b.updated_at) - new Date(a.updated_at));
    cacheSet(CACHE_KEY, repos);
    renderRepos(repos);
    grid.setAttribute("aria-busy","false");
  } catch (e){
    console.error(e);
    if (!cached) {
      grid.innerHTML = ""; // remove skeletons
      error.textContent = e.message || "Não foi possível carregar os repositórios agora.";
      error.classList.remove("hidden");
      grid.setAttribute("aria-busy","false");
    }
  }
}

// === Render + interação (reaproveita seu template/card clicável) ===
// === Render principal: configura estado e mostra a página 1 ===
function renderRepos(repos){
  ALL_REPOS = repos || [];
  FILTERED_REPOS = ALL_REPOS;
  maybeUpdateTopTechBadges(ALL_REPOS);
  CURRENT_PAGE = 1;

  ensurePagerContainers();    // cria #pager-top e #pager-bottom se não existirem
  renderPage(1, { scroll:false });
  setupControls(ALL_REPOS);   // mantém busca/ordenar
}

/* === Cria contêineres de pager (topo e base) uma única vez === */
function ensurePagerContainers(){
  const grid = document.querySelector("#repo-grid");
  if (!document.getElementById("pager-top")){
    const top = document.createElement("nav");
    top.id = "pager-top";
    top.className = "pager";
    top.setAttribute("role","navigation");
    top.setAttribute("aria-label","Paginação (topo)");
    grid.insertAdjacentElement("beforebegin", top);
  }
  if (!document.getElementById("pager-bottom")){
    const bottom = document.createElement("nav");
    bottom.id = "pager-bottom";
    bottom.className = "pager";
    bottom.setAttribute("role","navigation");
    bottom.setAttribute("aria-label","Paginação (base)");
    grid.insertAdjacentElement("afterend", bottom);
  }
}

/* === Renderiza ambos os pagers === */
function renderPagers(totalPages){
  renderPagerFor("pager-top", totalPages);
  renderPagerFor("pager-bottom", totalPages);
}

/* === HTML do pager + eventos === */
function renderPagerFor(containerId, totalPages){
  const pager = document.getElementById(containerId);
  if (!pager) return;

  if (totalPages <= 1){
    pager.innerHTML = "";
    pager.hidden = true;
    return;
  }
  pager.hidden = false;

  const btn = (label, opts={}) => {
    const { disabled=false, page=null, current=false } = opts;
    return `<button class="pager-btn${current?' is-current':''}" ${disabled?'disabled':''} ${page?`data-page="${page}"`:''} ${current?'aria-current="page"':''}>${label}</button>`;
  };

  const windowSize = 5;
  const startWin = Math.max(1, CURRENT_PAGE - 2);
  const endWin = Math.min(totalPages, startWin + windowSize - 1);
  const realStart = Math.max(1, Math.min(startWin, totalPages - windowSize + 1));

  let html = "";
  html += btn("‹", { disabled: CURRENT_PAGE===1, page: CURRENT_PAGE-1 });

  if (realStart > 1){
    html += btn(1, { page: 1 });
    if (realStart > 2) html += `<span class="pager-ellipsis">…</span>`;
  }

  for (let p = realStart; p <= endWin; p++){
    html += btn(p, { page: p, current: p===CURRENT_PAGE });
  }

  if (endWin < totalPages){
    if (endWin < totalPages - 1) html += `<span class="pager-ellipsis">…</span>`;
    html += btn(totalPages, { page: totalPages });
  }

  html += btn("›", { disabled: CURRENT_PAGE===totalPages, page: CURRENT_PAGE+1 });
  pager.innerHTML = html;

  // eventos (delegação)
  pager.onclick = (e) => {
    const b = e.target.closest(".pager-btn");
    if (!b || b.disabled) return;
    const page = parseInt(b.dataset.page, 10);
    if (!isNaN(page)) renderPage(page, { scroll:true });
  };
}

/* === Contador "Exibindo X–Y de Z • Total públicos: N" === */
function updateRepoCounter(){
  const elCounter = document.getElementById("repo-counter");
  if (!elCounter) return;

  const totalFiltered = FILTERED_REPOS?.length || 0;
  const totalPublic   = (TOTAL_PUBLIC_REPOS ?? totalFiltered);

  let start = 0, end = 0;
  if (totalFiltered > 0){
    start = (CURRENT_PAGE - 1) * PAGE_SIZE + 1;
    end   = Math.min(CURRENT_PAGE * PAGE_SIZE, totalFiltered);
  }

  const rangeTxt = totalFiltered ? `${start}–${end} de ${totalFiltered}` : `0 de 0`;
  const totalTxt = (totalPublic !== totalFiltered) ? ` • Total públicos: ${totalPublic}` : "";

  elCounter.textContent = `Exibindo ${rangeTxt}${totalTxt}`;
}

/* === Scroll para o início da lista (considera header fixo) === */
function scrollToReposStart(){
  const section = document.getElementById("repos") || document.querySelector(".repos");
  const header  = document.querySelector(".site-header");
  const headerH = header ? header.offsetHeight : 0;
  if (!section) return;
  const y = section.getBoundingClientRect().top + window.pageYOffset - (headerH + 12);
  window.scrollTo({ top: y, behavior: "smooth" });
}

// === Render de uma página específica (aplica slice) ===
function renderPage(page = 1, opts = { scroll:false }){
  const grid = document.querySelector("#repo-grid");
  const totalPages = Math.max(1, Math.ceil(FILTERED_REPOS.length / PAGE_SIZE));
  CURRENT_PAGE = Math.min(Math.max(1, page), totalPages);

  const start = (CURRENT_PAGE - 1) * PAGE_SIZE;
  const items = FILTERED_REPOS.slice(start, start + PAGE_SIZE);

  grid.innerHTML = items.map(repoCardTemplate).join("");
  makeCardsClickable();
  updateEmptyState();

  renderPagers(totalPages);   // atualiza topo e base
  updateRepoCounter();        // "Exibindo X–Y de Z • Total públicos: N"

  if (opts.scroll) scrollToReposStart();
}

// === Pager (Prev • 1 … n • Next) ===
function renderPager(totalPages){
  const grid = document.querySelector("#repo-grid");
  let pager = document.getElementById("pager");
  if (!pager){
    pager = document.createElement("nav");
    pager.id = "pager";
    pager.className = "pager";
    pager.setAttribute("role","navigation");
    pager.setAttribute("aria-label","Paginação");
    grid.insertAdjacentElement("afterend", pager);
  }

  if (totalPages <= 1){
    pager.innerHTML = "";
    pager.hidden = true;
    return;
  }
  pager.hidden = false;

  // helper para montar botões
  const btn = (label, opts={}) => {
    const { disabled=false, page=null, current=false } = opts;
    return `<button class="pager-btn${current?' is-current':''}" ${disabled?'disabled':''} ${page?`data-page="${page}"`:''} ${current?'aria-current="page"':''}>${label}</button>`;
  };

  // intervalo “inteligente” (mostra no máx 7 botões numéricos)
  const windowSize = 5;
  const start = Math.max(1, CURRENT_PAGE - 2);
  const end = Math.min(totalPages, start + windowSize - 1);
  const realStart = Math.max(1, Math.min(start, totalPages - windowSize + 1));

  let html = "";
  html += btn("‹", { disabled: CURRENT_PAGE===1, page: CURRENT_PAGE-1 });

  if (realStart > 1){
    html += btn(1, { page: 1 });
    if (realStart > 2) html += `<span class="pager-ellipsis">…</span>`;
  }

  for (let p = realStart; p <= end; p++){
    html += btn(p, { page: p, current: p===CURRENT_PAGE });
  }

  if (end < totalPages){
    if (end < totalPages - 1) html += `<span class="pager-ellipsis">…</span>`;
    html += btn(totalPages, { page: totalPages });
  }

  html += btn("›", { disabled: CURRENT_PAGE===totalPages, page: CURRENT_PAGE+1 });
  pager.innerHTML = html;

  // eventos (delegação)
  pager.onclick = (e) => {
    const b = e.target.closest(".pager-btn");
    if (!b || b.disabled) return;
    const page = parseInt(b.dataset.page, 10);
    if (!isNaN(page)) renderPage(page);
  };
}

/* ====== Controles (busca + sort) ====== */
function setupControls(repos){
  const grid = el("#repo-grid");
  const search = el("#search");
  const sort = el("#sort");

  function apply(){
    const q = (search?.value || "").toLowerCase().trim();
    const sorted = [...repos].sort(sorters[sort?.value || "updated"]);
    const filtered = q
      ? sorted.filter((repo) => {
          const hay = [
            repo.name || "",
            repo.description || "",
            (repo.topics||[]).join(" "),
            repo.language || ""
          ].join(" ").toLowerCase();
          return hay.includes(q);
        })
      : sorted;

        FILTERED_REPOS = filtered;
        renderPage(1, { scroll:true });   // volta ao topo da lista ao mudar filtro/ordem
    }

    makeCardsClickable();
    updateEmptyState();

  search?.addEventListener("input", apply);
  sort?.addEventListener("change", apply);
}

/* ====== Card clicável (abre o repo) ====== */
function makeCardsClickable(){
  const grid = el("#repo-grid");
  if (!grid) return;

  grid.querySelectorAll(".card.clickable").forEach(card => {
    // evitar múltiplos binds
    if (card.dataset.bound === "1") return;
    card.dataset.bound = "1";

    function go(){
      const url = card.getAttribute("data-href");
      if (url) window.open(url, "_blank", "noopener"); // redireciona em abas diferentes
    }

    card.addEventListener("click", (e) => {
      // se clicou em um link interno, deixa o link agir
      if (e.target.closest("a")) return;
      go();
    });

    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault(); go();
      }
    });
  });
}

function colorizeTopBadges(){
  document.querySelectorAll(".tech-badges .badge").forEach(b => {
    const type = b.dataset.type || "";               // "lang" | "topic" | ""
    const raw  = (b.textContent || "").trim();
    const name = raw.startsWith("#") ? raw.slice(1) : raw;

    let color = null;
    if (type === "lang" || type === "") {
      color = getLangColor(name);
    }
    if (color){
      b.style.setProperty("--badge-color", color);
    } else {
      b.style.removeProperty("--badge-color"); // cai no accent
    }
  });
}

/* ====== Util ====== */
function updateEmptyState(){
  const empty = el("#empty");
  const hasCards = !!document.querySelector(".repo-grid .card");
  empty?.classList.toggle("hidden", hasCards);
}

/* ====== Bootstrap ====== */
(function bootstrap(){
  const yearEl = el("#year"); if (yearEl) yearEl.textContent = new Date().getFullYear();
  const userEl = el("#username"); if (userEl) userEl.textContent = GH_USERNAME;
  colorizeTopBadges();
  loadRepos();
  loadAvatar();
})();

function updateHeaderFromProfile(data){
  const login = (data && data.login) || GH_USERNAME;
  const displayName = (data && data.name) || login;
  const htmlUrl = `https://github.com/${login}`;

  // Nome e @username no topo
  const nameEl = document.querySelector(".identity .name");
  if (nameEl) nameEl.textContent = displayName;
  const userEl = document.getElementById("username");
  if (userEl) userEl.textContent = login;

  // Links do topo (avatar e botão GitHub)
  const avatarWrap = document.getElementById("avatar-wrap");
  if (avatarWrap) avatarWrap.href = htmlUrl;
  const ghLink = document.getElementById("github-link") || document.querySelector('.links a[href^="https://github.com/"]');
  if (ghLink) ghLink.href = htmlUrl;

  // Alt da foto
  const img = document.getElementById("avatar");
  if (img) img.alt = `Foto de perfil de ${displayName}`;

  // ---- Título da página e meta description ----
  document.title = `${displayName} • Portfólio`;

  // garante a existência da meta description e atualiza o conteúdo
  let metaDesc = document.querySelector('meta[name="description"]');
  if (!metaDesc) {
    metaDesc = document.createElement("meta");
    metaDesc.setAttribute("name", "description");
    document.head.appendChild(metaDesc);
  }
  metaDesc.setAttribute(
    "content",
    `Portfólio e repositórios públicos de ${displayName} (@${login}).`
  );
}

async function loadAvatar(){
  const wrap = document.getElementById("avatar-wrap");
  const img  = document.getElementById("avatar");
  if (!wrap || !img) return;

  // helper para setar a imagem e marcar como carregada
  const trySet = (url) => new Promise(resolve => {
    img.onload  = () => { wrap.classList.add("is-loaded"); resolve(true); };
    img.onerror = () => resolve(false);
    img.src = url;
  });

  // 1) busca o perfil no GitHub
  try{
    const res = await fetch(`https://api.github.com/users/${GH_USERNAME}`, {
      headers:{ "Accept":"application/vnd.github+json", "X-GitHub-Api-Version":"2022-11-28" }
    });
    if (!res.ok) throw new Error("user fetch failed");
    const data = await res.json();

    // contador: total de públicos
    TOTAL_PUBLIC_REPOS = typeof data.public_repos === "number" ? data.public_repos : null;
    updateRepoCounter();

    // atualiza topo (nome, @, links, alt da foto)
    updateHeaderFromProfile(data);

    // define o avatar (com param de tamanho; respeita caso já tenha ?)
    const base = data.avatar_url || "";
    const url  = base ? `${base}${base.includes("?") ? "&" : "?"}s=120` : "";
    if (url) await trySet(url);

  }catch(e){
    console.debug("Falha ao buscar perfil; mantendo fallback.", e);
    // Mesmo com erro, atualiza topo pelo login bruto
    updateHeaderFromProfile({ login: GH_USERNAME });
  }
}

