(() => {
  const tg = window.parent?.Telegram?.WebApp || window.Telegram?.WebApp;
  tg?.ready();
  tg?.expand();

  // Параметры запуска
  const searchParams = new URLSearchParams(window.location.search);
  const chatId = searchParams.get('chat_id') || tg?.initDataUnsafe?.chat?.id || null;
  const initData = tg?.initData || '';
  const userName = tg?.initDataUnsafe?.user?.first_name || 'Ловкий Охотник';

  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');

  // Виртуальные размеры поля 720 x 1280
  const CW = 720;
  const CH = 1280;

  // Telegram Haptic feedback
  function triggerHaptic(type = 'impact', style = 'medium') {
    try {
      if (tg?.HapticFeedback) {
        if (type === 'impact') {
          tg.HapticFeedback.impactOccurred(style); // 'light', 'medium', 'heavy', 'rigid', 'soft'
        } else if (type === 'notification') {
          tg.HapticFeedback.notificationOccurred(style); // 'error', 'success', 'warning'
        }
      }
    } catch (_) {}
  }

  // --- Web Audio синтезатор звуков сочных ударов ---
  let soundEnabled = true;
  let audioCtx = null;

  function initAudio() {
    if (!audioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        audioCtx = new AudioCtx();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
  }

  function playHitSound(isGold = false) {
    if (!soundEnabled) return;
    try {
      initAudio();
      if (!audioCtx) return;
      const now = audioCtx.currentTime;

      // Басовый панч (punch impact)
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(isGold ? 240 : 180, now);
      osc.frequency.exponentialRampToValueAtTime(30, now + 0.12);

      gain.gain.setValueAtTime(0.5, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.12);

      // Высокий шлепок / колокольчик для золотого
      if (isGold) {
        const bell = audioCtx.createOscillator();
        const bGain = audioCtx.createGain();
        bell.type = 'sine';
        bell.frequency.setValueAtTime(880, now);
        bell.frequency.exponentialRampToValueAtTime(1760, now + 0.2);
        bGain.gain.setValueAtTime(0.35, now);
        bGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        bell.connect(bGain);
        bGain.connect(audioCtx.destination);
        bell.start(now);
        bell.stop(now + 0.2);
      } else {
        // Звонкий хлопок
        const slap = audioCtx.createOscillator();
        const sGain = audioCtx.createGain();
        slap.type = 'square';
        slap.frequency.setValueAtTime(450, now);
        slap.frequency.exponentialRampToValueAtTime(120, now + 0.08);
        sGain.gain.setValueAtTime(0.2, now);
        sGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        slap.connect(sGain);
        sGain.connect(audioCtx.destination);
        slap.start(now);
        slap.stop(now + 0.08);
      }
    } catch (_) {}
  }

  function playBombSound() {
    if (!soundEnabled) return;
    try {
      initAudio();
      if (!audioCtx) return;
      const now = audioCtx.currentTime;

      // Низкий взрыв
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.exponentialRampToValueAtTime(25, now + 0.45);

      gain.gain.setValueAtTime(0.6, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.45);
    } catch (_) {}
  }

  function playWhackWhoosh() {
    if (!soundEnabled) return;
    try {
      initAudio();
      if (!audioCtx) return;
      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, now);
      osc.frequency.exponentialRampToValueAtTime(180, now + 0.07);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.07);
    } catch (_) {}
  }

  function playPopSound() {
    if (!soundEnabled) return;
    try {
      initAudio();
      if (!audioCtx) return;
      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(320, now);
      osc.frequency.exponentialRampToValueAtTime(640, now + 0.06);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.06);
    } catch (_) {}
  }

  function playGameOverSound() {
    if (!soundEnabled) return;
    try {
      initAudio();
      if (!audioCtx) return;
      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(350, now);
      osc.frequency.exponentialRampToValueAtTime(90, now + 0.6);
      gain.gain.setValueAtTime(0.4, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.6);
    } catch (_) {}
  }

  // --- Игровое состояние ---
  let gameState = 'START'; // 'START' | 'PLAYING' | 'GAMEOVER'
  let score = 0;
  let combo = 0;
  let maxCombo = 0;
  let totalWhacked = 0;
  let bestScore = 0;
  try {
    bestScore = parseInt(localStorage.getItem('whack_mole_best_score') || '0', 10);
  } catch (_) {}

  const TOTAL_ROUND_TIME = 45; // 45 секунд чистого хардкора
  let timeLeft = TOTAL_ROUND_TIME;
  let lastTimestamp = 0;

  // Сетка 3x3 (9 норок)
  const HOLE_ROWS = 3;
  const HOLE_COLS = 3;
  const holes = [];

  // Вычисление координат норок
  // Поле размещаем по центру экрана
  const GRID_Y_OFFSET = 330;
  const GRID_SPACING_X = 210;
  const GRID_SPACING_Y = 190;
  const START_X = (CW - (HOLE_COLS - 1) * GRID_SPACING_X) / 2;

  for (let r = 0; r < HOLE_ROWS; r++) {
    for (let c = 0; c < HOLE_COLS; c++) {
      holes.push({
        id: r * HOLE_COLS + c,
        x: START_X + c * GRID_SPACING_X,
        y: GRID_Y_OFFSET + r * GRID_SPACING_Y,
        radiusX: 78,
        radiusY: 44,
        state: 'EMPTY', // 'EMPTY' | 'UP' | 'HIT'
        type: 'REGULAR', // 'REGULAR' | 'GOLD' | 'BOMB'
        progress: 0, // 0..1 (высота выскакивания)
        timer: 0,
        maxStayTime: 800, // мс нахождение наверху
        risingSpeed: 0.08,
      });
    }
  }

  // Визуальные эффекты (молотки, звёзды, частицы, всплывающий текст)
  let hammers = []; // анимированные удары молотком
  let stars = []; // вращающиеся звёздочки над оглушённым кротом
  let particles = []; // брызги/искры
  let floatTexts = []; // всплывающие очки "+10", "+20", "-15"

  // Спавн кротов
  let spawnCooldown = 600; // интервал между попытками спавна
  let spawnTimer = 0;

  function resetGame() {
    score = 0;
    combo = 0;
    maxCombo = 0;
    totalWhacked = 0;
    timeLeft = TOTAL_ROUND_TIME;
    lastTimestamp = performance.now();
    hammers = [];
    stars = [];
    particles = [];
    floatTexts = [];
    holes.forEach(h => {
      h.state = 'EMPTY';
      h.progress = 0;
      h.timer = 0;
    });
    gameState = 'PLAYING';
    triggerHaptic('impact', 'medium');
  }

  function gameOver() {
    gameState = 'GAMEOVER';
    playGameOverSound();
    triggerHaptic('notification', 'success');

    if (score > bestScore) {
      bestScore = score;
      try {
        localStorage.setItem('whack_mole_best_score', bestScore.toString());
      } catch (_) {}
    }

    submitScore(score);
  }

  async function submitScore(finalScore) {
    try {
      const payload = {
        game: 'whack_mole',
        game_name: 'whack_mole',
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
      console.warn('Failed to submit whack_mole score:', err);
    }
  }

  // --- Логика спавна и обновления ---
  function update(dt) {
    if (gameState !== 'PLAYING') return;

    // Таймер раунда
    timeLeft -= dt / 1000;
    if (timeLeft <= 0) {
      timeLeft = 0;
      gameOver();
      return;
    }

    // Скорость игры плавно нарастает от 0 до 100%
    const progress = 1 - (timeLeft / TOTAL_ROUND_TIME); // 0 -> 1
    // Время нахождения крота на поверхности: от 850мс в начале до 360мс в конце
    const currentStayTime = 850 - progress * 490;
    // Интервал спавна: от 650мс до 250мс
    spawnCooldown = 650 - progress * 400;

    spawnTimer += dt;
    if (spawnTimer >= spawnCooldown) {
      spawnTimer = 0;
      trySpawnMole(currentStayTime, progress);
    }

    // Обновление состояния каждой норки
    holes.forEach(h => {
      if (h.state === 'UP') {
        if (h.progress < 1) {
          h.progress = Math.min(1, h.progress + h.risingSpeed * (dt / 16.6));
        } else {
          h.timer += dt;
          if (h.timer >= h.maxStayTime) {
            // Крот уходит обратно, если его не ударили
            h.state = 'RETREATING';
          }
        }
      } else if (h.state === 'RETREATING') {
        h.progress -= h.risingSpeed * (dt / 16.6);
        if (h.progress <= 0) {
          h.progress = 0;
          h.state = 'EMPTY';
          // Если это был крот и он ушел невредимым - комбо сбрасывается
          if (h.type !== 'BOMB') {
            combo = 0;
          }
        }
      } else if (h.state === 'HIT') {
        h.timer += dt;
        if (h.timer > 320) {
          h.progress -= h.risingSpeed * 1.5 * (dt / 16.6);
          if (h.progress <= 0) {
            h.progress = 0;
            h.state = 'EMPTY';
          }
        }
      }
    });

    // Обновление молотков
    for (let i = hammers.length - 1; i >= 0; i--) {
      const ham = hammers[i];
      ham.progress += dt / 180; // анимация удара 180мс
      if (ham.progress >= 1) {
        hammers.splice(i, 1);
      }
    }

    // Обновление звёзд оглушения
    for (let i = stars.length - 1; i >= 0; i--) {
      const s = stars[i];
      s.angle += s.rotSpeed;
      s.alpha -= 0.025;
      if (s.alpha <= 0) {
        stars.splice(i, 1);
      }
    }

    // Обновление частиц
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.alpha -= p.decay;
      if (p.alpha <= 0) {
        particles.splice(i, 1);
      }
    }

    // Обновление всплывающих очков
    for (let i = floatTexts.length - 1; i >= 0; i--) {
      const ft = floatTexts[i];
      ft.y += ft.vy;
      ft.alpha -= 0.025;
      if (ft.alpha <= 0) {
        floatTexts.splice(i, 1);
      }
    }
  }

  function trySpawnMole(stayTime, difficultyRatio) {
    const emptyHoles = holes.filter(h => h.state === 'EMPTY');
    if (emptyHoles.length === 0) return;

    // В хардкорном конце игры могут вылезать сразу 2 крота
    const spawnCount = (difficultyRatio > 0.55 && Math.random() < 0.45 && emptyHoles.length >= 2) ? 2 : 1;

    for (let i = 0; i < spawnCount; i++) {
      if (emptyHoles.length === 0) break;
      const idx = Math.floor(Math.random() * emptyHoles.length);
      const hole = emptyHoles.splice(idx, 1)[0];

      // Определение типа:
      // Золотой крот (15-20%), Бомба (15-25%), Обычный крот (остальное)
      const rand = Math.random();
      if (rand < 0.18) {
        hole.type = 'GOLD';
      } else if (rand < 0.18 + 0.20) {
        hole.type = 'BOMB';
      } else {
        hole.type = 'REGULAR';
      }

      hole.state = 'UP';
      hole.progress = 0;
      hole.timer = 0;
      hole.maxStayTime = stayTime * (hole.type === 'GOLD' ? 0.75 : 1.0); // золотой прячется быстрее!
      hole.risingSpeed = 0.09 + difficultyRatio * 0.07;
      playPopSound();
    }
  }

  // --- Обработка клика/тача (Whack!) ---
  function handleHit(x, y) {
    initAudio();
    if (gameState === 'START' || gameState === 'GAMEOVER') {
      resetGame();
      return;
    }
    if (gameState !== 'PLAYING') return;

    // Спавним анимацию взмаха молотка в точке удара
    hammers.push({
      x,
      y,
      progress: 0,
    });
    playWhackWhoosh();

    // Проверяем попадание по норкам (проверка попадания по вылезшему кроту)
    let hitSomething = false;
    for (let h of holes) {
      if (h.state !== 'UP' || h.progress < 0.25) continue;

      // Тело крота находится над центром норки
      const moleY = h.y - h.progress * 65;
      const dist = Math.hypot(x - h.x, y - moleY);

      if (dist < 85) {
        hitSomething = true;
        h.state = 'HIT';
        h.timer = 0;

        if (h.type === 'BOMB') {
          // Удар по бомбе! Штраф очков и сброс комбо
          const penalty = Math.min(score, 25);
          score = Math.max(0, score - 25);
          combo = 0;
          playBombSound();
          triggerHaptic('notification', 'error');

          spawnFloatingText(h.x, moleY - 20, `-${penalty} 💣 БОМБА!`, '#ff2a2a', 32);
          spawnExplosion(h.x, moleY, '#ff3b30', 25);
        } else if (h.type === 'GOLD') {
          // Золотой крот! x2 очки (+20 базовых * комбо)
          combo++;
          if (combo > maxCombo) maxCombo = combo;
          totalWhacked++;
          const comboMul = Math.min(4, 1 + Math.floor(combo / 5) * 0.5);
          const gained = Math.round(20 * comboMul);
          score += gained;

          playHitSound(true);
          triggerHaptic('impact', 'heavy');

          spawnFloatingText(h.x, moleY - 30, `+${gained} ЗОЛОТО! ⭐`, '#ffd700', 36);
          spawnStars(h.x, moleY - 45, '#ffe600');
          spawnExplosion(h.x, moleY, '#ffbe0b', 22);
        } else {
          // Обычный крот (+10 базовых)
          combo++;
          if (combo > maxCombo) maxCombo = combo;
          totalWhacked++;
          const comboMul = Math.min(4, 1 + Math.floor(combo / 5) * 0.5);
          const gained = Math.round(10 * comboMul);
          score += gained;

          playHitSound(false);
          triggerHaptic('impact', 'medium');

          const comboTxt = combo > 2 ? ` (x${combo}!)` : '';
          spawnFloatingText(h.x, moleY - 30, `+${gained}${comboTxt}`, '#a6ff00', 30);
          spawnStars(h.x, moleY - 45, '#9ef01a');
          spawnExplosion(h.x, moleY, '#70e000', 16);
        }
        break; // один удар поражает одного крота
      }
    }

    if (!hitSomething) {
      // Промах по пустому полю сбивает комбо
      if (combo > 0) combo = 0;
    }
  }

  // --- Эффекты ---
  function spawnStars(cx, cy, color) {
    const starCount = 4;
    for (let i = 0; i < starCount; i++) {
      stars.push({
        cx,
        cy,
        radius: 36,
        angle: (i / starCount) * Math.PI * 2,
        rotSpeed: 0.12,
        color,
        alpha: 1,
      });
    }
  }

  function spawnExplosion(x, y, color, count = 16) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 8 + 3;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: Math.random() * 7 + 4,
        color,
        alpha: 1,
        decay: Math.random() * 0.04 + 0.02,
      });
    }
  }

  function spawnFloatingText(x, y, text, color, size = 28) {
    floatTexts.push({
      x,
      y,
      text,
      color,
      size,
      alpha: 1,
      vy: -2.2,
    });
  }

  // --- Отрисовка графики (Render) ---
  function render() {
    ctx.clearRect(0, 0, CW, CH);

    // Фоновая полянка с градиентом
    drawBackground();

    // Верхний HUD (время, очки, комбо)
    drawHUD();

    // Отрисовка 9 норок с кротами
    // Сортируем норки сверху вниз для корректного z-order перекрытия
    const sortedHoles = [...holes].sort((a, b) => a.y - b.y);
    sortedHoles.forEach(h => {
      drawHole(h);
    });

    // Отрисовка частиц
    particles.forEach(p => {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    // Отрисовка звёздочек над оглушёнными кротами
    stars.forEach(s => {
      ctx.save();
      ctx.globalAlpha = Math.max(0, s.alpha);
      const starX = s.cx + Math.cos(s.angle) * s.radius;
      const starY = s.cy + Math.sin(s.angle) * (s.radius * 0.4);
      drawStar(ctx, starX, starY, 5, 12, 6, s.color);
      ctx.restore();
    });

    // Отрисовка молотков
    hammers.forEach(ham => {
      drawHammer(ham);
    });

    // Отрисовка всплывающего текста
    floatTexts.forEach(ft => {
      ctx.save();
      ctx.globalAlpha = Math.max(0, ft.alpha);
      ctx.font = `900 ${ft.size}px -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = ft.color;
      ctx.shadowColor = '#000000';
      ctx.shadowBlur = 8;
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#000000';
      ctx.strokeText(ft.text, ft.x, ft.y);
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.restore();
    });

    // Оверлеи стартового и финального экрана
    if (gameState === 'START') {
      renderStartOverlay();
    } else if (gameState === 'GAMEOVER') {
      renderGameOverOverlay();
    }
  }

  function drawBackground() {
    // Сочная травянистая лужайка
    const bgGrad = ctx.createLinearGradient(0, 0, 0, CH);
    bgGrad.addColorStop(0, '#1c2e17');
    bgGrad.addColorStop(0.3, '#2b4424');
    bgGrad.addColorStop(1, '#131e10');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, CW, CH);

    // Декоративные травинки и текстура
    ctx.fillStyle = 'rgba(74, 124, 63, 0.2)';
    for (let i = 0; i < 40; i++) {
      const tx = (i * 137) % CW;
      const ty = (i * 243) % CH;
      ctx.beginPath();
      ctx.arc(tx, ty, 35, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawHUD() {
    // Верхняя панель HUD
    ctx.save();

    // Плашка с очками (Слева)
    const cardY = 85;
    ctx.fillStyle = 'rgba(15, 26, 12, 0.85)';
    roundRect(ctx, 30, cardY, 200, 75, 18);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(158, 240, 26, 0.4)';
    ctx.stroke();

    ctx.font = '700 14px -apple-system, sans-serif';
    ctx.fillStyle = '#9ef01a';
    ctx.textAlign = 'left';
    ctx.fillText('ОЧКИ', 50, cardY + 28);
    ctx.font = '900 32px -apple-system, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(score.toString(), 50, cardY + 62);

    // Плашка с таймером (Справа)
    ctx.fillStyle = 'rgba(15, 26, 12, 0.85)';
    roundRect(ctx, CW - 230, cardY, 200, 75, 18);
    ctx.fill();
    const isUrgent = timeLeft <= 10;
    ctx.strokeStyle = isUrgent ? 'rgba(255, 68, 68, 0.8)' : 'rgba(158, 240, 26, 0.4)';
    ctx.stroke();

    ctx.font = '700 14px -apple-system, sans-serif';
    ctx.fillStyle = isUrgent ? '#ff4d4d' : '#9ef01a';
    ctx.fillText('ВРЕМЯ', CW - 210, cardY + 28);
    ctx.font = '900 32px -apple-system, sans-serif';
    ctx.fillStyle = isUrgent ? '#ff3b30' : '#ffffff';
    ctx.fillText(`${Math.ceil(timeLeft)} сек`, CW - 210, cardY + 62);

    // Комбо счетчик (По центру)
    if (combo > 1) {
      ctx.fillStyle = 'rgba(255, 190, 11, 0.9)';
      ctx.font = '900 24px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.shadowColor = '#ffbe0b';
      ctx.shadowBlur = 12;
      ctx.fillText(`🔥 x${combo} СЕРИЯ!`, CW / 2, cardY + 48);
      ctx.shadowBlur = 0;
    }

    ctx.restore();
  }

  function drawHole(hole) {
    ctx.save();

    // 1. Задняя стенка норки / Земляной вал
    ctx.beginPath();
    ctx.ellipse(hole.x, hole.y + 4, hole.radiusX + 12, hole.radiusY + 8, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#1c150c';
    ctx.fill();

    // Земляной ободок вокруг норки
    ctx.beginPath();
    ctx.ellipse(hole.x, hole.y, hole.radiusX + 8, hole.radiusY + 6, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#4a3319';
    ctx.fill();

    // Внутренняя темнота норки
    ctx.beginPath();
    ctx.ellipse(hole.x, hole.y, hole.radiusX, hole.radiusY, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#0f0a06';
    ctx.fill();

    // 2. Крот / Персонаж, вылезающий из норки (с маской обрезки по нижнему краю норки)
    if (hole.progress > 0) {
      ctx.save();
      // Клиппинг: крот не должен торчать снизу норки
      ctx.beginPath();
      // Прямоугольник выше дна норки
      ctx.rect(hole.x - hole.radiusX - 30, hole.y - 180, (hole.radiusX + 30) * 2, 180 + hole.radiusY * 0.4);
      ctx.clip();

      const moleY = hole.y - hole.progress * 85;
      if (hole.type === 'BOMB') {
        drawBomb(ctx, hole.x, moleY, hole.state === 'HIT');
      } else {
        drawMole(ctx, hole.x, moleY, hole.type === 'GOLD', hole.state === 'HIT');
      }
      ctx.restore();
    }

    // 3. Передний край норки (трава и кочки, перекрывающие крота спереди)
    ctx.beginPath();
    ctx.ellipse(hole.x, hole.y + 2, hole.radiusX + 4, hole.radiusY * 0.6, 0, 0, Math.PI);
    ctx.fillStyle = '#3a5a2a';
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(hole.x, hole.y + 6, hole.radiusX + 2, hole.radiusY * 0.45, 0, 0, Math.PI);
    ctx.fillStyle = '#223618';
    ctx.fill();

    ctx.restore();
  }

  function drawMole(context, x, y, isGold, isHit) {
    context.save();
    context.translate(x, y);

    const bodyColor = isGold ? '#f59e0b' : '#6b4f38';
    const highlightColor = isGold ? '#fcd34d' : '#8d6e52';
    const bellyColor = isGold ? '#fef3c7' : '#d7b89c';

    // Тело крота
    context.fillStyle = bodyColor;
    context.beginPath();
    context.ellipse(0, 30, 48, 55, 0, 0, Math.PI * 2);
    context.fill();

    // Блики на теле
    context.fillStyle = highlightColor;
    context.beginPath();
    context.ellipse(-12, 15, 14, 28, -0.2, 0, Math.PI * 2);
    context.fill();

    // Пузико
    context.fillStyle = bellyColor;
    context.beginPath();
    context.ellipse(0, 38, 26, 32, 0, 0, Math.PI * 2);
    context.fill();

    // Голова
    context.fillStyle = bodyColor;
    context.beginPath();
    context.ellipse(0, -12, 42, 38, 0, 0, Math.PI * 2);
    context.fill();

    // Мордочка (светлая область)
    context.fillStyle = bellyColor;
    context.beginPath();
    context.ellipse(0, -2, 28, 20, 0, 0, Math.PI * 2);
    context.fill();

    // Носик
    context.fillStyle = isGold ? '#dc2626' : '#ec4899';
    context.beginPath();
    context.ellipse(0, -10, 10, 7, 0, 0, Math.PI * 2);
    context.fill();

    // Глазки
    if (isHit) {
      // Оглушённые глаза-крестики (X_X)
      drawCrossEye(context, -16, -22);
      drawCrossEye(context, 16, -22);

      // Головокружительный рот волной
      context.beginPath();
      context.moveTo(-14, 8);
      context.quadraticCurveTo(-6, 2, 0, 8);
      context.quadraticCurveTo(6, 14, 14, 8);
      context.lineWidth = 3;
      context.strokeStyle = '#4a2810';
      context.stroke();
    } else {
      // Весёлые круглые глаза
      context.fillStyle = '#ffffff';
      context.beginPath();
      context.ellipse(-16, -22, 10, 13, 0, 0, Math.PI * 2);
      context.ellipse(16, -22, 10, 13, 0, 0, Math.PI * 2);
      context.fill();

      // Зрачки
      context.fillStyle = '#111111';
      context.beginPath();
      context.arc(-15, -21, 5, 0, Math.PI * 2);
      context.arc(17, -21, 5, 0, Math.PI * 2);
      context.fill();

      // Белые блики в зрачках
      context.fillStyle = '#ffffff';
      context.beginPath();
      context.arc(-17, -23, 2, 0, Math.PI * 2);
      context.arc(15, -23, 2, 0, Math.PI * 2);
      context.fill();

      // Задорная улыбка с зубиком
      context.beginPath();
      context.arc(0, 2, 14, 0.2, Math.PI - 0.2);
      context.lineWidth = 3;
      context.strokeStyle = '#382010';
      context.stroke();

      // Передние белые зубки крота
      context.fillStyle = '#ffffff';
      roundRect(context, -6, 4, 12, 8, 2);
      context.fill();
      context.stroke();
    }

    // Если золотой — корона на голове! 👑
    if (isGold) {
      context.fillStyle = '#ffbe0b';
      context.strokeStyle = '#d97706';
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(-20, -42);
      context.lineTo(-24, -60);
      context.lineTo(-10, -50);
      context.lineTo(0, -66);
      context.lineTo(10, -50);
      context.lineTo(24, -60);
      context.lineTo(20, -42);
      context.closePath();
      context.fill();
      context.stroke();

      // Рубины в короне
      context.fillStyle = '#ef4444';
      context.beginPath();
      context.arc(0, -52, 3, 0, Math.PI * 2);
      context.fill();
    }

    // Лапки по бокам
    context.fillStyle = bellyColor;
    context.beginPath();
    context.ellipse(-42, 28, 12, 16, -0.4, 0, Math.PI * 2);
    context.ellipse(42, 28, 12, 16, 0.4, 0, Math.PI * 2);
    context.fill();

    context.restore();
  }

  function drawCrossEye(ctx, cx, cy) {
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = '#2b1404';
    ctx.beginPath();
    ctx.moveTo(cx - 7, cy - 7);
    ctx.lineTo(cx + 7, cy + 7);
    ctx.moveTo(cx + 7, cy - 7);
    ctx.lineTo(cx - 7, cy + 7);
    ctx.stroke();
  }

  function drawBomb(context, x, y, isHit) {
    context.save();
    context.translate(x, y);

    // Чёрный шар бомбы
    context.fillStyle = isHit ? '#ff3b30' : '#1e2024';
    context.beginPath();
    context.arc(0, 0, 44, 0, Math.PI * 2);
    context.fill();

    // Блик на шаре
    if (!isHit) {
      context.fillStyle = 'rgba(255, 255, 255, 0.35)';
      context.beginPath();
      context.ellipse(-14, -14, 12, 8, -0.8, 0, Math.PI * 2);
      context.fill();
    }

    // Горлышко бомбы
    context.fillStyle = '#3a3d45';
    roundRect(context, -12, -54, 24, 14, 4);
    context.fill();

    // Фитиль
    context.beginPath();
    context.moveTo(0, -54);
    context.quadraticCurveTo(14, -70, 24, -65);
    context.lineWidth = 4;
    context.strokeStyle = '#b45309';
    context.stroke();

    // Искра на фитиле
    const sparkColor = (Date.now() % 200 < 100) ? '#ffbe0b' : '#ff0055';
    drawStar(context, 24, -65, 5, 12, 6, sparkColor);

    // Череп / Знак опасности на бомбе
    context.fillStyle = '#ffffff';
    context.font = '900 28px -apple-system, sans-serif';
    context.textAlign = 'center';
    context.fillText('💣', 0, 10);

    context.restore();
  }

  function drawHammer(ham) {
    ctx.save();
    ctx.translate(ham.x, ham.y);

    // Угол взмаха: от -45 градусов до удара 30 градусов
    const angle = -0.8 + Math.sin(ham.progress * Math.PI) * 1.3;
    ctx.rotate(angle);

    // Рукоятка молотка
    ctx.fillStyle = '#a16207';
    ctx.strokeStyle = '#78350f';
    ctx.lineWidth = 3;
    roundRect(ctx, -8, -120, 16, 120, 6);
    ctx.fill();
    ctx.stroke();

    // Металлическая ударная головка
    const headGrad = ctx.createLinearGradient(-35, -145, 35, -105);
    headGrad.addColorStop(0, '#94a3b8');
    headGrad.addColorStop(0.5, '#f8fafc');
    headGrad.addColorStop(1, '#475569');
    ctx.fillStyle = headGrad;
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 4;
    roundRect(ctx, -38, -150, 76, 38, 8);
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  function drawStar(context, cx, cy, spikes, outerRadius, innerRadius, color) {
    let rot = (Math.PI / 2) * 3;
    let x = cx;
    let y = cy;
    const step = Math.PI / spikes;

    context.beginPath();
    context.moveTo(cx, cy - outerRadius);
    for (let i = 0; i < spikes; i++) {
      x = cx + Math.cos(rot) * outerRadius;
      y = cy + Math.sin(rot) * outerRadius;
      context.lineTo(x, y);
      rot += step;

      x = cx + Math.cos(rot) * innerRadius;
      y = cy + Math.sin(rot) * innerRadius;
      context.lineTo(x, y);
      rot += step;
    }
    context.lineTo(cx, cy - outerRadius);
    context.closePath();
    context.fillStyle = color;
    context.fill();
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

  // --- Оверлеи стартового и финального экрана ---
  function renderStartOverlay() {
    ctx.save();
    ctx.fillStyle = 'rgba(10, 16, 8, 0.88)';
    ctx.fillRect(0, 0, CW, CH);

    ctx.textAlign = 'center';
    ctx.shadowColor = '#9ef01a';
    ctx.shadowBlur = 24;
    ctx.font = '900 56px -apple-system, sans-serif';
    ctx.fillStyle = '#9ef01a';
    ctx.fillText('УДАРЬ КРОТА', CW / 2, 380);

    ctx.shadowBlur = 0;
    ctx.font = '700 22px -apple-system, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('⚡ Битва на сверхбыструю реакцию! ⚡', CW / 2, 435);

    ctx.font = '500 18px -apple-system, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.fillText('Тапайте по кротам, как только они вылезают.', CW / 2, 490);
    ctx.fillText('⭐ Золотой крот даёт x2 очков.', CW / 2, 525);
    ctx.fillText('💣 Осторожно с бомбами: отнимают очки!', CW / 2, 560);
    ctx.fillText('⏱ У вас есть ровно 45 секунд.', CW / 2, 595);

    // Кнопка Играть
    const btnW = 340;
    const btnH = 76;
    const btnX = (CW - btnW) / 2;
    const btnY = 660;

    const grad = ctx.createLinearGradient(btnX, btnY, btnX + btnW, btnY);
    grad.addColorStop(0, '#70e000');
    grad.addColorStop(1, '#9ef01a');

    ctx.shadowColor = '#9ef01a';
    ctx.shadowBlur = 20;
    ctx.fillStyle = grad;
    roundRect(ctx, btnX, btnY, btnW, btnH, 20);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.fillStyle = '#0f1a08';
    ctx.font = '900 28px -apple-system, sans-serif';
    ctx.fillText('ИГРАТЬ 🔨', CW / 2, btnY + 48);

    if (bestScore > 0) {
      ctx.font = '700 20px -apple-system, sans-serif';
      ctx.fillStyle = '#ffd700';
      ctx.fillText(`🏆 Ваш рекорд: ${bestScore}`, CW / 2, 785);
    }

    ctx.restore();
  }

  function renderGameOverOverlay() {
    ctx.save();
    ctx.fillStyle = 'rgba(10, 16, 8, 0.92)';
    ctx.fillRect(0, 0, CW, CH);

    ctx.textAlign = 'center';
    ctx.shadowColor = '#ffbe0b';
    ctx.shadowBlur = 22;
    ctx.font = '900 52px -apple-system, sans-serif';
    ctx.fillStyle = '#ffbe0b';
    ctx.fillText('ВРЕМЯ ВЫШЛО!', CW / 2, 360);

    ctx.shadowBlur = 0;
    ctx.font = '700 22px -apple-system, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.fillText('ВАШ ИТОГОВЫЙ СЧЁТ', CW / 2, 420);

    ctx.shadowColor = '#9ef01a';
    ctx.shadowBlur = 24;
    ctx.font = '900 84px -apple-system, sans-serif';
    ctx.fillStyle = '#9ef01a';
    ctx.fillText(score.toString(), CW / 2, 510);

    ctx.shadowBlur = 0;
    ctx.font = '600 20px -apple-system, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`Поймано кротов: ${totalWhacked} шт.`, CW / 2, 565);
    ctx.fillText(`Макс. серия комбо: x${maxCombo}`, CW / 2, 600);

    ctx.font = '700 22px -apple-system, sans-serif';
    ctx.fillStyle = '#ffd700';
    ctx.fillText(`🏆 Лучший рекорд: ${bestScore}`, CW / 2, 650);

    // Кнопка Играть снова
    const btnW = 340;
    const btnH = 76;
    const btnX = (CW - btnW) / 2;
    const btnY = 700;

    const grad = ctx.createLinearGradient(btnX, btnY, btnX + btnW, btnY);
    grad.addColorStop(0, '#70e000');
    grad.addColorStop(1, '#9ef01a');

    ctx.shadowColor = '#9ef01a';
    ctx.shadowBlur = 20;
    ctx.fillStyle = grad;
    roundRect(ctx, btnX, btnY, btnW, btnH, 20);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.fillStyle = '#0f1a08';
    ctx.font = '900 28px -apple-system, sans-serif';
    ctx.fillText('ЕЩЁ РАЗ ↺', CW / 2, btnY + 48);

    ctx.restore();
  }

  // --- Координаты клика / тапа ---
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

  function onPointerDown(e) {
    if (e.target.closest('.control-btn')) return;
    const pos = getCanvasCoords(e);
    handleHit(pos.x, pos.y);
  }

  const container = document.getElementById('game-container');
  container.addEventListener('touchstart', (e) => {
    e.preventDefault();
    onPointerDown(e);
  }, { passive: false });

  container.addEventListener('pointerdown', onPointerDown);

  // Кнопки верхней панели
  document.getElementById('btn-back')?.addEventListener('click', () => {
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

  // Главный цикл анимации
  function gameLoop(now) {
    if (!lastTimestamp) lastTimestamp = now;
    const dt = Math.min(100, now - lastTimestamp);
    lastTimestamp = now;

    update(dt);
    render();
    requestAnimationFrame(gameLoop);
  }

  requestAnimationFrame(gameLoop);
})();
