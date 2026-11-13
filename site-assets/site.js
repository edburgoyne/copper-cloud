/* Shared, dependency-free interactions for the assembled static site. */
document.documentElement.classList.add("js");

const menuButton = document.querySelector(".menu-toggle");
const navigation = document.querySelector("#site-nav");
if (menuButton && navigation) {
  function setMenu(open) {
    menuButton.setAttribute("aria-expanded", String(open));
    navigation.classList.toggle("is-open", open);
  }
  menuButton.addEventListener("click", () => setMenu(menuButton.getAttribute("aria-expanded") !== "true"));
  navigation.addEventListener("click", (event) => {
    if (event.target.closest("a")) setMenu(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menuButton.getAttribute("aria-expanded") === "true") {
      setMenu(false);
      menuButton.focus();
    }
  });
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function createGameCard(game) {
  const card = element("article", "game-card");
  const coverLink = element("a", "cover-link");
  coverLink.href = game.page_url;
  coverLink.setAttribute("aria-label", `View ${game.title}`);
  const cover = element("img", "game-cover");
  cover.src = game.thumbnail || "./site-assets/game-placeholder.svg";
  cover.alt = game.thumbnail_alt || "";
  cover.loading = "lazy";
  cover.addEventListener("error", () => {
    cover.src = "./site-assets/game-placeholder.svg";
    cover.alt = "";
  }, { once: true });
  coverLink.append(cover);

  const info = element("div", "game-info");
  const meta = element("div", "game-meta");
  meta.append(element("span", "", game.category));
  if (game.featured) meta.append(element("span", "", "Featured ✦"));
  const title = element("h3", "game-title", game.title);
  const description = element("p", "game-description", game.description);
  const link = element("a", "text-link", "Play game ");
  link.href = game.page_url;
  const arrow = element("span", "", "↗");
  arrow.setAttribute("aria-hidden", "true");
  link.append(arrow);
  info.append(meta, title, description, link);
  card.append(coverLink, info);
  return card;
}

async function loadGames() {
  const response = await fetch("./games.json", { cache: "no-cache" });
  if (!response.ok) throw new Error(`Game list request failed (${response.status})`);
  const games = await response.json();
  if (!Array.isArray(games)) throw new Error("Game list has an invalid format");
  return games;
}

function renderCards(grid, games, status, emptyMessage) {
  grid.replaceChildren(...games.map(createGameCard));
  status.hidden = games.length > 0;
  status.textContent = games.length ? "" : emptyMessage;
}

function initHome(games) {
  const featured = games.filter((game) => game.featured);
  renderCards(document.querySelector("#featured-grid"), featured, document.querySelector("#featured-status"), "Featured games are coming soon. Explore the library in the meantime.");
  const otherGames = games.filter((game) => !game.featured);
  renderCards(document.querySelector("#discover-grid"), (otherGames.length ? otherGames : games).slice(0, 3), document.querySelector("#discover-status"), "Games are coming soon. Check back for new adventures.");
}

function initLibrary(games) {
  const search = document.querySelector("#game-search");
  const category = document.querySelector("#game-category");
  const grid = document.querySelector("#library-grid");
  const message = document.querySelector("#library-message");
  const count = document.querySelector("#library-count");
  const categories = [...new Set(games.map((game) => game.category))].sort((a, b) => a.localeCompare(b));
  categories.forEach((name) => {
    const option = element("option", "", name);
    option.value = name;
    category.append(option);
  });
  function update() {
    const query = search.value.trim().toLocaleLowerCase();
    const matches = games.filter((game) => {
      const searchable = [game.title, game.description, game.category, game.creator].join(" ").toLocaleLowerCase();
      return (!category.value || game.category === category.value) && searchable.includes(query);
    });
    grid.replaceChildren(...matches.map(createGameCard));
    count.textContent = `${matches.length} ${matches.length === 1 ? "game" : "games"}`;
    message.hidden = matches.length > 0;
    message.textContent = games.length ? "No games match those filters. Try another search or category." : "There are no games in the arcade yet. Check back soon!";
  }
  search.addEventListener("input", update);
  category.addEventListener("change", update);
  update();
}

function initPlay(games) {
  const gameId = new URLSearchParams(window.location.search).get("game");
  const game = games.find((entry) => entry.id === gameId);
  const status = document.querySelector("#play-status");
  if (!game) {
    status.textContent = "We couldn't find that game in the arcade. Return to Games to explore what's available.";
    return;
  }

  document.title = `${game.title} — Copper Cloud`;
  document.querySelector("#play-title").textContent = game.title;
  document.querySelector("#play-category").textContent = `${game.category} / THE ARCADE`;
  document.querySelector("#play-creator").textContent = game.creator;
  document.querySelector("#play-description").textContent = game.description;
  document.querySelector("#play-controls").replaceChildren(...game.controls.map((control) => element("li", "", control)));
  document.querySelector("#direct-game-link").href = game.url;

  const frame = document.querySelector("#game-frame");
  frame.title = `${game.title} game`;
  frame.style.aspectRatio = `${game.aspect_ratio[0]} / ${game.aspect_ratio[1]}`;
  frame.src = game.url;
  document.querySelector("#restart-game").addEventListener("click", () => {
    frame.src = game.url;
    const actionStatus = document.querySelector("#game-action-status");
    actionStatus.hidden = false;
    actionStatus.textContent = "Game restarted. Click inside the game to play.";
  });
  const fullscreen = document.querySelector("#fullscreen-game");
  if (!document.fullscreenEnabled || !frame.requestFullscreen) {
    fullscreen.hidden = true;
  } else {
    fullscreen.addEventListener("click", async () => {
      try {
        await frame.requestFullscreen();
        frame.focus();
      } catch (error) {
        const actionStatus = document.querySelector("#game-action-status");
        actionStatus.hidden = false;
        actionStatus.textContent = "Fullscreen could not be opened. You can still play in the game window.";
        console.error("Could not open fullscreen:", error);
      }
    });
  }
  const recommendations = games.filter((entry) => entry.id !== game.id).slice(0, 3);
  renderCards(document.querySelector("#recommendations"), recommendations, document.querySelector("#recommendations-status"), "More games are on their way. Explore the library for the latest additions.");
  status.hidden = true;
  document.querySelector("#play-content").hidden = false;
}

const page = document.body.dataset.page;
if (["home", "games", "play"].includes(page)) {
  loadGames().then((games) => {
    if (page === "home") initHome(games);
    if (page === "games") initLibrary(games);
    if (page === "play") initPlay(games);
  }).catch((error) => {
    console.error("Could not load Copper Cloud games:", error);
    if (page === "home") {
      for (const selector of ["#featured-status", "#discover-status"]) {
        document.querySelector(selector).textContent = "The game list could not be loaded. Please try again later.";
      }
    } else if (page === "games") {
      document.querySelector("#library-count").textContent = "Games unavailable";
      const message = document.querySelector("#library-message");
      message.hidden = false;
      message.textContent = "The game list could not be loaded. Please try again later.";
    } else {
      document.querySelector("#play-status").textContent = "The game list could not be loaded. Please try again later.";
    }
  });
}
