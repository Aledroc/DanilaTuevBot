(() => {
  const tg = window.parent?.Telegram?.WebApp || window.Telegram?.WebApp;
  tg?.ready();
  tg?.expand();

  // Параметры запуска
  const searchParams = new URLSearchParams(window.location.search);
  const chatId = searchParams.get('chat_id') || tg?.initDataUnsafe?.chat?.id || null;
  const initData = tg?.initData || '';
  const userName = tg?.initDataUnsafe?.user?.first_name || 'Ножевик';

  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');

  // Звуки
  let soundEnabled = true;
  const sounds = {
    hit: new Audio('/games/knife/assets/audio/hit.mp3'),
    collision: new Audio('/games/knife/assets/audio/collision.mp3'),
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

  // Загрузка спрайтов
  const assetPaths = {
    target: '/games/knife/assets/images/target.png',
    knife: '/games/knife/assets/images/knife.png',
  };

  const images = {};
  let loadedCount = 0;
  const totalAssets = Object.keys(assetPaths).length;

  for (const [key, path] of Object.entries(assetPaths)) {
    const img = new Image();
    img.src = path;
    img.onload = () => {
      loadedCount++;
      if (loadedCount === totalAssets) initGame();
    };
    img.onerror = () => {
      console.warn('Failed to load asset', path);
      loadedCount++;
      if (loadedCount === totalAssets) initGame();
    };
    images[key] = img;
  }

  // Константы игрового поля
  const CW = 720;
  const CH = 1280;
  const TARGET_X = CW / 2;
  const TARGET_Y = 380;
  const TARGET_RADIUS = 130;
  const KNIFE_WIDTH = 34;
  const KNIFE_HEIGHT = 130;
  const KNIFE_START_Y = 1000;
  const KNIFE_SPEED = 42; // px per frame
  const COLLISION_ANGLE_DIST = 0.22; // ~12.6 градусов дистанция столкновения

  // Состояние игры
  let gameState = 'START'; // 'START' | 'PLAYING' | 'GAMEOVER' | 'VICTORY'
  let score = 0;
  let stage = 1;
  let bestScore = 0;
  try {
    bestScore = parseInt(localStorage.getItem('knife_best_score') || '0', 10);
  } catch (_) {}

  let targetAngle = 0;
  let targetRotationSpeed = 0.035; // radians per tick
  let rotationPatternTimer = 0;
  let currentPattern = 'constant'; // 'constant' | 'oscillate' | 'stop_and_go' | 'speed_burst'

  let remainingKnives = 7;
  let readyKnife = null;
  let flyingKnife = null;
  let stuckKnives = []; // Array of angles relative to target: number[]
  let particles = []; // Щепки, искры, осколки дерева
  let woodDebris = []; // Большие куски спила при взрыве
  let screenShake = 0;
  let scorePopups = [];

  // Настройка уровня / раунда
  function setupStage(newStage) {
    stage = newStage;
    targetAngle = 0;
    stuckKnives = [];
    flyingKnife = null;
    remainingKnives = Math.min(6 + stage, 12);
    
    // Предварительно воткнутые ножи на мишени (как в классическом Knife Hit)
    const preStuckCount = Math.min(Math.floor((stage - 1) / 2), 4);
    for (let i = 0; i < preStuckCount; i++) {
      let angleCandidate;
      let attempts = 0;
      do {
        angleCandidate = Math.random() * Math.PI * 2;
        attempts++;
      } while (
        attempts < 20 &&
        stuckKnives.some(a => Math.abs(normalizeAngle(a - angleCandidate)) < COLLISION_ANGLE_DIST * 1.5)
      );
      stuckKnives.push(angleCandidate);
    }

    // Режим вращения
    const patterns = ['constant', 'oscillate', 'speed_burst'];
    if (stage >= 3) patterns.push('stop_and_go');
    currentPattern = patterns[Math.floor(Math.random() * patterns.length)];
    targetRotationSpeed = (0.03 + Math.min(stage * 0.005, 0.04)) * (Math.random() < 0.5 ? 1 : -1);
    rotationPatternTimer = 0;

    spawnReadyKnife();
  }

  function spawnReadyKnife() {
    if (remainingKnives <= 0) {
      readyKnife = null;
      return;
    }
    readyKnife = {
      x: TARGET_X,
      y: KNIFE_START_Y,
      targetY: KNIFE_START_Y,
    };
  }

  function normalizeAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  // Бросок ножа
  function throwKnife() {
    if (gameState === 'START') {
      gameState = 'PLAYING';
      score = 0;
      setupStage(1);
      return;
    }
    if (gameState === 'GAMEOVER') {
      gameState = 'PLAYING';
      score = 0;
      setupStage(1);
      return;
    }
    if (gameState !== 'PLAYING') return;
    if (flyingKnife || !readyKnife) return;

    flyingKnife = {
      x: TARGET_X,
      y: readyKnife.y,
    };
    readyKnife = null;
    remainingKnives--;

    // Виброотклик Telegram
    if (tg?.HapticFeedback) {
      tg.HapticFeedback.impactOccurred('light');
    }
  }

  // Эффект щепок при вонзании
  function createHitWoodParticles(x, y) {
    for (let i = 0; i < 14; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 6;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 3 + Math.random() * 5,
        color: Math.random() < 0.5 ? '#d2994e' : '#8d5b2d',
        life: 1,
        decay: 0.03 + Math.random() * 0.04,
        rot: Math.random() * Math.PI,
        vrot: (Math.random() - 0.5) * 0.2,
      });
    }
  }

  // Эффект металлических искр при столкновении
  function createMetalSparkParticles(x, y) {
    for (let i = 0; i < 28; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 4 + Math.random() * 12;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 2 + Math.random() * 4,
        color: Math.random() < 0.4 ? '#ffffff' : Math.random() < 0.8 ? '#ffe600' : '#ff7700',
        life: 1,
        decay: 0.04 + Math.random() * 0.06,
        rot: 0,
        vrot: 0,
      });
    }
  }

  // Разрушение спила дерева при прохождении раунда
  function explodeTarget() {
    screenShake = 16;
    if (tg?.HapticFeedback) {
      tg.HapticFeedback.notificationOccurred('success');
    }
    // Разлетающиеся крупные куски дерева
    for (let i = 0; i < 6; i++) {
      const sliceAngle = (i / 6) * Math.PI * 2;
      const speed = 6 + Math.random() * 8;
      woodDebris.push({
        x: TARGET_X,
        y: TARGET_Y,
        vx: Math.cos(sliceAngle) * speed,
        vy: Math.sin(sliceAngle) * speed - 2,
        rot: sliceAngle,
        vrot: (Math.random() - 0.5) * 0.2,
        life: 1,
        decay: 0.02,
        size: TARGET_RADIUS * 0.7,
      });
    }
    createHitWoodParticles(TARGET_X, TARGET_Y);
  }

  // Завершение игры
  function gameOver(deflectedKnife) {
    gameState = 'GAMEOVER';
    playSfx('collision');
    createMetalSparkParticles(deflectedKnife.x, deflectedKnife.y);
    screenShake = 22;

    if (tg?.HapticFeedback) {
      tg.HapticFeedback.notificationOccurred('error');
    }

    if (score > bestScore) {
      bestScore = score;
      try {
        localStorage.setItem('knife_best_score', String(bestScore));
      } catch (_) {}
    }

    submitScore(score);
  }

  // Отправка счёта на сервер
  async function submitScore(finalScore) {
    try {
      const payload = {
        game: 'knife_hit',
        game_name: 'knife_hit',
        score: finalScore,
        chat_id: chatId,
        user_name: userName,
      };
      const headers = {
        'Content-Type': 'application/json',
      };
      if (initData) headers['X-Telegram-Init-Data'] = initData;

      await fetch('/api/game/submit_score', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
    } catch (err) {
      console.warn('Failed to submit score:', err);
    }
  }

  // Главный цикл обновления физики
  function update() {
    rotationPatternTimer++;

    // Паттерны вращения мишени
    if (gameState === 'PLAYING' || gameState === 'START') {
      if (currentPattern === 'oscillate') {
        targetRotationSpeed = Math.sin(rotationPatternTimer * 0.03) * (0.045 + stage * 0.005);
      } else if (currentPattern === 'stop_and_go') {
        const cycle = rotationPatternTimer % 180;
        if (cycle < 100) {
          targetRotationSpeed = 0.04 * (targetRotationSpeed >= 0 ? 1 : -1);
        } else if (cycle < 130) {
          targetRotationSpeed = 0.005 * (targetRotationSpeed >= 0 ? 1 : -1);
        } else {
          targetRotationSpeed = -0.045 * (targetRotationSpeed >= 0 ? 1 : -1);
        }
      } else if (currentPattern === 'speed_burst') {
        if (rotationPatternTimer % 140 === 0) {
          targetRotationSpeed = (Math.random() < 0.5 ? 1 : -1) * (0.03 + Math.random() * 0.04);
        }
      }
      targetAngle += targetRotationSpeed;
    }

    // Полёт ножа
    if (flyingKnife) {
      flyingKnife.y -= KNIFE_SPEED;

      // Достижение мишени
      const hitTargetY = TARGET_Y + TARGET_RADIUS - 10;
      if (flyingKnife.y <= hitTargetY) {
        // Угол входа ножа в систему координат вращающейся мишени
        // Нож летит снизу вверх (угол в абсолютных координатах = PI/2)
        const hitAngle = normalizeAngle(Math.PI / 2 - targetAngle);

        // Проверка на столкновение с рукояткой уже воткнутых ножей
        let collided = false;
        for (const angle of stuckKnives) {
          const diff = Math.abs(normalizeAngle(angle - hitAngle));
          if (diff < COLLISION_ANGLE_DIST) {
            collided = true;
            break;
          }
        }

        if (collided) {
          // Столкновение металл об металл!
          const deflectKnife = {
            x: flyingKnife.x,
            y: flyingKnife.y,
            vx: (Math.random() > 0.5 ? 1 : -1) * (7 + Math.random() * 5),
            vy: 12 + Math.random() * 6,
            rot: 0,
            vrot: 0.35,
          };
          flyingKnife = null;
          gameOver(deflectKnife);
        } else {
          // Успешное вонзание!
          stuckKnives.push(hitAngle);
          playSfx('hit');
          createHitWoodParticles(flyingKnife.x, flyingKnife.y);
          screenShake = 6;
          score += 1;
          scorePopups.push({ x: flyingKnife.x + 35, y: flyingKnife.y - 20, text: '+1', life: 1 });
          flyingKnife = null;

          if (tg?.HapticFeedback) {
            tg.HapticFeedback.impactOccurred('medium');
          }

          // Проверка победы в раунде
          if (remainingKnives === 0) {
            explodeTarget();
            score += stage * 5; // Бонус за зачистку бревна
            scorePopups.push({ x: TARGET_X, y: TARGET_Y, text: `+${stage * 5} ЗАЧИСТКА!`, life: 1.5 });
            setTimeout(() => {
              setupStage(stage + 1);
            }, 500);
          } else {
            spawnReadyKnife();
          }
        }
      }
    }

    // Тряска экрана
    if (screenShake > 0) screenShake *= 0.85;
    if (screenShake < 0.3) screenShake = 0;

    // Частицы
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.25; // гравитация
      p.rot += p.vrot;
      p.life -= p.decay;
      if (p.life <= 0) particles.splice(i, 1);
    }

    // Осколки дерева при взрыве
    for (let i = woodDebris.length - 1; i >= 0; i--) {
      const w = woodDebris[i];
      w.x += w.vx;
      w.y += w.vy;
      w.vy += 0.4;
      w.rot += w.vrot;
      w.life -= w.decay;
      if (w.life <= 0 || w.y > CH + 100) woodDebris.splice(i, 1);
    }

    // Всплывающие очки
    for (let i = scorePopups.length - 1; i >= 0; i--) {
      const sp = scorePopups[i];
      sp.y -= 1.5;
      sp.life -= 0.025;
      if (sp.life <= 0) scorePopups.splice(i, 1);
    }
  }

  // Отрисовка
  function render() {
    ctx.save();
    ctx.clearRect(0, 0, CW, CH);

    // Эффект тряски экрана
    if (screenShake > 0) {
      const sx = (Math.random() - 0.5) * screenShake;
      const sy = (Math.random() - 0.5) * screenShake;
      ctx.translate(sx, sy);
    }

    // Фоновая сетка / лучи гаражного тира
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;
    for (let y = 100; y < CH; y += 80) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(CW, y);
      ctx.stroke();
    }

    // Верхняя информационная панель (Счёт, Рекорд, Этап)
    renderHUD();

    // Осколки взорвавшегося пня
    for (const w of woodDebris) {
      ctx.save();
      ctx.translate(w.x, w.y);
      ctx.rotate(w.rot);
      ctx.globalAlpha = Math.max(0, w.life);
      if (images.target && images.target.complete) {
        ctx.drawImage(images.target, -w.size / 2, -w.size / 2, w.size, w.size);
      } else {
        ctx.fillStyle = '#8d5b2d';
        ctx.beginPath();
        ctx.arc(0, 0, w.size / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Мишень (спил дерева) с воткнутыми ножами
    if (woodDebris.length === 0 || remainingKnives > 0) {
      renderTargetWithKnives();
    }

    // Летящий нож
    if (flyingKnife) {
      renderSingleKnife(flyingKnife.x, flyingKnife.y, 0);
    }

    // Готовый к броску нож
    if (readyKnife) {
      renderSingleKnife(readyKnife.x, readyKnife.y, 0);
    }

    // Индикатор оставшихся ножей слева внизу
    renderRemainingKnivesIndicator();

    // Частицы
    for (const p of particles) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      ctx.restore();
    }

    // Всплывающий текст очков
    for (const sp of scorePopups) {
      ctx.save();
      ctx.font = 'bold 32px sans-serif';
      ctx.fillStyle = `rgba(255, 215, 0, ${Math.max(0, sp.life)})`;
      ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
      ctx.shadowBlur = 8;
      ctx.fillText(sp.text, sp.x, sp.y);
      ctx.restore();
    }

    // Оверлеи состояний (Старт / Геймовер)
    if (gameState === 'START') {
      renderStartOverlay();
    } else if (gameState === 'GAMEOVER') {
      renderGameOverOverlay();
    }

    ctx.restore();
  }

  // Отрисовка мишени и закреплённых на ней ножей
  function renderTargetWithKnives() {
    ctx.save();
    ctx.translate(TARGET_X, TARGET_Y);
    ctx.rotate(targetAngle);

    // Спил бревна
    if (images.target && images.target.complete) {
      ctx.drawImage(
        images.target,
        -TARGET_RADIUS,
        -TARGET_RADIUS,
        TARGET_RADIUS * 2,
        TARGET_RADIUS * 2
      );
    } else {
      // Запасная процедурная отрисовка спила дерева
      ctx.fillStyle = '#8b5a2b';
      ctx.beginPath();
      ctx.arc(0, 0, TARGET_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 14;
      ctx.strokeStyle = '#5a3818';
      ctx.stroke();

      // Годовые кольца
      ctx.strokeStyle = 'rgba(60, 35, 10, 0.35)';
      ctx.lineWidth = 4;
      for (let r = 25; r < TARGET_RADIUS; r += 24) {
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Воткнутые ножи (вращаются вместе с мишенью)
    for (const angle of stuckKnives) {
      ctx.save();
      ctx.rotate(angle);
      // Нож торчит лезвием в дерево, рукоять наружу
      // Смещение наружу от центра радиуса
      ctx.translate(0, TARGET_RADIUS - 10);
      renderKnifeSprite(0, 0, 0);
      ctx.restore();
    }

    ctx.restore();
  }

  // Отрисовка отдельного спрайта ножа
  function renderSingleKnife(x, y, angle) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    renderKnifeSprite(0, 0, 0);
    ctx.restore();
  }

  function renderKnifeSprite(x, y, rot) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    if (images.knife && images.knife.complete) {
      // Спрайт knife.png: 92x372, остриё направлено вверх
      ctx.drawImage(
        images.knife,
        -KNIFE_WIDTH / 2,
        -KNIFE_HEIGHT * 0.15, // Центр привязки у кончика
        KNIFE_WIDTH,
        KNIFE_HEIGHT
      );
    } else {
      // Запасная векторная отрисовка ножа
      // Клинок
      ctx.fillStyle = '#e2e8f0';
      ctx.beginPath();
      ctx.moveTo(0, -10);
      ctx.lineTo(KNIFE_WIDTH / 2, 45);
      ctx.lineTo(-KNIFE_WIDTH / 2, 45);
      ctx.closePath();
      ctx.fill();
      // Рукоятка
      ctx.fillStyle = '#c53030';
      ctx.fillRect(-KNIFE_WIDTH * 0.35, 45, KNIFE_WIDTH * 0.7, KNIFE_HEIGHT - 45);
      // Гарда
      ctx.fillStyle = '#4a5568';
      ctx.fillRect(-KNIFE_WIDTH * 0.5, 40, KNIFE_WIDTH, 7);
    }
    ctx.restore();
  }

  // Индикатор оставшихся ножей в раунде
  function renderRemainingKnivesIndicator() {
    const startX = 40;
    const bottomY = CH - 80;
    const iconW = 12;
    const iconH = 32;
    const gap = 14;

    ctx.save();
    for (let i = 0; i < remainingKnives; i++) {
      const y = bottomY - i * (iconH + gap);
      ctx.fillStyle = '#ff9800';
      ctx.shadowColor = '#ff9800';
      ctx.shadowBlur = 8;
      // Мини-пиктограмма ножика
      ctx.fillRect(startX, y, iconW, iconH * 0.65);
      ctx.fillStyle = '#e0e0e0';
      ctx.beginPath();
      ctx.moveTo(startX, y);
      ctx.lineTo(startX + iconW / 2, y - 10);
      ctx.lineTo(startX + iconW, y);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // Панель счета и рекорда
  function renderHUD() {
    ctx.save();
    // Текущий счёт
    ctx.font = '800 68px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
    ctx.shadowBlur = 10;
    ctx.fillText(String(score), CW / 2, 130);

    // Номер этапа
    ctx.font = '600 22px sans-serif';
    ctx.fillStyle = '#ff9800';
    ctx.fillText(`ЭТАП ${stage}`, CW / 2, 175);

    // Рекорд
    ctx.font = '500 18px sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.fillText(`РЕКОРД: ${bestScore}`, CW / 2, 205);

    ctx.restore();
  }

  // Стартовый экран
  function renderStartOverlay() {
    ctx.save();
    ctx.fillStyle = 'rgba(10, 12, 16, 0.65)';
    ctx.fillRect(0, 0, CW, CH);

    ctx.textAlign = 'center';
    ctx.font = '900 46px sans-serif';
    ctx.fillStyle = '#ff9800';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
    ctx.shadowBlur = 16;
    ctx.fillText('НОЖЕВОЙ ТИР', CW / 2, CH * 0.58);

    ctx.font = '500 22px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('Втыкайте ножи в мишень!', CW / 2, CH * 0.64);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.font = '400 18px sans-serif';
    ctx.fillText('Не попадайте по другим ножам', CW / 2, CH * 0.68);

    // Кнопка ТАП ДЛЯ СТАРТА
    ctx.fillStyle = '#ff9800';
    roundRect(ctx, CW / 2 - 140, CH * 0.74, 280, 64, 18);
    ctx.fill();

    ctx.font = '700 24px sans-serif';
    ctx.fillStyle = '#111';
    ctx.shadowBlur = 0;
    ctx.fillText('НАЖМИТЕ ДЛЯ СТАРТА', CW / 2, CH * 0.74 + 40);

    ctx.restore();
  }

  // Экран поражения
  function renderGameOverOverlay() {
    ctx.save();
    ctx.fillStyle = 'rgba(10, 12, 16, 0.78)';
    ctx.fillRect(0, 0, CW, CH);

    ctx.textAlign = 'center';
    ctx.font = '900 48px sans-serif';
    ctx.fillStyle = '#ff4d4f';
    ctx.shadowColor = 'rgba(255, 77, 79, 0.6)';
    ctx.shadowBlur = 16;
    ctx.fillText('ОТСКОК!', CW / 2, CH * 0.46);

    ctx.font = '500 22px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.shadowBlur = 0;
    ctx.fillText('Нож попал в рукоять', CW / 2, CH * 0.52);

    ctx.font = '700 36px sans-serif';
    ctx.fillStyle = '#ffcc00';
    ctx.fillText(`Счёт: ${score}`, CW / 2, CH * 0.59);

    if (score >= bestScore && score > 0) {
      ctx.font = '700 20px sans-serif';
      ctx.fillStyle = '#52c41a';
      ctx.fillText('🎉 НОВЫЙ РЕКОРД! 🎉', CW / 2, CH * 0.64);
    }

    // Кнопка ЕЩЁ РАЗ
    ctx.fillStyle = '#ff9800';
    roundRect(ctx, CW / 2 - 140, CH * 0.72, 280, 64, 18);
    ctx.fill();

    ctx.font = '700 24px sans-serif';
    ctx.fillStyle = '#111';
    ctx.fillText('ИГРАТЬ СНОВА', CW / 2, CH * 0.72 + 40);

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

  // Игровой цикл
  function gameLoop() {
    update();
    render();
    requestAnimationFrame(gameLoop);
  }

  function initGame() {
    setupStage(1);
    gameState = 'START';
    requestAnimationFrame(gameLoop);
  }

  // Обработка клика / тапа
  const container = document.getElementById('game-container');
  function handleTap(e) {
    if (e.target.closest('.control-btn')) return;
    e.preventDefault();
    throwKnife();
  }

  container.addEventListener('touchstart', handleTap, { passive: false });
  container.addEventListener('pointerdown', handleTap);

  // Кнопки управления
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
})();
