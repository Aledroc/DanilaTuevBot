(() => {
  const tg = window.parent?.Telegram?.WebApp || window.Telegram?.WebApp;
  tg?.ready();
  tg?.expand();

  // Параметры запуска
  const searchParams = new URLSearchParams(window.location.search);
  const chatId = searchParams.get('chat_id') || tg?.initDataUnsafe?.chat?.id || null;
  const initData = tg?.initData || '';
  const userName = tg?.initDataUnsafe?.user?.first_name || 'Снайпер';

  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');

  // Звуки
  let soundEnabled = true;
  const sounds = {
    swish: new Audio('/games/basketball/assets/audio/swish.wav'),
    rim: new Audio('/games/basketball/assets/audio/rim.wav'),
    backboard: new Audio('/games/basketball/assets/audio/backboard.wav'),
    score: new Audio('/games/basketball/assets/audio/score.wav'),
    swipe: new Audio('/games/basketball/assets/audio/swipe.wav'),
  };

  function playSfx(name) {
    if (!soundEnabled) return;
    try {
      const s = sounds[name];
      if (s) {
        s.currentTime = 0;
        s.play().catch(() => {});
      }
    } catch (_) {}
  }

  // Константы игрового поля (Canvas 720x1280)
  const CW = 720;
  const CH = 1280;

  // Баскетбольный щит и кольцо
  let hoopX = CW / 2;
  const HOOP_Y = 330;
  const BACKBOARD_WIDTH = 280;
  const BACKBOARD_HEIGHT = 180;
  const BACKBOARD_TOP = HOOP_Y - 140;
  const RIM_WIDTH = 150; // Расширено для честного диаметра корзины
  const RIM_RADIUS = 10;
  const RIM_Y = HOOP_Y;
  const NET_HEIGHT = 95;

  // Параметры мяча
  const BALL_BASE_RADIUS = 52;
  const BALL_START_X = CW / 2;
  const BALL_START_Y = 1060;

  // Гравитация и физика
  const GRAVITY = 0.72; // Более плавная и предсказуемая баллистическая дуга
  const TARGET_DEPTH_SCALE = 0.52; // Размер мяча у кольца: r ~ 27px, диаметр ~ 54px vs RIM_WIDTH 150px
  const SCALE_SPEED = 0.013; // Уменьшение при удалении к кольцу
  let netSway = 0; // Анимация колыхания сетки при попадании
  let netSwayVx = 0;

  // Состояние игры
  let gameState = 'START'; // 'START' | 'PLAYING' | 'GAMEOVER'
  let score = 0;
  let combo = 0;
  let streak = 0; // комбо чистых попаданий или серии
  let isOnFire = false;
  let timeLeft = 45;
  let gameTimer = null;
  let bestScore = 0;

  try {
    bestScore = parseInt(localStorage.getItem('basketball_best_score') || '0', 10);
  } catch (_) {}

  // Движение кольца (усложнение с ростом счёта)
  let hoopSpeed = 0;
  let hoopDirection = 1;

  // Объект мяча
  const ball = {
    x: BALL_START_X,
    y: BALL_START_Y,
    vx: 0,
    vy: 0,
    rot: 0,
    vrot: 0,
    scale: 1.0,
    state: 'READY', // 'READY' | 'FLIGHT' | 'SCORED' | 'MISSED' | 'RESETTING'
    touchedRim: false,
    passedAboveRim: false,
    scored: false,
    resetProgress: 0,
    trail: [],
    inNetTimer: 0
  };

  // Частицы
  const particles = [];
  const scorePopups = [];
  let screenShake = 0;

  // Таймер обратного отсчета
  function startTimer() {
    if (gameTimer) clearInterval(gameTimer);
    timeLeft = 45;
    gameTimer = setInterval(() => {
      if (gameState === 'PLAYING') {
        timeLeft--;
        if (timeLeft <= 0) {
          timeLeft = 0;
          gameOver();
        }
      }
    }, 1000);
  }

  function stopTimer() {
    if (gameTimer) {
      clearInterval(gameTimer);
      gameTimer = null;
    }
  }

  function gameOver() {
    gameState = 'GAMEOVER';
    stopTimer();
    if (score > bestScore) {
      bestScore = score;
      try {
        localStorage.setItem('basketball_best_score', bestScore.toString());
      } catch (_) {}
    }
    submitScore(score);
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'GAME_OVER', game: 'swipe_basketball', score: score }, '*');
    }
  }

  async function submitScore(finalScore) {
    try {
      const payload = {
        game: 'swipe_basketball',
        score: finalScore,
        chat_id: chatId,
        user_name: userName,
      };
      const headers = { 'Content-Type': 'application/json' };
      if (initData) headers['X-Telegram-Init-Data'] = initData;

      await fetch('/api/game/submit_score', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
    } catch (err) {
      console.warn('Failed to submit basketball score:', err);
    }
  }

  function resetBall() {
    ball.x = BALL_START_X;
    ball.y = BALL_START_Y;
    ball.vx = 0;
    ball.vy = 0;
    ball.rot = 0;
    ball.vrot = 0;
    ball.scale = 1.0;
    ball.state = 'READY';
    ball.touchedRim = false;
    ball.passedAboveRim = false;
    ball.scored = false;
    ball.resetProgress = 0;
    ball.trail = [];
    ball.inNetTimer = 0;
  }

  function startGame() {
    score = 0;
    combo = 0;
    streak = 0;
    isOnFire = false;
    hoopX = CW / 2;
    hoopSpeed = 0;
    resetBall();
    gameState = 'PLAYING';
    startTimer();
  }

  // Обновление физики и логики
  function update() {
    if (screenShake > 0) screenShake *= 0.88;
    if (screenShake < 0.2) screenShake = 0;

    // Движение кольца при счёте > 4
    if (gameState === 'PLAYING') {
      if (score >= 12) {
        hoopSpeed = 3.6;
      } else if (score >= 8) {
        hoopSpeed = 2.6;
      } else if (score >= 4) {
        hoopSpeed = 1.6;
      } else {
        hoopSpeed = 0;
      }

      if (hoopSpeed > 0) {
        hoopX += hoopSpeed * hoopDirection;
        const maxOffset = 160;
        if (hoopX > CW / 2 + maxOffset) {
          hoopX = CW / 2 + maxOffset;
          hoopDirection = -1;
        } else if (hoopX < CW / 2 - maxOffset) {
          hoopX = CW / 2 - maxOffset;
          hoopDirection = 1;
        }
      }
    }

    // Физика сетки
    if (Math.abs(netSway) > 0.1 || Math.abs(netSwayVx) > 0.1) {
      netSwayVx += -netSway * 0.12; // пружина
      netSwayVx *= 0.88; // трение
      netSway += netSwayVx;
    } else {
      netSway = 0;
      netSwayVx = 0;
    }

    // Физика мяча в полете
    if (ball.state === 'FLIGHT' || ball.state === 'SCORED' || ball.state === 'MISSED') {
      // Обновляем трейл (особенно эффектный при On Fire)
      ball.trail.push({ x: ball.x, y: ball.y, scale: ball.scale, life: 1.0 });
      if (ball.trail.length > (isOnFire ? 18 : 8)) ball.trail.shift();

      // Если мяч проваливается сквозь сетку (SCORED)
      if (ball.state === 'SCORED') {
        ball.inNetTimer++;
        // Плавное притяжение к центру кольца и легкое торможение в сетке
        ball.vx *= 0.82;
        ball.x += (hoopX - ball.x) * 0.15;
        ball.vy = Math.min(ball.vy + GRAVITY * 0.7, 10);
        ball.y += ball.vy;
        ball.rot += ball.vrot * 0.5;
      } else {
        ball.x += ball.vx;
        ball.y += ball.vy;
        ball.vy += GRAVITY;
        ball.rot += ball.vrot;
      }

      // Перспектива: плавное масштабирование к глубине кольца
      // Зависит от высоты полета относительно кольца и старта
      if (ball.scale > TARGET_DEPTH_SCALE) {
        ball.scale -= SCALE_SPEED;
        if (ball.scale < TARGET_DEPTH_SCALE) ball.scale = TARGET_DEPTH_SCALE;
      }

      const curRadius = BALL_BASE_RADIUS * ball.scale;

      // Геометрия кольца
      const rimLeftX = hoopX - RIM_WIDTH / 2;
      const rimRightX = hoopX + RIM_WIDTH / 2;
      const rimY = RIM_Y;

      // Щит (отскок от щита)
      const boardLeft = hoopX - BACKBOARD_WIDTH / 2;
      const boardRight = hoopX + BACKBOARD_WIDTH / 2;
      const boardBottom = BACKBOARD_TOP + BACKBOARD_HEIGHT;

      // Коллизия с щитом (срабатывает около кольца и выше обода)
      if (ball.state !== 'SCORED' && ball.scale <= TARGET_DEPTH_SCALE + 0.15) {
        if (ball.x >= boardLeft && ball.x <= boardRight && ball.y >= BACKBOARD_TOP && ball.y <= boardBottom) {
          // Если летит вверх или горизонтально в щит, отскок вниз и в сторону кольца
          if (ball.vy < 2 || (ball.y < rimY && ball.vy < 8)) {
            ball.vy = Math.abs(ball.vy) * 0.5 + 2.5;
            // Мягкий отскок от щита в сторону корзины
            ball.vx = (hoopX - ball.x) * 0.08 + (ball.vx * -0.3);
            playSfx('backboard');
            screenShake = Math.max(screenShake, 4);
          }
        }
      }

      // Отслеживание прохождения над кольцом (или на уровне обода)
      if (ball.y < rimY + 10) {
        ball.passedAboveRim = true;
      }

      // Входное окно кольца (щедрое и честное)
      // Допуск к центру: при RIM_WIDTH=150, радиус ~75.
      // Мяч r~27. Внутренний проём ~96px.
      // Добавляем допуск магнетизма: если мяч падает вниз через створ кольца
      const distToHoopCenter = Math.abs(ball.x - hoopX);
      const isOverHoopOpening = distToHoopCenter < (RIM_WIDTH / 2 - 8);

      // Проверка попадания в корзину (через дужку вниз)
      if (
        !ball.scored &&
        ball.passedAboveRim &&
        ball.vy > 0 &&
        ball.y >= rimY - 8 &&
        ball.y <= rimY + 50 &&
        isOverHoopOpening
      ) {
        ball.scored = true;
        ball.state = 'SCORED';

        // Эффект колыхания сетки
        netSwayVx = (ball.vx || (Math.random() - 0.5) * 6) * 1.5;
        netSway = (ball.x - hoopX) * 0.4;

        const isSwish = !ball.touchedRim;
        streak++;
        if (isSwish) {
          combo++;
        } else {
          combo = 1;
        }

        // Если 3 попадания подряд — On Fire!
        if (streak >= 3) {
          isOnFire = true;
        }

        const addedScore = isSwish ? (2 + Math.min(combo, 5)) : 1;
        score += addedScore;
        if (score > bestScore) bestScore = score;

        playSfx(isSwish ? 'swish' : 'score');
        screenShake = isSwish ? 7 : 4;

        scorePopups.push({
          x: hoopX,
          y: rimY - 30,
          text: isSwish ? `SWISH! ЧИСТЫЙ БРОСОК! +${addedScore}` : `+${addedScore} BUCKS`,
          color: isSwish ? '#ffd700' : '#00f0ff',
          scale: isSwish ? 1.4 : 1.0,
          life: 1.0
        });

        // Частицы конфетти / огня / золота из сетки
        createGoalParticles(hoopX, rimY + 30, isOnFire);
      }

      // Коллизии с левой и правой дужкой кольца (только если не забили)
      if (!ball.scored) {
        checkRimCollision(rimLeftX, rimY, curRadius, -1);
        checkRimCollision(rimRightX, rimY, curRadius, 1);
      }

      // Проверка падения за пределы экрана
      if (ball.y > CH + 150 || ball.x < -150 || ball.x > CW + 150) {
        if (!ball.scored && ball.state !== 'MISSED') {
          // Промах сбрасывает комбо и On Fire
          streak = 0;
          combo = 0;
          isOnFire = false;
          scorePopups.push({
            x: CW / 2,
            y: CH * 0.72,
            text: '💀 МИМО КОРЗИНЫ — 10 ОТЖИМАНИЙ!',
            color: '#ff4d4f',
            scale: 1.1,
            life: 1.0
          });
        }
        ball.state = 'RESETTING';
      }
    }

    // Плавный возврат мяча на исходную позицию
    if (ball.state === 'RESETTING') {
      resetBall();
    }

    // Частицы
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.gravity || 0.15;
      p.life -= p.decay;
      if (p.life <= 0) particles.splice(i, 1);
    }

    // Всплывающие очки
    for (let i = scorePopups.length - 1; i >= 0; i--) {
      const sp = scorePopups[i];
      sp.y -= 1.6;
      sp.life -= 0.02;
      if (sp.life <= 0) scorePopups.splice(i, 1);
    }
  }

  function checkRimCollision(rx, ry, radius, rimSide) {
    // Проверяем коллизию только когда мяч на нужной глубине
    if (ball.scale > TARGET_DEPTH_SCALE + 0.15 || ball.scale < TARGET_DEPTH_SCALE - 0.08) return;

    const dx = ball.x - rx;
    const dy = ball.y - ry;
    const dist = Math.hypot(dx, dy);

    // Коллизия с дужкой
    if (dist < radius + RIM_RADIUS) {
      ball.touchedRim = true;
      playSfx('rim');
      screenShake = Math.max(screenShake, 3);

      // Вектор от центра дужки к центру мяча
      const nx = dx / (dist || 1);
      const ny = dy / (dist || 1);

      // Если мяч падает сверху и находится ближе к внутренней части корзины
      // Даем мягкий «закрут» / воронку внутрь (мягкий отскок в сторону центра)
      const isInnerSide = (rimSide < 0 && dx > 0) || (rimSide > 0 && dx < 0);
      if (ball.vy > 0 && isInnerSide && Math.abs(dx) < radius * 0.9) {
        // Мяч соскальзывает внутрь кольца
        ball.vx += rimSide < 0 ? 1.5 : -1.5;
        ball.vy *= 0.75;
        // Легкое покачивание сетки
        netSwayVx += (rimSide < 0 ? 1.8 : -1.8);
      } else {
        // Отражение вектора скорости с упругостью (bounciness 0.6)
        const dot = ball.vx * nx + ball.vy * ny;
        if (dot < 0) {
          ball.vx = (ball.vx - 1.5 * dot * nx) * 0.65;
          ball.vy = (ball.vy - 1.5 * dot * ny) * 0.65;
          ball.x = rx + nx * (radius + RIM_RADIUS + 1);
          ball.y = ry + ny * (radius + RIM_RADIUS + 1);
        }
      }
    }
  }

  function createGoalParticles(x, y, onFire) {
    const count = onFire ? 24 : 14;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI / count) * i + Math.PI / 4;
      const speed = Math.random() * 6 + 2;
      particles.push({
        x: x + (Math.random() - 0.5) * 40,
        y: y,
        vx: Math.cos(angle) * speed * (Math.random() > 0.5 ? 1 : -1),
        vy: (Math.random() - 0.7) * 7,
        gravity: 0.22,
        size: Math.random() * 8 + 4,
        color: onFire
          ? ['#ff3300', '#ff9900', '#ffdd00', '#ffffff'][Math.floor(Math.random() * 4)]
          : ['#2ecc71', '#3498db', '#f1c40f', '#e74c3c'][Math.floor(Math.random() * 4)],
        life: 1.0,
        decay: Math.random() * 0.03 + 0.02
      });
    }
  }

  // --- Отрисовка игры ---
  function render() {
    ctx.save();
    ctx.clearRect(0, 0, CW, CH);

    if (screenShake > 0) {
      const sx = (Math.random() - 0.5) * screenShake * 2;
      const sy = (Math.random() - 0.5) * screenShake * 2;
      ctx.translate(sx, sy);
    }

    // Фоновый спортивный паркет и огни трибун
    renderCourtBackground();

    // Задняя часть кольца и щит
    renderBackboardAndNetBack();

    // Мяч (если он летит ЗА передней дужкой кольца)
    if (ball.state !== 'READY' && ball.y < RIM_Y + 15) {
      renderBall();
    }

    // Передняя дужка кольца и передняя сетка
    renderRimAndNetFront();

    // Мяч (если он перед дужкой или внизу)
    if (ball.state === 'READY' || ball.y >= RIM_Y + 15) {
      renderBall();
    }

    // Частицы
    for (const p of particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Всплывающие очки
    for (const sp of scorePopups) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, sp.life);
      ctx.font = `900 ${Math.round(38 * (sp.scale || 1))}px -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = sp.color || '#fff';
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = 10;
      ctx.fillText(sp.text, sp.x, sp.y);
      ctx.restore();
    }

    // Верхняя плашка очков и таймера
    renderHUD();

    // Оверлеи меню и геймовера
    if (gameState === 'START') {
      renderStartOverlay();
    } else if (gameState === 'GAMEOVER') {
      renderGameOverOverlay();
    }

    ctx.restore();
  }

  function renderCourtBackground() {
    // Темная раздевалка Dungeon Gym: брутальные глубокие оттенки
    const grad = ctx.createLinearGradient(0, 0, 0, CH);
    grad.addColorStop(0, '#06080e');
    grad.addColorStop(0.35, '#0c1322');
    grad.addColorStop(0.65, '#161922');
    grad.addColorStop(1, '#0e1117');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CW, CH);

    // Доски темного раздевалочного паркета (дорогой лакированный черный орех)
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 180, 0, 0.05)';
    ctx.lineWidth = 1;
    for (let py = 600; py < CH; py += 45) {
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(CW, py);
      ctx.stroke();
    }
    // Вертикальные стыки паркета
    for (let px = 60; px < CW; px += 120) {
      ctx.beginPath();
      ctx.moveTo(px, 600);
      ctx.lineTo(px, CH);
      ctx.stroke();
    }

    // Золотая гачи-разметка качалки
    ctx.strokeStyle = 'rgba(255, 215, 0, 0.16)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(CW / 2, CH + 100, 390, Math.PI, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(0, 230, 255, 0.12)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(CW / 2, CH + 100, 190, Math.PI, Math.PI * 2);
    ctx.stroke();

    // Неоновые лучи прожекторов сверху (атмосфера арены Gym)
    const beamGrad = ctx.createLinearGradient(CW / 2, 0, CW / 2, 450);
    beamGrad.addColorStop(0, 'rgba(0, 210, 255, 0.12)');
    beamGrad.addColorStop(0.5, 'rgba(255, 215, 0, 0.05)');
    beamGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = beamGrad;
    ctx.beginPath();
    ctx.moveTo(CW / 2 - 120, 0);
    ctx.lineTo(CW / 2 + 120, 0);
    ctx.lineTo(CW / 2 + 300, 480);
    ctx.lineTo(CW / 2 - 300, 480);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function renderBackboardAndNetBack() {
    ctx.save();
    const bx = hoopX - BACKBOARD_WIDTH / 2;
    const by = BACKBOARD_TOP;

    // Стойка щита из титанового сплава качалки
    ctx.fillStyle = '#10141e';
    ctx.fillRect(hoopX - 16, 0, 32, by + 40);
    ctx.strokeStyle = 'rgba(255, 215, 0, 0.25)';
    ctx.lineWidth = 2;
    ctx.strokeRect(hoopX - 16, 0, 32, by + 40);

    // Золотое свечение щита
    ctx.shadowColor = 'rgba(255, 215, 0, 0.25)';
    ctx.shadowBlur = 18;

    // Щит (тонированное бронированное стекло с золотым кантом)
    ctx.fillStyle = 'rgba(15, 22, 35, 0.75)';
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 6;
    roundRect(ctx, bx, by, BACKBOARD_WIDTH, BACKBOARD_HEIGHT, 10);
    ctx.fill();
    ctx.stroke();

    // Внутренний прямоугольник щита (неоновый циан/золото Dungeon)
    const innerW = 104;
    const innerH = 78;
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 12;
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 4;
    roundRect(ctx, hoopX - innerW / 2, by + BACKBOARD_HEIGHT - innerH - 16, innerW, innerH, 4);
    ctx.stroke();

    // Задняя стенка неоновой сетки (светящийся циан)
    ctx.shadowColor = 'rgba(0, 240, 255, 0.6)';
    ctx.shadowBlur = 8;
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.65)';
    ctx.lineWidth = 2.2;
    const rimLeftX = hoopX - RIM_WIDTH / 2;
    const netBottomY = RIM_Y + NET_HEIGHT;
    const netBottomW = RIM_WIDTH * 0.55;
    const swayOffset = netSway;
    const netBL = hoopX - netBottomW / 2 + swayOffset;

    for (let i = 0; i <= 6; i++) {
      const topX = rimLeftX + (RIM_WIDTH / 6) * i;
      const botX = netBL + (netBottomW / 6) * i;
      ctx.beginPath();
      ctx.moveTo(topX, RIM_Y);
      ctx.quadraticCurveTo(topX + swayOffset * 0.4, RIM_Y + NET_HEIGHT * 0.5, botX, netBottomY);
      ctx.stroke();
    }
    ctx.restore();
  }

  function renderRimAndNetFront() {
    ctx.save();
    const rimLeftX = hoopX - RIM_WIDTH / 2;
    const rimRightX = hoopX + RIM_WIDTH / 2;
    const netBottomY = RIM_Y + NET_HEIGHT;
    const netBottomW = RIM_WIDTH * 0.55;
    const swayOffset = netSway;
    const netBL = hoopX - netBottomW / 2 + swayOffset;
    const netBR = hoopX + netBottomW / 2 + swayOffset;

    // Неоновая сетка спереди (перекрестные неоновые нити)
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 10;
    ctx.strokeStyle = 'rgba(120, 245, 255, 0.9)';
    ctx.lineWidth = 2.5;

    for (let i = 0; i <= 6; i++) {
      const topX = rimLeftX + (RIM_WIDTH / 6) * i;
      const oppBotX = netBR - (netBottomW / 6) * i;
      ctx.beginPath();
      ctx.moveTo(topX, RIM_Y);
      ctx.quadraticCurveTo(topX + swayOffset * 0.4, RIM_Y + NET_HEIGHT * 0.5, oppBotX, netBottomY);
      ctx.stroke();
    }

    // Горизонтальные поддерживающие нити сетки (реалистичный рельеф сетки)
    ctx.strokeStyle = 'rgba(120, 245, 255, 0.5)';
    ctx.lineWidth = 1.6;
    for (let row = 1; row <= 3; row++) {
      const frac = row / 4;
      const rowY = RIM_Y + NET_HEIGHT * frac;
      const curW = RIM_WIDTH - (RIM_WIDTH - netBottomW) * frac;
      const curX = hoopX + swayOffset * frac;
      ctx.beginPath();
      ctx.ellipse(curX, rowY, curW / 2, 7 * (1 - frac * 0.2), 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Нижнее кольцо неоновой сетки
    ctx.strokeStyle = 'rgba(120, 245, 255, 0.9)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(hoopX + swayOffset, netBottomY, netBottomW / 2, 8, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Золотой обод кольца (Heavy Duty Dungeon Gold)
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur = 16;
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.ellipse(hoopX, RIM_Y, RIM_WIDTH / 2, 16, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Золотые заклепки / крепления кольца
    ctx.fillStyle = '#fff066';
    ctx.beginPath();
    ctx.arc(rimLeftX, RIM_Y, RIM_RADIUS, 0, Math.PI * 2);
    ctx.arc(rimRightX, RIM_Y, RIM_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function renderBall() {
    ctx.save();
    const r = BALL_BASE_RADIUS * ball.scale;

    // Трейл огня при On Fire / серии
    if (isOnFire && ball.trail.length > 0) {
      for (let i = 0; i < ball.trail.length; i++) {
        const t = ball.trail[i];
        const tr = BALL_BASE_RADIUS * t.scale * (i / ball.trail.length);
        const alpha = (i / ball.trail.length) * 0.75;
        ctx.fillStyle = i % 2 === 0 ? `rgba(255, 215, 0, ${alpha})` : `rgba(255, 50, 0, ${alpha})`;
        ctx.shadowColor = '#ff4500';
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.arc(t.x, t.y, tr * 0.95, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Тень под мячом на стартовой позиции
    if (ball.state === 'READY') {
      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.beginPath();
      ctx.ellipse(ball.x, ball.y + r + 6, r * 0.7, 14, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.translate(ball.x, ball.y);
    ctx.rotate(ball.rot);

    // Стальной тяжелый гачи-шар или огненный золотой метеор
    const ballGrad = ctx.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r);
    if (isOnFire) {
      // Огненный шар флекса
      ballGrad.addColorStop(0, '#ffffff');
      ballGrad.addColorStop(0.25, '#ffe57f');
      ballGrad.addColorStop(0.6, '#ff9100');
      ballGrad.addColorStop(0.88, '#d50000');
      ballGrad.addColorStop(1, '#4a0000');
      ctx.shadowColor = '#ff9100';
      ctx.shadowBlur = 24;
    } else {
      // Хромированный тяжелый стальной шар раздевалки с золотым отливом
      ballGrad.addColorStop(0, '#f0f5ff');
      ballGrad.addColorStop(0.3, '#94a3b8');
      ballGrad.addColorStop(0.65, '#334155');
      ballGrad.addColorStop(0.9, '#1e293b');
      ballGrad.addColorStop(1, '#0f172a');
      ctx.shadowColor = 'rgba(0, 240, 255, 0.4)';
      ctx.shadowBlur = 12;
    }

    ctx.fillStyle = ballGrad;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    // Гравированные золотые / неоновые силовые полосы мяча
    ctx.strokeStyle = isOnFire ? 'rgba(255, 240, 150, 0.95)' : 'rgba(255, 215, 0, 0.75)';
    ctx.lineWidth = Math.max(2, 4.5 * ball.scale);

    // Горизонтальный и вертикальный пояса
    ctx.beginPath();
    ctx.moveTo(-r, 0);
    ctx.lineTo(r, 0);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(0, r);
    ctx.stroke();

    // Боковые изогнутые силовые дуги
    ctx.beginPath();
    ctx.arc(-r * 0.7, 0, r * 0.75, -Math.PI / 2.4, Math.PI / 2.4);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(r * 0.7, 0, r * 0.75, Math.PI - Math.PI / 2.4, Math.PI + Math.PI / 2.4);
    ctx.stroke();

    // Металлический блик и гравировка "300$"
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, r - 1, 0, Math.PI * 2);
    ctx.stroke();

    // Тиснение в центре мяча
    ctx.fillStyle = isOnFire ? '#ffffff' : '#ffd700';
    ctx.font = `900 ${Math.round(r * 0.38)}px -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('300$', 0, 0);

    ctx.restore();
  }

  function renderHUD() {
    ctx.save();
    const padY = 90;

    // Таймер слева (с таймером качалки)
    ctx.textAlign = 'left';
    ctx.font = '700 20px -apple-system, sans-serif';
    ctx.fillStyle = 'rgba(255, 215, 0, 0.7)';
    ctx.fillText('⏱ ТАЙМЕР ЗАЛА', 36, padY);

    ctx.font = '900 38px -apple-system, sans-serif';
    ctx.fillStyle = timeLeft <= 10 ? '#ff3b30' : '#ffffff';
    ctx.fillText(`${timeLeft}s`, 36, padY + 38);

    // Счёт по центру
    ctx.textAlign = 'center';
    ctx.font = '700 20px -apple-system, sans-serif';
    ctx.fillStyle = 'rgba(255, 215, 0, 0.7)';
    ctx.fillText('⚡ ОЧКИ ФЛЕКСА', CW / 2, padY);

    ctx.font = '900 64px -apple-system, sans-serif';
    ctx.fillStyle = '#ffd700';
    ctx.shadowColor = 'rgba(255, 215, 0, 0.75)';
    ctx.shadowBlur = 16;
    ctx.fillText(score.toString(), CW / 2, padY + 54);
    ctx.shadowBlur = 0;

    // Рекорд справа
    ctx.textAlign = 'right';
    ctx.font = '700 20px -apple-system, sans-serif';
    ctx.fillStyle = 'rgba(255, 215, 0, 0.7)';
    ctx.fillText('🏆 РЕКОРД GYM', CW - 36, padY);

    ctx.font = '900 38px -apple-system, sans-serif';
    ctx.fillStyle = '#00f0ff';
    ctx.shadowColor = 'rgba(0, 240, 255, 0.5)';
    ctx.shadowBlur = 10;
    ctx.fillText(bestScore.toString(), CW - 36, padY + 38);
    ctx.shadowBlur = 0;

    // Индикатор On Fire
    if (isOnFire) {
      ctx.textAlign = 'center';
      ctx.font = '900 24px -apple-system, sans-serif';
      ctx.fillStyle = '#ff3b30';
      ctx.shadowColor = 'rgba(255, 59, 48, 0.9)';
      ctx.shadowBlur = 16;
      ctx.fillText('🔥 ON FIRE! СТАЛЬНОЙ ФЛЕКС X2 🔥', CW / 2, padY + 88);
      ctx.shadowBlur = 0;
    }

    ctx.restore();
  }

  function renderStartOverlay() {
    ctx.save();
    ctx.fillStyle = 'rgba(8, 11, 18, 0.88)';
    ctx.fillRect(0, 0, CW, CH);

    ctx.textAlign = 'center';
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur = 24;
    ctx.font = '900 52px -apple-system, sans-serif';
    ctx.fillStyle = '#ffd700';
    ctx.fillText('DUNGEON SLAM', CW / 2, 470);

    ctx.shadowBlur = 0;
    ctx.font = '700 22px -apple-system, sans-serif';
    ctx.fillStyle = '#00f0ff';
    ctx.fillText('Бросок в кольцо качалки • 300 Bucks', CW / 2, 520);

    ctx.font = '600 20px -apple-system, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
    ctx.fillText('Заряжай стальной мяч снизу прямо в золотой обод!', CW / 2, 565);
    ctx.fillText('Чистый SWISH активирует СТАЛЬНОЙ ФЛЕКС 🔥', CW / 2, 600);

    // Кнопка Старт
    const btnW = 360;
    const btnH = 76;
    const btnX = (CW - btnW) / 2;
    const btnY = 660;

    const grad = ctx.createLinearGradient(btnX, btnY, btnX + btnW, btnY);
    grad.addColorStop(0, '#d4af37');
    grad.addColorStop(0.5, '#ffd700');
    grad.addColorStop(1, '#ff9100');

    ctx.shadowColor = 'rgba(255, 215, 0, 0.6)';
    ctx.shadowBlur = 20;
    ctx.fillStyle = grad;
    roundRect(ctx, btnX, btnY, btnW, btnH, 20);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.fillStyle = '#0a0d14';
    ctx.font = '900 26px -apple-system, sans-serif';
    ctx.fillText('ВОЙТИ В КАЧАЛКУ 💥', CW / 2, btnY + 48);

    ctx.restore();
  }

  function renderGameOverOverlay() {
    ctx.save();
    ctx.fillStyle = 'rgba(8, 11, 18, 0.92)';
    ctx.fillRect(0, 0, CW, CH);

    ctx.textAlign = 'center';
    ctx.shadowColor = '#ff3b30';
    ctx.shadowBlur = 20;
    ctx.font = '900 48px -apple-system, sans-serif';
    ctx.fillStyle = '#ff3b30';
    ctx.fillText('ВРЕМЯ ТРЕНИРОВКИ ВЫШЛО!', CW / 2, 420);

    ctx.shadowBlur = 0;
    ctx.font = '700 22px -apple-system, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.fillText('ИТОГОВЫЙ СИЛОВОЙ СЧЁТ', CW / 2, 480);

    ctx.font = '900 82px -apple-system, sans-serif';
    ctx.fillStyle = '#ffd700';
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur = 20;
    ctx.fillText(score.toString(), CW / 2, 565);
    ctx.shadowBlur = 0;

    ctx.font = '700 24px -apple-system, sans-serif';
    ctx.fillStyle = '#00f0ff';
    ctx.fillText(`🏆 Абсолютный рекорд: ${bestScore}`, CW / 2, 625);

    // Кнопка Еще раз
    const btnW = 360;
    const btnH = 76;
    const btnX = (CW - btnW) / 2;
    const btnY = 680;

    const grad = ctx.createLinearGradient(btnX, btnY, btnX + btnW, btnY);
    grad.addColorStop(0, '#d4af37');
    grad.addColorStop(0.5, '#ffd700');
    grad.addColorStop(1, '#ff9100');

    ctx.shadowColor = 'rgba(255, 215, 0, 0.6)';
    ctx.shadowBlur = 20;
    ctx.fillStyle = grad;
    roundRect(ctx, btnX, btnY, btnW, btnH, 20);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.fillStyle = '#0a0d14';
    ctx.font = '900 26px -apple-system, sans-serif';
    ctx.fillText('ЕЩЁ ПОДХОД ↺', CW / 2, btnY + 47);

    ctx.restore();
  }

  function roundRect(context, x, y, w, h, r) {
    context.beginPath();
    context.moveTo(x + r, y);
    context.lineTo(x + w - r, y);
    context.quadraticCurveTo(x + w, y, x + w, y + r);
    context.lineTo(x + w, y + h - r);
    context.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    context.lineTo(x + r, y + h);
    context.quadraticCurveTo(x, y + h, x, y + h - r);
    context.lineTo(x, y + r);
    context.quadraticCurveTo(x, y, x + r, y);
    context.closePath();
  }

  // --- Механика Свайпа (Swipe Physics) ---
  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartTime = 0;
  let isDragging = false;

  function getCanvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  function handleStart(e) {
    if (e.target.closest('.control-btn')) return;
    e.preventDefault();

    if (gameState === 'START' || gameState === 'GAMEOVER') {
      startGame();
      return;
    }

    if (ball.state !== 'READY') return;

    const pos = getCanvasCoords(e);
    const distToBall = Math.hypot(pos.x - ball.x, pos.y - ball.y);

    // Допускаем касание мяча или области вокруг него
    if (distToBall < BALL_BASE_RADIUS * 1.8 || pos.y > 900) {
      isDragging = true;
      touchStartX = pos.x;
      touchStartY = pos.y;
      touchStartTime = performance.now();
    }
  }

  function handleEnd(e) {
    if (!isDragging) return;
    isDragging = false;

    if (ball.state !== 'READY') return;

    let endX = touchStartX;
    let endY = touchStartY;
    if (e.changedTouches && e.changedTouches[0]) {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      endX = (e.changedTouches[0].clientX - rect.left) * scaleX;
      endY = (e.changedTouches[0].clientY - rect.top) * scaleY;
    } else if (e.clientX !== undefined) {
      const pos = getCanvasCoords(e);
      endX = pos.x;
      endY = pos.y;
    }

    const dt = Math.max(30, Math.min(600, performance.now() - touchStartTime));
    const dx = endX - touchStartX;
    const dy = endY - touchStartY;

    // Свайп должен быть направлен вверх (dy < 0) и иметь достаточную амплитуду
    if (dy < -35) {
      // Комбинированный расчет:
      // Скорость свайпа (dx/dt) + доля от пройденного расстояния dy (интуитивное ощущение силы броска)
      const flickSpeed = Math.abs(dy) / dt; // обычно от 0.4 до 3.5 px/ms
      // Базовая вертикальная скорость броска
      // Идеальная вертикальная скорость для попадания в кольцо (y=330 c y=1060 при GRAVITY 0.72) составляет ~ -32..-35
      let vy = -22 - flickSpeed * 4.2 - (Math.abs(dy) / 45);
      vy = Math.max(-38, Math.min(-24, vy));

      // Горизонтальная скорость свайпа: пропорциональна смещению dx и скорости свайпа
      let vx = (dx / dt) * 12.0 + (dx / 40);
      vx = Math.max(-20, Math.min(20, vx));

      // Небольшая помощь прицеливания (aim assist): если бросок почти ровно направлен в кольцо,
      // слегка сглаживаем микро-дрожание пальца на мобильном экране
      const targetDirX = (hoopX - ball.x);
      if (Math.abs(vx) < 1.8 && Math.abs(targetDirX) < 30) {
        vx *= 0.5;
      }

      ball.vx = vx;
      ball.vy = vy;
      ball.vrot = ball.vx * 0.03 + (Math.random() - 0.5) * 0.02;
      ball.state = 'FLIGHT';
      playSfx('swipe');
    }
  }

  const container = document.getElementById('game-container');
  // Используем pointer events для мыши и тач-события для мобилок без дублирования
  let hasTouch = false;
  container.addEventListener('touchstart', (e) => {
    hasTouch = true;
    handleStart(e);
  }, { passive: false });
  container.addEventListener('touchend', (e) => {
    handleEnd(e);
  }, { passive: false });

  container.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') return; // предотвращаем дублирование
    handleStart(e);
  });
  container.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'touch') return;
    handleEnd(e);
  });

  // Кнопки верхней панели
  document.getElementById('btn-back')?.addEventListener('click', () => {
    stopTimer();
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'CLOSE_GAME' }, '*');
      const closeBtn = window.parent.document.getElementById('close-game-modal');
      if (closeBtn) closeBtn.click();
    }
  });

  const muteBtn = document.getElementById('btn-mute');
  muteBtn?.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    muteBtn.textContent = soundEnabled ? '🔊 Звук: Вкл' : '🔇 Звук: Выкл';
  });

  // Главный игровой цикл
  function gameLoop() {
    update();
    render();
    requestAnimationFrame(gameLoop);
  }

  requestAnimationFrame(gameLoop);
})();
