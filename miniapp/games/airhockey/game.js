(() => {
  const tg = window.parent?.Telegram?.WebApp || window.Telegram?.WebApp;
  tg?.ready();
  tg?.expand();

  // Параметры запуска
  const searchParams = new URLSearchParams(window.location.search);
  const chatId = searchParams.get('chat_id') || tg?.initDataUnsafe?.chat?.id || null;
  const initData = tg?.initData || '';
  const userName = tg?.initDataUnsafe?.user?.first_name || 'Хоккеист';

  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');

  // Разрешение виртуального стола
  const CW = 720;
  const CH = 1280;

  // Web Audio синтезатор звуков соударений и неоновых эффектов
  let soundEnabled = true;
  let audioCtx = null;

  function initAudio() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
  }

  function playSynthSound(type, intensity = 1.0) {
    if (!soundEnabled) return;
    try {
      initAudio();
      if (!audioCtx) return;
      const now = audioCtx.currentTime;

      if (type === 'hit') {
        // Удар по шайбе (металлический звон биты)
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        const baseFreq = 540 + Math.random() * 80;
        osc.frequency.setValueAtTime(baseFreq * (0.8 + intensity * 0.4), now);
        osc.frequency.exponentialRampToValueAtTime(120, now + 0.12);

        gain.gain.setValueAtTime(Math.min(0.8, 0.3 + intensity * 0.4), now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.12);
      } else if (type === 'wall') {
        // Удар о борт
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(320 + Math.random() * 40, now);
        osc.frequency.exponentialRampToValueAtTime(80, now + 0.08);

        gain.gain.setValueAtTime(Math.min(0.5, 0.2 + intensity * 0.3), now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.08);
      } else if (type === 'goal') {
        // Гол: фанфары/победный всплеск
        const notes = [440, 554, 659, 880];
        notes.forEach((freq, idx) => {
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(freq, now + idx * 0.07);

          gain.gain.setValueAtTime(0.3, now + idx * 0.07);
          gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.07 + 0.28);

          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.start(now + idx * 0.07);
          osc.stop(now + idx * 0.07 + 0.3);
        });
      } else if (type === 'concede') {
        // Пропущенный гол
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(260, now);
        osc.frequency.linearRampToValueAtTime(90, now + 0.35);

        gain.gain.setValueAtTime(0.4, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.35);
      }
    } catch (_) {}
  }

  function triggerHaptic(type = 'impact') {
    try {
      if (tg?.HapticFeedback) {
        if (type === 'impact') {
          tg.HapticFeedback.impactOccurred('medium');
        } else if (type === 'success') {
          tg.HapticFeedback.notificationOccurred('success');
        } else if (type === 'warning') {
          tg.HapticFeedback.notificationOccurred('warning');
        }
      } else if (navigator.vibrate) {
        if (type === 'impact') navigator.vibrate(20);
        else if (type === 'success') navigator.vibrate([40, 50, 60]);
        else if (type === 'warning') navigator.vibrate(80);
      }
    } catch (_) {}
  }

  // Границы игрового стола (неоновое поле)
  const TABLE = {
    left: 40,
    right: CW - 40,
    top: 40,
    bottom: CH - 40,
    goalWidth: 260,
    cornerCut: 40,
  };
  const GOAL_LEFT = (CW - TABLE.goalWidth) / 2;
  const GOAL_RIGHT = (CW + TABLE.goalWidth) / 2;

  // Размеры шайбы и бит
  const PUCK_RADIUS = 26;
  const MALLET_RADIUS = 52;
  const MAX_PUCK_SPEED = 38;
  const PUCK_FRICTION = 0.993; // лёгкое скольжение как на воздушной подушке
  const MATCH_GOALS_TO_WIN = 7;
  const MATCH_TIME_LIMIT = 60; // 60 секунд соревновательного матча

  // Состояние игры
  let gameState = 'START'; // 'START' | 'PLAYING' | 'GOAL_CELEBRATION' | 'GAMEOVER'
  let playerScore = 0;
  let aiScore = 0;
  let timeLeft = MATCH_TIME_LIMIT;
  let timerInterval = null;
  let bestScore = 0;
  let celebrationTimer = 0;
  let celebrationBanner = '';
  let celebrationColor = '#00f0ff';
  let screenShake = 0;

  try {
    bestScore = parseInt(localStorage.getItem('air_hockey_best_score') || '0', 10);
  } catch (_) {}

  // Объекты шайбы и бит
  const puck = {
    x: CW / 2,
    y: CH / 2,
    vx: 0,
    vy: 0,
    radius: PUCK_RADIUS,
    trail: []
  };

  const player = {
    x: CW / 2,
    y: CH - 220,
    vx: 0,
    vy: 0,
    targetX: CW / 2,
    targetY: CH - 220,
    radius: MALLET_RADIUS,
    color: '#00f0ff',
    glowColor: 'rgba(0, 240, 255, 0.7)'
  };

  const ai = {
    x: CW / 2,
    y: 220,
    vx: 0,
    vy: 0,
    targetX: CW / 2,
    targetY: 220,
    radius: MALLET_RADIUS,
    speed: 13,
    color: '#ff0055',
    glowColor: 'rgba(255, 0, 85, 0.7)'
  };

  // Эффекты частиц и вспышек
  const particles = [];
  const scoreFlashes = [];

  function addSparks(x, y, color, count = 14, speedMult = 1.0) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = (2 + Math.random() * 8) * speedMult;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        color,
        radius: 2 + Math.random() * 3.5,
        alpha: 1.0,
        decay: 0.025 + Math.random() * 0.035
      });
    }
  }

  function addGoalFlash(text, color) {
    scoreFlashes.push({
      text,
      color,
      alpha: 1.0,
      scale: 0.4
    });
  }

  // Отправка рекорда на бэкенд
  async function submitScore(finalScore) {
    try {
      const payload = {
        game: 'air_hockey',
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
      console.warn('Failed to submit air hockey score:', err);
    }
  }

  function resetPositions(scorer = null) {
    puck.vx = 0;
    puck.vy = 0;
    puck.trail = [];
    if (scorer === 'player') {
      puck.x = CW / 2;
      puck.y = CH / 2 - 120; // смещение в сторону пропустившего гол
      puck.vy = -3;
    } else if (scorer === 'ai') {
      puck.x = CW / 2;
      puck.y = CH / 2 + 120;
      puck.vy = 3;
    } else {
      puck.x = CW / 2;
      puck.y = CH / 2;
    }

    player.x = CW / 2;
    player.y = CH - 220;
    player.targetX = player.x;
    player.targetY = player.y;
    player.vx = 0;
    player.vy = 0;

    ai.x = CW / 2;
    ai.y = 220;
    ai.targetX = ai.x;
    ai.targetY = ai.y;
    ai.vx = 0;
    ai.vy = 0;
  }

  function startGame() {
    playerScore = 0;
    aiScore = 0;
    timeLeft = MATCH_TIME_LIMIT;
    gameState = 'PLAYING';
    particles.length = 0;
    scoreFlashes.length = 0;
    resetPositions();

    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      if (gameState === 'PLAYING' || gameState === 'GOAL_CELEBRATION') {
        timeLeft--;
        if (timeLeft <= 0) {
          endGame();
        }
      }
    }, 1000);
  }

  function endGame() {
    gameState = 'GAMEOVER';
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }

    // Итоговые очки: разница забитых шайб + бонус за победу + очки за голы
    const matchBonus = (playerScore > aiScore) ? 100 : 0;
    const finalPoints = Math.max(0, playerScore * 25 + (playerScore - aiScore) * 15 + matchBonus);

    if (finalPoints > bestScore) {
      bestScore = finalPoints;
      try {
        localStorage.setItem('air_hockey_best_score', bestScore.toString());
      } catch (_) {}
    }

    submitScore(finalPoints);
  }

  // --- Swept / Continuous Collision Resolution ---
  function resolveMalletPuckCollision(mallet, isPlayer) {
    const dx = puck.x - mallet.x;
    const dy = puck.y - mallet.y;
    const dist = Math.hypot(dx, dy);
    const minDist = mallet.radius + puck.radius;

    if (dist < minDist) {
      // Нормаль соударения
      const nx = dist > 0.001 ? dx / dist : 0;
      const ny = dist > 0.001 ? dy / dist : (isPlayer ? -1 : 1);

      // Выталкиваем шайбу из биты
      const overlap = minDist - dist;
      puck.x += nx * overlap;
      puck.y += ny * overlap;

      // Относительная скорость
      const rvx = puck.vx - mallet.vx;
      const rvy = puck.vy - mallet.vy;
      const velAlongNormal = rvx * nx + rvy * ny;

      // Удар происходит только при сближении или касании
      if (velAlongNormal < 0) {
        const restitution = 1.25; // упругий импульсивный отскок
        const impulse = -(1 + restitution) * velAlongNormal;

        puck.vx += nx * impulse;
        puck.vy += ny * impulse;

        // Дополнительный импульс от движения биты
        puck.vx += mallet.vx * 0.75;
        puck.vy += mallet.vy * 0.75;

        // Ограничиваем максимальную скорость
        const currentSpeed = Math.hypot(puck.vx, puck.vy);
        if (currentSpeed > MAX_PUCK_SPEED) {
          puck.vx = (puck.vx / currentSpeed) * MAX_PUCK_SPEED;
          puck.vy = (puck.vy / currentSpeed) * MAX_PUCK_SPEED;
        }

        const intensity = Math.min(1.0, currentSpeed / 25);
        playSynthSound('hit', intensity);
        triggerHaptic('impact');
        screenShake = Math.max(screenShake, intensity * 9);
        addSparks(puck.x, puck.y, mallet.color, Math.floor(10 + intensity * 12), intensity);
      }
    }
  }

  // --- Искусственный Интеллект (Smart Opponent AI) ---
  function updateAI(dt) {
    const homeX = CW / 2;
    const homeY = TABLE.top + 160;

    // AI реагирует, если шайба на его половине или приближается к ней
    if (puck.y < CH / 2 + 100) {
      // Предсказание траектории шайбы
      let predictedX = puck.x;
      let predictedY = puck.y;
      if (puck.vy < 0) {
        const timeToReach = Math.max(0, (ai.y - puck.y) / (puck.vy || -0.1));
        predictedX = puck.x + puck.vx * Math.min(timeToReach, 18);
        // Учет отскока от стен при предсказании
        if (predictedX < TABLE.left + puck.radius) {
          predictedX = TABLE.left + puck.radius + Math.abs(TABLE.left + puck.radius - predictedX);
        } else if (predictedX > TABLE.right - puck.radius) {
          predictedX = TABLE.right - puck.radius - Math.abs(predictedX - (TABLE.right - puck.radius));
        }
      }

      // Стремимся занять позицию за шайбой для удара в сторону игрока
      if (puck.y > ai.y - 10) {
        // Шайба ниже AI: атакуем
        ai.targetX = Math.max(TABLE.left + ai.radius, Math.min(TABLE.right - ai.radius, predictedX));
        ai.targetY = Math.max(TABLE.top + ai.radius, Math.min(CH / 2 - 30, puck.y - 20));
      } else {
        // Шайба оказалась за спиной AI: быстрый возврат к своим воротам
        ai.targetX = homeX;
        ai.targetY = TABLE.top + ai.radius + 15;
      }
    } else {
      // Шайба на стороне игрока: AI держит оборону ворот
      ai.targetX = homeX + (puck.x - homeX) * 0.45;
      ai.targetY = homeY;
    }

    // Плавное физическое перемещение AI к целевой точке
    const moveX = (ai.targetX - ai.x);
    const moveY = (ai.targetY - ai.y);
    const distToTarget = Math.hypot(moveX, moveY);
    const maxStep = ai.speed;

    if (distToTarget > 0.1) {
      const step = Math.min(distToTarget, maxStep);
      ai.vx = (moveX / distToTarget) * step;
      ai.vy = (moveY / distToTarget) * step;
      ai.x += ai.vx;
      ai.y += ai.vy;
    } else {
      ai.vx = 0;
      ai.vy = 0;
    }

    // Ограничение движения AI строго его верхней половиной
    ai.x = Math.max(TABLE.left + ai.radius, Math.min(TABLE.right - ai.radius, ai.x));
    ai.y = Math.max(TABLE.top + ai.radius, Math.min(CH / 2 - ai.radius - 8, ai.y));
  }

  // --- Физический шаг (Sub-stepping для устранения туннелирования) ---
  function physicsStep() {
    // 1. Движение игрока к цели (управление пальцем)
    const prevPx = player.x;
    const prevPy = player.y;

    // Плавное следование за пальцем
    player.x += (player.targetX - player.x) * 0.72;
    player.y += (player.targetY - player.y) * 0.72;

    // Ограничение игрока только нижней половиной стола
    player.x = Math.max(TABLE.left + player.radius, Math.min(TABLE.right - player.radius, player.x));
    player.y = Math.max(CH / 2 + player.radius + 8, Math.min(TABLE.bottom - player.radius, player.y));

    player.vx = player.x - prevPx;
    player.vy = player.y - prevPy;

    // 2. Интеллект противника
    updateAI(1);

    // 3. Несколько микро-шагов (sub-steps) для физики шайбы
    const subSteps = 4;
    for (let s = 0; s < subSteps; s++) {
      puck.x += (puck.vx / subSteps);
      puck.y += (puck.vy / subSteps);

      // Проверка соударений с битами
      resolveMalletPuckCollision(player, true);
      resolveMalletPuckCollision(ai, false);

      // Отскоки от левого и правого борта
      if (puck.x - puck.radius < TABLE.left) {
        puck.x = TABLE.left + puck.radius;
        puck.vx = -puck.vx * 0.98;
        playSynthSound('wall', 0.6);
        addSparks(puck.x, puck.y, '#00f0ff', 6);
      } else if (puck.x + puck.radius > TABLE.right) {
        puck.x = TABLE.right - puck.radius;
        puck.vx = -puck.vx * 0.98;
        playSynthSound('wall', 0.6);
        addSparks(puck.x, puck.y, '#00f0ff', 6);
      }

      // Отскоки от верхнего и нижнего борта (кроме зоны ворот)
      const inGoalZoneX = (puck.x > GOAL_LEFT && puck.x < GOAL_RIGHT);

      // Верхний борт (ворота AI)
      if (puck.y - puck.radius < TABLE.top) {
        if (inGoalZoneX) {
          // ГОЛ В ВОРОТА AI!
          if (puck.y < TABLE.top - 15 && gameState === 'PLAYING') {
            onGoalScored('player');
            return;
          }
        } else {
          // Удар о борт рядом с воротами
          puck.y = TABLE.top + puck.radius;
          puck.vy = -puck.vy * 0.98;
          playSynthSound('wall', 0.7);
          addSparks(puck.x, puck.y, '#ff0055', 6);
        }
      }

      // Нижний борт (ворота игрока)
      if (puck.y + puck.radius > TABLE.bottom) {
        if (inGoalZoneX) {
          // ГОЛ В ВОРОТА ИГРОКА!
          if (puck.y > TABLE.bottom + 15 && gameState === 'PLAYING') {
            onGoalScored('ai');
            return;
          }
        } else {
          // Удар о борт рядом со своими воротами
          puck.y = TABLE.bottom - puck.radius;
          puck.vy = -puck.vy * 0.98;
          playSynthSound('wall', 0.7);
          addSparks(puck.x, puck.y, '#00f0ff', 6);
        }
      }
    }

    // Трение шайбы
    puck.vx *= PUCK_FRICTION;
    puck.vy *= PUCK_FRICTION;

    // Шлейф движения шайбы
    puck.trail.push({ x: puck.x, y: puck.y, alpha: 1.0 });
    if (puck.trail.length > 9) puck.trail.shift();
  }

  function onGoalScored(scorer) {
    gameState = 'GOAL_CELEBRATION';
    celebrationTimer = 75; // кадров празднования (~1.25 сек)
    screenShake = 16;

    if (scorer === 'player') {
      playerScore++;
      celebrationBanner = 'ГОООЛ! ⚽🔥';
      celebrationColor = '#00f0ff';
      playSynthSound('goal', 1.0);
      triggerHaptic('success');
      addGoalFlash('ГООЛ!', '#00f0ff');
      addSparks(puck.x, puck.y, '#00f0ff', 40, 1.8);
      addSparks(puck.x, puck.y, '#39ff14', 30, 1.4);
    } else {
      aiScore++;
      celebrationBanner = 'ПРОПУЩЕН ГОЛ! ⚡';
      celebrationColor = '#ff0055';
      playSynthSound('concede', 1.0);
      triggerHaptic('warning');
      addGoalFlash('ПРОПУЩЕНО!', '#ff0055');
      addSparks(puck.x, puck.y, '#ff0055', 35, 1.5);
    }

    // Проверка победы по очкам
    if (playerScore >= MATCH_GOALS_TO_WIN || aiScore >= MATCH_GOALS_TO_WIN) {
      setTimeout(() => {
        endGame();
      }, 1200);
    }
  }

  // --- Обновление логики ---
  function update() {
    if (screenShake > 0) screenShake *= 0.88;

    // Обновление частиц
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.alpha -= p.decay;
      if (p.alpha <= 0) particles.splice(i, 1);
    }

    // Обновление вспышек
    for (let i = scoreFlashes.length - 1; i >= 0; i--) {
      const f = scoreFlashes[i];
      f.scale += 0.04;
      f.alpha -= 0.022;
      if (f.alpha <= 0) scoreFlashes.splice(i, 1);
    }

    if (gameState === 'PLAYING') {
      physicsStep();
    } else if (gameState === 'GOAL_CELEBRATION') {
      celebrationTimer--;
      // Замедленное движение шайбы во время гола
      puck.x += puck.vx * 0.3;
      puck.y += puck.vy * 0.3;
      puck.vx *= 0.94;
      puck.vy *= 0.94;

      if (celebrationTimer <= 0) {
        if (playerScore < MATCH_GOALS_TO_WIN && aiScore < MATCH_GOALS_TO_WIN && timeLeft > 0) {
          gameState = 'PLAYING';
          resetPositions(celebrationColor === '#00f0ff' ? 'player' : 'ai');
        } else {
          endGame();
        }
      }
    }
  }

  // --- Рендеринг (Неоновый кибер-стиль) ---
  function render() {
    ctx.save();

    // Экранная тряска
    if (screenShake > 0.5) {
      const shakeX = (Math.random() - 0.5) * screenShake;
      const shakeY = (Math.random() - 0.5) * screenShake;
      ctx.translate(shakeX, shakeY);
    }

    // 1. Фон поля
    ctx.fillStyle = '#060814';
    ctx.fillRect(0, 0, CW, CH);

    // Сетка стола
    drawTableGrid();

    // 2. Борта и разметка стола
    drawRink();

    // 3. Шлейф шайбы
    puck.trail.forEach((t, idx) => {
      ctx.beginPath();
      ctx.arc(t.x, t.y, puck.radius * (0.4 + (idx / puck.trail.length) * 0.6), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0, 240, 255, ${0.08 * (idx + 1)})`;
      ctx.fill();
    });

    // 4. Шайба
    drawPuck();

    // 5. Биты игроков
    drawMallet(player.x, player.y, player.radius, player.color, player.glowColor, 'ВЫ');
    drawMallet(ai.x, ai.y, ai.radius, ai.color, ai.glowColor, 'AI');

    // 6. Частицы и искры
    particles.forEach(p => {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    // 7. Вспышки голов
    scoreFlashes.forEach(f => {
      ctx.save();
      ctx.globalAlpha = Math.max(0, f.alpha);
      ctx.font = `900 ${Math.floor(70 * f.scale)}px -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = f.color;
      ctx.shadowColor = f.color;
      ctx.shadowBlur = 30;
      ctx.fillText(f.text, CW / 2, CH / 2 + 20);
      ctx.restore();
    });

    // 8. Табло счёта и времени
    drawScoreboard();

    // 9. Оверлеи стартового экрана и конца игры
    if (gameState === 'START') {
      renderStartOverlay();
    } else if (gameState === 'GAMEOVER') {
      renderGameOverOverlay();
    } else if (gameState === 'GOAL_CELEBRATION') {
      renderGoalCelebration();
    }

    ctx.restore();
  }

  function drawTableGrid() {
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.04)';
    ctx.lineWidth = 1;
    const step = 40;
    for (let x = TABLE.left; x <= TABLE.right; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, TABLE.top);
      ctx.lineTo(x, TABLE.bottom);
      ctx.stroke();
    }
    for (let y = TABLE.top; y <= TABLE.bottom; y += step) {
      ctx.beginPath();
      ctx.moveTo(TABLE.left, y);
      ctx.lineTo(TABLE.right, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawRink() {
    ctx.save();

    // Неоновое свечение бортов
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 14;
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 4;

    // Внешняя рама стола
    ctx.beginPath();
    // Верхняя стенка (левое крыло)
    ctx.moveTo(TABLE.left, TABLE.top);
    ctx.lineTo(GOAL_LEFT, TABLE.top);
    // Ворота AI (углубление ворот)
    ctx.moveTo(GOAL_RIGHT, TABLE.top);
    ctx.lineTo(TABLE.right, TABLE.top);
    // Правый борт
    ctx.lineTo(TABLE.right, TABLE.bottom);
    // Нижняя стенка (правое крыло)
    ctx.lineTo(GOAL_RIGHT, TABLE.bottom);
    // Ворота игрока
    ctx.moveTo(GOAL_LEFT, TABLE.bottom);
    ctx.lineTo(TABLE.left, TABLE.bottom);
    // Левый борт
    ctx.lineTo(TABLE.left, TABLE.top);
    ctx.stroke();

    // Ворота AI (красный свет)
    ctx.strokeStyle = '#ff0055';
    ctx.shadowColor = '#ff0055';
    ctx.shadowBlur = 20;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(GOAL_LEFT, TABLE.top);
    ctx.lineTo(GOAL_LEFT, TABLE.top - 24);
    ctx.lineTo(GOAL_RIGHT, TABLE.top - 24);
    ctx.lineTo(GOAL_RIGHT, TABLE.top);
    ctx.stroke();

    // Ворота игрока (голубой свет)
    ctx.strokeStyle = '#00f0ff';
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 20;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(GOAL_LEFT, TABLE.bottom);
    ctx.lineTo(GOAL_LEFT, TABLE.bottom + 24);
    ctx.lineTo(GOAL_RIGHT, TABLE.bottom + 24);
    ctx.lineTo(GOAL_RIGHT, TABLE.bottom);
    ctx.stroke();

    // Центральная линия
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.shadowBlur = 6;
    ctx.shadowColor = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 3;
    ctx.setLineDash([12, 10]);
    ctx.beginPath();
    ctx.moveTo(TABLE.left, CH / 2);
    ctx.lineTo(TABLE.right, CH / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Центральный круг
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.35)';
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(CW / 2, CH / 2, 90, 0, Math.PI * 2);
    ctx.stroke();

    // Центральная точка
    ctx.fillStyle = '#00f0ff';
    ctx.beginPath();
    ctx.arc(CW / 2, CH / 2, 8, 0, Math.PI * 2);
    ctx.fill();

    // Круги в зонах защиты
    ctx.strokeStyle = 'rgba(255, 0, 85, 0.2)';
    ctx.shadowColor = '#ff0055';
    ctx.beginPath();
    ctx.arc(CW / 2, TABLE.top + 60, 110, 0, Math.PI);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(0, 240, 255, 0.2)';
    ctx.shadowColor = '#00f0ff';
    ctx.beginPath();
    ctx.arc(CW / 2, TABLE.bottom - 60, 110, Math.PI, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }

  function drawPuck() {
    ctx.save();
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 18;

    // Внешний диск шайбы
    const pGrad = ctx.createRadialGradient(puck.x - 6, puck.y - 6, 2, puck.x, puck.y, puck.radius);
    pGrad.addColorStop(0, '#ffffff');
    pGrad.addColorStop(0.4, '#00f0ff');
    pGrad.addColorStop(1, '#005588');

    ctx.fillStyle = pGrad;
    ctx.beginPath();
    ctx.arc(puck.x, puck.y, puck.radius, 0, Math.PI * 2);
    ctx.fill();

    // Обод шайбы
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    // Внутренний неоновый глазок
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(puck.x, puck.y, puck.radius * 0.35, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawMallet(x, y, radius, color, glowColor, label) {
    ctx.save();

    // Неоновое свечение вокруг биты
    ctx.shadowColor = color;
    ctx.shadowBlur = 24;

    // Внешнее основание биты
    const grad = ctx.createRadialGradient(x - radius * 0.2, y - radius * 0.2, radius * 0.1, x, y, radius);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.3, color);
    grad.addColorStop(0.8, '#101426');
    grad.addColorStop(1, color);

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.lineWidth = 3;
    ctx.strokeStyle = color;
    ctx.stroke();

    // Ручка биты (внутренняя круглая кнопка)
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#060814';
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.45, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Текстовая метка
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 13px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y);

    ctx.restore();
  }

  function drawScoreboard() {
    ctx.save();

    // Счёт AI (сверху)
    ctx.font = '900 68px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255, 0, 85, 0.45)';
    ctx.shadowColor = '#ff0055';
    ctx.shadowBlur = 16;
    ctx.fillText(aiScore.toString(), CW / 2, CH / 2 - 110);

    // Счёт игрока (снизу)
    ctx.fillStyle = 'rgba(0, 240, 255, 0.45)';
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 16;
    ctx.fillText(playerScore.toString(), CW / 2, CH / 2 + 160);

    // Таймер матча по центру
    ctx.font = '800 24px -apple-system, sans-serif';
    ctx.fillStyle = timeLeft <= 10 ? '#ff3366' : '#ffffff';
    ctx.shadowColor = timeLeft <= 10 ? '#ff3366' : 'rgba(255, 255, 255, 0.6)';
    ctx.shadowBlur = 10;
    const min = Math.floor(timeLeft / 60);
    const sec = (timeLeft % 60).toString().padStart(2, '0');
    ctx.fillText(`⏱ 0${min}:${sec}`, CW / 2, CH / 2 - 10);

    ctx.restore();
  }

  function renderGoalCelebration() {
    ctx.save();
    ctx.fillStyle = 'rgba(6, 8, 20, 0.45)';
    ctx.fillRect(0, 0, CW, CH);

    ctx.textAlign = 'center';
    ctx.font = '900 48px -apple-system, sans-serif';
    ctx.fillStyle = celebrationColor;
    ctx.shadowColor = celebrationColor;
    ctx.shadowBlur = 24;
    ctx.fillText(celebrationBanner, CW / 2, CH / 2 - 50);

    ctx.font = '700 22px -apple-system, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.shadowBlur = 0;
    ctx.fillText(`Счёт: ${playerScore} — ${aiScore}`, CW / 2, CH / 2 + 10);
    ctx.restore();
  }

  function renderStartOverlay() {
    ctx.save();
    ctx.fillStyle = 'rgba(5, 7, 18, 0.88)';
    ctx.fillRect(0, 0, CW, CH);

    ctx.textAlign = 'center';
    ctx.font = '900 52px -apple-system, sans-serif';
    ctx.fillStyle = '#00f0ff';
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 25;
    ctx.fillText('НЕОНОВЫЙ', CW / 2, 400);

    ctx.fillStyle = '#ff0055';
    ctx.shadowColor = '#ff0055';
    ctx.fillText('АЭРОХОККЕЙ', CW / 2, 460);

    ctx.shadowBlur = 0;
    ctx.font = '600 20px -apple-system, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fillText('Управляйте битой пальцем 🏑', CW / 2, 530);
    ctx.fillText('Забивайте шайбу в ворота AI 🥅', CW / 2, 565);
    ctx.fillText('Матч до 7 голов или 60 секунд ⚡', CW / 2, 600);

    if (bestScore > 0) {
      ctx.font = '700 22px -apple-system, sans-serif';
      ctx.fillStyle = '#ffd700';
      ctx.fillText(`🏆 Лучший рекорд: ${bestScore}`, CW / 2, 655);
    }

    // Кнопка Старт
    const btnW = 340;
    const btnH = 74;
    const btnX = (CW - btnW) / 2;
    const btnY = 715;

    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 20;
    const grad = ctx.createLinearGradient(btnX, btnY, btnX + btnW, btnY);
    grad.addColorStop(0, '#00d2ff');
    grad.addColorStop(1, '#0066ff');

    ctx.fillStyle = grad;
    roundRect(ctx, btnX, btnY, btnW, btnH, 20);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 26px -apple-system, sans-serif';
    ctx.fillText('ИГРАТЬ 🏒', CW / 2, btnY + 46);

    ctx.restore();
  }

  function renderGameOverOverlay() {
    ctx.save();
    ctx.fillStyle = 'rgba(5, 7, 18, 0.92)';
    ctx.fillRect(0, 0, CW, CH);

    const isWinner = playerScore > aiScore;
    const isDraw = playerScore === aiScore;

    ctx.textAlign = 'center';
    ctx.font = '900 48px -apple-system, sans-serif';
    ctx.fillStyle = isWinner ? '#00f0ff' : (isDraw ? '#ffaa00' : '#ff0055');
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 25;
    ctx.fillText(isWinner ? 'ПОБЕДА! 🏆' : (isDraw ? 'НИЧЬЯ! 🤝' : 'ПОРАЖЕНИЕ! 💥'), CW / 2, 420);

    ctx.shadowBlur = 0;
    ctx.font = '800 34px -apple-system, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`${playerScore} : ${aiScore}`, CW / 2, 480);

    const matchBonus = isWinner ? 100 : 0;
    const earnedPoints = Math.max(0, playerScore * 25 + (playerScore - aiScore) * 15 + matchBonus);

    ctx.font = '600 20px -apple-system, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.fillText('НАБРАНО ОЧКОВ', CW / 2, 535);

    ctx.font = '900 64px -apple-system, sans-serif';
    ctx.fillStyle = '#ffd700';
    ctx.fillText(earnedPoints.toString(), CW / 2, 605);

    ctx.font = '700 20px -apple-system, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fillText(`Рекорд: ${bestScore}`, CW / 2, 650);

    // Кнопка Играть снова
    const btnW = 340;
    const btnH = 74;
    const btnX = (CW - btnW) / 2;
    const btnY = 695;

    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 20;
    const grad = ctx.createLinearGradient(btnX, btnY, btnX + btnW, btnY);
    grad.addColorStop(0, '#00d2ff');
    grad.addColorStop(1, '#ff0055');

    ctx.fillStyle = grad;
    roundRect(ctx, btnX, btnY, btnW, btnH, 20);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 25px -apple-system, sans-serif';
    ctx.fillText('ИГРАТЬ СНОВА ↺', CW / 2, btnY + 46);

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

  // --- Управление Touch / Pointer ---
  let isPointerActive = false;

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

  function handlePointerDown(e) {
    if (e.target.closest('.control-btn')) return;
    e.preventDefault();
    initAudio();

    if (gameState === 'START' || gameState === 'GAMEOVER') {
      startGame();
      return;
    }

    const pos = getCanvasCoords(e);
    isPointerActive = true;
    player.targetX = pos.x;
    player.targetY = Math.max(CH / 2 + player.radius + 8, pos.y);
  }

  function handlePointerMove(e) {
    if (!isPointerActive && !e.touches) return;
    if (gameState !== 'PLAYING' && gameState !== 'GOAL_CELEBRATION') return;

    const pos = getCanvasCoords(e);
    player.targetX = pos.x;
    // Игрок не может заводить биту на половину поля противника
    player.targetY = Math.max(CH / 2 + player.radius + 8, Math.min(TABLE.bottom - player.radius, pos.y));
  }

  function handlePointerUp() {
    isPointerActive = false;
  }

  const container = document.getElementById('game-container');
  container.addEventListener('touchstart', handlePointerDown, { passive: false });
  container.addEventListener('touchmove', handlePointerMove, { passive: false });
  container.addEventListener('touchend', handlePointerUp, { passive: false });

  container.addEventListener('pointerdown', handlePointerDown);
  window.addEventListener('pointermove', handlePointerMove);
  window.addEventListener('pointerup', handlePointerUp);

  // Кнопки верхней панели
  document.getElementById('btn-back')?.addEventListener('click', () => {
    if (timerInterval) clearInterval(timerInterval);
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
