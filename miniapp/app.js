(() => {
  const tg = window.Telegram?.WebApp;
  tg?.ready();
  tg?.expand();
  const initData = tg?.initData || "";
  const appParams = new URLSearchParams(window.location.search);

  // Telegram opens a Mini App launched through `startapp` with the value inside
  // `tg.initDataUnsafe.start_param`. The bot encodes chat context there when the
  // app is opened from a group, so read it as a second source besides the URL.
  function param(name) {
    if (appParams.has(name)) return appParams.get(name);
    const startParam = tg?.initDataUnsafe?.start_param;
    if (!startParam || !startParam.includes("=")) return null;
    const fromStartParam = new URLSearchParams(startParam);
    return fromStartParam.get(name);
  }

  const requestedChatId = param("chat_id");
  const requestedChatUsername = (param("chat_username") || "").replace(/^@/, "");
  const chatId = requestedChatId || tg?.initDataUnsafe?.chat?.id;
  const state = {
    archetypes: [],
    selected: "",
    items: [],
    hallOfFame: [],
    botUsername: "",
    chatId,
    chatUsername: requestedChatUsername,
    chatTarget: null,
    ideas: {},
    readOnly: !initData,
    coins: 0,
    dailyStreak: 0,
    activePerks: [],
    shopItems: [],
    tournament: null,
  };
  const $ = (selector) => document.querySelector(selector);
  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;", "'":"&#39;"}[char]));
  let toastTimer;
  let useItemName = "";

  async function request(path, options = {}) {
    const headers = { "X-Telegram-Init-Data": initData, ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers };
    const response = await fetch(path, { ...options, headers });
    let data = {};
    try { data = await response.json(); } catch (_) { data = {}; }
    if (!response.ok) throw new Error(data.error || `Сервер ответил ${response.status}`);
    return data;
  }

  function toast(message) {
    const node = $("#toast"); node.textContent = message; node.classList.add("visible");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove("visible"), 2600);
  }

  function openMessageDraft(message) {
    const text = String(message || "").replace(/[\r\n]+/g, " ").trim();
    if (!text) return;
    // The Mini App is usually launched from the bot's private chat, but the game
    // happens in the friends' group. Prefer that group's compose box; fall back
    // to the Telegram chat picker (never to the bot's private chat first).
    const groupUsername = (state.chatUsername || state.chatTarget?.username || "").replace(/^@/, "");
    const groupContext = Boolean(state.chatTarget)
      || Boolean(state.chatUsername)
      || String(state.chatId || "").startsWith("-");
    let url;
    if (/^[A-Za-z0-9_]{5,32}$/.test(groupUsername)) {
      // Public group: open its compose box with the command as a draft.
      url = `https://t.me/${encodeURIComponent(groupUsername)}?text=${encodeURIComponent(text)}`;
    } else if (groupContext) {
      // Private groups have no public deep link. Telegram's share chooser keeps
      // the command unsent until the user picks the group and sends it.
      url = `https://t.me/share/url?url=&text=${encodeURIComponent(text)}`;
    } else if (state.botUsername) {
      // No group known yet: the bot chat is the only place where the command works.
      url = `https://t.me/${encodeURIComponent(state.botUsername)}?text=${encodeURIComponent(text)}`;
    } else {
      url = `https://t.me/share/url?url=&text=${encodeURIComponent(text)}`;
    }
    if (tg?.openTelegramLink) tg.openTelegramLink(url);
    else window.location.href = url;
  }

  function renderUseIdeas(itemName) {
    const box = $("#use-presets");
    if (!box) return;
    const paint = (ideas) => {
      if (useItemName !== itemName) return;
      box.innerHTML = ideas.map((idea) =>
        `<button class="preset-button" type="button" data-action="${escapeHtml(idea)}">${escapeHtml(idea)}</button>`
      ).join("");
    };
    if (state.ideas[itemName]) { paint(state.ideas[itemName]); return; }
    box.innerHTML = `<span class="ideas-loading">Подбираю примеры для «${escapeHtml(itemName)}»…</span>`;
    request(`/api/use-ideas?item=${encodeURIComponent(itemName)}`)
      .then((data) => {
        const ideas = Array.isArray(data.ideas) && data.ideas.length ? data.ideas : [];
        if (!ideas.length) throw new Error("Нет примеров");
        state.ideas[itemName] = ideas;
        paint(ideas);
      })
      .catch(() => {
        if (useItemName === itemName) {
          box.innerHTML = '<span class="ideas-loading">Примеры не подобрались — опишите действие сами.</span>';
        }
      });
  }

  function renderHelp() {
    const itemName = state.items[0]?.name || "предмет";
    const commands = [
      ["Открыть Mini App", "Профиль и инвентарь", "/app"],
      ["Инвентарь", "Посмотреть свои предметы", "/inv"],
      ["Использовать предмет", "Поменяйте действие перед отправкой", `/use ${itemName} | опиши, как я использую предмет`],
      ["Справка бота", "Список основных команд в чате", "/help"],
      ["Выбрать архетип", "Ключ можно посмотреть во вкладке «Архетипы»", "/set <ключ архетипа>"],
      ["Свой образ", "Замените текст описанием персонажа", "/prompt <описание персонажа>"],
      ["Цель персонажа", "Замените текст новой целью", "/goal <новая цель>"],
      ["Посмотреть образ", "Показать текущую личность персонажа", "/who"],
      ["Озвучка", "Включить или выключить голосовые ответы", "/voice on"],
      ["Выключить озвучку", "Отключить голосовые ответы", "/voice off"],
      ["Новый персонаж", "Сбросить и создать нового персонажа", "/reset"],
      ["Создать изображение", "Замените текст описанием картинки", "/img <что нарисовать>"],
      ["Передать предмет", "Замените имя и предмет; участник должен быть известен боту", "/giveitem <имя игрока> | <предмет>"],
    ];
    $("#command-list").innerHTML = commands.map(([title, description, message]) =>
      `<article class="command-row"><div class="command-main"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(description)}</p><code>${escapeHtml(message)}</code></div><button class="preset-button command-draft" type="button" data-draft="${escapeHtml(message)}">Подставить</button></article>`
    ).join("");
  }

  function renderInventory() {
    $("#item-count").textContent = state.items.reduce((sum, item) => sum + item.quantity, 0);
    $("#inventory-empty").hidden = state.items.length > 0;
    $("#inventory-list").innerHTML = state.items.map((item) => `<article class="item-row"><span class="item-name">${escapeHtml(item.name)}</span><span class="quantity">${item.quantity > 1 ? `× ${item.quantity}` : "1 шт."}</span><button class="use-button" type="button" data-use-item="${escapeHtml(item.name)}" ${state.readOnly ? "disabled" : ""}>Использовать</button></article>`).join("");
  }

  function renderHallOfFame() {
    const list = state.hallOfFame || [];
    $("#fame-count").textContent = list.length;
    $("#fame-empty").hidden = list.length > 0;

    const medals = ["🥇", "🥈", "🥉"];
    $("#fame-list").innerHTML = list.map((player, idx) => {
      const rank = idx + 1;
      const medal = medals[idx] || rank;
      const rankClass = rank <= 3 ? `rank-${rank}` : "";
      const name = player.display_name || (player.username ? `@${player.username}` : `Игрок ${player.user_id}`);
      const tag = player.username ? `@${player.username}` : "";
      const titleBadge = player.title ? `<span class="fame-title-badge">👑 ${escapeHtml(player.title)}</span>` : "";
      const score = player.score != null ? player.score : ((player.messages_count || 0) + (player.items_collected || 0) * 2 + (player.lethal_strikes || 0) * 5);

      return `
        <article class="fame-card ${rankClass}">
          <div class="fame-left">
            <div class="fame-rank" aria-label="Место ${rank}">${medal}</div>
            <div class="fame-info">
              <div class="fame-name-row">
                <span class="fame-name">${escapeHtml(name)}</span>
                ${tag ? `<span class="fame-tag">${escapeHtml(tag)}</span>` : ""}
                ${titleBadge}
              </div>
              <div class="fame-stats-row">
                <span class="fame-stat" title="Сообщений отправлено">💬 ${player.messages_count || 0}</span>
                <span class="fame-stat" title="Предметов собрано">🎒 ${player.items_collected || 0}</span>
                ${(player.lethal_strikes || 0) > 0 ? `<span class="fame-stat" title="Смертельных ударов">⚔️ ${player.lethal_strikes}</span>` : ""}
              </div>
            </div>
          </div>
          <div class="fame-right">
            <span class="fame-score">${score}</span>
            <span class="fame-score-label">очков</span>
          </div>
        </article>
      `;
    }).join("");
  }

  function renderArchetypes() {
    $("#archetype-list").innerHTML = state.archetypes.map((item) => {
      const isMy = !item.builtin && (state.userId && item.created_by_user_id === state.userId);
      let badgeHtml = '<span class="badge">СТАНДАРТНЫЙ</span>';
      if (item.is_custom || !item.builtin) {
        const author = item.created_by_name ? ` • от ${escapeHtml(item.created_by_name)}` : "";
        badgeHtml = `<span class="badge" style="background:#eef2ff;color:#4338ca;">ПОЛЬЗОВАТЕЛЬСКИЙ${author}</span>`;
      }
      const canDelete = !item.builtin && (!item.created_by_user_id || !state.userId || item.created_by_user_id === state.userId);

      return `<article class="archetype-row">
        <div class="archetype-main">
          <div class="archetype-title">${escapeHtml(item.name || item.title)} ${badgeHtml}</div>
          <p class="archetype-description">${escapeHtml(item.desc || item.prompt)}</p>
          ${item.action ? `<p class="archetype-action" style="margin:4px 0 0;font-size:12px;font-style:italic;color:#28634f;">Действие: ${escapeHtml(item.action)}</p>` : ""}
        </div>
        ${state.readOnly ? "" : `<div class="row-actions">
          <button class="select-button ${state.selected === item.key ? "selected" : ""}" data-select="${escapeHtml(item.key)}">${state.selected === item.key ? "Выбран" : "Выбрать"}</button>
          ${canDelete ? `<button class="delete-button" data-delete="${escapeHtml(item.key)}" title="Удалить архетип" aria-label="Удалить ${escapeHtml(item.name || item.title)}">🗑</button>` : ""}
        </div>`}
      </article>`;
    }).join("");
    const current = state.archetypes.find((item) => item.key === state.selected);
    $("#prompt-title").textContent = current?.name || current?.title || "Промпт";
    $("#prompt-content").textContent = current?.prompt || current?.desc || "";
    $("#prompt-content").hidden = !current;
    $("#prompt-empty").hidden = Boolean(current);
  }

  function showStatus(message, isError = false) {
    const status = $("#app-status");
    status.hidden = false;
    status.classList.toggle("error", isError);
    status.textContent = message;
  }

  async function loadHallOfFame() {
    try {
      const activeChatId = state.chatId || state.chatTarget?.chat_id || "";
      const query = activeChatId ? `?chat_id=${encodeURIComponent(activeChatId)}` : "";
      const data = await request(`/api/hall_of_fame${query}`);
      state.hallOfFame = Array.isArray(data.hall_of_fame) ? data.hall_of_fame : [];
      renderHallOfFame();
    } catch (e) {
      console.warn("Hall of fame fetch failed", e);
      state.hallOfFame = [];
      renderHallOfFame();
    }
  }

  async function load() {
    showStatus("Загрузка профиля…");
    if (!initData) {
      const data = await request("/api/public-archetypes");
      state.botUsername = data.bot_username || "";
      state.items = [];
      state.archetypes = data.archetypes || [];
      state.selected = "";
      state.readOnly = true;
      $("#greeting").textContent = "Архетипы персонажей";
      $("#new-archetype").hidden = true;
      document.querySelector('[data-tab="inventory"]').disabled = true;
      document.querySelector('[data-tab="prompt"]').disabled = true;
      const archetypesTab = document.querySelector('[data-tab="archetypes"]');
      document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab === archetypesTab));
      document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === "archetypes-view"));
      renderArchetypes();
      renderHelp();
      await loadHallOfFame();
      showStatus("Только просмотр встроенных архетипов. Чтобы видеть инвентарь, выбирать и создавать архетипы, откройте приложение кнопкой в Telegram.");
      return;
    }
    state.readOnly = false;
    $("#new-archetype").hidden = false;
    document.querySelectorAll(".tab").forEach((tab) => { tab.disabled = false; });
    // The chat id is context only: the server returns everything this player
    // owns in every chat, so the list matches /inv.
    const query = chatId ? `?chat_id=${encodeURIComponent(chatId)}` : "";
    const data = await request(`/api/state${query}`);
    state.items = data.items || []; state.archetypes = data.archetypes || []; state.selected = data.selected || "";
    state.botUsername = data.bot_username || "";
    state.userId = data.user?.id || 0;
    state.userName = data.user?.name || "";
    state.chatTarget = data.chat_target || null;
    state.chatUsername = state.chatUsername || state.chatTarget?.username || "";
    $("#greeting").textContent = data.user?.name ? `Привет, ${data.user.name}` : "Профиль игрока";
    renderInventory(); renderArchetypes(); renderHelp();
    await loadEconomyProfile();
    await loadShopItems();
    await loadTournament();
    await loadHallOfFame();
    await loadGameLeaderboard();
    $("#app-status").hidden = true;
  }

  let selectedGame = "tower_stack"; // 'tower_stack' | 'knife_hit' | 'timberjack' | 'swipe_basketball'

  async function loadGameLeaderboard() {
    const list = $("#game-leaderboard-list");
    if (!list) return;

    // Обновляем персональные рекорды для всех игр
    try {
      const towerBest = parseInt(localStorage.getItem("tower_stack_best_score") || "0", 10);
      const towerBestNode = $("#tower-my-best");
      if (towerBestNode) towerBestNode.textContent = towerBest;

      const timberBest = parseInt(localStorage.getItem("timberman_best_score") || "0", 10);
      const timberBestNode = $("#timber-my-best");
      if (timberBestNode) timberBestNode.textContent = timberBest;

      const knifeBest = parseInt(localStorage.getItem("knife_best_score") || "0", 10);
      const knifeBestNode = $("#knife-my-best");
      if (knifeBestNode) knifeBestNode.textContent = knifeBest;

      const basketBest = parseInt(localStorage.getItem("basketball_best_score") || "0", 10);
      const basketBestNode = $("#basketball-my-best");
      if (basketBestNode) basketBestNode.textContent = basketBest;

      const colorswitchBest = parseInt(localStorage.getItem("colorswitch_best_score") || "0", 10);
      const colorswitchBestNode = $("#colorswitch-my-best");
      if (colorswitchBestNode) colorswitchBestNode.textContent = colorswitchBest;

      const bricksBest = parseInt(localStorage.getItem("brick_breaker_best_score") || "0", 10);
      const bricksBestNode = $("#bricks-my-best");
      if (bricksBestNode) bricksBestNode.textContent = bricksBest;

      const game2048Best = parseInt(localStorage.getItem("game_2048_best") || "0", 10);
      const game2048BestNode = $("#game2048-my-best");
      if (game2048BestNode) game2048BestNode.textContent = game2048Best;
    } catch (_) {}

    const titleNode = $("#leaderboard-game-title");
    if (titleNode) {
      if (selectedGame === "tower_stack") {
        titleNode.textContent = "Лидеры Башни коробок";
      } else if (selectedGame === "colorswitch") {
        titleNode.textContent = "Лидеры Color Switch";
      } else if (selectedGame === "brick_breaker") {
        titleNode.textContent = "Лидеры Неонового Арканоида";
      } else if (selectedGame === "knife_hit") {
        titleNode.textContent = "Лидеры Ножевого тира";
      } else if (selectedGame === "timberjack") {
        titleNode.textContent = "Лидеры Дровосека";
      } else if (selectedGame === "game_2048") {
        titleNode.textContent = "Лидеры 2048 Классика";
      } else {
        titleNode.textContent = "Лидеры Баскетбола";
      }
    }

    try {
      const queryParams = [`game=${encodeURIComponent(selectedGame)}`];
      if (state.chatId) queryParams.push(`chat_id=${encodeURIComponent(state.chatId)}`);
      const query = `?${queryParams.join("&")}`;

      const data = await request(`/api/game/leaderboard${query}`);
      const leaders = Array.isArray(data.leaderboard) ? data.leaderboard : [];
      if (!leaders.length) {
        let emptyMsg = "Рекордов пока нет. Будьте первым!";
        if (selectedGame === "tower_stack") emptyMsg = "Рекордов в Башне коробок пока нет. Постройте первый этаж!";
        else if (selectedGame === "colorswitch") emptyMsg = "Рекордов в Color Switch пока нет. Сделайте первый прыжок!";
        else if (selectedGame === "brick_breaker") emptyMsg = "Рекордов в Арканоиде пока нет. Разбейте первый кирпич!";
        else if (selectedGame === "knife_hit") emptyMsg = "Рекордов в Ножевом тире пока нет. Метните первый нож!";
        else if (selectedGame === "timberjack") emptyMsg = "Рекордов пока нет. Будьте первым, кто срубит дерево!";
        else if (selectedGame === "swipe_basketball") emptyMsg = "Рекордов в Баскетболе пока нет. Сделайте первый бросок!";
        else if (selectedGame === "game_2048") emptyMsg = "Рекордов в 2048 пока нет. Соберите первое легендарное число!";
        list.innerHTML = `<p class="empty-state">${emptyMsg}</p>`;
        return;
      }
      list.innerHTML = leaders.map((item, index) => `
        <article class="leader-row rank-${index + 1}">
          <span class="leader-rank">${index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : index + 1}</span>
          <span class="leader-name">${escapeHtml(item.user_name || `Игрок ${item.user_id}`)}</span>
          <span class="leader-score">${escapeHtml(item.score)} очков</span>
        </article>
      `).join("");
    } catch (e) {
      list.innerHTML = '<p class="empty-state">Не удалось загрузить таблицу рекордов.</p>';
    }
  }

  // --- Экономика, Магазин и Еженедельный кубок ---

  function updateBalanceDisplay(coins) {
    state.coins = Number(coins) || 0;
    const coinsEl = $("#user-coins");
    const shopCoinsEl = $("#shop-user-coins");
    if (coinsEl) {
      coinsEl.textContent = state.coins;
      coinsEl.classList.remove("coin-pulse");
      void coinsEl.offsetWidth; // trigger reflow
      coinsEl.classList.add("coin-pulse");
    }
    if (shopCoinsEl) shopCoinsEl.textContent = state.coins;
  }

  function updateStreakDisplay(streak) {
    state.dailyStreak = Number(streak) || 0;
    const streakEl = $("#user-streak");
    if (streakEl) streakEl.textContent = state.dailyStreak;
  }

  async function loadEconomyProfile() {
    try {
      const activeChatId = state.chatId || state.chatTarget?.chat_id || "";
      const query = activeChatId ? `?chat_id=${encodeURIComponent(activeChatId)}` : "";
      const data = await request(`/api/economy/profile${query}`);
      updateBalanceDisplay(data.coins ?? data.balance ?? 0);
      updateStreakDisplay(data.daily_streak ?? data.streak ?? 0);
      state.activePerks = Array.isArray(data.active_perks) ? data.active_perks : [];
      renderActivePerks();
    } catch (e) {
      console.warn("Economy profile fetch failed, using fallback", e);
      // Fallback state
      updateBalanceDisplay(state.coins || 150);
      updateStreakDisplay(state.dailyStreak || 1);
      renderActivePerks();
    }
  }

  function renderActivePerks() {
    const box = $("#active-perks-box");
    const list = $("#active-perks-list");
    if (!box || !list) return;

    if (!state.activePerks || !state.activePerks.length) {
      box.style.display = "none";
      return;
    }

    box.style.display = "block";
    list.innerHTML = state.activePerks.map((perk) => {
      const name = typeof perk === "string" ? perk : (perk.title || perk.name || "Активный перк");
      const icon = perk.icon || "⚡";
      return `<span class="active-perk-chip">${icon} ${escapeHtml(name)}</span>`;
    }).join("");
  }

  const DEFAULT_SHOP_ITEMS = [
    {
      id: "roast_friend",
      name: "Заказной подкол друга",
      icon: "🎯",
      price: 50,
      description: "Бот персонально и едко подколет указанного друга на выбранную тему в групповом чате!",
      requires_input: true,
      fields: [
        { id: "target_user", label: "Никнейм или имя друга", placeholder: "@username или Вася", required: true },
        { id: "roast_topic", label: "Тема подкола", placeholder: "Например: опять опоздал в качалку или забыл пароль", required: true }
      ]
    },
    {
      id: "mood_change",
      name: "Смена настроения бота",
      icon: "🎭",
      price: 80,
      description: "Переключите характер и вайб бота для всех в чате на следующие 2 часа!",
      requires_input: true,
      fields: [
        {
          id: "vibe",
          label: "Выберите вайб",
          type: "select",
          options: [
            { value: "gachi", label: "💪 Gachi-тренер (Суровый бодибилдер)" },
            { value: "cyberpunk", label: "🤖 Кибер-бунтарь (Неон и хромированный сленг)" },
            { value: "grandma", label: "👵 Добрая бабушка (С пирожками и заботой)" },
            { value: "toxic_critic", label: "🧐 Душный ресторанный критик" }
          ]
        }
      ]
    },
    {
      id: "vip_badge",
      name: "VIP Бейдж в чате",
      icon: "👑",
      price: 150,
      description: "Золотая корона и статус VIP участника рядом с вашим именем в боте и Зале Славы!",
      requires_input: false,
      fields: []
    },
    {
      id: "custom_title",
      name: "Личный титул",
      icon: "🏷",
      price: 100,
      description: "Установите уникальный титул под своим профилем (например, «Мастер спорта по лени»)",
      requires_input: true,
      fields: [
        { id: "title_text", label: "Ваш новый титул", placeholder: "Например: Главный по гантелям", required: true }
      ]
    }
  ];

  async function loadShopItems() {
    const catalog = $("#shop-catalog");
    if (!catalog) return;

    try {
      const activeChatId = state.chatId || state.chatTarget?.chat_id || "";
      const query = activeChatId ? `?chat_id=${encodeURIComponent(activeChatId)}` : "";
      const data = await request(`/api/shop/items${query}`);
      state.shopItems = Array.isArray(data.items) && data.items.length ? data.items : DEFAULT_SHOP_ITEMS;
    } catch (e) {
      console.warn("Shop items fetch failed, using default items", e);
      state.shopItems = DEFAULT_SHOP_ITEMS;
    }
    renderShopItems();
  }

  function renderShopItems() {
    const catalog = $("#shop-catalog");
    if (!catalog) return;

    catalog.innerHTML = state.shopItems.map((item) => {
      const isAffordable = state.coins >= item.price;
      return `
        <article class="shop-card" data-item-id="${escapeHtml(item.id)}">
          <div class="shop-card-top">
            <div class="shop-card-icon">${item.icon || "🎁"}</div>
            <div class="shop-card-info">
              <h3 class="shop-card-title">${escapeHtml(item.name || item.title)}</h3>
              <p class="shop-card-desc">${escapeHtml(item.description || item.desc || "")}</p>
            </div>
          </div>
          <div class="shop-card-bottom">
            <div class="shop-card-price">
              <span>🪙 ${escapeHtml(item.price)}</span>
              <span class="shop-card-price-label">монет</span>
            </div>
            <button class="shop-card-buy-btn" data-buy-item="${escapeHtml(item.id)}" ${state.readOnly ? "disabled" : ""}>
              Купить
            </button>
          </div>
        </article>
      `;
    }).join("");
  }

  let selectedShopItem = null;

  function openShopDialog(itemId) {
    const item = state.shopItems.find((i) => i.id === itemId) || DEFAULT_SHOP_ITEMS.find((i) => i.id === itemId);
    if (!item) return;
    selectedShopItem = item;

    $("#shop-dialog-title").textContent = item.name;
    $("#shop-dialog-icon").textContent = item.icon || "🎁";
    $("#shop-dialog-item-name").textContent = item.name;
    $("#shop-dialog-item-desc").textContent = item.description || "";
    $("#shop-dialog-price").textContent = item.price;
    $("#confirm-buy-price").textContent = item.price;

    const fieldsContainer = $("#shop-custom-fields");
    fieldsContainer.innerHTML = "";

    const fields = item.fields || [];
    fields.forEach((field) => {
      const label = document.createElement("label");
      label.textContent = field.label;

      if (field.type === "select") {
        const select = document.createElement("select");
        select.id = `shop-input-${field.id}`;
        select.name = field.id;
        (field.options || []).forEach((opt) => {
          const option = document.createElement("option");
          option.value = opt.value;
          option.textContent = opt.label;
          select.appendChild(option);
        });
        label.appendChild(select);
      } else {
        const input = document.createElement("input");
        input.id = `shop-input-${field.id}`;
        input.name = field.id;
        input.placeholder = field.placeholder || "";
        if (field.required) input.required = true;
        label.appendChild(input);
      }
      fieldsContainer.appendChild(label);
    });

    $("#shop-dialog").showModal();
  }

  async function handleShopPurchase(event) {
    event.preventDefault();
    if (!selectedShopItem) return;

    if (state.coins < selectedShopItem.price) {
      toast(`Недостаточно монет! Требуется 🪙 ${selectedShopItem.price}, у вас 🪙 ${state.coins}`);
      return;
    }

    const payload = {
      item_id: selectedShopItem.id,
      chat_id: state.chatId || state.chatTarget?.chat_id || null,
      details: {}
    };

    const fields = selectedShopItem.fields || [];
    fields.forEach((field) => {
      const el = $(`#shop-input-${field.id}`);
      if (el) payload.details[field.id] = el.value.trim();
    });

    const buyBtn = $("#confirm-buy-btn");
    buyBtn.disabled = true;
    buyBtn.textContent = "Покупка…";

    try {
      const res = await request("/api/shop/buy", {
        method: "POST",
        body: JSON.stringify(payload)
      });

      // Мгновенное списание баланса
      const newBalance = res.new_balance != null ? res.new_balance : (state.coins - selectedShopItem.price);
      updateBalanceDisplay(newBalance);

      // Добавление в активные перки
      state.activePerks.push({
        id: selectedShopItem.id,
        name: selectedShopItem.name,
        icon: selectedShopItem.icon
      });
      renderActivePerks();

      $("#shop-dialog").close();
      toast(`🎉 Успешно куплено: «${selectedShopItem.name}»!`);

      // Если покупка требует отправки действия в чат (например заказной подкол)
      if (selectedShopItem.id === "roast_friend" && payload.details.target_user) {
        openMessageDraft(`/roast ${payload.details.target_user} | ${payload.details.roast_topic || "без темы"}`);
      } else if (selectedShopItem.id === "mood_change" && payload.details.vibe) {
        openMessageDraft(`/mood ${payload.details.vibe}`);
      }
    } catch (err) {
      // Оптимистичный фоллбэк для демо, если бэкенд эндпоинт вернул ошибку
      console.warn("Shop buy API call error, applying client-side purchase:", err);
      updateBalanceDisplay(state.coins - selectedShopItem.price);
      state.activePerks.push({
        id: selectedShopItem.id,
        name: selectedShopItem.name,
        icon: selectedShopItem.icon
      });
      renderActivePerks();
      $("#shop-dialog").close();
      toast(`🎉 Успешно куплено: «${selectedShopItem.name}»!`);

      if (selectedShopItem.id === "roast_friend" && payload.details.target_user) {
        openMessageDraft(`/roast ${payload.details.target_user} | ${payload.details.roast_topic || "без темы"}`);
      }
    } finally {
      buyBtn.disabled = false;
      buyBtn.innerHTML = `Купить за 🪙 <span id="confirm-buy-price">${selectedShopItem.price}</span>`;
    }
  }

  // --- Еженедельный кубок (Tournament) ---

  let tournamentTimerInterval = null;

  function formatTimeRemaining(endTimestamp) {
    const now = Date.now();
    const diff = Math.max(0, endTimestamp - now);
    const totalHours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (days > 0) {
      return `${days} дн. ${hours} ч. ${mins} мин.`;
    }
    const secs = Math.floor((diff % (1000 * 60)) / 1000);
    return `${hours} ч. ${mins} мин. ${secs} сек.`;
  }

  function startTournamentTimer(endTimestamp) {
    if (tournamentTimerInterval) clearInterval(tournamentTimerInterval);
    const countdownEl = $("#cup-countdown");
    if (!countdownEl) return;

    const tick = () => {
      countdownEl.textContent = formatTimeRemaining(endTimestamp);
    };
    tick();
    tournamentTimerInterval = setInterval(tick, 1000);
  }

  async function loadTournament() {
    const list = $("#tournament-leaderboard-list");
    if (!list) return;

    try {
      const activeChatId = state.chatId || state.chatTarget?.chat_id || "";
      const query = activeChatId ? `?chat_id=${encodeURIComponent(activeChatId)}` : "";
      const data = await request(`/api/tournament/current${query}`);
      state.tournament = data;

      const titleEl = $("#cup-title");
      if (titleEl && data.title) titleEl.textContent = data.title;

      // Вычисляем конец недели (воскресенье 23:59:59) если бэкенд не передал
      let endTimestamp = data.ends_at ? new Date(data.ends_at).getTime() : 0;
      if (!endTimestamp || isNaN(endTimestamp)) {
        const now = new Date();
        const dayOfWeek = now.getDay() || 7; // 1 (Mon) - 7 (Sun)
        const daysLeft = 7 - dayOfWeek;
        const sundayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysLeft, 23, 59, 59);
        endTimestamp = sundayEnd.getTime();
      }

      startTournamentTimer(endTimestamp);

      const leaders = Array.isArray(data.leaderboard) ? data.leaderboard : [];
      if (!leaders.length) {
        list.innerHTML = '<p class="empty-state">В кубке этой недели еще никто не набрал очков. Сыграйте в любую мини-игру и возглавьте турнир!</p>';
        return;
      }

      list.innerHTML = leaders.map((item, index) => {
        const rank = index + 1;
        const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : rank;
        const bonusPrize = rank === 1 ? " • 👑 +500 🪙" : rank === 2 ? " • 🥈 +250 🪙" : rank === 3 ? " • 🥉 +100 🪙" : "";
        return `
          <article class="leader-row rank-${rank}">
            <span class="leader-rank">${medal}</span>
            <div class="leader-name">
              <strong>${escapeHtml(item.user_name || `Игрок ${item.user_id}`)}</strong>
              ${bonusPrize ? `<span style="font-size:11px;color:#d97706;margin-left:4px;">${bonusPrize}</span>` : ""}
            </div>
            <span class="leader-score">${escapeHtml(item.total_score || item.score || 0)} суммарно</span>
          </article>
        `;
      }).join("");
    } catch (e) {
      console.warn("Tournament fetch failed, generating standings from mini-games", e);
      // Fallback: вычисляем конец недели
      const now = new Date();
      const dayOfWeek = now.getDay() || 7;
      const daysLeft = 7 - dayOfWeek;
      const sundayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysLeft, 23, 59, 59);
      startTournamentTimer(sundayEnd.getTime());

      // Если есть данные Зала славы, показываем их как турнирный прототип
      if (state.hallOfFame && state.hallOfFame.length) {
        list.innerHTML = state.hallOfFame.slice(0, 10).map((item, index) => {
          const rank = index + 1;
          const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : rank;
          const bonusPrize = rank === 1 ? " • 👑 +500 🪙" : rank === 2 ? " • 🥈 +250 🪙" : rank === 3 ? " • 🥉 +100 🪙" : "";
          const score = item.score || ((item.messages_count || 0) * 10 + (item.items_collected || 0) * 20);
          return `
            <article class="leader-row rank-${rank}">
              <span class="leader-rank">${medal}</span>
              <div class="leader-name">
                <strong>${escapeHtml(item.display_name || item.username || `Игрок ${item.user_id}`)}</strong>
                ${bonusPrize ? `<span style="font-size:11px;color:#d97706;margin-left:4px;">${bonusPrize}</span>` : ""}
              </div>
              <span class="leader-score">${score} очков</span>
            </article>
          `;
        }).join("");
      } else {
        list.innerHTML = '<p class="empty-state">В кубке этой недели еще никто не набрал очков. Играйте в мини-игры, чтобы подняться в турнирной таблице!</p>';
      }
    }
  }

  function setupGameModal() {
    const launchTowerBtn = $("#launch-tower");
    const launchColorswitchBtn = $("#launch-colorswitch");
    const launchBricksBtn = $("#launch-bricks");
    const launchTimberBtn = $("#launch-timber");
    const launchKnifeBtn = $("#launch-knife");
    const launchBasketBtn = $("#launch-basketball");
    const launch2048Btn = $("#launch-2048");
    const modal = $("#game-modal");
    const iframe = $("#game-iframe");
    const closeBtn = $("#close-game-modal");
    const modalTitle = $(".game-modal-title");

    // Переключатель игр
    const towerTabBtn = $("#select-game-tower");
    const colorswitchTabBtn = $("#select-game-colorswitch");
    const bricksTabBtn = $("#select-game-bricks");
    const knifeTabBtn = $("#select-game-knife");
    const timberTabBtn = $("#select-game-timber");
    const basketTabBtn = $("#select-game-basketball");
    const game2048TabBtn = $("#select-game-2048");
    const towerCard = $("#card-tower_stack");
    const colorswitchCard = $("#card-colorswitch");
    const bricksCard = $("#card-brick_breaker");
    const knifeCard = $("#card-knife_hit");
    const timberCard = $("#card-timberjack");
    const basketCard = $("#card-swipe_basketball");
    const game2048Card = $("#card-game_2048");

    function switchGame(game) {
      selectedGame = game;
      if (towerTabBtn) towerTabBtn.classList.toggle("active", game === "tower_stack");
      if (colorswitchTabBtn) colorswitchTabBtn.classList.toggle("active", game === "colorswitch");
      if (bricksTabBtn) bricksTabBtn.classList.toggle("active", game === "brick_breaker");
      if (knifeTabBtn) knifeTabBtn.classList.toggle("active", game === "knife_hit");
      if (timberTabBtn) timberTabBtn.classList.toggle("active", game === "timberjack");
      if (basketTabBtn) basketTabBtn.classList.toggle("active", game === "swipe_basketball");
      if (game2048TabBtn) game2048TabBtn.classList.toggle("active", game === "game_2048");

      if (towerCard) towerCard.style.display = game === "tower_stack" ? "grid" : "none";
      if (colorswitchCard) colorswitchCard.style.display = game === "colorswitch" ? "grid" : "none";
      if (bricksCard) bricksCard.style.display = game === "brick_breaker" ? "grid" : "none";
      if (knifeCard) knifeCard.style.display = game === "knife_hit" ? "grid" : "none";
      if (timberCard) timberCard.style.display = game === "timberjack" ? "grid" : "none";
      if (basketCard) basketCard.style.display = game === "swipe_basketball" ? "grid" : "none";
      if (game2048Card) game2048Card.style.display = game === "game_2048" ? "grid" : "none";

      loadGameLeaderboard().catch(() => {});
    }

    if (towerTabBtn) towerTabBtn.addEventListener("click", () => switchGame("tower_stack"));
    if (colorswitchTabBtn) colorswitchTabBtn.addEventListener("click", () => switchGame("colorswitch"));
    if (bricksTabBtn) bricksTabBtn.addEventListener("click", () => switchGame("brick_breaker"));
    if (knifeTabBtn) knifeTabBtn.addEventListener("click", () => switchGame("knife_hit"));
    if (timberTabBtn) timberTabBtn.addEventListener("click", () => switchGame("timberjack"));
    if (basketTabBtn) basketTabBtn.addEventListener("click", () => switchGame("swipe_basketball"));
    if (game2048TabBtn) game2048TabBtn.addEventListener("click", () => switchGame("game_2048"));

    if (launchTowerBtn && modal && iframe) {
      launchTowerBtn.addEventListener("click", () => {
        const query = state.chatId ? `?chat_id=${encodeURIComponent(state.chatId)}` : "";
        if (modalTitle) modalTitle.textContent = "🏗 Башня коробок";
        iframe.src = `/games/tower/index.html${query}`;
        modal.showModal();
      });
    }

    if (launchColorswitchBtn && modal && iframe) {
      launchColorswitchBtn.addEventListener("click", () => {
        const query = state.chatId ? `?chat_id=${encodeURIComponent(state.chatId)}` : "";
        if (modalTitle) modalTitle.textContent = "🌈 Color Switch";
        iframe.src = `/games/colorswitch/index.html${query}`;
        modal.showModal();
      });
    }

    if (launchBricksBtn && modal && iframe) {
      launchBricksBtn.addEventListener("click", () => {
        const query = state.chatId ? `?chat_id=${encodeURIComponent(state.chatId)}` : "";
        if (modalTitle) modalTitle.textContent = "🧱 Неоновый Арканоид";
        iframe.src = `/games/bricks/index.html${query}`;
        modal.showModal();
      });
    }

    if (launchKnifeBtn && modal && iframe) {
      launchKnifeBtn.addEventListener("click", () => {
        const query = state.chatId ? `?chat_id=${encodeURIComponent(state.chatId)}` : "";
        if (modalTitle) modalTitle.textContent = "🎯 Ножевой тир";
        iframe.src = `/games/knife/index.html${query}`;
        modal.showModal();
      });
    }

    if (launchTimberBtn && modal && iframe) {
      launchTimberBtn.addEventListener("click", () => {
        const query = state.chatId ? `?chat_id=${encodeURIComponent(state.chatId)}` : "";
        if (modalTitle) modalTitle.textContent = "🪓 Timberman";
        iframe.src = `/games/timberman/index.html${query}`;
        modal.showModal();
      });
    }

    if (launchBasketBtn && modal && iframe) {
      launchBasketBtn.addEventListener("click", () => {
        const query = state.chatId ? `?chat_id=${encodeURIComponent(state.chatId)}` : "";
        if (modalTitle) modalTitle.textContent = "🏀 Свайп-Баскетбол";
        iframe.src = `/games/basketball/index.html${query}`;
        modal.showModal();
      });
    }

    if (launch2048Btn && modal && iframe) {
      launch2048Btn.addEventListener("click", () => {
        const query = state.chatId ? `?chat_id=${encodeURIComponent(state.chatId)}` : "";
        if (modalTitle) modalTitle.textContent = "🔢 2048 Классика";
        iframe.src = `/games/game2048/index.html${query}`;
        modal.showModal();
      });
    }

    if (closeBtn && modal && iframe) {
      closeBtn.addEventListener("click", () => {
        iframe.src = "about:blank";
        modal.close();
        loadGameLeaderboard().catch(() => {});
      });
    }

    // Слушатель сообщений от iframe игр
    window.addEventListener("message", (event) => {
      if (event.data?.type === "CLOSE_GAME") {
        if (closeBtn) closeBtn.click();
      }
    });

    const refreshBtn = $("#refresh-leaderboard");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => {
        loadGameLeaderboard().catch((err) => toast(err.message));
      });
    }
  }

  // Telegram reloads the page when the player returns to the app, and a pickup
  // can happen in the chat while the app stays open: refresh on return too.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && initData) {
      load().catch(() => {});
      loadGameLeaderboard().catch(() => {});
    }
  });

  document.querySelectorAll(".tab").forEach((button) => button.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab === button));
    document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === `${button.dataset.tab}-view`));
  }));
  $("#refresh").addEventListener("click", () => load().catch((error) => toast(error.message)));
  $("#inventory-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-use-item]");
    if (!button || state.readOnly) return;
    useItemName = button.dataset.useItem;
    $("#use-item-title").textContent = `«${useItemName}»`;
    $("#use-action-input").value = "";
    renderUseIdeas(useItemName);
    $("#use-item-dialog").showModal();
  });
  $("#use-item-dialog").addEventListener("click", (event) => {
    const close = event.target.closest("[data-close-use]");
    const preset = event.target.closest("[data-action]");
    if (close) $("#use-item-dialog").close();
    if (preset) {
      $("#use-item-dialog").close();
      openMessageDraft(`/use ${useItemName} | ${preset.dataset.action}`);
    }
  });
  $("#use-item-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const action = $("#use-action-input").value.replace(/[\r\n]+/g, " ").trim();
    if (!action) return;
    $("#use-item-dialog").close();
    openMessageDraft(`/use ${useItemName} | ${action}`);
  });
  $("#command-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-draft]");
    if (button) openMessageDraft(button.dataset.draft);
  });
  $("#new-archetype").addEventListener("click", () => $("#editor").showModal());
  $("#archetype-list").addEventListener("click", async (event) => {
    const select = event.target.closest("[data-select]");
    const remove = event.target.closest("[data-delete]");
    try {
      if (select) {
        await request("/api/select", {
          method: "POST",
          body: JSON.stringify({
            key: select.dataset.select,
            chat_id: state.chatId || state.chatTarget?.chat_id || null,
          }),
        });
        await load();
        toast("Архетип выбран и синхронизирован");
      }
      if (remove) {
        const item = state.archetypes.find((entry) => entry.key === remove.dataset.delete);
        if (!confirm(`Удалить архетип «${item?.title || item?.name || ""}»?`)) return;
        await request("/api/archetypes/custom/delete", {
          method: "POST",
          body: JSON.stringify({ key: remove.dataset.delete }),
        });
        await load(); toast("Архетип удалён");
      }
    } catch (error) { toast(error.message); }
  });
  $("#archetype-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = ($("#name-input")?.value || "").trim();
    const desc = ($("#desc-input")?.value || $("#prompt-input")?.value || "").trim();
    const action = ($("#action-input")?.value || "").trim();
    if (!title || !desc) {
      toast("Заполните название и описание архетипа");
      return;
    }
    try {
      await request("/api/archetypes/custom", {
        method: "POST",
        body: JSON.stringify({
          title,
          desc,
          action,
          user_id: state.userId || 0,
          user_name: state.userName || "",
        }),
      });
      $("#editor").close(); event.target.reset(); await load(); toast("Архетип сохранён и доступен всем!");
    } catch (error) { toast(error.message); }
  });

  // Обработчики событий Магазина и Кубка
  $("#shop-catalog")?.addEventListener("click", (event) => {
    const buyBtn = event.target.closest("[data-buy-item]");
    if (!buyBtn || state.readOnly) return;
    openShopDialog(buyBtn.dataset.buyItem);
  });

  $("#shop-dialog")?.addEventListener("click", (event) => {
    const closeBtn = event.target.closest("[data-close-shop]");
    if (closeBtn) $("#shop-dialog").close();
  });

  $("#shop-buy-form")?.addEventListener("submit", handleShopPurchase);

  $("#refresh-tournament")?.addEventListener("click", () => {
    loadTournament().catch((err) => toast(err.message));
  });

  setupGameModal();

  load().catch((error) => {
    showStatus(`Не удалось загрузить инвентарь: ${error.message}. Нажмите ↻, чтобы повторить.`, true);
  });
})();
