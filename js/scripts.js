/* ====== Config ====== */
const GH_USERNAME  = (window.PORTFOLIO_CONFIG && window.PORTFOLIO_CONFIG.username) || "Dan7Arievlis";
const PAGE_SIZE    = (window.PORTFOLIO_CONFIG && (window.PORTFOLIO_CONFIG.pageSize || window.PORTFOLIO_CONFIG.perPage)) || 12; // quantos por página (UI)
const GH_PER_PAGE  = 100; // quantos baixar da API do GitHub (máx 100 por request)

/* ====== Estado para paginação ====== */
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
  // fallbacks p/ nomes não mapeados:
  "SCSS": "#c6538c", "Sass": "#a53b70", "Vue": "#41B883", "Lua": "#000080"
};

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

  const langMain  = repo.language || null;                    // linguagem principal
  const langColor = getLangColor(langMain) || null;           // cor (se mapeada)
  const topics    = (repo.topics || []).slice(0, 4);

  const pills = [
    ...(langMain ? [`<span class="pill lang" title="Linguagem principal">${langMain}</span>`] : []),
    ...topics.map(t => `<span class="pill">#${t}</span>`),
    `<span class="pill" title="Última atualização">Atualizado: ${fmtDate(repo.updated_at)}</span>`
  ].join("");

  // define a variável CSS --lang-color para pintar a faixa do card (topo)
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
        <div class="pills">${pills}</div>
        <div class="star" title="Stars">
          ⭐ <strong>${repo.stargazers_count || 0}</strong>
        </div>
      </div>

      <!-- Se quiser botões, reative o bloco abaixo -->
      <!--
      <div class="actions">
        <a class="link" href="${repo.html_url}" target="_blank" rel="noopener">Repositório</a>
        ${homepage ? `<a class="link" href="${homepage}" target="_blank" rel="noopener">Demo</a>` : ""}
      </div>
      -->
    </article>
  `;
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
  CURRENT_PAGE = 1;
  renderPage(CURRENT_PAGE);
  setupControls(ALL_REPOS); // mantém sua busca/ordenar
}

// === Render de uma página específica (aplica slice) ===
function renderPage(page = 1){
  const grid = document.querySelector("#repo-grid");
  const totalPages = Math.max(1, Math.ceil(FILTERED_REPOS.length / PAGE_SIZE));
  CURRENT_PAGE = Math.min(Math.max(1, page), totalPages);

  const start = (CURRENT_PAGE - 1) * PAGE_SIZE;
  const items = FILTERED_REPOS.slice(start, start + PAGE_SIZE);

  grid.innerHTML = items.map(repoCardTemplate).join("");
  makeCardsClickable();
  updateEmptyState();
  renderPager(totalPages);
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

    FILTERED_REPOS = filtered;   // atualiza lista visível
    renderPage(1);               // volta para a primeira página

    makeCardsClickable();
    updateEmptyState();
  }

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
  loadRepos();
  loadAvatar();
})();


async function loadAvatar(){
  const wrap = document.getElementById("avatar-wrap");
  const img  = document.getElementById("avatar");
  if (!wrap || !img) return;

  // 1) tenta usar imagem local (assets/profile.jpg)
  const localSrc = "assets/profile.jpg"; // coloque seu arquivo aqui
  let done = false;

  function markLoaded(){
    wrap.classList.add("is-loaded");
    done = true;
  }

  // tenta local primeiro
  await new Promise((resolve) => {
    img.onload = () => { markLoaded(); resolve(); };
    img.onerror = () => resolve(); // se falhar, tenta GitHub
    img.src = localSrc;
  });

  if (done) return;

  // 2) fallback: busca avatar do GitHub pela API
  try{
    const res = await fetch(`https://api.github.com/users/${GH_USERNAME}`, {
      headers:{ "Accept":"application/vnd.github+json", "X-GitHub-Api-Version":"2022-11-28" }
    });
    if (!res.ok) throw new Error("user fetch failed");
    const data = await res.json();
    // dica: pedir tamanho ajuda (parâmetro s=) — opcional
    const url = data.avatar_url ? `${data.avatar_url}&s=120` : null;
    if (url){
      await new Promise((resolve)=> {
        img.onload = () => { markLoaded(); resolve(); };
        img.onerror = () => resolve();
        img.src = url;
      });
    }
  }catch(e){
    // se tudo falhar, mantém as iniciais "DN"
    console.debug("Avatar: usando fallback de iniciais");
  }
}
