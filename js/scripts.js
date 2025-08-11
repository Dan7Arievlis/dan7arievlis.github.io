/* ====== Config ====== */
const GH_USERNAME = (window.PORTFOLIO_CONFIG && window.PORTFOLIO_CONFIG.username) || "Dan7Arievlis";
const PER_PAGE = (window.PORTFOLIO_CONFIG && window.PORTFOLIO_CONFIG.perPage) || 100;

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

  const pills = [
    ...lang.map(l => `<span class="pill lang" title="Linguagem principal">${l}</span>`),
    ...topics.map(t => `<span class="pill">#${t}</span>`),
    `<span class="pill" title="Última atualização">Atualizado: ${fmtDate(repo.updated_at)}</span>`
  ].join("");

  // card clicável: data-href com URL do repo
  cardspecs = `
    <article class="card clickable" role="link" tabindex="0"
             aria-label="Abrir repositório ${repo.name} no GitHub"
             data-href="${repo.html_url}">
      <h3 class="title">${repo.name}</h3>
      <p class="desc">${desc}</p>

      <div class="meta">
        <div class="pills">${pills}</div>
        <div class="star" title="Stars">
          ⭐ <strong>${repo.stargazers_count || 0}</strong>
        </div>
      </div>

      <!--<div class="actions">
        <a class="link" href="${repo.html_url}" target="_blank" rel="noopener">
          Repositório
        </a>
        ${homepage ? `<a class="link" href="${homepage}" target="_blank" rel="noopener">Demo</a>` : ""}
      </div>-->
    </article>
  `
  return cardspecs;
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
