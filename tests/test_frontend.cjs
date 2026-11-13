// Run with: node tests/test_frontend.cjs
// Uses a small DOM harness so registry interactions can be checked without dependencies.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../site-assets/site.js"), "utf8");
const games = [
  { id: "dino", title: "Dino Runner", category: "Arcade", description: "Jump over cacti", creator: "Cloud", controls: ["Space: jump"], aspect_ratio: [800, 400], featured: true, thumbnail: "./dino.svg", thumbnail_alt: "A dinosaur", page_url: "./play.html?game=dino", url: "./games/live_games/dino/" },
  { id: "battle", title: "Battle Royale", category: "Action", description: "Survive the storm", creator: "Cloud", controls: ["WASD: move"], aspect_ratio: [900, 600], featured: false, thumbnail: "./battle.svg", thumbnail_alt: "An arena", page_url: "./play.html?game=battle", url: "./games/live_games/battle/" },
];

class FakeElement {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.style = {};
    this.hidden = false;
    this.value = "";
    this.textContent = "";
    const classes = new Set();
    this.classList = {
      add: (name) => classes.add(name),
      toggle: (name, force) => force ? classes.add(name) : classes.delete(name),
      contains: (name) => classes.has(name),
    };
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(type, callback) { (this.listeners[type] ??= []).push(callback); }
  dispatch(type, details = {}) { for (const callback of this.listeners[type] ?? []) callback({ target: this, ...details }); }
  focus() { this.focused = true; }
}

async function setup(page, options = {}) {
  const nodes = new Map();
  const node = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, new FakeElement());
    return nodes.get(selector);
  };
  const document = {
    documentElement: new FakeElement("html"),
    body: { dataset: { page } },
    title: "",
    fullscreenEnabled: true,
    querySelector: node,
    createElement: (tag) => new FakeElement(tag),
    addEventListener: (...args) => node("document").addEventListener(...args),
  };
  node(".menu-toggle").setAttribute("aria-expanded", "false");
  const frame = node("#game-frame");
  frame.requestFullscreen = async () => { document.fullscreenElement = frame; };
  const errors = [];
  const context = {
    document,
    window: { location: { search: options.search ?? "" } },
    URLSearchParams,
    console: { error: (...args) => errors.push(args) },
    fetch: async (url, fetchOptions) => {
      assert.equal(url, "./games.json");
      assert.equal(fetchOptions.cache, "no-cache");
      if (options.fail) return { ok: false, status: 503 };
      return { ok: true, json: async () => options.games ?? games };
    },
  };
  vm.runInNewContext(source, context);
  await new Promise(setImmediate);
  return { node, document, errors };
}

test("homepage shows featured entries and a discovery selection from the registry", async () => {
  const { node } = await setup("home");
  const featured = node("#featured-grid").children;
  const discovered = node("#discover-grid").children;
  assert.equal(featured.length, 1);
  assert.equal(featured[0].children[0].href, "./play.html?game=dino");
  assert.equal(discovered.length, 1);
  assert.equal(discovered[0].children[0].href, "./play.html?game=battle");
  assert.equal(node("#featured-status").hidden, true);
  const cover = featured[0].children[0].children[0];
  cover.dispatch("error");
  assert.equal(cover.src, "./site-assets/game-placeholder.svg");
  assert.equal(cover.alt, "");
});

test("library searches, combines category filters, and explains empty results", async () => {
  const { node } = await setup("games");
  assert.equal(node("#library-count").textContent, "2 games");
  assert.deepEqual(node("#game-category").children.map((option) => option.value), ["Action", "Arcade"]);
  node("#game-search").value = "STORM";
  node("#game-search").dispatch("input");
  assert.equal(node("#library-count").textContent, "1 game");
  assert.equal(node("#library-grid").children[0].children[0].href, "./play.html?game=battle");
  node("#game-category").value = "Arcade";
  node("#game-category").dispatch("change");
  assert.equal(node("#library-count").textContent, "0 games");
  assert.equal(node("#library-message").hidden, false);
  assert.match(node("#library-message").textContent, /No games match/);
  node("#game-search").value = "";
  node("#game-search").dispatch("input");
  assert.equal(node("#library-grid").children[0].children[0].href, "./play.html?game=dino");
});

test("player uses registry metadata, reloads its frame, and requests fullscreen", async () => {
  const { node, document } = await setup("play", { search: "?game=battle" });
  const frame = node("#game-frame");
  assert.equal(node("#play-title").textContent, "Battle Royale");
  assert.equal(node("#play-creator").textContent, "Cloud");
  assert.equal(node("#play-controls").children[0].textContent, "WASD: move");
  assert.equal(frame.src, "./games/live_games/battle/");
  assert.equal(frame.style.aspectRatio, "900 / 600");
  assert.equal(node("#recommendations").children[0].children[0].href, "./play.html?game=dino");
  frame.src = "changed";
  node("#restart-game").dispatch("click");
  assert.equal(frame.src, "./games/live_games/battle/");
  assert.match(node("#game-action-status").textContent, /restarted/i);
  node("#fullscreen-game").dispatch("click");
  await new Promise(setImmediate);
  assert.equal(document.fullscreenElement, frame);
  assert.equal(frame.focused, true);
});

test("unknown games and registry failures produce useful states", async () => {
  const missing = await setup("play", { search: "?game=missing" });
  assert.match(missing.node("#play-status").textContent, /couldn't find/);
  const failed = await setup("games", { fail: true });
  assert.equal(failed.node("#library-count").textContent, "Games unavailable");
  assert.match(failed.node("#library-message").textContent, /could not be loaded/);
  assert.equal(failed.errors.length, 1);
});

test("compact navigation exposes and closes its menu", async () => {
  const { node } = await setup("about");
  const toggle = node(".menu-toggle");
  toggle.dispatch("click");
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.equal(node("#site-nav").classList.contains("is-open"), true);
  node("document").dispatch("keydown", { key: "Escape" });
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(toggle.focused, true);
});
