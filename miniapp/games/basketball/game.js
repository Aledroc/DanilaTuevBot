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
  const HOOP_Y = 320;
  const BACKBOARD_WIDTH = 260;
  const BACKBOARD_HEIGHT = 170;
  const BACKBOARD_TOP = HOOP_Y - 130;
  const RIM_WIDTH = 130;
  const RIM_RADIUS = 10;
  const RIM_Y = HOOP_Y;
  const NET_HEIGHT = 90;

  // Параметры мяча
  const BALL_BASE_RADIUS = 56;
  const BALL_START_X = CW / 2;
  const BALL_START_Y = 1060;

  // Гравитация и физика
  const GRAVITY = 0.82;
  const SCALE_SPEED = 0.012; // уменьшение при удалении к кольцу
  const TARGET_DEPTH_SCALE = 0.58; // размер мяча на глубине кольца

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
    trail: []
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

    // Физика мяча в полете
    if (ball.state === 'FLIGHT' || ball.state === 'SCORED' || ball.state === 'MISSED') {
      // Обновляем трейл (особенно эффектный при On Fire)
      ball.trail.push({ x: ball.x, y: ball.y, scale: ball.scale, life: 1.0 });
      if (ball.trail.length > (isOnFire ? 18 : 8)) ball.trail.shift();

      ball.x += ball.vx;
      ball.y += ball.vy;
      ball.vy += GRAVITY;
      ball.rot += ball.vrot;

      // Перспектива: уменьшение мяча пока летит вверх / до глубины кольца
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

      // Коллизия с щитом (срабатывает, когда мяч на нужной глубине около кольца)
      if (ball.scale <= TARGET_DEPTH_SCALE + 0.1 && ball.scale >= TARGET_DEPTH_SCALE - 0.05) {
        if (ball.x >= boardLeft && ball.x <= boardRight && ball.y >= BACKBOARD_TOP && ball.y <= boardBottom) {
          // Если летит назад в глубь/вверх, отскакивает вперед
          if (ball.vy < 0 || Math.abs(ball.y - (boardBottom - 20)) < 30) {
            ball.vy = Math.abs(ball.vy) * 0.45;
            ball.vx = (ball.x - hoopX) * 0.04;
            playSfx('backboard');
            screenShake = Math.max(screenShake, 4);
          }
        }
      }

      // Отслеживание прохождения над кольцом
      if (ball.y < rimY - curRadius * 0.4) {
        ball.passedAboveRim = true;
      }

      // Проверка попадания в корзину (через дужку вниз)
      if (
        !ball.scored &&
        ball.passedAboveRim &&
        ball.vy > 0 &&
        ball.y >= rimY - 10 &&
        ball.y <= rimY + 40 &&
        ball.x > rimLeftX + 18 &&
        ball.x < rimRightX - 18
      ) {
        ball.scored = true;
        ball.state = 'SCORED';

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
          text: isSwish ? `SWISH! +${addedScore} 🔥` : `+${addedScore}`,
          color: isSwish ? '#ff9900' : '#2ecc71',
          scale: isSwish ? 1.4 : 1.0,
          life: 1.0
        });

        // Частицы конфетти / огня из сетки
        createGoalParticles(hoopX, rimY + 30, isOnFire);
      }

      // Коллизии с левой и правой дужкой кольца
      checkRimCollision(rimLeftX, rimY, curRadius);
      checkRimCollision(rimRightX, rimY, curRadius);

      // Проверка падения за пределы экрана
      if (ball.y > CH + 150 || ball.x < -150 || ball.x > CW + 150) {
        if (!ball.scored && ball.state !== 'MISSED') {
          // Промах сбрасывает комбо и On Fire
          streak = 0;
          combo = 0;
          isOnFire = false;
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

  function checkRimCollision(rx, ry, radius) {
    if (ball.scale > TARGET_DEPTH_SCALE + 0.16 || ball.scale < TARGET_DEPTH_SCALE - 0.08) return;

    const dx = ball.x - rx;
    const dy = ball.y - ry;
    const dist = Math.hypot(dx, dy);

    if (dist < radius + RIM_RADIUS) {
      ball.touchedRim = true;
      playSfx('rim');
      screenShake = Math.max(screenShake, 3);

      // Нормаль отскока
      const nx = dx / (dist || 1);
      const ny = dy / (dist || 1);

      // Отражение вектора скорости
      const dot = ball.vx * nx + ball.vy * ny;
      if (dot < 0) {
        ball.vx = (ball.vx - 1.7 * dot * nx) * 0.7;
        ball.vy = (ball.vy - 1.7 * dot * ny) * 0.7;
        // Легкое выталкивание наружу
        ball.x = rx + nx * (radius + RIM_RADIUS + 1);
        ball.y = ry + ny * (radius + RIM_RADIUS + 1);
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
    // Верхняя тёмная зона трибун с огнями
    const grad = ctx.createLinearGradient(0, 0, 0, CH);
    grad.addColorStop(0, '#0a0d14');
    grad.addColorStop(0.45, '#161f30');
    grad.addColorStop(0.7, '#241a14');
    grad.addColorStop(1, '#150f0c');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CW, CH);

    // Паркетная разметка внизу
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 160, 50, 0.12)';
    ctx.lineWidth = 3;
    // Линия штрафного / круга
    ctx.beginPath();
    ctx.arc(CW / 2, CH + 100, 380, Math.PI, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(CW / 2, CH + 100, 180, Math.PI, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function renderBackboardAndNetBack() {
    ctx.save();
    const bx = hoopX - BACKBOARD_WIDTH / 2;
    const by = BACKBOARD_TOP;

    // Стойка щита сзади
    ctx.fillStyle = '#1e2430';
    ctx.fillRect(hoopX - 14, 0, 28, by + 40);

    // Щит (акриловое стекло с белой каймой)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 6;
    roundRect(ctx, bx, by, BACKBOARD_WIDTH, BACKBOARD_HEIGHT, 8);
    ctx.fill();
    ctx.stroke();

    // Внутренний прямоугольник щита
    const innerW = 100;
    const innerH = 75;
    ctx.strokeStyle = '#e74c3c';
    ctx.lineWidth = 4;
    roundRect(ctx, hoopX - innerW / 2, by + BACKBOARD_HEIGHT - innerH - 15, innerW, innerH, 4);
    ctx.stroke();

    // Задняя стенка сетки
    ctx.strokeStyle = 'rgba(240, 240, 240, 0.45)';
    ctx.lineWidth = 2;
    const rimLeftX = hoopX - RIM_WIDTH / 2;
    const rimRightX = hoopX + RIM_WIDTH / 2;
    const netBottomY = RIM_Y + NET_HEIGHT;
    const netBottomW = RIM_WIDTH * 0.55;
    const netBL = hoopX - netBottomW / 2;
    const netBR = hoopX + netBottomW / 2;

    for (let i = 0; i <= 6; i++) {
      const topX = rimLeftX + (RIM_WIDTH / 6) * i;
      const botX = netBL + (netBottomW / 6) * i;
      ctx.beginPath();
      ctx.moveTo(topX, RIM_Y);
      ctx.lineTo(botX, netBottomY);
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
    const netBL = hoopX - netBottomW / 2;
    const netBR = hoopX + netBottomW / 2;

    // Передняя сетка (перекрестные линии)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 2.5;

    for (let i = 0; i <= 6; i++) {
      const topX = rimLeftX + (RIM_WIDTH / 6) * i;
      const oppBotX = netBR - (netBottomW / 6) * i;
      ctx.beginPath();
      ctx.moveTo(topX, RIM_Y);
      ctx.lineTo(oppBotX, netBottomY);
      ctx.stroke();
    }

    // Нижняя кромка сетки
    ctx.beginPath();
    ctx.ellipse(hoopX, netBottomY, netBottomW / 2, 8, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Металлическая дужка кольца (оранжевый обод)
    ctx.strokeStyle = '#e64a19';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.ellipse(hoopX, RIM_Y, RIM_WIDTH / 2, 16, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Шарниры дужек
    ctx.fillStyle = '#ff7043';
    ctx.beginPath();
    ctx.arc(rimLeftX, RIM_Y, RIM_RADIUS, 0, Math.PI * 2);
    ctx.arc(rimRightX, RIM_Y, RIM_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function renderBall() {
    ctx.save();
    const r = BALL_BASE_RADIUS * ball.scale;

    // Трейл огня при On Fire
    if (isOnFire && ball.trail.length > 0) {
      for (let i = 0; i < ball.trail.length; i++) {
        const t = ball.trail[i];
        const tr = BALL_BASE_RADIUS * t.scale * (i / ball.trail.length);
        const alpha = (i / ball.trail.length) * 0.65;
        ctx.fillStyle = i % 2 === 0 ? `rgba(255, 69, 0, ${alpha})` : `rgba(255, 215, 0, ${alpha})`;
        ctx.beginPath();
        ctx.arc(t.x, t.y, tr * 0.9, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Тень под мячом на стартовой позиции
    if (ball.state === 'READY') {
      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.beginPath();
      ctx.ellipse(ball.x, ball.y + r + 6, r * 0.7, 14, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.translate(ball.x, ball.y);
    ctx.rotate(ball.rot);

    // Основная текстура баскетбольного мяча (радиальный 3D градиент)
    const ballGrad = ctx.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r);
    if (isOnFire) {
      ballGrad.addColorStop(0, '#ffe082');
      ballGrad.addColorStop(0.4, '#ff9800');
      ballGrad.addColorStop(0.85, '#e65100');
      ballGrad.addColorStop(1, '#bf360c');
    } else {
      ballGrad.addColorStop(0, '#ff9e57');
      ballGrad.addColorStop(0.5, '#ea580c');
      ballGrad.addColorStop(0.85, '#c2410c');
      ballGrad.addColorStop(1, '#7c2d12');
    }

    ctx.fillStyle = ballGrad;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    // Характерные черные линии швов баскетбольного мяча
    ctx.strokeStyle = isOnFire ? 'rgba(70, 10, 0, 0.85)' : 'rgba(30, 15, 10, 0.88)';
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

    // Изогнутые боковые дуги
    ctx.beginPath();
    ctx.arc(-r * 0.7, 0, r * 0.75, -Math.PI / 2.4, Math.PI / 2.4);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(r * 0.7, 0, r * 0.75, Math.PI - Math.PI / 2.4, Math.PI + Math.PI / 2.4);
    ctx.stroke();

    // Внешняя кромка и блик
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }

  function renderHUD() {
    ctx.save();
    // Верхняя плашка со счетом и таймером
    const padY = 90;

    // Таймер слева
    ctx.textAlign = 'left';
    ctx.font = '700 22px -apple-system, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.fillText('ВРЕМЯ', 36, padY);

    ctx.font = '900 38px -apple-system, sans-serif';
    ctx.fillStyle = timeLeft <= 10 ? '#ff4d4f' : '#ffffff';
    ctx.fillText(`${timeLeft}s`, 36, padY + 38);

    // Счёт по центру
    ctx.textAlign = 'center';
    ctx.font = '700 20px -apple-system, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.fillText('СЧЁТ', CW / 2, padY);

    ctx.font = '900 64px -apple-system, sans-serif';
    ctx.fillStyle = '#ff9800';
    ctx.shadowColor = 'rgba(255, 152, 0, 0.5)';
    ctx.shadowBlur = 12;
    ctx.fillText(score.toString(), CW / 2, padY + 54);
    ctx.shadowBlur = 0;

    // Рекорд справа
    ctx.textAlign = 'right';
    ctx.font = '700 22px -apple-system, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.fillText('РЕКОРД', CW - 36, padY);

    ctx.font = '900 38px -apple-system, sans-serif';
    ctx.fillStyle = '#ffd700';
    ctx.fillText(bestScore.toString(), CW - 36, padY + 38);

    // Индикатор On Fire
    if (isOnFire) {
      ctx.textAlign = 'center';
      ctx.font = '900 24px -apple-system, sans-serif';
      ctx.fillStyle = '#ff4500';
      ctx.shadowColor = 'rgba(255, 69, 0, 0.8)';
      ctx.shadowBlur = 14;
      ctx.fillText('🔥 ON FIRE! X2 БОНУС 🔥', CW / 2, padY + 86);
      ctx.shadowBlur = 0;
    }

    ctx.restore();
  }

  function renderStartOverlay() {
    ctx.save();
    ctx.fillStyle = 'rgba(10, 14, 22, 0.82)';
    ctx.fillRect(0, 0, CW, CH);

    ctx.textAlign = 'center';
    ctx.font = '900 52px -apple-system, sans-serif';
    ctx.fillStyle = '#ff9800';
    ctx.fillText('СВАЙП-БАСКЕТБОЛ', CW / 2, 490);

    ctx.font = '600 22px -apple-system, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.fillText('Свайпай мяч снизу прямо в корзину!', CW / 2, 540);
    ctx.fillText('Чистые попадания (Swish) дают комбо-очки 🔥', CW / 2, 575);

    // Кнопка Старт
    const btnW = 340;
    const btnH = 76;
    const btnX = (CW - btnW) / 2;
    const btnY = 640;

    const grad = ctx.createLinearGradient(btnX, btnY, btnX + btnW, btnY);
    grad.addColorStop(0, '#f57c00');
    grad.addColorStop(1, '#ff9800');

    ctx.fillStyle = grad;
    roundRect(ctx, btnX, btnY, btnW, btnH, 20);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = '900 28px -apple-system, sans-serif';
    ctx.fillText('БРОСИТЬ МЯЧ 🏀', CW / 2, btnY + 48);

    ctx.restore();
  }

  function renderGameOverOverlay() {
    ctx.save();
    ctx.fillStyle = 'rgba(10, 14, 22, 0.88)';
    ctx.fillRect(0, 0, CW, CH);

    ctx.textAlign = 'center';
    ctx.font = '900 48px -apple-system, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('ВРЕМЯ ВЫШЛО!', CW / 2, 430);

    ctx.font = '700 24px -apple-system, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.fillText('ВАШ РЕЗУЛЬТАТ', CW / 2, 490);

    ctx.font = '900 80px -apple-system, sans-serif';
    ctx.fillStyle = '#ff9800';
    ctx.fillText(score.toString(), CW / 2, 575);

    ctx.font = '700 24px -apple-system, sans-serif';
    ctx.fillStyle = '#ffd700';
    ctx.fillText(`Лучший рекорд: ${bestScore}`, CW / 2, 630);

    // Кнопка Еще раз
    const btnW = 340;
    const btnH = 76;
    const btnX = (CW - btnW) / 2;
    const btnY = 680;

    const grad = ctx.createLinearGradient(btnX, btnY, btnX + btnW, btnY);
    grad.addColorStop(0, '#e65100');
    grad.addColorStop(1, '#ff9800');

    ctx.fillStyle = grad;
    roundRect(ctx, btnX, btnY, btnW, btnH, 20);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = '900 26px -apple-system, sans-serif';
    ctx.fillText('ИГРАТЬ СНОВА ↺', CW / 2, btnY + 47);

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

    const dt = Math.max(16, performance.now() - touchStartTime);
    const dx = endX - touchStartX;
    const dy = endY - touchStartY;

    // Свайп должен быть направлен вверх (dy < 0) и иметь достаточную амплитуду
    if (dy < -40) {
      // Расчет начальной скорости броска
      const speedY = (dy / dt) * 16.5;
      const speedX = (dx / dt) * 16.5;

      ball.vx = Math.max(-18, Math.min(18, speedX * 0.95));
      ball.vy = Math.max(-32, Math.min(-18, speedY * 0.95));
      ball.vrot = ball.vx * 0.02;
      ball.state = 'FLIGHT';
      playSfx('swipe');
    }
  }

  const container = document.getElementById('game-container');
  container.addEventListener('touchstart', handleStart, { passive: false });
  container.addEventListener('touchend', handleEnd, { passive: false });
  container.addEventListener('pointerdown', handleStart);
  container.addEventListener('pointerup', handleEnd);

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
