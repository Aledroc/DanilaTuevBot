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

  // Определение Telegram WebApp пользователя или параметров из URL/localStorage
  const tgUser = tg?.initDataUnsafe?.user;
  const storedUserId = (() => {
    try { return localStorage.getItem("gym_user_id"); } catch (_) { return null; }
  })();
  const storedUserName = (() => {
    try { return localStorage.getItem("gym_user_name"); } catch (_) { return null; }
  })();
  const storedUsername = (() => {
    try { return localStorage.getItem("gym_username"); } catch (_) { return null; }
  })();

  const requestedUserId = param("user_id") || (tgUser?.id ? String(tgUser.id) : (storedUserId || "1075912512"));
  const requestedFirstName = param("first_name") || param("user_name") || tgUser?.first_name || storedUserName || "Aledroc";
  const requestedUsername = param("username") || tgUser?.username || storedUsername || "Aledroc";

  // Сохраняем в localStorage для надежности между сессиями
  try {
    if (requestedUserId) localStorage.setItem("gym_user_id", requestedUserId);
    if (requestedFirstName) localStorage.setItem("gym_user_name", requestedFirstName);
    if (requestedUsername) localStorage.setItem("gym_username", requestedUsername);
  } catch (_) {}

  // Проверяем, есть ли реальные данные пользователя (initData или переданный user_id / tgUser)
  const hasUserAuth = true; // Теперь всегда работаем в полнофункциональном режиме с fallback-профилем
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
    readOnly: false,
    coins: 0,
    dailyStreak: 0,
    activePerks: [],
    shopItems: [],
    tournament: null,
    achievements: [],
    achFilter: "all",
  };
  const $ = (selector) => document.querySelector(selector);
  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;", "'":"&#39;"}[char]));
  let toastTimer;
  let useItemName = "";

  function buildQuery(params = {}) {
    const q = new URLSearchParams();
    if (chatId) q.set("chat_id", chatId);
    if (requestedUserId) q.set("user_id", requestedUserId);
    if (requestedFirstName) q.set("first_name", requestedFirstName);
    if (requestedUsername) q.set("username", requestedUsername);
    for (const [key, value] of Object.entries(params)) {
      if (value != null && value !== "") q.set(key, value);
    }
    const str = q.toString();
    return str ? `?${str}` : "";
  }

  async function request(path, options = {}) {
    // Если в пути нет query, добавляем контекст пользователя
    let targetPath = path;
    if (requestedUserId && !path.includes("user_id=")) {
      const sep = path.includes("?") ? "&" : "?";
      targetPath = `${path}${sep}user_id=${encodeURIComponent(requestedUserId)}${requestedFirstName ? `&first_name=${encodeURIComponent(requestedFirstName)}` : ""}${requestedUsername ? `&username=${encodeURIComponent(requestedUsername)}` : ""}`;
    }
    const headers = { "X-Telegram-Init-Data": initData, ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers };
    const response = await fetch(targetPath, { ...options, headers });
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
    const itemName = state.items[0]?.name || "кожаный ремень";

    const categories = [
      {
        id: "minigames",
        title: "Мини-игры и Турниры",
        icon: "🎮",
        badge: "Dungeon Games",
        badgeClass: "badge-games",
        desc: "Соревнования в 9 играх качалки, кубок недели и прокачка ачивок",
        commands: [
          {
            title: "Открыть Dungeon Games",
            desc: "Главный хаб игр, турнирная таблица Boss Cup и инвентарь бойца",
            cmd: "/app",
            tag: "Основная"
          },
          {
            title: "Турнир Недели (Boss Cup)",
            desc: "Посмотреть текущий кубок качалки и лидеров недели",
            cmd: "/cup",
            tag: "Турнир"
          },
          {
            title: "Кожаные Достижения",
            desc: "Открыть список достижений и забрать заработанные награды",
            cmd: "/achievements",
            tag: "Награды"
          }
        ]
      },
      {
        id: "economy",
        title: "Экономика и Магазин",
        icon: "💰",
        badge: "Three Hundred Bucks",
        badgeClass: "badge-economy",
        desc: "Заработок монет, покупки в магазине $300 и элитные VIP статусы",
        commands: [
          {
            title: "Баланс и Стрик",
            desc: "Проверить сколько монет на счету и забрать ежедневную награду",
            cmd: "/coins",
            tag: "Баланс"
          },
          {
            title: "Leather Shop ($300)",
            desc: "Каталог товаров: спанкинг, фейк-бан, перки и VIP на неделю",
            cmd: "/shop",
            tag: "Каталог"
          },
          {
            title: "Быстрая покупка",
            desc: "Приобрести товар напрямую по его названию или коду",
            cmd: "/buy vip_badge",
            tag: "Покупка"
          }
        ]
      },
      {
        id: "roleplay",
        title: "Ролевая игра и Каста",
        icon: "🎭",
        badge: "Roleplay & Lore",
        badgeClass: "badge-roleplay",
        desc: "Управление характером бота, выбор касты и настройка целей",
        commands: [
          {
            title: "Кто Boss of this Gym?",
            desc: "Показать текущую роль бота, его настроение и активную цель",
            cmd: "/who",
            tag: "Статус"
          },
          {
            title: "Выбрать Касту",
            desc: "Переключить архетип бота (dungeon_master, billy, van, coach и др.)",
            cmd: "/set dungeon_master",
            tag: "Каста"
          },
          {
            title: "Свой образ бойца",
            desc: "Задать индивидуальный характер, правила поведения и историю бота",
            cmd: "/prompt Суровый тренер по пауэрлифтингу, мотивирует криками и хлопками",
            tag: "Промпт"
          },
          {
            title: "Цель в качалке",
            desc: "Задать текущую сюжетную цель для персонажа в чате",
            cmd: "/goal пожать 300 кг от груди до конца недели",
            tag: "Цель"
          },
          {
            title: "Новый боец (Сброс)",
            desc: "Очистить текущий контекст диалога и начать разговор с чистого листа",
            cmd: "/reset",
            tag: "Сброс"
          }
        ]
      },
      {
        id: "inventory",
        title: "Инвентарь и Предметы",
        icon: "🎒",
        badge: "Dungeon Gear",
        badgeClass: "badge-inventory",
        desc: "Найденные вещи, взаимодействие с предметами и передача друзьям",
        commands: [
          {
            title: "Снаряга Слейва",
            desc: "Посмотреть список всех собранных в чатах кожаных предметов",
            cmd: "/inv",
            tag: "Инвентарь"
          },
          {
            title: "Использовать предмет",
            desc: "Применить предмет из сумки с описанием желаемого действия",
            cmd: `/use ${itemName} | смачно шлёпнуть по скамье для жима`,
            tag: "Действие"
          },
          {
            title: "Передать снарягу",
            desc: "Отдать предмет другому бойцу, который есть в этом чате",
            cmd: `/giveitem @username | ${itemName}`,
            tag: "Передача"
          }
        ]
      },
      {
        id: "voice",
        title: "Озвучка и Медиа",
        icon: "🎙",
        badge: "Media & Audio",
        badgeClass: "badge-voice",
        desc: "Голосовые ответы с фирменными басами и генерация картинок",
        commands: [
          {
            title: "Включить голос",
            desc: "Включить озвучку ответов персонажа сочными голосовыми сообщениями",
            cmd: "/voice on",
            tag: "Голос"
          },
          {
            title: "Выключить голос",
            desc: "Отключить голосовые ответы и оставить только текст",
            cmd: "/voice off",
            tag: "Тишина"
          },
          {
            title: "Голос персонажа",
            desc: "Выбрать голос озвучки (billy, van, deep, coach)",
            cmd: "/voice billy",
            tag: "Тембр"
          },
          {
            title: "Генератор артов",
            desc: "Создать сочный Deep Dark Fantasy арт по текстовому описанию",
            cmd: "/img Билли Херрингтон в неоновой качалке 80-х",
            tag: "Арт"
          }
        ]
      }
    ];

    const container = $("#command-list");
    if (!container) return;

    container.innerHTML = categories.map((cat) => `
      <section class="help-category-section" id="help-cat-${cat.id}">
        <div class="help-category-header">
          <div class="help-cat-title-wrap">
            <span class="help-cat-icon">${cat.icon}</span>
            <div class="help-cat-titles">
              <h3 class="help-cat-title">${escapeHtml(cat.title)}</h3>
              <p class="help-cat-desc">${escapeHtml(cat.desc)}</p>
            </div>
          </div>
          <span class="help-cat-badge ${cat.badgeClass}">${escapeHtml(cat.badge)}</span>
        </div>
        <div class="help-commands-grid">
          ${cat.commands.map((cmd) => `
            <article class="help-command-card">
              <div class="help-cmd-header">
                <span class="help-cmd-title">${escapeHtml(cmd.title)}</span>
                <span class="help-cmd-tag">${escapeHtml(cmd.tag)}</span>
              </div>
              <p class="help-cmd-desc">${escapeHtml(cmd.desc)}</p>
              <div class="help-cmd-footer">
                <code class="help-cmd-snippet">${escapeHtml(cmd.cmd)}</code>
                <button class="preset-button command-draft-btn" type="button" data-draft="${escapeHtml(cmd.cmd)}" title="Подставить в чат Telegram">
                  <span>✍️</span> Подставить
                </button>
              </div>
            </article>
          `).join("")}
        </div>
      </section>
    `).join("");
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
    let stateLoaded = false;
    try {
      state.readOnly = false;
      $("#new-archetype").hidden = false;
      document.querySelectorAll(".tab").forEach((tab) => { tab.disabled = false; });
      const query = buildQuery();
      const data = await request(`/api/state${query}`);
      if (data.coins != null) {
        updateBalanceDisplay(data.coins);
      }
      if (data.daily_streak != null) {
        updateStreakDisplay(data.daily_streak);
      }
      state.items = data.items || [];
      state.archetypes = data.archetypes || [];
      state.selected = data.selected || "";
      state.botUsername = data.bot_username || "";
      state.userId = data.user?.id || 0;
      state.userName = data.user?.name || "";
      state.chatTarget = data.chat_target || null;
      state.chatUsername = state.chatUsername || state.chatTarget?.username || "";
      $("#greeting").textContent = data.user?.name ? `Привет, ${data.user.name} • Качалка` : "🎮 Dungeon Games";
      renderInventory();
      renderArchetypes();
      renderHelp();
      stateLoaded = true;
    } catch (err) {
      console.warn("Failed to load /api/state, falling back to public view", err);
      try {
        const data = await request("/api/public-archetypes");
        state.botUsername = data.bot_username || "";
        state.items = [];
        state.archetypes = data.archetypes || [];
        state.selected = "";
        renderArchetypes();
        renderHelp();
      } catch (_) {}
    }

    // Всегда независимо подгружаем вторичные разделы с защитой от сбоя одного из них
    await Promise.allSettled([
      loadEconomyProfile(),
      loadShopItems(),
      loadAchievements(),
      loadTournament(),
      loadHallOfFame(),
      loadGameLeaderboard()
    ]);

    if (stateLoaded) {
      $("#app-status").hidden = true;
    } else {
      showStatus("Работа в автономном режиме качалки. Все разделы активны!");
      setTimeout(() => { $("#app-status").hidden = true; }, 1500);
    }
  }

  let selectedGame = "tower_stack"; // 'tower_stack' | 'timberjack' | 'knife_hit' | 'swipe_basketball' | 'brick_breaker' | 'colorswitch' | 'air_hockey' | 'whack_mole' | 'game_2048'

  const GAME_INFO_MAP = {
    tower_stack: { title: "Лидеры Стек Штанги • Dungeon Bench", icon: "🏗", empty: "Рекордов в Стек Штанге пока нет. Поставь первый блин на гриф!" },
    timberjack: { title: "Лидеры Leather Lumberjack • Лесоруб Билли", icon: "🪓", empty: "Рекордов у Лесоруба Билли пока нет. Вруби топор первым!" },
    knife_hit: { title: "Лидеры Метание дилдо / Спанкинг • Spank Hit", icon: "🎯", empty: "Рекордов в Spank Hit пока нет. Запусти снаряд в цель!" },
    swipe_basketball: { title: "Лидеры Dungeon Slam • Бросок в кольцо", icon: "🏀", empty: "Рекордов в Dungeon Slam пока нет. Сделай первый бросок в кольцо качалки!" },
    brick_breaker: { title: "Лидеры Smash the Jabroni • Кибер-Дробилка", icon: "🧱", empty: "Рекордов в Кибер-Дробилке пока нет. Разбей первый блок платформой!" },
    colorswitch: { title: "Лидеры Rainbow Dungeon • Цветной флекс", icon: "🌈", empty: "Рекордов в Rainbow Dungeon пока нет. Сделай первый флекс через кольцо!" },
    air_hockey: { title: "Лидеры Ice Gym Clash • Аэрохоккей Слейвов", icon: "🏒", empty: "Рекордов в Ice Gym Clash пока нет. Победи Dungeon AI!" },
    whack_mole: { title: "Лидеры Whack the Jabroni • Накажи Слейва", icon: "🔨", empty: "Рекордов в Whack the Jabroni пока нет. Накажи первого джаброни молотом!" },
    game_2048: { title: "Лидеры 2048 Gym Power • Сила трех сотен баксов", icon: "🔢", empty: "Рекордов в 2048 Gym Power пока нет. Собери плитку 2048 и стань Boss of this Gym!" }
  };

  async function loadGameLeaderboard(targetGameKey) {
    const gameKey = targetGameKey || selectedGame;
    selectedGame = gameKey;

    // Обновляем персональные рекорды для всех 9 игр
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

      const bricksBest = parseInt(localStorage.getItem("brick_breaker_best_score") || "0", 10);
      const bricksBestNode = $("#bricks-my-best");
      if (bricksBestNode) bricksBestNode.textContent = bricksBest;

      const colorswitchBest = parseInt(localStorage.getItem("colorswitch_best_score") || "0", 10);
      const colorswitchBestNode = $("#colorswitch-my-best");
      if (colorswitchBestNode) colorswitchBestNode.textContent = colorswitchBest;

      const airHockeyBest = parseInt(localStorage.getItem("air_hockey_best_score") || "0", 10);
      const airHockeyBestNode = $("#airhockey-my-best");
      if (airHockeyBestNode) airHockeyBestNode.textContent = airHockeyBest;

      const whackBest = parseInt(localStorage.getItem("whack_mole_best_score") || "0", 10);
      const whackBestNode = $("#whack-my-best");
      if (whackBestNode) whackBestNode.textContent = whackBest;

      const game2048Best = parseInt(localStorage.getItem("game_2048_best") || "0", 10);
      const game2048BestNode = $("#game2048-my-best");
      if (game2048BestNode) game2048BestNode.textContent = game2048Best;
    } catch (_) {}

    const info = GAME_INFO_MAP[gameKey] || GAME_INFO_MAP.tower_stack;

    // Карточка игры, под которой раскрывается инлайн-лидерборд
    const targetCard = document.querySelector(`.game-hub-card[data-game="${gameKey}"]`);
    let inlineDrawer = targetCard ? targetCard.querySelector(".game-card-leaderboard") : null;
    if (targetCard && !inlineDrawer) {
      inlineDrawer = document.createElement("div");
      inlineDrawer.className = "game-card-leaderboard";
      targetCard.appendChild(inlineDrawer);
    }

    if (inlineDrawer) {
      inlineDrawer.innerHTML = `
        <div class="card-lb-header">
          <div class="card-lb-title">
            <span>${info.icon}</span>
            <span>Топ-10 • ${escapeHtml(info.title.replace(/^Лидеры\s*/, ''))}</span>
          </div>
          <button class="card-lb-close" title="Скрыть лидерборд" aria-label="Закрыть">✕</button>
        </div>
        <div class="card-lb-body">
          <div class="loading-state" style="padding:10px 0;font-size:12px;">Загружаем рекорды качалки…</div>
        </div>
      `;
    }

    // Подсвечиваем активную карточку и кнопку Топ
    document.querySelectorAll(".game-hub-card").forEach((card) => {
      const isMatch = card.dataset.game === gameKey;
      card.classList.toggle("active-leaderboard-card", isMatch);
      const drawer = card.querySelector(".game-card-leaderboard");
      if (drawer && !isMatch) {
        drawer.remove();
      }
    });
    document.querySelectorAll("[data-leaderboard-for]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.leaderboardFor === gameKey);
    });

    // Обновляем заголовок и иконку нижнего запасного блока (если он есть)
    const titleNode = $("#leaderboard-game-title");
    const iconNode = $("#leaderboard-game-icon");
    if (titleNode) titleNode.textContent = info.title;
    if (iconNode) iconNode.textContent = info.icon;
    const bottomList = $("#game-leaderboard-list");

    try {
      const queryParams = [`game=${encodeURIComponent(gameKey)}`];
      if (state.chatId) queryParams.push(`chat_id=${encodeURIComponent(state.chatId)}`);
      const query = `?${queryParams.join("&")}`;

      const data = await request(`/api/game/leaderboard${query}`);
      let leaders = Array.isArray(data.leaderboard) ? data.leaderboard : [];

      // Если в базе нет записей, но у текущего игрока есть локальный рекорд в этой игре
      if (!leaders.length) {
        let myScore = 0;
        try {
          const scoreMap = {
            tower_stack: "tower_stack_best_score",
            timberjack: "timberman_best_score",
            knife_hit: "knife_best_score",
            swipe_basketball: "basketball_best_score",
            brick_breaker: "brick_breaker_best_score",
            colorswitch: "colorswitch_best_score",
            air_hockey: "air_hockey_best_score",
            whack_mole: "whack_mole_best_score",
            game_2048: "game_2048_best"
          };
          const key = scoreMap[gameKey];
          if (key) myScore = parseInt(localStorage.getItem(key) || "0", 10);
        } catch (_) {}

        if (myScore > 0) {
          leaders = [
            { rank: 1, user_id: state.userId || 1075912512, user_name: `${state.userName || "Вы"} (Твой рекорд)`, score: myScore }
          ];
        }
      }

      const renderHtml = (items) => {
        if (!items.length) {
          return `<p class="empty-state" style="padding:8px 0;font-size:12px;">${info.empty}</p>`;
        }
        return items.map((item, index) => `
          <article class="leader-row rank-${index + 1}">
            <span class="leader-rank">${index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : index + 1}</span>
            <span class="leader-name">${escapeHtml(item.user_name || `Игрок ${item.user_id}`)}</span>
            <span class="leader-score">${escapeHtml(item.score)}</span>
          </article>
        `).join("");
      };

      if (inlineDrawer) {
        const body = inlineDrawer.querySelector(".card-lb-body");
        if (body) body.innerHTML = renderHtml(leaders);
        inlineDrawer.querySelector(".card-lb-close")?.addEventListener("click", (e) => {
          e.stopPropagation();
          inlineDrawer.remove();
          targetCard?.classList.remove("active-leaderboard-card");
          targetCard?.querySelector("[data-leaderboard-for]")?.classList.remove("active");
        });
      }

      if (bottomList) {
        bottomList.innerHTML = renderHtml(leaders);
      }

      return leaders;
    } catch (e) {
      console.warn("loadGameLeaderboard failed, showing local fallback", e);
      let fallbackLeaders = [];
      try {
        const scoreMap = {
          tower_stack: "tower_stack_best_score",
          timberjack: "timberman_best_score",
          knife_hit: "knife_best_score",
          swipe_basketball: "basketball_best_score",
          brick_breaker: "brick_breaker_best_score",
          colorswitch: "colorswitch_best_score",
          air_hockey: "air_hockey_best_score",
          whack_mole: "whack_mole_best_score",
          game_2048: "game_2048_best"
        };
        const key = scoreMap[gameKey];
        const myScore = key ? parseInt(localStorage.getItem(key) || "0", 10) : 0;
        if (myScore > 0) {
          fallbackLeaders = [
            { rank: 1, user_id: state.userId || 1075912512, user_name: `${state.userName || "Вы"} (Твой рекорд)`, score: myScore }
          ];
        }
      } catch (_) {}

      const renderHtml = (items) => items.map((item, index) => `
        <article class="leader-row rank-${index + 1}">
          <span class="leader-rank">${index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : index + 1}</span>
          <span class="leader-name">${escapeHtml(item.user_name || `Игрок ${item.user_id}`)}</span>
          <span class="leader-score">${escapeHtml(item.score)}</span>
        </article>
      `).join("");

      if (inlineDrawer) {
        const body = inlineDrawer.querySelector(".card-lb-body");
        if (body) body.innerHTML = renderHtml(fallbackLeaders);
        inlineDrawer.querySelector(".card-lb-close")?.addEventListener("click", (ev) => {
          ev.stopPropagation();
          inlineDrawer.remove();
          targetCard?.classList.remove("active-leaderboard-card");
          targetCard?.querySelector("[data-leaderboard-for]")?.classList.remove("active");
        });
      }
      if (bottomList) {
        bottomList.innerHTML = renderHtml(fallbackLeaders);
      }
      return fallbackLeaders;
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
    // Синхронизируем кнопки в каталоге магазина
    if (state.shopItems && state.shopItems.length) {
      renderShopItems();
    }
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
      let perks = Array.isArray(data.active_perks) ? data.active_perks : [];
      if (!perks.length && Array.isArray(data.perks)) {
        perks = data.perks;
      }
      if (data.vip && !perks.some(p => (p.perk_id === "vip_badge" || p.id === "vip_badge" || (typeof p === "string" && p.includes("VIP"))))) {
        perks.unshift({ id: "vip_badge", perk_id: "vip_badge", name: "👑 LORD VIP (на 7 дн.)", icon: "👑" });
      }
      state.activePerks = perks;
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
    const nowSec = Math.floor(Date.now() / 1000);
    list.innerHTML = state.activePerks.map((perk) => {
      const isVip = (typeof perk === "object" && (perk.id === "vip_badge" || perk.perk_id === "vip_badge"))
        || (typeof perk === "string" && (perk.includes("LORD") || perk.includes("VIP")));

      let extraTimeLabel = "";
      if (typeof perk === "object" && perk.expires_at && perk.expires_at > nowSec) {
        const diffSec = perk.expires_at - nowSec;
        const days = Math.floor(diffSec / 86400);
        const hours = Math.floor((diffSec % 86400) / 3600);
        if (days > 0) {
          extraTimeLabel = ` (осталось ${days} дн. ${hours} ч.)`;
        } else {
          const mins = Math.max(1, Math.floor((diffSec % 3600) / 60));
          extraTimeLabel = ` (осталось ${hours} ч. ${mins} мин.)`;
        }
      }

      let name = typeof perk === "string" ? perk : (perk.title || perk.name || "Активный перк");
      let icon = (typeof perk === "object" && perk.icon) || "⚡";
      if (isVip) {
        icon = "👑";
        name = `LORD VIP${extraTimeLabel || " (на 7 дн.)"}`;
        return `<span class="active-perk-chip vip-chip" style="background:linear-gradient(135deg,rgba(251,191,36,0.25),rgba(217,119,6,0.3));border-color:rgba(251,191,36,0.7);color:#fef08a;font-weight:700;">${icon} ${escapeHtml(name)}</span>`;
      }
      return `<span class="active-perk-chip">${icon} ${escapeHtml(name)}${escapeHtml(extraTimeLabel)}</span>`;
    }).join("");
  }

  const DEFAULT_SHOP_ITEMS = [
    {
      id: "vip_badge",
      name: "👑 LORD OF THE DUNGEON (VIP на неделю)",
      icon: "👑",
      price: 5000,
      description: "Элитный статус короля спортзала на 7 дней! Персонаж признает вас своим боссом, уважительно обращается на 'Вы, мой Босс' с поклоном в каждом сообщении, дает доступ к золотой короне в Зале славы и бейджу [LORD VIP].",
      requires_input: false,
      fields: []
    },
    {
      id: "golden_fart",
      name: "💨 Золотой залп / Гачи-выхлоп",
      icon: "💨",
      price: 80,
      description: "Бот смачно и громогласно выдает фирменный звуковой эффект выхлопа в раздевалке со звонким хлопком!",
      requires_input: false,
      fields: []
    },
    {
      id: "compliment_bomb",
      name: "🌹 Королевский респект / Комплимент",
      icon: "🌹",
      price: 90,
      description: "Бот осыпает указанного бойца роскошными комплиментами о его бицепсах, форме и стальном прессе!",
      requires_input: true,
      fields: [
        { id: "target_user", label: "Кому выразить королевский респект", placeholder: "@username или Вася", required: true }
      ]
    },
    {
      id: "custom_roast",
      name: "🎯 Спанкинг / Заказной подкол",
      icon: "🎯",
      price: 100,
      description: "Бот персонально и со смачным хлопком подколет указанного бойца на выбранную тему прямо в качалке!",
      requires_input: true,
      fields: [
        { id: "target_user", label: "Никнейм слейва или имя братана", placeholder: "@username или Van", required: true },
        { id: "roast_topic", label: "Повод для порки", placeholder: "Например: забыл надеть кожаные ремни или филонит жим", required: true }
      ]
    },
    {
      id: "slap_friend",
      name: "🐟 Дружеский лещ / Мокрое полотенце",
      icon: "🐟",
      price: 120,
      description: "Бот смачно отвешивает дружеского виртуального леща или бросает мокрое полотенце в лицо указанному другу при его появлении в чате со звонким звуком!",
      requires_input: true,
      fields: [
        { id: "target_user", label: "Кому отвесить леща", placeholder: "@username или Вася", required: true },
        { id: "reason", label: "За какую провинность", placeholder: "Например: не пожал сотку от груди", required: false }
      ]
    },
    {
      id: "fake_ban",
      name: "🔨 Фейковый бан молотом Билли",
      icon: "🔨",
      price: 130,
      description: "Бот устраивает эпичный шуточный 'бан' указанного друга с отсчетом секунд до изгнания!",
      requires_input: true,
      fields: [
        { id: "target_user", label: "Кого эпично забанить", placeholder: "@username или Слейв", required: true },
        { id: "reason", label: "Причина изгнания", placeholder: "Например: пропустил день ног", required: false }
      ]
    },
    {
      id: "silent_muter",
      name: "🤐 Кляп для слейва / Режим Тишины (15 минут)",
      icon: "🤐",
      price: 150,
      description: "Бот замолкает и отдыхает от спонтанных реплик в качалке следующие 15 минут.",
      requires_input: false,
      fields: []
    },
    {
      id: "bot_whisper",
      name: "🕵️ Анонимный слух / Сплетня",
      icon: "🕵️",
      price: 180,
      description: "Бот вбрасывает в чат забавный анонимный слух или секрет от лица своего персонажа, не выдавая автора покупки.",
      requires_input: true,
      fields: [
        { id: "whisper_text", label: "Текст слуха или инсайда", placeholder: "Например: говорят, в душевой завелся призрак Билли...", required: true }
      ]
    },
    {
      id: "custom_title",
      name: "Кожаный Титул",
      icon: "🏷",
      price: 200,
      description: "Установи уникальный титул под своим профилем (например, «Performance Artist» или «Three Hundred Bucks»)",
      requires_input: true,
      fields: [
        { id: "title_text", label: "Твой новый титул", placeholder: "Например: Master of the Locker Room", required: true }
      ]
    },
    {
      id: "dungeon_party",
      name: "🎉 Дискотека в качалке (30 минут)",
      icon: "🎉",
      price: 220,
      description: "Бот включает безумный рейв с ремиксами и зажигает всю раздевалку на 30 минут!",
      requires_input: false,
      fields: []
    },
    {
      id: "paranoia_mode",
      name: "🛸 Режим Паранойи и Масонов (1 час)",
      icon: "🛸",
      price: 250,
      description: "Бот начинает во всем видеть тайный заговор рептилоидов, масонов и слежку агентов в чате!",
      requires_input: false,
      fields: []
    },
    {
      id: "shout_announcement",
      name: "📢 Мегафон / Крик на всю качалку",
      icon: "📢",
      price: 300,
      description: "Персонаж прерывает разговор громогласным криком через рупор с вашим объявлением на весь чат!",
      requires_input: true,
      fields: [
        { id: "shout_text", label: "Текст объявления в мегафон", placeholder: "Срочно всем построиться в шеренгу!", required: true }
      ]
    },
    {
      id: "mood_override",
      name: "Атмосфера Подземелья (Вайб)",
      icon: "🎭",
      price: 150,
      description: "Задай тон всей раздевалке на следующие 2 часа! Ass we can!",
      requires_input: true,
      fields: [
        {
          id: "vibe",
          label: "Выбери настрой качалки",
          type: "select",
          options: [
            { value: "gachi", label: "💪 Dungeon Master (Классический гачимучи флекс)" },
            { value: "cyberpunk", label: "🤖 Кибер-Джаброни (Неоновый хром и синты)" },
            { value: "grandma", label: "👵 Добрая бабушка (С протеиновыми пирожками)" },
            { value: "toxic_critic", label: "🧐 Суровый судья соревнований по бодибилдингу" }
          ]
        }
      ]
    },
    {
      id: "dungeon_immunity",
      name: "🛡️ Неприкасаемый Слейв (Иммунитет)",
      icon: "🛡️",
      price: 600,
      description: "Иммунитет на неделю: бот ни при каких обстоятельствах не подкалывает владельца и заступается за него в спорах.",
      requires_input: false,
      fields: []
    }
  ];

  async function loadShopItems() {
    const catalog = $("#shop-catalog");
    if (!catalog) return;

    try {
      const activeChatId = state.chatId || state.chatTarget?.chat_id || "";
      const query = activeChatId ? `?chat_id=${encodeURIComponent(activeChatId)}` : "";
      const data = await request(`/api/shop/items${query}`);
      state.shopItems = Array.isArray(data.items) && data.items.length
        ? data.items.map((it) => ({
            ...it,
            id: it.id || it.item_id,
            fields: it.fields || DEFAULT_SHOP_ITEMS.find((d) => d.id === (it.id || it.item_id))?.fields || [],
          }))
        : DEFAULT_SHOP_ITEMS;
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
      const itemId = item.id || item.item_id;
      const isAffordable = state.coins >= item.price;
      const diff = item.price - state.coins;
      const btnText = isAffordable ? "Купить" : `Не хватает ${diff} 🪙`;
      const btnClass = isAffordable ? "shop-card-buy-btn" : "shop-card-buy-btn not-enough";
      const btnTitle = isAffordable ? "Купить предмет" : `Недостаточно средств: нужно ещё ${diff} 🪙`;

      return `
        <article class="shop-card ${isAffordable ? "" : "card-disabled"}" data-item-id="${escapeHtml(itemId)}">
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
            <button class="${btnClass}" data-buy-item="${escapeHtml(itemId)}" title="${btnTitle}" ${state.readOnly ? "disabled" : ""}>
              ${btnText}
            </button>
          </div>
        </article>
      `;
    }).join("");
  }

  let selectedShopItem = null;

  function openShopDialog(itemId) {
    const item = state.shopItems.find((i) => (i.id || i.item_id) === itemId) || DEFAULT_SHOP_ITEMS.find((i) => (i.id || i.item_id) === itemId);
    if (!item) return;
    selectedShopItem = { ...item, id: item.id || item.item_id };

    const isAffordable = state.coins >= item.price;
    const diff = item.price - state.coins;

    $("#shop-dialog-title").textContent = item.name;
    $("#shop-dialog-icon").textContent = item.icon || "🎁";
    $("#shop-dialog-item-name").textContent = item.name;
    $("#shop-dialog-item-desc").textContent = item.description || "";
    $("#shop-dialog-price").textContent = item.price;

    const warningEl = $("#shop-dialog-balance-warning");
    const confirmBtn = $("#confirm-buy-btn");

    if (warningEl) {
      if (!isAffordable) {
        warningEl.hidden = false;
        warningEl.innerHTML = `⚠️ <strong>Недостаточно монет:</strong> на балансе <strong>${state.coins} 🪙</strong>, требуется <strong>${item.price} 🪙</strong> (нужно ещё <strong>${diff} 🪙</strong>). Заработайте монеты в мини-играх качалки!`;
      } else {
        warningEl.hidden = true;
        warningEl.textContent = "";
      }
    }

    if (confirmBtn) {
      if (!isAffordable) {
        confirmBtn.disabled = true;
        confirmBtn.classList.add("btn-disabled");
        confirmBtn.innerHTML = `Недостаточно монет (нужно ещё ${diff} 🪙)`;
      } else {
        confirmBtn.disabled = false;
        confirmBtn.classList.remove("btn-disabled");
        confirmBtn.innerHTML = `Купить за 🪙 <span id="confirm-buy-price">${item.price}</span>`;
      }
    }

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
      toast(`❌ Недостаточно монет! Требуется ${selectedShopItem.price} 🪙, а у вас ${state.coins} 🪙`);
      return;
    }

    const details = {};
    const fields = selectedShopItem.fields || [];
    fields.forEach((field) => {
      const el = $(`#shop-input-${field.id}`);
      if (el) details[field.id] = el.value.trim();
    });

    const payload = {
      item_id: selectedShopItem.id,
      chat_id: state.chatId || state.chatTarget?.chat_id || null,
      details: details,
      extra_data: details
    };

    const buyBtn = $("#confirm-buy-btn");
    buyBtn.disabled = true;
    buyBtn.textContent = "Покупка…";

    try {
      const res = await request("/api/shop/buy", {
        method: "POST",
        body: JSON.stringify(payload)
      });

      // Мгновенное списание баланса
      const newBalance = res.new_balance != null ? res.new_balance : (res.balance != null ? res.balance : (state.coins - selectedShopItem.price));
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
      if ((selectedShopItem.id === "custom_roast" || selectedShopItem.id === "roast_friend") && payload.details.target_user) {
        openMessageDraft(`Билли, подколи @${payload.details.target_user.replace(/^@/, '')} | ${payload.details.roast_topic || "без темы"}`);
      } else if (selectedShopItem.id === "compliment_bomb" && payload.details.target_user) {
        openMessageDraft(`Билли, сделай королевский комплимент @${payload.details.target_user.replace(/^@/, '')}!`);
      } else if (selectedShopItem.id === "fake_ban" && payload.details.target_user) {
        openMessageDraft(`Билли, забань молотом @${payload.details.target_user.replace(/^@/, '')} | ${payload.details.reason || "пропуск дня ног"}`);
      } else if (selectedShopItem.id === "slap_friend" && payload.details.target_user) {
        openMessageDraft(`Билли, отвесь леща @${payload.details.target_user.replace(/^@/, '')} | ${payload.details.reason || "нарушение дисциплины"}`);
      } else if ((selectedShopItem.id === "mood_override" || selectedShopItem.id === "mood_change") && payload.details.vibe) {
        openMessageDraft(`/mood ${payload.details.vibe}`);
      } else if (selectedShopItem.id === "golden_fart") {
        openMessageDraft("/fart");
      } else if (selectedShopItem.id === "silent_muter") {
        openMessageDraft("/mute 15");
      } else if (selectedShopItem.id === "dungeon_party") {
        openMessageDraft("/party");
      }
    } catch (err) {
      console.warn("Shop buy error:", err);
      toast(`❌ Ошибка покупки: ${err.message || "Не удалось совершить покупку"}`);
    } finally {
      if (selectedShopItem) {
        const canAffordNow = state.coins >= selectedShopItem.price;
        buyBtn.disabled = !canAffordNow;
        if (canAffordNow) {
          buyBtn.classList.remove("btn-disabled");
          buyBtn.innerHTML = `Купить за 🪙 <span id="confirm-buy-price">${selectedShopItem.price}</span>`;
        } else {
          buyBtn.classList.add("btn-disabled");
          buyBtn.innerHTML = `Недостаточно монет (нужно ещё ${selectedShopItem.price - state.coins} 🪙)`;
        }
      } else {
        buyBtn.disabled = false;
        buyBtn.classList.remove("btn-disabled");
      }
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

      let leaders = Array.isArray(data.leaderboard) ? data.leaderboard : [];

      if (!leaders.length) {
        list.innerHTML = '<p class="empty-state">В кубке этой недели еще никто не набрал очков. Играйте в мини-игры, чтобы попасть в турнирную таблицу!</p>';
        return;
      }

      list.innerHTML = leaders.map((item, index) => {
        const rank = item.rank || (index + 1);
        const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : rank;
        const bonusPrize = rank === 1 ? " • 👑 +500 🪙" : rank === 2 ? " • 🥈 +250 🪙" : rank === 3 ? " • 🥉 +100 🪙" : "";
        const scoreVal = item.total_score != null ? item.total_score : (item.points != null ? item.points : (item.score != null ? item.score : 0));
        return `
          <article class="leader-row rank-${rank}">
            <span class="leader-rank">${medal}</span>
            <div class="leader-name">
              <strong>${escapeHtml(item.user_name || `Игрок ${item.user_id}`)}</strong>
              ${bonusPrize ? `<span style="font-size:11px;color:#d97706;margin-left:4px;">${bonusPrize}</span>` : ""}
            </div>
            <span class="leader-score">${escapeHtml(scoreVal)} очков</span>
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

  // --- Система Достижений (Achievements) ---

  const DEFAULT_ACHIEVEMENTS = [
    { id: "tower_master", name: "Небоскреб качалки", desc: "Построить башню от 20 этажей в Tower Stack", icon: "🏗️", reward: 150, category: "minigames", req_progress: 20 },
    { id: "timber_beast", name: "Лесоруб Билли", desc: "Набрать 50+ очков в Timberman", icon: "🪓", reward: 150, category: "minigames", req_progress: 50 },
    { id: "knife_sniper", name: "Мастер спанкинга", desc: "Набрать 30+ очков в Knife Hit", icon: "🗡️", reward: 150, category: "minigames", req_progress: 30 },
    { id: "hoop_legend", name: "Dungeon Slammer", desc: "Забить 15+ мячей в Баскетболе", icon: "🏀", reward: 150, category: "minigames", req_progress: 15 },
    { id: "brick_breaker", name: "Дробитель кирпичей", desc: "Набрать 500+ очков в Арканоиде", icon: "🧱", reward: 150, category: "minigames", req_progress: 500 },
    { id: "color_god", name: "Радужный флекс", desc: "Набрать 25+ очков в Color Switch", icon: "🌈", reward: 150, category: "minigames", req_progress: 25 },
    { id: "hockey_pro", name: "Гроза шайбы", desc: "Набрать 7+ очков в Аэрохоккее", icon: "🏒", reward: 150, category: "minigames", req_progress: 7 },
    { id: "mole_hunter", name: "Каратель Джаброни", desc: "Набрать 40+ очков в Whack-a-Mole", icon: "🔨", reward: 150, category: "minigames", req_progress: 40 },
    { id: "math_genius", name: "Сила 2048", desc: "Собрать плитку 2048 в игре", icon: "🔢", reward: 300, category: "minigames", req_progress: 2048 },
    { id: "all_rounder", name: "Универсальный атлет", desc: "Сыграть во все 9 мини-игр клуба", icon: "🏅", reward: 400, category: "minigames", req_progress: 9 },
    { id: "game_champion", name: "Покоритель аркад", desc: "Сыграть суммарно 50 раз в мини-игры", icon: "🕹️", reward: 250, category: "minigames", req_progress: 50 },
    { id: "first_words", name: "Добро пожаловать в клуб", desc: "Отправить первое сообщение боту", icon: "💬", reward: 50, category: "chat", req_progress: 1 },
    { id: "chat_warrior", name: "Разговорчивый слейв", desc: "Написать 100+ сообщений в чатах", icon: "🗣️", reward: 200, category: "chat", req_progress: 100 },
    { id: "night_owl", name: "Ночной качок", desc: "Общаться с ботом после 02:00 ночи (02:00 - 05:00)", icon: "🦉", reward: 100, category: "chat", req_progress: 1 },
    { id: "chat_veteran", name: "Ветеран качалки", desc: "Написать 500+ сообщений в чатах", icon: "🎖️", reward: 500, category: "chat", req_progress: 500 },
    { id: "streak_week", name: "Железная дисциплина", desc: "Стрик ежедневного входа 7 дней подряд", icon: "🔥", reward: 300, category: "economy", req_progress: 7 },
    { id: "first_purchase", name: "Первая примерка кожи", desc: "Купить любой товар в магазине", icon: "🛍️", reward: 100, category: "economy", req_progress: 1 },
    { id: "big_spender", name: "Three Hundred Bucks", desc: "Потратить суммарно 300+ монет в магазине", icon: "💵", reward: 200, category: "economy", req_progress: 300 },
    { id: "gold_hoard", name: "Золотой слиток", desc: "Накопить баланс от 1000 монет", icon: "💰", reward: 250, category: "economy", req_progress: 1000 },
    { id: "lord_of_gym", name: "Boss of this Gym", desc: "Накопить 5000 монет или купить VIP-статус", icon: "👑", reward: 1000, category: "economy", req_progress: 1 },
    { id: "first_gear", name: "Первый лут", desc: "Получить свой первый предмет в инвентарь", icon: "📦", reward: 50, category: "inventory", req_progress: 1 },
    { id: "hoarder", name: "Плюшкин подземелья", desc: "Собрать 10 уникальных предметов в инвентаре", icon: "🎒", reward: 200, category: "inventory", req_progress: 10 },
    // Новые элитные достижения
    { id: "tower_titan", name: "Титанический жим", desc: "Построить башню от 40 этажей в Tower Stack", icon: "🏛️", reward: 350, category: "minigames", req_progress: 40 },
    { id: "timber_legend", name: "Реликтовый дровосек", desc: "Набрать 100+ очков в Timberman", icon: "🌲", reward: 350, category: "minigames", req_progress: 100 },
    { id: "knife_god", name: "Виртуозный спанкинг", desc: "Набрать 60+ очков в Knife Hit", icon: "⚔️", reward: 350, category: "minigames", req_progress: 60 },
    { id: "hoop_allstar", name: "Слэмданк Чемпион", desc: "Забить 30+ мячей в Баскетболе", icon: "🔥", reward: 350, category: "minigames", req_progress: 30 },
    { id: "brick_annihilator", name: "Сокрушитель блоков", desc: "Набрать 1500+ очков в Арканоиде", icon: "💥", reward: 350, category: "minigames", req_progress: 1500 },
    { id: "color_master", name: "Повелитель спектра", desc: "Набрать 50+ очков в Color Switch", icon: "🔮", reward: 350, category: "minigames", req_progress: 50 },
    { id: "hockey_legend", name: "Ледовый Монарх", desc: "Набрать 15+ очков в Аэрохоккее", icon: "🏆", reward: 350, category: "minigames", req_progress: 15 },
    { id: "mole_terminator", name: "Гроза всех Джаброни", desc: "Набрать 80+ очков в Whack-a-Mole", icon: "⚡", reward: 350, category: "minigames", req_progress: 80 },
    { id: "math_emperor", name: "Магистр 4096", desc: "Собрать плитку 4096 в 2048 Gym Power", icon: "♾️", reward: 600, category: "minigames", req_progress: 4096 },
    { id: "arcade_god", name: "Легенда игровых автоматов", desc: "Сыграть суммарно 100 раз в мини-игры клуба", icon: "👑", reward: 500, category: "minigames", req_progress: 100 },
    { id: "chat_legend", name: "Голос Подземелья", desc: "Написать 1000+ сообщений в чатах", icon: "📢", reward: 800, category: "chat", req_progress: 1000 },
    { id: "lethal_gladiator", name: "Смертоносный боец", desc: "Совершить 5 смертельных ударов персонажам в ролевой игре", icon: "💀", reward: 300, category: "chat", req_progress: 5 },
    { id: "early_bird", name: "Утренняя разминка", desc: "Общаться в чате ранним утром (с 06:00 до 09:00)", icon: "🌅", reward: 150, category: "chat", req_progress: 1 },
    { id: "story_explorer", name: "Исследователь судеб", desc: "Опробовать 5 различных архетипов персонажей", icon: "🎭", reward: 250, category: "chat", req_progress: 5 },
    { id: "streak_month", name: "Стальной характер", desc: "Стрик ежедневного входа 30 дней подряд", icon: "💎", reward: 1000, category: "economy", req_progress: 30 },
    { id: "shopaholic", name: "Постоянный клиент $300 Store", desc: "Купить 5 различных товаров или розыгрышей в магазине", icon: "🛍️", reward: 300, category: "economy", req_progress: 5 },
    { id: "millionaire_slave", name: "Олигарх Качалки", desc: "Накопить баланс от 3000 монет", icon: "🏦", reward: 500, category: "economy", req_progress: 3000 },
    { id: "cup_champion", name: "Покоритель Кубка", desc: "Набрать 500+ турнирных очков в еженедельном кубке", icon: "🏆", reward: 500, category: "economy", req_progress: 500 },
    { id: "leather_collector", name: "Коллекционер кожи", desc: "Собрать 20 уникальных предметов в инвентаре", icon: "🥋", reward: 400, category: "inventory", req_progress: 20 },
    { id: "generous_master", name: "Щедрый Босс", desc: "Передать предмет другому игроку через команду /giveitem", icon: "🤝", reward: 150, category: "inventory", req_progress: 1 }
  ];

  async function loadAchievements() {
    const grid = $("#achievements-grid");
    if (!grid) return;

    try {
      const data = await request("/api/achievements");
      state.achievements = Array.isArray(data.achievements) && data.achievements.length ? data.achievements : null;
    } catch (e) {
      console.warn("Achievements fetch failed, using fallback list", e);
    }

    if (!state.achievements || !state.achievements.length) {
      // Собираем локальный прогресс из localStorage для мини-игр
      const getScore = (key) => parseInt(localStorage.getItem(key) || "0", 10);
      const towerScore = getScore("tower_stack_best_score");
      const timberScore = getScore("timberman_best_score");
      const knifeScore = getScore("knife_best_score");
      const basketScore = getScore("basketball_best_score");
      const bricksScore = getScore("brick_breaker_best_score");
      const colorScore = getScore("colorswitch_best_score");
      const hockeyScore = getScore("air_hockey_best_score");
      const whackScore = getScore("whack_mole_best_score");
      const g2048Score = getScore("game_2048_best");

      state.achievements = DEFAULT_ACHIEVEMENTS.map(ach => {
        let curr = 0;
        let unlocked = false;
        if (ach.id === "tower_master") { curr = towerScore; unlocked = curr >= 20; }
        else if (ach.id === "tower_titan") { curr = towerScore; unlocked = curr >= 40; }
        else if (ach.id === "timber_beast") { curr = timberScore; unlocked = curr >= 50; }
        else if (ach.id === "timber_legend") { curr = timberScore; unlocked = curr >= 100; }
        else if (ach.id === "knife_sniper") { curr = knifeScore; unlocked = curr >= 30; }
        else if (ach.id === "knife_god") { curr = knifeScore; unlocked = curr >= 60; }
        else if (ach.id === "hoop_legend") { curr = basketScore; unlocked = curr >= 15; }
        else if (ach.id === "hoop_allstar") { curr = basketScore; unlocked = curr >= 30; }
        else if (ach.id === "brick_breaker") { curr = bricksScore; unlocked = curr >= 500; }
        else if (ach.id === "brick_annihilator") { curr = bricksScore; unlocked = curr >= 1500; }
        else if (ach.id === "color_god") { curr = colorScore; unlocked = curr >= 25; }
        else if (ach.id === "color_master") { curr = colorScore; unlocked = curr >= 50; }
        else if (ach.id === "hockey_pro") { curr = hockeyScore; unlocked = curr >= 7; }
        else if (ach.id === "hockey_legend") { curr = hockeyScore; unlocked = curr >= 15; }
        else if (ach.id === "mole_hunter") { curr = whackScore; unlocked = curr >= 40; }
        else if (ach.id === "mole_terminator") { curr = whackScore; unlocked = curr >= 80; }
        else if (ach.id === "math_genius") { curr = g2048Score; unlocked = curr >= 2048; }
        else if (ach.id === "math_emperor") { curr = g2048Score; unlocked = curr >= 4096; }
        else if (ach.id === "first_words") { curr = 1; unlocked = true; }
        else if (ach.id === "streak_week") { curr = state.dailyStreak || 1; unlocked = curr >= 7; }
        else if (ach.id === "streak_month") { curr = state.dailyStreak || 1; unlocked = curr >= 30; }
        else if (ach.id === "gold_hoard") { curr = state.coins || 0; unlocked = curr >= 1000; }
        else if (ach.id === "millionaire_slave") { curr = state.coins || 0; unlocked = curr >= 3000; }
        else if (ach.id === "lord_of_gym") { curr = (state.coins >= 5000 || (state.activePerks || []).some(p => (p.id || p.perk_id) === "vip_badge")) ? 1 : 0; unlocked = curr >= 1; }
        else if (ach.id === "first_gear") { curr = state.items?.length ? 1 : 0; unlocked = curr >= 1; }
        else if (ach.id === "hoarder") { curr = state.items?.length || 0; unlocked = curr >= 10; }
        else if (ach.id === "leather_collector") { curr = state.items?.length || 0; unlocked = curr >= 20; }
        else if (ach.id === "shopaholic") { curr = (state.activePerks || []).length; unlocked = curr >= 5; }

        return {
          ...ach,
          current_progress: curr,
          unlocked: unlocked,
          claimed: false,
        };
      });
    }

    renderAchievements();
  }

  function renderAchievements() {
    const grid = $("#achievements-grid");
    const countEl = $("#achievements-count");
    if (!grid) return;

    const achs = state.achievements || [];
    const unlockedCount = achs.filter(a => a.unlocked).length;
    if (countEl) {
      countEl.textContent = `${unlockedCount} / ${achs.length}`;
    }

    const filter = state.achFilter || "all";
    const filtered = achs.filter(a => filter === "all" || a.category === filter);

    if (!filtered.length) {
      grid.innerHTML = '<p class="empty-state">Нет достижений в этой категории.</p>';
      return;
    }

    grid.innerHTML = filtered.map(ach => {
      const isUnlocked = !!ach.unlocked;
      const isClaimed = !!ach.claimed;
      const cardClass = isClaimed
        ? "achievement-card claimed"
        : (isUnlocked ? "achievement-card unlocked unclaimed" : "achievement-card locked");

      const req = ach.req_progress || 1;
      const curr = isUnlocked ? req : Math.min(ach.current_progress || 0, req);
      const pct = Math.min(100, Math.round((curr / req) * 100));

      let actionHtml = "";
      if (isClaimed) {
        actionHtml = '<span class="ach-claimed-badge">✅ Получено</span>';
      } else if (isUnlocked) {
        actionHtml = `<button class="ach-claim-btn" data-claim-ach="${escapeHtml(ach.id)}">Забрать 🪙 ${ach.reward}</button>`;
      } else {
        actionHtml = '<span class="ach-locked-badge">🔒 Заблокировано</span>';
      }

      return `
        <article class="${cardClass}" data-ach-id="${escapeHtml(ach.id)}">
          <div class="ach-card-header">
            <div class="ach-icon-box">
              <span>${ach.icon || "🏅"}</span>
              ${!isUnlocked ? '<span class="ach-lock-badge">🔒</span>' : ''}
            </div>
            <div class="ach-info">
              <h3 class="ach-title">${escapeHtml(ach.name)}</h3>
              <p class="ach-desc">${escapeHtml(ach.desc)}</p>
            </div>
          </div>

          <div class="ach-progress-section">
            <div class="ach-progress-labels">
              <span>Прогресс</span>
              <span>${curr} / ${req} (${pct}%)</span>
            </div>
            <div class="ach-progress-track">
              <div class="ach-progress-fill" style="width: ${pct}%"></div>
            </div>
          </div>

          <div class="ach-footer">
            <div class="ach-reward-badge">
              <span>🪙</span>
              <span>+${ach.reward}</span>
            </div>
            <div class="ach-action-area">
              ${actionHtml}
            </div>
          </div>
        </article>
      `;
    }).join("");
  }

  async function handleClaimAchievement(achId) {
    if (!achId) return;
    const btn = $(`[data-claim-ach="${achId}"]`);
    if (btn) btn.disabled = true;

    try {
      const res = await request("/api/achievements/claim", {
        method: "POST",
        body: JSON.stringify({ achievement_id: achId }),
      });
      const data = res.result || res;
      if (data.balance != null) {
        updateBalanceDisplay(data.balance);
      } else if (data.reward) {
        updateBalanceDisplay(state.coins + data.reward);
      }

      toast(data.message || "🎉 Награда успешно получена!");

      // Обновляем статус ачивки локально
      const target = (state.achievements || []).find(a => a.id === achId);
      if (target) {
        target.claimed = true;
      }
      renderAchievements();
    } catch (err) {
      console.warn("Claim error:", err);
      toast(err.message || "Ошибка получения награды");
      if (btn) btn.disabled = false;
    }
  }

  function setupGameModal() {
    const modal = $("#game-modal");
    const iframe = $("#game-iframe");
    const closeBtn = $("#close-game-modal");
    const modalTitle = $(".game-modal-title");

    function openGame(gameKey, title, path) {
      if (!modal || !iframe) return;
      selectedGame = gameKey;
      const query = state.chatId ? `?chat_id=${encodeURIComponent(state.chatId)}` : "";
      if (modalTitle) modalTitle.textContent = title;
      iframe.src = `${path}${query}`;
      modal.showModal();
    }

    // Слушатели кнопок запуска игр
    $("#launch-tower")?.addEventListener("click", () => openGame("tower_stack", "🏗 Стек Штанги • Dungeon Bench", "/games/tower/index.html"));
    $("#launch-timber")?.addEventListener("click", () => openGame("timberjack", "🪓 Leather Lumberjack • Лесоруб Билли", "/games/timberman/index.html"));
    $("#launch-knife")?.addEventListener("click", () => openGame("knife_hit", "🎯 Метание дилдо / Спанкинг • Spank Hit", "/games/knife/index.html"));
    $("#launch-basketball")?.addEventListener("click", () => openGame("swipe_basketball", "🏀 Dungeon Slam • Бросок в кольцо", "/games/basketball/index.html"));
    $("#launch-bricks")?.addEventListener("click", () => openGame("brick_breaker", "🧱 Smash the Jabroni • Кибер-Дробилка", "/games/bricks/index.html?v=20261116_perf2"));
    $("#launch-colorswitch")?.addEventListener("click", () => openGame("colorswitch", "🌈 Rainbow Dungeon • Цветной флекс", "/games/colorswitch/index.html"));
    $("#launch-airhockey")?.addEventListener("click", () => openGame("air_hockey", "🏒 Ice Gym Clash • Аэрохоккей Слейвов", "/games/airhockey/index.html"));
    $("#launch-whack")?.addEventListener("click", () => openGame("whack_mole", "🔨 Whack the Jabroni • Накажи Слейва", "/games/whack/index.html"));
    $("#launch-2048")?.addEventListener("click", () => openGame("game_2048", "🔢 2048 Gym Power • Сила трех сотен баксов", "/games/game2048/index.html"));

    // Быстрый переключатель таблицы рекордов по кнопкам «🏆 Топ» у каждой карточки
    $("#games-grid")?.addEventListener("click", (event) => {
      const topBtn = event.target.closest("[data-leaderboard-for]");
      if (topBtn) {
        const gameKey = topBtn.dataset.leaderboardFor;
        if (gameKey) {
          const targetCard = topBtn.closest(".game-hub-card");
          const existingDrawer = targetCard?.querySelector(".game-card-leaderboard");
          if (existingDrawer) {
            // Если уже открыт под этой карточкой — сворачиваем при повторном клике
            existingDrawer.remove();
            targetCard.classList.remove("active-leaderboard-card");
            topBtn.classList.remove("active");
          } else {
            selectedGame = gameKey;
            loadGameLeaderboard(gameKey).catch(() => {});
            targetCard?.scrollIntoView({ behavior: "smooth", block: "nearest" });
          }
        }
      }
    });

    // Функция показа модального экрана Game Over с лидербордом поверх игры
    async function showGameOverLeaderboard(gameKey, score) {
      const overOverlay = $("#game-over-overlay");
      const overScore = $("#game-over-score");
      const overGameName = $("#game-over-game-name");
      const overList = $("#game-over-lb-list");
      if (!overOverlay) return;

      const info = GAME_INFO_MAP[gameKey] || GAME_INFO_MAP[selectedGame] || GAME_INFO_MAP.tower_stack;
      if (overScore) overScore.textContent = score != null ? score : "0";
      if (overGameName) overGameName.textContent = info.title.replace(/^Лидеры\s*/, '');
      if (overList) overList.innerHTML = '<div class="loading-state" style="padding:10px 0;font-size:12px;">Загружаем таблицу лидеров…</div>';

      overOverlay.style.display = "flex";

      try {
        const leaders = await loadGameLeaderboard(gameKey);
        if (overList) {
          if (!leaders || !leaders.length) {
            overList.innerHTML = `<p class="empty-state" style="padding:8px 0;font-size:12px;">${info.empty}</p>`;
          } else {
            // Показываем Топ-5 лидеров
            overList.innerHTML = leaders.slice(0, 5).map((item, index) => `
              <article class="leader-row rank-${index + 1}">
                <span class="leader-rank">${index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : index + 1}</span>
                <span class="leader-name">${escapeHtml(item.user_name || `Игрок ${item.user_id}`)}</span>
                <span class="leader-score">${escapeHtml(item.score)}</span>
              </article>
            `).join("");
          }
        }
      } catch (_) {
        if (overList) overList.innerHTML = '<p class="empty-state">Рекорды обновлены!</p>';
      }
    }

    $("#game-over-retry")?.addEventListener("click", () => {
      const overOverlay = $("#game-over-overlay");
      if (overOverlay) overOverlay.style.display = "none";
      if (iframe) {
        try {
          iframe.contentWindow?.location?.reload();
        } catch (_) {
          iframe.src = iframe.src;
        }
      }
    });

    $("#game-over-close")?.addEventListener("click", () => {
      const overOverlay = $("#game-over-overlay");
      if (overOverlay) overOverlay.style.display = "none";
      if (closeBtn) closeBtn.click();
    });

    if (closeBtn && modal && iframe) {
      closeBtn.addEventListener("click", () => {
        const overOverlay = $("#game-over-overlay");
        if (overOverlay) overOverlay.style.display = "none";
        iframe.src = "about:blank";
        modal.close();
        loadGameLeaderboard().catch(() => {});
        // Фокус на карточке игры
        const card = document.querySelector(`.game-hub-card[data-game="${selectedGame}"]`);
        if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }

    // Слушатель сообщений от iframe игр
    window.addEventListener("message", (event) => {
      const d = event.data;
      if (!d) return;
      if (d.type === "CLOSE_GAME") {
        if (closeBtn) closeBtn.click();
      } else if (d.type === "GAME_OVER" || d.type === "SUBMIT_SCORE") {
        const gameKey = d.game || selectedGame;
        const score = d.score;
        showGameOverLeaderboard(gameKey, score).catch(() => {});
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

  function switchTab(tabName) {
    if (!tabName) return;
    const targetNavBtn = document.querySelector(`.bottom-nav-item[data-tab="${tabName}"]`);
    document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === tabName));
    document.querySelectorAll(".bottom-nav-item").forEach((bnav) => {
      if (bnav.dataset.tab) {
        bnav.classList.toggle("active", bnav.dataset.tab === tabName);
      }
    });
    // Если выбран раздел из выпадающего меню «Ещё», подсвечиваем кнопку «Ещё»
    const moreTabs = ["achievements", "fame", "archetypes", "prompt", "help"];
    const moreBtn = document.getElementById("bottom-nav-more-btn");
    if (moreBtn) {
      moreBtn.classList.toggle("active", moreTabs.includes(tabName));
    }

    document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === `${tabName}-view`));
    
    if (targetNavBtn) {
      targetNavBtn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }

  document.querySelectorAll(".tab").forEach((button) => button.addEventListener("click", () => {
    switchTab(button.dataset.tab);
  }));

  document.querySelectorAll(".bottom-nav-item[data-tab]").forEach((button) => button.addEventListener("click", () => {
    switchTab(button.dataset.tab);
  }));

  // Обработка кнопки «Ещё» (☰) и модального меню
  const moreSheet = document.getElementById("more-menu-sheet");
  const moreBtn = document.getElementById("bottom-nav-more-btn");
  const moreSheetClose = document.getElementById("more-sheet-close");
  const moreSheetBackdrop = document.getElementById("more-sheet-backdrop");

  if (moreBtn && moreSheet) {
    moreBtn.addEventListener("click", () => {
      moreSheet.showModal();
    });
  }

  if (moreSheetClose && moreSheet) {
    moreSheetClose.addEventListener("click", () => {
      moreSheet.close();
    });
  }

  if (moreSheetBackdrop && moreSheet) {
    moreSheetBackdrop.addEventListener("click", () => {
      moreSheet.close();
    });
  }

  document.querySelectorAll(".more-menu-tile").forEach((tile) => {
    tile.addEventListener("click", () => {
      const tab = tile.dataset.tab;
      if (tab) {
        if (moreSheet) moreSheet.close();
        switchTab(tab);
      }
    });
  });
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

  // Обработчики клика по фильтрам и кнопкам клейма достижений
  document.addEventListener("click", (event) => {
    const filterBtn = event.target.closest(".ach-filter-btn");
    if (filterBtn) {
      document.querySelectorAll(".ach-filter-btn").forEach(b => b.classList.toggle("active", b === filterBtn));
      state.achFilter = filterBtn.dataset.filter || "all";
      renderAchievements();
      return;
    }

    const claimBtn = event.target.closest("[data-claim-ach]");
    if (claimBtn) {
      const achId = claimBtn.dataset.claimAch;
      if (achId) {
        handleClaimAchievement(achId);
      }
    }
  });

  setupGameModal();

  load().catch((error) => {
    showStatus(`Не удалось загрузить инвентарь: ${error.message}. Нажмите ↻, чтобы повторить.`, true);
  });
})();
