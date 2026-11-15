(() => {
  const tg = window.parent?.Telegram?.WebApp || window.Telegram?.WebApp;
  tg?.ready();
  tg?.expand();

  // Параметры запуска
  const searchParams = new URLSearchParams(window.location.search);
  const chatId = searchParams.get('chat_id') || tg?.initDataUnsafe?.chat?.id || null;
  const initData = tg?.initData || '';
  const userName = tg?.initDataUnsafe?.user?.first_name || 'Dungeon Master';

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
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'GAME_OVER', game: 'whack_mole', score: score }, '*');
    }
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
          // Удар по взрывчатке / ловушке! Штраф очков и сброс комбо
          const penalty = Math.min(score, 25);
          score = Math.max(0, score - 25);
          combo = 0;
          playBombSound();
          triggerHaptic('notification', 'error');

          spawnFloatingText(h.x, moleY - 20, `-${penalty} 💀 DUNGEON TRAP!`, '#ff2a5f', 32);
          spawnExplosion(h.x, moleY, '#ff3b30', 25);
        } else if (h.type === 'GOLD') {
          // Золотой Джаброни! x2 очки (+20 базовых * комбо)
          combo++;
          if (combo > maxCombo) maxCombo = combo;
          totalWhacked++;
          const comboMul = Math.min(4, 1 + Math.floor(combo / 5) * 0.5);
          const gained = Math.round(20 * comboMul);
          score += gained;

          playHitSound(true);
          triggerHaptic('impact', 'heavy');

          // Сочные Гачи комбо-тексты
          let comboGachi = '💥 300 BUCKS COMBO';
          if (combo >= 10) {
            comboGachi = '⚡ ASS WE CAN';
          } else if (combo >= 5) {
            comboGachi = '🔨 SPANK!';
          }

          spawnFloatingText(h.x, moleY - 30, `+${gained} ${comboGachi}! ⭐`, '#ffd700', 34);
          spawnStars(h.x, moleY - 45, '#ffe600');
          spawnExplosion(h.x, moleY, '#ffbe0b', 24);
        } else {
          // Обычный Джаброни (+10 базовых)
          combo++;
          if (combo > maxCombo) maxCombo = combo;
          totalWhacked++;
          const comboMul = Math.min(4, 1 + Math.floor(combo / 5) * 0.5);
          const gained = Math.round(10 * comboMul);
          score += gained;

          playHitSound(false);
          triggerHaptic('impact', 'medium');

          let spankText = '🔨 SPANK!';
          if (combo >= 15) {
            spankText = '⚡ ASS WE CAN!';
          } else if (combo >= 8) {
            spankText = '💥 300 BUCKS!';
          } else if (combo >= 3) {
            spankText = `🔨 SPANK! x${combo}`;
          }

          spawnFloatingText(h.x, moleY - 30, `+${gained} ${spankText}`, '#00f0ff', 30);
          spawnStars(h.x, moleY - 45, '#00f0ff');
          spawnExplosion(h.x, moleY, '#38bdf8', 18);
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
    // Благородный тёмный интерьер Dungeon Gym
    const bgGrad = ctx.createLinearGradient(0, 0, 0, CH);
    bgGrad.addColorStop(0, '#0c101c');
    bgGrad.addColorStop(0.35, '#131b2e');
    bgGrad.addColorStop(1, '#060911');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, CW, CH);

    // Неоновые отблески качалки и кожаные маты
    ctx.fillStyle = 'rgba(0, 240, 255, 0.04)';
    for (let i = 0; i < 35; i++) {
      const tx = (i * 149) % CW;
      const ty = (i * 263) % CH;
      ctx.beginPath();
      ctx.arc(tx, ty, 40, 0, Math.PI * 2);
      ctx.fill();
    }

    // Текстовая надпись на стене данжена
    ctx.save();
    ctx.font = '900 28px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0, 240, 255, 0.07)';
    ctx.letterSpacing = '8px';
    ctx.fillText('DUNGEON GYM • SPANK ARENA', CW / 2, 220);
    ctx.restore();
  }

  function drawHUD() {
    // Верхняя панель HUD
    ctx.save();

    // Плашка с очками (Слева)
    const cardY = 85;
    ctx.fillStyle = 'rgba(12, 18, 32, 0.9)';
    roundRect(ctx, 30, cardY, 200, 75, 18);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.45)';
    ctx.stroke();

    ctx.font = '800 13px -apple-system, sans-serif';
    ctx.fillStyle = '#00f0ff';
    ctx.textAlign = 'left';
    ctx.fillText('BUCKS 💰', 50, cardY + 28);
    ctx.font = '900 32px -apple-system, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(score.toString(), 50, cardY + 62);

    // Плашка с таймером (Справа)
    ctx.fillStyle = 'rgba(12, 18, 32, 0.9)';
    roundRect(ctx, CW - 230, cardY, 200, 75, 18);
    ctx.fill();
    const isUrgent = timeLeft <= 10;
    ctx.strokeStyle = isUrgent ? 'rgba(255, 42, 95, 0.9)' : 'rgba(0, 240, 255, 0.45)';
    ctx.stroke();

    ctx.font = '800 13px -apple-system, sans-serif';
    ctx.fillStyle = isUrgent ? '#ff4d79' : '#00f0ff';
    ctx.fillText('РАУНД ⏱', CW - 210, cardY + 28);
    ctx.font = '900 32px -apple-system, sans-serif';
    ctx.fillStyle = isUrgent ? '#ff2a5f' : '#ffffff';
    ctx.fillText(`${Math.ceil(timeLeft)} сек`, CW - 210, cardY + 62);

    // Комбо счетчик (По центру)
    if (combo > 1) {
      ctx.fillStyle = combo >= 10 ? '#ffd700' : '#00f0ff';
      ctx.font = '900 24px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.shadowColor = combo >= 10 ? '#ffd700' : '#00f0ff';
      ctx.shadowBlur = 14;
      const comboLabel = combo >= 10 ? `⚡ x${combo} ASS WE CAN!` : `🔨 x${combo} SPANK!`;
      ctx.fillText(comboLabel, CW / 2, cardY + 48);
      ctx.shadowBlur = 0;
    }

    ctx.restore();
  }

  function drawHole(hole) {
    ctx.save();

    // 1. Кожаный подиум люка / Кольцо арены
    ctx.beginPath();
    ctx.ellipse(hole.x, hole.y + 4, hole.radiusX + 14, hole.radiusY + 10, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#080c16';
    ctx.fill();

    // Стальной заклепанный обод люка
    ctx.beginPath();
    ctx.ellipse(hole.x, hole.y, hole.radiusX + 8, hole.radiusY + 6, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#1e293b';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.25)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Тёмный провал люка в раздевалку
    ctx.beginPath();
    ctx.ellipse(hole.x, hole.y, hole.radiusX, hole.radiusY, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#04060a';
    ctx.fill();

    // 2. Джаброни / Ловушка, вылезающие из люка
    if (hole.progress > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(hole.x - hole.radiusX - 30, hole.y - 190, (hole.radiusX + 30) * 2, 190 + hole.radiusY * 0.4);
      ctx.clip();

      const moleY = hole.y - hole.progress * 90;
      if (hole.type === 'BOMB') {
        drawBomb(ctx, hole.x, moleY, hole.state === 'HIT');
      } else {
        drawMole(ctx, hole.x, moleY, hole.type === 'GOLD', hole.state === 'HIT');
      }
      ctx.restore();
    }

    // 3. Передний край люка (кожаный бортик со стальной каймой)
    ctx.beginPath();
    ctx.ellipse(hole.x, hole.y + 2, hole.radiusX + 4, hole.radiusY * 0.6, 0, 0, Math.PI);
    ctx.fillStyle = '#1e283d';
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(hole.x, hole.y + 6, hole.radiusX + 2, hole.radiusY * 0.45, 0, 0, Math.PI);
    ctx.fillStyle = '#0f172a';
    ctx.fill();

    ctx.restore();
  }

  function drawMole(context, x, y, isGold, isHit) {
    context.save();
    context.translate(x, y);

    // Персонаж — наглый Джаброни в коже / кепке качалки
    const skinTone = isGold ? '#d97706' : '#e0a97a';
    const leatherTone = isGold ? '#b45309' : '#1e293b';

    // 1. Мощные мускулистые плечи / торс Джаброни
    context.fillStyle = skinTone;
    context.beginPath();
    context.ellipse(0, 36, 52, 48, 0, 0, Math.PI * 2);
    context.fill();

    // Кожаная портупея / ремни качалки крест-накрест на груди
    context.strokeStyle = isGold ? '#ffd700' : '#0f172a';
    context.lineWidth = 5;
    context.beginPath();
    context.moveTo(-35, 12);
    context.lineTo(35, 55);
    context.moveTo(35, 12);
    context.lineTo(-35, 55);
    context.stroke();

    // Стальная пряжка по центру
    context.fillStyle = isGold ? '#fef08a' : '#94a3b8';
    context.beginPath();
    context.arc(0, 33, 6, 0, Math.PI * 2);
    context.fill();

    // 2. Мускулистая шея и голова
    context.fillStyle = skinTone;
    context.beginPath();
    context.ellipse(0, -10, 38, 36, 0, 0, Math.PI * 2);
    context.fill();

    // Наглая челюсть / подбородок
    context.fillStyle = skinTone;
    context.beginPath();
    context.ellipse(0, 10, 24, 18, 0, 0, Math.PI * 2);
    context.fill();

    // 3. Кепка качалки или кожаная маска с заклепками
    if (isGold) {
      // Золотой Джаброни: Золотая корона босса / цепь $300
      context.fillStyle = '#ffbe0b';
      context.strokeStyle = '#d97706';
      context.lineWidth = 2.5;
      context.beginPath();
      context.moveTo(-24, -38);
      context.lineTo(-28, -58);
      context.lineTo(-12, -48);
      context.lineTo(0, -68);
      context.lineTo(12, -48);
      context.lineTo(28, -58);
      context.lineTo(24, -38);
      context.closePath();
      context.fill();
      context.stroke();

      // Золотая цепь на шее
      context.strokeStyle = '#ffd700';
      context.lineWidth = 4;
      context.beginPath();
      context.arc(0, 18, 22, 0.2, Math.PI - 0.2);
      context.stroke();
    } else {
      // Обычный Джаброни: Черная кожаная кепка / брутальный козырек
      context.fillStyle = '#0f172a';
      context.beginPath();
      // Купол кепки
      context.ellipse(0, -32, 34, 18, 0, Math.PI, 0);
      context.fill();
      // Козырек кепки
      context.fillStyle = '#1e293b';
      context.beginPath();
      context.ellipse(0, -30, 42, 10, 0, 0, Math.PI);
      context.fill();
      // Стальная эмблема на кепке
      context.fillStyle = '#00f0ff';
      context.fillRect(-6, -42, 12, 6);
    }

    // 4. Глаза / Очки Джаброни
    if (isHit) {
      // Оглушенный вид: крестики в глазах
      drawCrossEye(context, -14, -14);
      drawCrossEye(context, 14, -14);

      // Разинутый рот с выбитой спесью
      context.fillStyle = '#450a0a';
      context.beginPath();
      context.ellipse(0, 10, 10, 8, 0, 0, Math.PI * 2);
      context.fill();
    } else {
      // Тёмные стильные очки качалки или наглый прищур
      context.fillStyle = '#090d16';
      context.strokeStyle = isGold ? '#ffd700' : '#00f0ff';
      context.lineWidth = 2;
      roundRect(context, -25, -20, 20, 13, 3);
      context.fill();
      context.stroke();

      roundRect(context, 5, -20, 20, 13, 3);
      context.fill();
      context.stroke();

      // Мостик очков
      context.beginPath();
      context.moveTo(-5, -14);
      context.lineTo(5, -14);
      context.stroke();

      // Блики на линзах
      context.fillStyle = 'rgba(255, 255, 255, 0.5)';
      context.beginPath();
      context.ellipse(-17, -15, 6, 2, -0.4, 0, Math.PI * 2);
      context.ellipse(13, -15, 6, 2, -0.4, 0, Math.PI * 2);
      context.fill();

      // Наглая ухмылка Джаброни
      context.strokeStyle = '#3e1a06';
      context.lineWidth = 2.5;
      context.beginPath();
      context.moveTo(-10, 8);
      context.quadraticCurveTo(0, 15, 12, 6);
      context.stroke();
    }

    // 5. Бицепсы по бокам (кулаки в кожаных напульсниках)
    context.fillStyle = skinTone;
    context.beginPath();
    context.ellipse(-44, 25, 12, 16, -0.3, 0, Math.PI * 2);
    context.ellipse(44, 25, 12, 16, 0.3, 0, Math.PI * 2);
    context.fill();

    // Напульсники на руках
    context.fillStyle = isGold ? '#ffd700' : '#0f172a';
    roundRect(context, -50, 28, 14, 8, 2);
    context.fill();
    roundRect(context, 36, 28, 14, 8, 2);
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

    // Рукоятка карающего молота (обтянутая черной кожей с заклёпками)
    ctx.fillStyle = '#1e1b18';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3;
    roundRect(ctx, -9, -125, 18, 125, 6);
    ctx.fill();
    ctx.stroke();

    // Кожаные полосы обмотки рукоятки
    ctx.strokeStyle = 'rgba(255, 215, 0, 0.4)';
    ctx.lineWidth = 2;
    for (let i = -115; i < -15; i += 18) {
      ctx.beginPath();
      ctx.moveTo(-8, i);
      ctx.lineTo(8, i + 8);
      ctx.stroke();
    }

    // Золотое / стальное массивное навершие молота Dungeon Master'а
    const headGrad = ctx.createLinearGradient(-42, -155, 42, -105);
    headGrad.addColorStop(0, '#ffd700');
    headGrad.addColorStop(0.35, '#fffbeb');
    headGrad.addColorStop(0.7, '#d97706');
    headGrad.addColorStop(1, '#78350f');

    ctx.fillStyle = headGrad;
    ctx.strokeStyle = '#451a03';
    ctx.lineWidth = 4;
    roundRect(ctx, -42, -158, 84, 44, 10);
    ctx.fill();
    ctx.stroke();

    // Стальные шипы / золотая гравировка на боковине молота
    ctx.fillStyle = '#1e293b';
    ctx.font = '900 16px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⚡300', 0, -136);

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
    ctx.fillStyle = 'rgba(8, 12, 22, 0.92)';
    ctx.fillRect(0, 0, CW, CH);

    ctx.textAlign = 'center';
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 24;
    ctx.font = '900 52px -apple-system, sans-serif';
    ctx.fillStyle = '#00f0ff';
    ctx.fillText('WHACK THE JABRONI', CW / 2, 375);

    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur = 18;
    ctx.font = '900 36px -apple-system, sans-serif';
    ctx.fillStyle = '#ffd700';
    ctx.fillText('НАКАЖИ СЛЕЙВА 🔨', CW / 2, 430);

    ctx.shadowBlur = 0;
    ctx.font = '700 20px -apple-system, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('⚡ Турнир Данжена на реакцию и силу спанка! ⚡', CW / 2, 485);

    ctx.font = '500 18px -apple-system, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fillText('Тапай по наглым Джаброни, пока они не скрылись.', CW / 2, 530);
    ctx.fillText('⭐ Золотой Джаброни даёт x2 очков ($300 Bucks).', CW / 2, 565);
    ctx.fillText('💀 Не бей по ловушкам данжена: штраф очков!', CW / 2, 600);
    ctx.fillText('⏱ У вас есть ровно 45 секунд чистого экшена.', CW / 2, 635);

    // Кнопка Играть
    const btnW = 340;
    const btnH = 76;
    const btnX = (CW - btnW) / 2;
    const btnY = 680;

    const grad = ctx.createLinearGradient(btnX, btnY, btnX + btnW, btnY);
    grad.addColorStop(0, '#00d2ff');
    grad.addColorStop(1, '#ff0055');

    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 22;
    ctx.fillStyle = grad;
    roundRect(ctx, btnX, btnY, btnW, btnH, 20);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 26px -apple-system, sans-serif';
    ctx.fillText('ВОЙТИ В ДАНЖЕН 🔨', CW / 2, btnY + 48);

    if (bestScore > 0) {
      ctx.font = '700 20px -apple-system, sans-serif';
      ctx.fillStyle = '#ffd700';
      ctx.fillText(`🏆 Твой рекорд: ${bestScore} Bucks`, CW / 2, 795);
    }

    ctx.restore();
  }

  function renderGameOverOverlay() {
    ctx.save();
    ctx.fillStyle = 'rgba(8, 12, 22, 0.94)';
    ctx.fillRect(0, 0, CW, CH);

    ctx.textAlign = 'center';
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur = 22;
    ctx.font = '900 50px -apple-system, sans-serif';
    ctx.fillStyle = '#ffd700';
    ctx.fillText('СПАНК-РАУНД ОКОНЧЕН!', CW / 2, 355);

    ctx.shadowBlur = 0;
    ctx.font = '700 22px -apple-system, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.fillText('ЗАРАБОТАНО DUNGEON BUCKS', CW / 2, 415);

    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 25;
    ctx.font = '900 84px -apple-system, sans-serif';
    ctx.fillStyle = '#00f0ff';
    ctx.fillText(`${score} 💰`, CW / 2, 505);

    ctx.shadowBlur = 0;
    ctx.font = '600 20px -apple-system, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`Наказано Джаброни: ${totalWhacked} шт.`, CW / 2, 560);
    ctx.fillText(`Макс. серия Ass We Can: x${maxCombo}`, CW / 2, 595);

    ctx.font = '700 22px -apple-system, sans-serif';
    ctx.fillStyle = '#ffd700';
    ctx.fillText(`🏆 Рекорд Данжена: ${bestScore}`, CW / 2, 645);

    // Кнопка Играть снова
    const btnW = 340;
    const btnH = 76;
    const btnX = (CW - btnW) / 2;
    const btnY = 695;

    const grad = ctx.createLinearGradient(btnX, btnY, btnX + btnW, btnY);
    grad.addColorStop(0, '#00d2ff');
    grad.addColorStop(1, '#ff0055');

    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 20;
    ctx.fillStyle = grad;
    roundRect(ctx, btnX, btnY, btnW, btnH, 20);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 26px -apple-system, sans-serif';
    ctx.fillText('ЕЩЁ СПАНКОВ ↺', CW / 2, btnY + 48);

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
