/* ====== Config ====== */
const GH_USERNAME = (window.PORTFOLIO_CONFIG && window.PORTFOLIO_CONFIG.username) || "Dan7Arievlis";
const PER_PAGE = (window.PORTFOLIO_CONFIG && window.PORTFOLIO_CONFIG.perPage) || 9;

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

/* ====== Template ====== */
function repoCardTemplate(repo) {
  const desc = repo.description ? repo.description : "Sem descrição.";
  const homepage = repo.homepage && repo.homepage.trim() ? repo.homepage.trim() : null;
  const lang = repo.language ? [repo.language] : [];
  const topics = (repo.topics || []).slice(0, 4);
  // supondo langs = ["JavaScript","HTML","CSS"]
    const colors = langs.map(getLangColor).filter(Boolean);
    const stripe = colors.length
    ? `linear-gradient(180deg, ${colors.map((c,i)=>`${c} ${Math.round(i*100/colors.length)}% ${Math.round((i+1)*100/colors.length)}%`).join(", ")})`
    : null;
    const styleStripe = stripe ? `--lang-color:${stripe};` : (langColor ? `--lang-color:${langColor};` : "");
    // …e use style="${styleStripe}"

  const pills = [
    ...lang.map(l => `<span class="pill lang" title="Linguagem principal">${l}</span>`),
    ...topics.map(t => `<span class="pill">#${t}</span>`),
    `<span class="pill" title="Última atualização">Atualizado: ${fmtDate(repo.updated_at)}</span>`
  ].join("");

  // card clicável: data-href com URL do repo
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

      <!-- <div class="actions">
        <a class="link" href="${repo.html_url}" target="_blank" rel="noopener">
          Repositório
        </a>
        ${homepage ? `<a class="link" href="${homepage}" target="_blank" rel="noopener">Demo</a>` : ""}
      </div>  -->
    </article>
  `;
}

/* ====== Fetch + Build ====== */
async function loadRepos(){
  const grid = el("#repo-grid");
  const empty = el("#empty");
  const error = el("#error");

  grid.setAttribute("aria-busy","true");
  empty.classList.add("hidden");
  error.classList.add("hidden");

  try{
    const res = await fetch(`https://api.github.com/users/${GH_USERNAME}/repos?per_page=${PER_PAGE}&sort=updated`, {
      headers: {
        "Accept":"application/vnd.github+json",
        "X-GitHub-Api-Version":"2022-11-28"
      }
    });

    if(!res.ok){
      // Mostra erro claro (rate limit é comum)
      const text = await res.text().catch(() => "");
      throw new Error(`GitHub API status ${res.status}. ${text}`);
    }

    let repos = await res.json();

    // Ordena por updated inicialmente
    repos.sort(sorters.updated);

    // depois de "repos.sort(sorters.updated);"
    const LIMIT_LANG = 3;

    async function fetchTopLangs(repo){
    try{
        const r = await fetch(repo.languages_url);
        if (!r.ok) return [];
        const data = await r.json();
        return Object.entries(data).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([n])=>n);
    }catch{ return []; }
    }

    const enriched = await Promise.all(repos.map(async (repo, i) => {
    const langs = (i < LIMIT_LANG) ? await fetchTopLangs(repo) : (repo.language ? [repo.language] : []);
    return { repo, langs };
    }));

    // e adapte o template para aceitar {repo, langs}

    // Render
    grid.innerHTML = repos.map(repoCardTemplate).join("");
    grid.setAttribute("aria-busy","false");

    // Interações
    setupControls(repos);
    makeCardsClickable();
    updateEmptyState();
  }catch(e){
    console.error(e);
    grid.innerHTML = "";               // remove skeletons
    error.textContent = "Não foi possível carregar os repositórios agora (possível limite de requisições da API). Atualize a página em alguns minutos.";
    error.classList.remove("hidden");
    grid.setAttribute("aria-busy","false");
  }
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

    grid.innerHTML = filtered.map(repoCardTemplate).join("");
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
      if (url) window.location.href = url; // redireciona na mesma aba
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
