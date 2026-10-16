(() => {
  const feed = document.getElementById("feed");
  const updatedEl = document.getElementById("updated");
  const errorEl = document.getElementById("error");
  const statsEl = document.getElementById("stats");
  const themeToggle = document.getElementById("themeToggle");

  const THEME_KEY = "hn-digest-theme";

  function preferredTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
  }

  applyTheme(preferredTheme());
  themeToggle.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(next);
  });

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function timeAgo(ts) {
    if (!ts) return "never";
    const sec = Math.max(0, Math.floor((Date.now() / 1000) - ts));
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} min ago`;
    const hr = Math.floor(min / 60);
    if (hr < 48) return `${hr} hr ago`;
    const days = Math.floor(hr / 24);
    return `${days}d ago`;
  }

  function updatedLabel(ms) {
    if (!ms) return "Waiting for first refresh…";
    const min = Math.floor((Date.now() - ms) / 60000);
    if (min <= 0) return "Updated just now";
    if (min === 1) return "Updated 1 min ago";
    if (min < 60) return `Updated ${min} min ago`;
    const hr = Math.floor(min / 60);
    return `Updated ${hr} hr ago`;
  }

  function hnItemUrl(id) {
    return `https://news.ycombinator.com/item?id=${id}`;
  }

  function renderCard(story) {
    const href = story.url || hnItemUrl(story.id);
    const domain = story.domain
      ? `<span class="domain">${escapeHtml(story.domain)}</span>`
      : story.url
        ? ""
        : `<span class="domain">news.ycombinator.com</span>`;

    let summaryHtml;
    if (story.summaryStatus === "ready" && story.summary) {
      const bullets = Array.isArray(story.bullets) ? story.bullets.filter(Boolean) : [];
      const bulletsHtml = bullets.length
        ? `<ul class="digest-points">${bullets
            .map((b) => `<li>${escapeHtml(b)}</li>`)
            .join("")}</ul>`
        : "";
      summaryHtml = `<div class="digest"><p class="takeaway">${escapeHtml(story.summary)}</p>${bulletsHtml}</div>`;
    } else if (story.summaryStatus === "unavailable") {
      summaryHtml = `<p class="summary unavailable">Summary unavailable</p>`;
    } else {
      summaryHtml = `<p class="summary pending">Generating summary…</p>`;
    }

    return `<li class="card">
      <div class="rank">${story.rank}</div>
      <div class="card-body">
        <div class="title-row">
          <h2 class="title"><a href="${escapeHtml(href)}" rel="noopener noreferrer" target="_blank">${escapeHtml(story.title)}</a></h2>
          ${domain}
        </div>
        <p class="meta">
          <span>${story.points} points</span>
          <span class="dot"><a href="${hnItemUrl(story.id)}" target="_blank" rel="noopener">${story.commentCount} comments</a></span>
          <span class="dot">by ${escapeHtml(story.author)}</span>
          <span class="dot">${timeAgo(story.time)}</span>
        </p>
        ${summaryHtml}
      </div>
    </li>`;
  }

  function renderStats(stories) {
    const ready = stories.filter((s) => s.summaryStatus === "ready").length;
    const pending = stories.filter((s) => s.summaryStatus === "pending").length;
    const unavailable = stories.filter((s) => s.summaryStatus === "unavailable").length;
    document.getElementById("statReady").textContent = `${ready} summarized`;
    document.getElementById("statPending").textContent = `${pending} pending`;
    document.getElementById("statUnavailable").textContent = `${unavailable} unavailable`;
    statsEl.hidden = stories.length === 0;
  }

  let pollTimer = null;

  function schedulePoll(ms) {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(load, ms);
  }

  async function load() {
    try {
      const res = await fetch("/api/stories", {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data = await res.json();
      errorEl.hidden = true;
      updatedEl.textContent = updatedLabel(data.updatedAt);
      const stories = data.stories || [];
      if (!stories.length) {
        feed.innerHTML = `<li class="card"><div class="rank">…</div><div class="card-body"><p class="summary pending">Fetching the front page for the first time. Refresh in a moment.</p></div></li>`;
        feed.setAttribute("aria-busy", "false");
        schedulePoll(4000);
        return;
      }
      feed.innerHTML = stories.map(renderCard).join("");
      feed.setAttribute("aria-busy", "false");
      renderStats(stories);

      const pending = stories.some((s) => s.summaryStatus === "pending");
      // Page visits also kick a background refresh; poll often while digests catch up
      schedulePoll(pending ? 8000 : 5 * 60 * 1000);
    } catch (err) {
      errorEl.hidden = false;
      errorEl.textContent = `Could not load stories: ${err.message || err}`;
      updatedEl.textContent = "Update failed";
      feed.setAttribute("aria-busy", "false");
      schedulePoll(15000);
    }
  }

  load();
})();
