(() => {
  const tg = window.parent?.Telegram?.WebApp || window.Telegram?.WebApp;
  tg?.ready();
  tg?.expand();

  // Параметры запуска
  const searchParams = new URLSearchParams(window.location.search);
  const chatId = searchParams.get('chat_id') || tg?.initDataUnsafe?.chat?.id || null;
  const initData = tg?.initData || '';
  const userName = tg?.initDataUnsafe?.user?.first_name || 'Дровосек';

  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');
  const restartContainer = document.getElementById('restart-container');
  const restartBtn = document.getElementById('btn-restart');
  const touchLeft = document.getElementById('touch-left');
  const touchRight = document.getElementById('touch-right');

  // Аудиосистема с поддержкой Гачимучи звуков и авто-разблокировкой
  let soundEnabled = true;
  
  // Пул реальных аудиофайлов для мгновенного отклика без задержек браузера
  const gachiAudioPool = {
    cut: [
      new Audio('assets/sound/cut.mp3'),
      new Audio('assets/sound/cut.mp3'),
      new Audio('assets/sound/cut.mp3'),
      new Audio('assets/sound/cut.mp3')
    ],
    death: [
      new Audio('assets/sound/death.mp3'),
      new Audio('../../assets/gachi_audio/fuck_you.mp3'),
      new Audio('../../assets/gachi_audio/aaaaah.mp3')
    ],
    bonus: [
      new Audio('../../assets/gachi_audio/ass_we_can.mp3'),
      new Audio('../../assets/gachi_audio/boy_next_door.mp3'),
      new Audio('../../assets/gachi_audio/fisting_300.mp3'),
      new Audio('../../assets/gachi_audio/thank_you_sir.mp3'),
      new Audio('../../assets/gachi_audio/yes_sir.mp3')
    ]
  };
  let cutPoolIdx = 0;

  // Разблокировка аудио по первому тапу в окне
  function unlockAudio() {
    Object.values(gachiAudioPool).forEach(list => {
      list.forEach(a => {
        a.load();
      });
    });
    window.removeEventListener('pointerdown', unlockAudio);
    window.removeEventListener('keydown', unlockAudio);
  }
  window.addEventListener('pointerdown', unlockAudio, { once: true });
  window.addEventListener('keydown', unlockAudio, { once: true });

  function playSfx(name) {
    if (!soundEnabled) return;
    try {
      if (name === 'cut') {
        const pool = gachiAudioPool.cut;
        const a = pool[cutPoolIdx % pool.length];
        cutPoolIdx++;
        a.currentTime = 0;
        a.volume = 0.9;
        const p = a.play();
        if (p && p.catch) p.catch(() => {});


      } else if (name === 'death') {
        const pool = gachiAudioPool.death;
        const a = pool[Math.floor(Math.random() * pool.length)];
        a.currentTime = 0;
        a.volume = 1.0;
        a.play().catch(() => {});
      }
    } catch (_) {}
  }

  // Загрузка спрайтов
  const assetPaths = {
    background: 'assets/image/background.png',
    stump: 'assets/image/stump.png',
    trunk1: 'assets/image/trunk1.png',
    branchleft: 'assets/image/branch1.png',
    branchright: 'assets/image/branch2.png',
    man: 'assets/image/man.png',
    rip: 'assets/image/rip.png',
    gameover: 'assets/image/gameover.png',
    play: 'assets/image/play.png',
    timeContainer: 'assets/image/time-container.png',
    timeBar: 'assets/image/time-bar.png',
    logo: 'assets/image/timberman_logo.png',
    clic: 'assets/image/clic.png',
    numbers: 'assets/image/numbers.png'
  };

  const images = {};
  let loadedCount = 0;
  const totalAssets = Object.keys(assetPaths).length;

  for (const [key, path] of Object.entries(assetPaths)) {
    const img = new Image();
    img.src = path;
    img.onload = () => {
      loadedCount++;
      if (loadedCount === totalAssets) {
        initGame();
      }
    };
    img.onerror = () => {
      loadedCount++;
      if (loadedCount === totalAssets) {
        initGame();
      }
    };
    images[key] = img;
  }

  // Состояния игры
  const STATE_LOADING = 0;
  const STATE_START = 1;
  const STATE_PLAYING = 2;
  const STATE_GAMEOVER = 3;

  let gameState = STATE_LOADING;

  // Игровая логика
  const TRUNK_HEIGHT = 243;
  const MAX_TIME = 508;
  let timeLeft = 254;
  let score = 0;
  let bestScore = 0;
  try {
    bestScore = parseInt(localStorage.getItem('timberman_best_score') || '0', 10);
  } catch (_) {}

  // Позиция дровосека: 'left' или 'right'
  let manSide = 'left';
  let manCutting = false;
  let cutTimer = null;

  // Дерево: массив из 7 секций (0 - самая нижняя, рядом с пнем)
  // Значения: 'trunk', 'left', 'right'
  let tree = [];

  // Летающие отрубленные щепки / бревна (анимация отлета)
  const flyingLogs = [];

  // Всплывающие фразы при ударах (ASS WE CAN, SLAP, etc.)
  const hitQuotes = [];
  const GACHI_QUOTES = ['ASS WE CAN! 💪', 'DEEP! ⚡', 'SLAP! 💥', 'COME ON! 🔥', 'OH YES! ⛓️', 'BOY NEXT DOOR! 🏋️'];

  function initTrunk() {
    tree = ['trunk', 'trunk'];
    for (let i = 2; i < 7; i++) {
      tree.push(generateNextLog(tree[i - 1]));
    }
  }

  function generateNextLog(prevLog) {
    if (prevLog !== 'trunk') {
      // После ветки обязательно обычный ствол, чтобы ветки не шли подряд
      return 'trunk';
    }
    // 35% шанс обычный ствол, 65% шанс ветка (слева или справа)
    const rnd = Math.random();
    if (rnd < 0.35) return 'trunk';
    if (rnd < 0.67) return 'left';
    return 'right';
  }

  function startGame() {
    score = 0;
    timeLeft = 260;
    manSide = 'left';
    manCutting = false;
    flyingLogs.length = 0;
    initTrunk();
    gameState = STATE_START;
    if (restartContainer) {
      restartContainer.style.display = 'none';
    }
    if (touchLeft) touchLeft.style.pointerEvents = 'auto';
    if (touchRight) touchRight.style.pointerEvents = 'auto';
  }

  function chop(side) {
    if (gameState === STATE_GAMEOVER) {
      return;
    }
    if (gameState === STATE_START) {
      gameState = STATE_PLAYING;
    }

    manSide = side;
    manCutting = true;
    clearTimeout(cutTimer);
    cutTimer = setTimeout(() => { manCutting = false; }, 80);

    playSfx('cut');

    // Тактильная виброотдача для Telegram
    if (tg?.HapticFeedback) {
      try { tg.HapticFeedback.impactOccurred('medium'); } catch (_) {}
    }

    // Сохраняем отрубленный ствол для эффекта отлета
    const choppedType = tree[0];
    flyingLogs.push({
      type: choppedType,
      x: 37,
      y: 1394 - TRUNK_HEIGHT,
      vx: side === 'left' ? 28 : -28,
      vy: -18,
      rotation: 0,
      vrot: side === 'left' ? 0.25 : -0.25,
      alpha: 1.0
    });

    // Проверяем, не наступил ли игрок под ветку в текущей нижней секции
    if (tree[0] === side) {
      die();
      return;
    }

    // Сдвигаем дерево вниз
    tree.shift();
    tree.push(generateNextLog(tree[tree.length - 1]));

    // Увеличиваем счет
    score++;
    if (score > bestScore) {
      bestScore = score;
      try { localStorage.setItem('timberman_best_score', bestScore); } catch (_) {}
    }

    // Добавляем эффект фразы при ударах каждые несколько рубок или случайно
    if (score % 3 === 0 || Math.random() < 0.3) {
      const quoteText = GACHI_QUOTES[Math.floor(Math.random() * GACHI_QUOTES.length)];
      hitQuotes.push({
        text: quoteText,
        x: side === 'left' ? 320 : 760,
        y: 1160,
        vy: -4,
        alpha: 1.0
      });
    }

    // Добавляем время (чем больше счет, тем меньше добавляется)
    const bonus = Math.max(7, 18 - Math.floor(score / 18));
    timeLeft = Math.min(MAX_TIME, timeLeft + bonus);

    // Проверяем, не упала ли новая опустившаяся ветка на дровосека
    if (tree[0] === manSide) {
      die();
    }
  }

  function die() {
    gameState = STATE_GAMEOVER;
    playSfx('death');

    if (restartContainer) {
      restartContainer.style.display = 'flex';
    }

    if (tg?.HapticFeedback) {
      try { tg.HapticFeedback.notificationOccurred('error'); } catch (_) {}
    }

    // Отправка результата на сервер
    submitScore(score);
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'GAME_OVER', game: 'timberjack', score: score }, '*');
    }
  }

  async function submitScore(finalScore) {
    if (finalScore <= 0) return;
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (initData) headers['X-Telegram-Init-Data'] = initData;

      await fetch('/api/game/submit_score', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          game: 'timberjack',
          score: finalScore,
          user_name: userName,
          chat_id: chatId
        })
      });
    } catch (err) {
      console.warn('Score submission error:', err);
    }
  }

  function initGame() {
    startGame();
    setupInputs();
    requestAnimationFrame(gameLoop);
  }

  function setupInputs() {
    const leftBtn = document.getElementById('touch-left');
    const rightBtn = document.getElementById('touch-right');

    const handleRestart = (e) => {
      if (e) e.preventDefault();
      if (gameState === STATE_GAMEOVER) {
        playSfx('menu');
        startGame();
      }
    };

    const handleLeft = (e) => {
      e.preventDefault();
      if (gameState === STATE_GAMEOVER) {
        handleRestart(e);
        return;
      }
      chop('left');
    };

    const handleRight = (e) => {
      e.preventDefault();
      if (gameState === STATE_GAMEOVER) {
        handleRestart(e);
        return;
      }
      chop('right');
    };

    leftBtn.addEventListener('pointerdown', handleLeft);
    rightBtn.addEventListener('pointerdown', handleRight);

    if (restartBtn) {
      restartBtn.addEventListener('pointerdown', handleRestart);
      restartBtn.addEventListener('click', handleRestart);
    }

    // Клавиатура (для тестирования на десктопе / стрелки и A/D)
    window.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        chop('left');
      } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        chop('right');
      } else if ((e.key === ' ' || e.key === 'Enter') && gameState === STATE_GAMEOVER) {
        startGame();
      }
    });

    // Рестарт по клику на кнопку Play на экране Game Over
    canvas.addEventListener('pointerdown', (e) => {
      if (gameState === STATE_GAMEOVER) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const clickX = (e.clientX - rect.left) * scaleX;
        const clickY = (e.clientY - rect.top) * scaleY;

        // Область кнопки Play на экране Game Over: (350, 900) разм 376x233
        if (clickX >= 350 && clickX <= 726 && clickY >= 900 && clickY <= 1133) {
          playSfx('menu');
          startGame();
        }
      }
    });

    // Верхние кнопки
    document.getElementById('btn-back').addEventListener('click', () => {
      if (window.parent && window.parent !== window) {
        window.parent.location.hash = '#games';
        const gamesTab = window.parent.document.querySelector('[data-tab="games"]');
        if (gamesTab) gamesTab.click();
      } else {
        window.location.href = '/#games';
      }
    });

    const muteBtn = document.getElementById('btn-mute');
    muteBtn.addEventListener('click', () => {
      soundEnabled = !soundEnabled;
      muteBtn.textContent = soundEnabled ? '🔊 Звук: Вкл' : '🔇 Звук: Выкл';
    });
  }

  // Основной цикл обновления и рендеринга
  let lastTime = performance.now();

  function gameLoop(now) {
    const dt = (now - lastTime) / 1000;
    lastTime = now;

    update(dt);
    render();

    requestAnimationFrame(gameLoop);
  }

  function update(dt) {
    if (gameState === STATE_PLAYING) {
      // Скорость убывания таймера растет со счетом
      const drainSpeed = 65 + Math.min(240, score * 2.2);
      timeLeft -= drainSpeed * dt;
      if (timeLeft <= 0) {
        timeLeft = 0;
        die();
      }
    }

    // Обновление отлетающих щепок
    for (let i = flyingLogs.length - 1; i >= 0; i--) {
      const fl = flyingLogs[i];
      fl.x += fl.vx;
      fl.y += fl.vy;
      fl.vy += 1.2; // Гравитация
      fl.rotation += fl.vrot;
      fl.alpha -= 0.02;
      if (fl.alpha <= 0 || fl.y > 1800) {
        flyingLogs.splice(i, 1);
      }
    }

    // Обновление всплывающих реплик
    for (let i = hitQuotes.length - 1; i >= 0; i--) {
      const hq = hitQuotes[i];
      hq.y += hq.vy;
      hq.alpha -= 0.025;
      if (hq.alpha <= 0) {
        hitQuotes.splice(i, 1);
      }
    }
  }

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 1. Фон — Ночной Dungeon Gym Forest с неоновым свечением
    if (images.background) {
      ctx.drawImage(images.background, 0, 0, 1080, 1775);
    }
    // Накладываем атмосферный фильтр Dungeon Gym: глубокий кобальт / графит с неоновым освещением
    ctx.save();
    const bgGrad = ctx.createLinearGradient(0, 0, 0, 1775);
    bgGrad.addColorStop(0, 'rgba(4, 7, 18, 0.75)');
    bgGrad.addColorStop(0.4, 'rgba(10, 20, 42, 0.55)');
    bgGrad.addColorStop(0.85, 'rgba(5, 9, 20, 0.7)');
    bgGrad.addColorStop(1, 'rgba(2, 4, 10, 0.9)');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, 1080, 1775);

    // Добавляем неоновую колонну в центре за деревом
    const centerGlow = ctx.createRadialGradient(540, 900, 50, 540, 900, 550);
    centerGlow.addColorStop(0, 'rgba(0, 229, 255, 0.12)');
    centerGlow.addColorStop(0.5, 'rgba(0, 119, 182, 0.05)');
    centerGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = centerGlow;
    ctx.fillRect(0, 0, 1080, 1775);
    ctx.restore();

    // 2. Пень внизу (с кожаным/стальным оттенком)
    if (images.stump) {
      ctx.save();
      ctx.drawImage(images.stump, 352, 1394, 385, 81);

      ctx.restore();
    }

    // 3. Ствол дерева (6 секций от пня вверх) со стальными ремнями и заклепками
    for (let i = 0; i < 6; i++) {
      const logType = tree[i];
      const y = 1394 - TRUNK_HEIGHT * (i + 1);

      let img = images.trunk1;
      if (logType === 'left') img = images.branchleft;
      else if (logType === 'right') img = images.branchright;

      if (img) {
        ctx.save();
        ctx.drawImage(img, 37, y, 1004, TRUNK_HEIGHT);
        
        // Рисуем стильные кожаные ремни с металлическими заклепками на бревнах (Dungeon theme)
        const trunkCenter = 540;
        const trunkHalfW = 140;
        

        


        ctx.restore();
      }
    }

    // 4. Отлетающие отрубленные бревна
    for (const fl of flyingLogs) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, fl.alpha);
      ctx.translate(fl.x + 502, fl.y + TRUNK_HEIGHT / 2);
      ctx.rotate(fl.rotation);

      let fImg = images.trunk1;
      if (fl.type === 'left') fImg = images.branchleft;
      else if (fl.type === 'right') fImg = images.branchright;

      if (fImg) {
        ctx.drawImage(fImg, -502, -TRUNK_HEIGHT / 2, 1004, TRUNK_HEIGHT);
      }
      ctx.restore();
    }

    // 4.1. Всплывающие фразы при ударах (ASS WE CAN, SLAP, etc.)
    for (const hq of hitQuotes) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, hq.alpha);
      ctx.fillStyle = '#00e5ff';
      ctx.font = '900 36px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.shadowColor = '#00e5ff';
      ctx.shadowBlur = 16;
      ctx.fillText(hq.text, hq.x, hq.y);
      ctx.restore();
    }

    // 5. Дровосек или Могилка (RIP)
    if (gameState === STATE_GAMEOVER) {
      if (images.rip) {
        const ripX = manSide === 'left' ? 240 : 660;
        ctx.drawImage(images.rip, ripX, 1260, 275, 286);
      }
    } else {
      if (images.man) {
        renderTimberman();
      }
    }

    // 6. Таймер времени (вверху) — стилизованный под шкалу выносливости Gym
    if (gameState === STATE_PLAYING || gameState === STATE_START) {
      if (images.timeContainer && images.timeBar) {
        ctx.drawImage(images.timeContainer, 255, 100, 569, 150);

        const currentBarWidth = Math.max(0, (timeLeft / MAX_TIME) * 508);
        if (currentBarWidth > 0) {
          ctx.save();
          // Рисуем неоново-синюю шкалу выносливости вместо обычной зеленой
          const barGrad = ctx.createLinearGradient(285, 130, 285 + currentBarWidth, 130);
          barGrad.addColorStop(0, '#00b4d8');
          barGrad.addColorStop(1, '#00e5ff');
          ctx.fillStyle = barGrad;
          ctx.beginPath();
          ctx.roundRect ? ctx.roundRect(285, 130, currentBarWidth, 91, 10) : ctx.rect(285, 130, currentBarWidth, 91);
          ctx.fill();
          ctx.strokeStyle = '#e0f2fe';
          ctx.lineWidth = 3;
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    // 7. Счёт очков по центру
    renderNumbers(score, 700);

    // 8. Экран старта / кликни для начала
    if (gameState === STATE_START) {
      ctx.save();
      // Стильный логотип Leather Lumberjack • Лесоруб Билли
      ctx.fillStyle = '#ffffff';
      ctx.font = '900 48px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.shadowColor = '#00e5ff';
      ctx.shadowBlur = 24;
      ctx.fillText('LEATHER LUMBERJACK', 540, 410);

      ctx.fillStyle = '#00e5ff';
      ctx.font = '800 32px -apple-system, sans-serif';
      ctx.shadowBlur = 12;
      ctx.fillText('⚡ ЛЕСОРУБ БИЛЛИ ⚡', 540, 465);

      ctx.fillStyle = '#cbd5e1';
      ctx.font = '700 24px -apple-system, sans-serif';
      ctx.shadowBlur = 0;
      ctx.fillText('Руби ствол со свистом, boy next door!', 540, 515);

      // Плашка старта
      ctx.fillStyle = 'rgba(13, 22, 40, 0.85)';
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(540 - 230, 1470, 460, 90, 45) : ctx.rect(540 - 230, 1470, 460, 90);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#00e5ff';
      ctx.font = '900 32px -apple-system, sans-serif';
      ctx.shadowColor = '#00e5ff';
      ctx.shadowBlur = 15;
      ctx.fillText('💪 РУБИ СТВОЛ! (TAP)', 540, 1528);
      ctx.restore();
    }

    // 9. Экран Game Over
    if (gameState === STATE_GAMEOVER) {
      if (images.gameover) {
        ctx.drawImage(images.gameover, 104, 300, 872, 1100);
      }
      
      // Накладываем стильную плашку поражения: ⚡ ЛОПНУЛИ РЕМНИ!
      ctx.save();
      ctx.fillStyle = '#ef4444';
      ctx.font = '900 52px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.shadowColor = '#ef4444';
      ctx.shadowBlur = 25;
      ctx.fillText('⚡ ЛОПНУЛИ РЕМНИ! ⚡', 540, 450);

      ctx.fillStyle = '#fbbf24';
      ctx.font = '800 32px -apple-system, sans-serif';
      ctx.shadowColor = '#f59e0b';
      ctx.shadowBlur = 12;
      ctx.fillText('💀 СТВОЛ ОКАЗАЛСЯ СЛИШКОМ МОЩНЫМ', 540, 505);
      ctx.restore();

      if (images.play) {
        ctx.drawImage(images.play, 350, 900, 376, 233);
      }
      // Отрисовка лучшего рекорда внутри таблички
      renderNumbers(bestScore, 580);
    }
  }

  function renderTimberman() {
    ctx.save();
    // man.png размер (2108, 413), 4 кадра по 527x413:
    // Кадры: 0, 1 = рубка, 2, 3 = дыхание
    let frame = 2;
    if (manCutting) {
      frame = 1;
    } else {
      frame = (Math.floor(Date.now() / 320) % 2 === 0) ? 2 : 3;
    }

    const frameW = 527;
    const frameH = 413;
    const sx = frame * frameW;

    if (manSide === 'left') {
      ctx.drawImage(images.man, sx, 0, frameW, frameH, 80, 1120, frameW, frameH);
    } else {
      // Отражаем по горизонтали для правой стороны
      ctx.translate(1080, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(images.man, sx, 0, frameW, frameH, 80, 1120, frameW, frameH);
    }
    ctx.restore();
  }

  // Отрисовка цифр счета спрайтом numbers.png (744x101)
  const DIGIT_RECTS = [
    [5, 5, 66, 91],   // 0
    [81, 5, 50, 91],  // 1
    [141, 5, 66, 91], // 2
    [217, 5, 66, 91], // 3
    [293, 5, 66, 91], // 4
    [369, 5, 66, 91], // 5
    [445, 5, 66, 91], // 6
    [521, 5, 66, 91], // 7
    [597, 5, 66, 91], // 8
    [673, 5, 66, 91]  // 9
  ];

  function renderNumbers(num, y) {
    if (!images.numbers) return;
    const str = String(num);
    let totalW = 0;
    for (let i = 0; i < str.length; i++) {
      const d = parseInt(str[i], 10);
      totalW += DIGIT_RECTS[d][2] + 4;
    }

    let startX = (1080 - totalW) / 2;
    for (let i = 0; i < str.length; i++) {
      const d = parseInt(str[i], 10);
      const [sx, sy, sw, sh] = DIGIT_RECTS[d];
      ctx.drawImage(images.numbers, sx, sy, sw, sh, startX, y, sw, sh);
      startX += sw + 4;
    }
  }

})();