
// Gachimuchi Sound FX Engine
const gachiAudio = {
  spank: Array.from({ length: 4 }, () => new Audio('../../assets/gachi_audio/spank.mp3')),
  pass: [new Audio('../../assets/gachi_audio/yes_sir.mp3'), new Audio('../../assets/gachi_audio/ass_we_can.mp3')],
  death: new Audio('../../assets/gachi_audio/aaaaah.mp3'),
  boss: new Audio('../../assets/gachi_audio/boss_of_this_gym.mp3'),
  fisting: new Audio('../../assets/gachi_audio/fisting_300.mp3'),
  idx: 0
};
function playGachiSpank() {
  try {
    const a = gachiAudio.spank[gachiAudio.idx % gachiAudio.spank.length];
    gachiAudio.idx++;
    a.currentTime = 0; a.volume = 0.85; a.play().catch(()=>{});
  } catch(_) {}
}
function playGachiPass() {
  try {
    const a = gachiAudio.pass[Math.floor(Math.random() * gachiAudio.pass.length)];
    a.currentTime = 0; a.volume = 0.9; a.play().catch(()=>{});
  } catch(_) {}
}
function playGachiGoal() {
  try { gachiAudio.boss.currentTime = 0; gachiAudio.boss.volume = 0.9; gachiAudio.boss.play().catch(()=>{}); } catch(_) {}
}
function playGachiMiss() {
  try { gachiAudio.death.currentTime = 0; gachiAudio.death.volume = 0.9; gachiAudio.death.play().catch(()=>{}); } catch(_) {}
}
function playGachiOver() {
  try { gachiAudio.death.currentTime = 0; gachiAudio.death.volume = 0.9; gachiAudio.death.play().catch(()=>{}); } catch(_) {}
}
function playGachiDeath() {
  try { gachiAudio.death.currentTime = 0; gachiAudio.death.volume = 0.9; gachiAudio.death.play().catch(()=>{}); } catch(_) {}
}
(() => {
  const tg = window.parent?.Telegram?.WebApp || window.Telegram?.WebApp;
  tg?.ready();
  tg?.expand();

  // Параметры запуска
  const searchParams = new URLSearchParams(window.location.search);
  const chatId = searchParams.get('chat_id') || tg?.initDataUnsafe?.chat?.id || null;
  const initData = tg?.initData || '';
  const userName = tg?.initDataUnsafe?.user?.first_name || 'Кибер-Игрок';

  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');

  // Виртуальные размеры поля 720 x 1280
  const CW = 720;
  const CH = 1280;

  // Web Audio синтезатор для неоновых ретро-звуков (не требует внешних файлов и работает офлайн)
  let soundEnabled = true;
  let audioCtx = null;

  function initAudio() {
    if (!audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        audioCtx = new AudioContext();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
  }

  function playTone(freq, type = 'sine', duration = 0.1, gainVal = 0.25, pitchDrop = 0) {
    if (!soundEnabled) return;
    try {
      initAudio();
      if (!audioCtx) return;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = type;
      const now = audioCtx.currentTime;
      osc.frequency.setValueAtTime(freq, now);
      if (pitchDrop > 0) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq - pitchDrop), now + duration);
      } else if (pitchDrop < 0) {
        osc.frequency.exponentialRampToValueAtTime(freq - pitchDrop, now + duration);
      }

      gain.gain.setValueAtTime(gainVal, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      osc.start(now);
      osc.stop(now + duration);
    } catch (_) {}
  }

  function playSfx(name) {
    if (!soundEnabled) return;
    switch (name) {
      case 'paddle':
        playTone(320, 'triangle', 0.08, 0.3, -80);
        break;
      case 'hit1':
        playTone(520, 'sine', 0.09, 0.3, 100);
        break;
      case 'hit2':
        playTone(740, 'sine', 0.12, 0.35, 150);
        break;
      case 'hit3':
        playTone(1050, 'square', 0.15, 0.25, 300);
        break;
      case 'powerup':
        playTone(400, 'sine', 0.22, 0.35, -500);
        break;
      case 'laser':
        playTone(900, 'sawtooth', 0.12, 0.2, 700);
        break;
      case 'loselife':
        playTone(220, 'sawtooth', 0.35, 0.4, 150);
        break;
      case 'gameover':
        playTone(180, 'sawtooth', 0.7, 0.45, 120);
        break;
      case 'win':
        playTone(600, 'triangle', 0.4, 0.4, -300);
        break;
    }
  }

  // --- Игровое состояние ---
  let gameState = 'START'; // 'START' | 'PLAYING' | 'GAMEOVER' | 'VICTORY'
  let score = 0;
  let lives = 3;
  let combo = 0;
  let maxCombo = 0;
  let level = 1;
  let bestScore = 0;
  try {
    bestScore = parseInt(localStorage.getItem('brick_breaker_best_score') || '0', 10);
  } catch (_) {}

  // Платформа (Paddle)
  const PADDLE_BASE_WIDTH = 140;
  const PADDLE_HEIGHT = 20;
  const PADDLE_Y = CH - 140;
  let paddle = {
    x: CW / 2,
    y: PADDLE_Y,
    width: PADDLE_BASE_WIDTH,
    height: PADDLE_HEIGHT,
    targetX: CW / 2,
    laserTimer: 0,
    widthTimer: 0,
  };

  // Шарики (поддержка мульти-шара)
  let balls = [];
  const BALL_RADIUS = 10;
  const BASE_BALL_SPEED = 10.5;

  // Кирпичи (Bricks)
  const BRICK_ROWS = 7;
  const BRICK_COLS = 7;
  const BRICK_GAP = 10;
  const BRICK_OFFSET_TOP = 160;
  const BRICK_OFFSET_LEFT = 24;
  const BRICK_WIDTH = Math.floor((CW - BRICK_OFFSET_LEFT * 2 - (BRICK_COLS - 1) * BRICK_GAP) / BRICK_COLS);
  const BRICK_HEIGHT = 32;

  let bricks = [];

  // Выпадающие бонусы (PowerUps)
  // Типы: 'multi' (зеленый), 'wide' (синий/циан), 'laser' (красный), 'slow' (желтый)
  let powerUps = [];

  // Лазерные лучи
  let lasers = [];

  // Частицы неонового взрыва
  let particles = [];

  // Всплывающие очки (+100, x3 COMBO)
  let floatingTexts = [];

  // Цветовая палитра Гачимучи Gym: Кожаные подушки, Титановые блины, Золотые слитки
  const NEON_PALETTES = {
    hp1: { fill: '#1e293b', stroke: '#00f0ff', glow: '#00f0ff', label: '10KG' }, // Синий титановый блин
    hp2: { fill: '#3b1728', stroke: '#ff007f', glow: '#ff007f', label: '25KG' }, // Кожаная подушка качалки
    hp3: { fill: '#3a2e0a', stroke: '#ffd700', glow: '#ffd700', label: '50KG' }, // Золотой силовой блок 50KG
    gold: { fill: '#ffbe0b', stroke: '#fff1a8', glow: '#ffbe0b', label: '300$' }, // 300 Bucks блок
  };

  function createLevel(lvl) {
    bricks = [];
    const rows = Math.min(BRICK_ROWS + Math.floor((lvl - 1) / 2), 9);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < BRICK_COLS; c++) {
        // Прочность кирпича зависит от строки и уровня
        let maxHp = 1;
        if (r < 2) maxHp = 3;
        else if (r < 4) maxHp = 2;
        else maxHp = 1;

        if (lvl > 1 && Math.random() < 0.25) maxHp = Math.min(3, maxHp + 1);

        const x = BRICK_OFFSET_LEFT + c * (BRICK_WIDTH + BRICK_GAP);
        const y = BRICK_OFFSET_TOP + r * (BRICK_HEIGHT + BRICK_GAP);

        bricks.push({
          x,
          y,
          w: BRICK_WIDTH,
          h: BRICK_HEIGHT,
          hp: maxHp,
          maxHp: maxHp,
          active: true,
          colorType: maxHp === 3 ? 'hp3' : maxHp === 2 ? 'hp2' : 'hp1',
        });
      }
    }
  }

  function resetPaddle() {
    paddle.width = PADDLE_BASE_WIDTH;
    paddle.x = CW / 2;
    paddle.targetX = CW / 2;
    paddle.laserTimer = 0;
    paddle.widthTimer = 0;
  }

  function spawnBall(isServe = false) {
    const angle = (Math.random() * 0.6 - 0.3) - Math.PI / 2; // почти вертикально вверх
    const speed = BASE_BALL_SPEED + (level - 1) * 0.4;
    return {
      x: paddle.x,
      y: paddle.y - BALL_RADIUS - 4,
      vx: Math.sin(angle) * speed,
      vy: -Math.cos(angle) * speed,
      radius: BALL_RADIUS,
      active: true,
      stuck: isServe, // приклеен к платформе перед стартом
      trail: [],
    };
  }

  function startGame() {
    initAudio();
    score = 0;
    lives = 3;
    combo = 0;
    maxCombo = 0;
    level = 1;
    powerUps = [];
    lasers = [];
    particles = [];
    floatingTexts = [];
    resetPaddle();
    createLevel(level);
    balls = [spawnBall(true)];
    gameState = 'PLAYING';
  }

  function nextLevel() {
    level++;
    playSfx('win');
    spawnFloatingText(CW / 2, CH / 2 - 60, `УРОВЕНЬ ${level}!`, '#00f0ff', 44);
    createLevel(level);
    resetPaddle();
    powerUps = [];
    lasers = [];
    balls = [spawnBall(true)];
  }

  function gameOver() {
    gameState = 'GAMEOVER';
    playSfx('gameover');
    if (score > bestScore) {
      bestScore = score;
      try {
        localStorage.setItem('brick_breaker_best_score', bestScore.toString());
      } catch (_) {}
    }
    submitScore(score);
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'GAME_OVER', game: 'brick_breaker', score: score }, '*');
    }
  }

  async function submitScore(finalScore) {
    try {
      const payload = {
        game: 'brick_breaker',
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
      console.warn('Failed to submit brick_breaker score:', err);
    }
  }

  // --- Частицы и эффекты ---
  function spawnExplosion(x, y, color, count = 16) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 7 + 2;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: Math.random() * 5 + 3,
        color,
        alpha: 1,
        life: 1,
        decay: Math.random() * 0.03 + 0.02,
      });
    }
  }

  function spawnFloatingText(x, y, text, color = '#fff', size = 26) {
    floatingTexts.push({
      x,
      y,
      text,
      color,
      size,
      alpha: 1,
      vy: -1.6,
    });
  }

  function spawnPowerUp(x, y) {
    // 25% шанс выпадения бонуса при разрушении блока
    if (Math.random() > 0.28) return;
    const types = ['multi', 'wide', 'laser', 'slow'];
    const chosenType = types[Math.floor(Math.random() * types.length)];
    powerUps.push({
      x,
      y,
      vy: 3.2,
      type: chosenType,
      size: 26,
    });
  }

  function applyPowerUp(type) {
    playSfx('powerup');
    if (type === 'multi') {
      spawnFloatingText(paddle.x, paddle.y - 40, '🔥 300 BUCKS MULTIPLIER!', '#ffd700', 28);
      // Клонируем существующие шары в трех направлениях
      const newBalls = [];
      balls.forEach(b => {
        if (!b.active || b.stuck) return;
        [-0.45, 0.45].forEach(angOffset => {
          const curAng = Math.atan2(b.vy, b.vx);
          const spd = Math.hypot(b.vx, b.vy);
          newBalls.push({
            x: b.x,
            y: b.y,
            vx: Math.cos(curAng + angOffset) * spd,
            vy: Math.sin(curAng + angOffset) * spd,
            radius: BALL_RADIUS,
            active: true,
            stuck: false,
            trail: [],
          });
        });
      });
      balls.push(...newBalls);
    } else if (type === 'wide') {
      spawnFloatingText(paddle.x, paddle.y - 40, '💥 MAXIMUM POWER ГАНТЕЛЬ!', '#00f0ff', 28);
      paddle.width = PADDLE_BASE_WIDTH * 1.6;
      paddle.widthTimer = 600; // ~10 сек
    } else if (type === 'laser') {
      spawnFloatingText(paddle.x, paddle.y - 40, '⚡ JABRONI DOWN ЛАЗЕРЫ!', '#ff0055', 28);
      paddle.laserTimer = 450; // ~7.5 сек
    } else if (type === 'slow') {
      spawnFloatingText(paddle.x, paddle.y - 40, '💪 РЕЛАКС В САУНЕ!', '#ffbe0b', 28);
      balls.forEach(b => {
        b.vx *= 0.72;
        b.vy *= 0.72;
      });
    }
  }

  function fireLasers() {
    lasers.push({
      x: paddle.x - paddle.width / 2 + 10,
      y: paddle.y - 10,
      vy: -15,
      w: 4,
      h: 22,
    });
    lasers.push({
      x: paddle.x + paddle.width / 2 - 10,
      y: paddle.y - 10,
      vy: -15,
      w: 4,
      h: 22,
    });
    playSfx('laser');
  }

  let laserCooldown = 0;

  // --- Обновление логики игры (Update) ---
  function update() {
    if (gameState !== 'PLAYING') return;

    // Плавное следование платформы за пальцем / курсором
    paddle.x += (paddle.targetX - paddle.x) * 0.35;
    const halfW = paddle.width / 2;
    if (paddle.x - halfW < 0) paddle.x = halfW;
    if (paddle.x + halfW > CW) paddle.x = CW - halfW;

    // Таймеры бонусов
    if (paddle.widthTimer > 0) {
      paddle.widthTimer--;
      if (paddle.widthTimer <= 0) {
        paddle.width = PADDLE_BASE_WIDTH;
      }
    }

    if (paddle.laserTimer > 0) {
      paddle.laserTimer--;
      laserCooldown++;
      if (laserCooldown >= 18) {
        fireLasers();
        laserCooldown = 0;
      }
    }

    // Обновление лазеров
    for (let i = lasers.length - 1; i >= 0; i--) {
      const l = lasers[i];
      l.y += l.vy;
      let hit = false;
      for (let b of bricks) {
        if (!b.active) continue;
        if (l.x >= b.x && l.x <= b.x + b.w && l.y >= b.y && l.y <= b.y + b.h) {
          hit = true;
          b.hp--;
          spawnExplosion(l.x, l.y, '#ff0055', 8);
          if (b.hp <= 0) {
            b.active = false;
            score += 150;
            spawnPowerUp(b.x + b.w / 2, b.y + b.h / 2);
          }
          break;
        }
      }
      if (hit || l.y < 0) {
        lasers.splice(i, 1);
      }
    }

    // Обновление выпадающих бонусов
    for (let i = powerUps.length - 1; i >= 0; i--) {
      const p = powerUps[i];
      p.y += p.vy;

      // Проверка подбора платформой
      if (
        p.y + p.size / 2 >= paddle.y - paddle.height / 2 &&
        p.y - p.size / 2 <= paddle.y + paddle.height / 2 &&
        p.x >= paddle.x - paddle.width / 2 &&
        p.x <= paddle.x + paddle.width / 2
      ) {
        applyPowerUp(p.type);
        powerUps.splice(i, 1);
        continue;
      }

      // Упал за экран
      if (p.y > CH + 40) {
        powerUps.splice(i, 1);
      }
    }

    // Обновление шариков
    let activeBallCount = 0;
    for (let b of balls) {
      if (!b.active) continue;

      if (b.stuck) {
        b.x = paddle.x;
        b.y = paddle.y - paddle.height / 2 - b.radius - 2;
        activeBallCount++;
        continue;
      }

      // След шара
      b.trail.push({ x: b.x, y: b.y, alpha: 0.6 });
      if (b.trail.length > 7) b.trail.shift();

      b.x += b.vx;
      b.y += b.vy;

      // Отскок от стен
      if (b.x - b.radius < 0) {
        b.x = b.radius;
        b.vx = Math.abs(b.vx);
        playSfx('paddle');
      } else if (b.x + b.radius > CW) {
        b.x = CW - b.radius;
        b.vx = -Math.abs(b.vx);
        playSfx('paddle');
      }

      // Отскок от потолка
      if (b.y - b.radius < 70) {
        b.y = 70 + b.radius;
        b.vy = Math.abs(b.vy);
        playSfx('paddle');
      }

      // Столкновение с платформой
      const paddleTop = paddle.y - paddle.height / 2;
      const paddleBottom = paddle.y + paddle.height / 2;
      const paddleLeft = paddle.x - paddle.width / 2;
      const paddleRight = paddle.x + paddle.width / 2;

      if (
        b.y + b.radius >= paddleTop &&
        b.y - b.radius <= paddleBottom &&
        b.x >= paddleLeft - b.radius &&
        b.x <= paddleRight + b.radius &&
        b.vy > 0
      ) {
        // Угол отскока зависит от точки касания платформы (-1..1)
        const hitOffset = (b.x - paddle.x) / (paddle.width / 2);
        const clampedOffset = Math.max(-0.95, Math.min(0.95, hitOffset));
        const maxAngle = Math.PI * 0.4; // 72 градуса макс угол
        const bounceAngle = clampedOffset * maxAngle;
        const currentSpeed = Math.min(18, Math.hypot(b.vx, b.vy) * 1.015); // постепенное нарастание скорости

        b.vx = currentSpeed * Math.sin(bounceAngle);
        b.vy = -currentSpeed * Math.cos(bounceAngle);
        b.y = paddleTop - b.radius;

        combo = 0; // комбо сбрасывается при касании ракетки
        playSfx('paddle');
        spawnExplosion(b.x, paddleTop, '#00f0ff', 6);
      }

      // Столкновение с кирпичами
      for (let brick of bricks) {
        if (!brick.active) continue;

        // Быстрый AABB тест + поиск ближайшей точки
        const nearestX = Math.max(brick.x, Math.min(b.x, brick.x + brick.w));
        const nearestY = Math.max(brick.y, Math.min(b.y, brick.y + brick.h));
        const dx = b.x - nearestX;
        const dy = b.y - nearestY;

        if (dx * dx + dy * dy < b.radius * b.radius) {
          // Определяем с какой стороны было попадание
          const overlapLeft = (b.x + b.radius) - brick.x;
          const overlapRight = (brick.x + brick.w) - (b.x - b.radius);
          const overlapTop = (b.y + b.radius) - brick.y;
          const overlapBottom = (brick.y + brick.h) - (b.y - b.radius);

          const minOverlapX = Math.min(overlapLeft, overlapRight);
          const minOverlapY = Math.min(overlapTop, overlapBottom);

          if (minOverlapX < minOverlapY) {
            b.vx = -b.vx;
          } else {
            b.vy = -b.vy;
          }

          // Урон кирпичу
          brick.hp--;
          combo++;
          if (combo > maxCombo) maxCombo = combo;

          const comboMultiplier = Math.min(5, 1 + (combo - 1) * 0.5);
          const pointsGained = Math.round(100 * comboMultiplier);
          score += pointsGained;

          const palette = NEON_PALETTES[brick.colorType] || NEON_PALETTES.hp1;
          spawnExplosion(nearestX, nearestY, palette.glow, 14);

          if (combo > 1) {
            const comboText = combo >= 4 ? `💥 MAXIMUM POWER x${combo}!` : combo >= 2 ? `⚡ JABRONI DOWN x${combo}!` : `+${pointsGained}`;
            spawnFloatingText(nearestX, nearestY - 20, `${comboText} (+${pointsGained})`, '#ffd700', 22);
          } else {
            spawnFloatingText(nearestX, nearestY - 20, `+${pointsGained}`, '#ffffff', 20);
          }

          if (brick.hp <= 0) {
            brick.active = false;
            playSfx('hit3');
            spawnPowerUp(brick.x + brick.w / 2, brick.y + brick.h / 2);
          } else {
            playSfx(brick.hp === 2 ? 'hit2' : 'hit1');
          }
          break; // один удар за кадр
        }
      }

      // Падение шара ниже экрана
      if (b.y - b.radius > CH) {
        b.active = false;
      } else {
        activeBallCount++;
      }
    }

    // Если все шары потеряны
    if (activeBallCount === 0) {
      lives--;
      combo = 0;
      playSfx('loselife');
      if (lives <= 0) {
        gameOver();
      } else {
        resetPaddle();
        balls = [spawnBall(true)];
      }
    }

    // Проверка победы / перехода на следующий уровень
    const remainingBricks = bricks.filter(b => b.active).length;
    if (remainingBricks === 0) {
      nextLevel();
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

    // Обновление всплывающего текста
    for (let i = floatingTexts.length - 1; i >= 0; i--) {
      const ft = floatingTexts[i];
      ft.y += ft.vy;
      ft.alpha -= 0.02;
      if (ft.alpha <= 0) {
        floatingTexts.splice(i, 1);
      }
    }
  }

  // --- Отрисовка (Render) ---
  function render() {
    ctx.clearRect(0, 0, CW, CH);

    // Фоновая неоновая сетка
    renderBackgroundGrid();

    // Отрисовка кирпичей
    for (let b of bricks) {
      if (!b.active) continue;
      renderBrick(b);
    }

    // Отрисовка выпадающих бонусов
    for (let p of powerUps) {
      renderPowerUp(p);
    }

    // Отрисовка лазеров
    for (let l of lasers) {
      renderLaser(l);
    }

    // Отрисовка платформы (Paddle)
    renderPaddle();

    // Отрисовка шаров
    for (let b of balls) {
      if (b.active) renderBall(b);
    }

    // Отрисовка частиц
    for (let p of particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Всплывающий текст
    for (let ft of floatingTexts) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, ft.alpha);
      ctx.textAlign = 'center';
      ctx.font = `900 ${ft.size}px -apple-system, sans-serif`;
      ctx.fillStyle = ft.color;
      ctx.shadowColor = ft.color;
      ctx.shadowBlur = 12;
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.restore();
    }

    // Верхняя HUD полоса
    renderHUD();

    // Экраны Start / Game Over
    if (gameState === 'START') {
      renderStartOverlay();
    } else if (gameState === 'GAMEOVER') {
      renderGameOverOverlay();
    }
  }

  function renderBackgroundGrid() {
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.04)';
    ctx.lineWidth = 1;
    const step = 45;
    for (let x = 0; x < CW; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, CH);
      ctx.stroke();
    }
    for (let y = 0; y < CH; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(CW, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function renderBrick(b) {
    const palette = NEON_PALETTES[b.colorType] || NEON_PALETTES.hp1;
    ctx.save();
    ctx.shadowColor = palette.glow;
    ctx.shadowBlur = 14;

    // Внутренний металлический/кожаный градиент
    const grad = ctx.createLinearGradient(b.x, b.y, b.x, b.y + b.h);
    grad.addColorStop(0, palette.stroke);
    grad.addColorStop(0.2, palette.fill);
    grad.addColorStop(1, '#05070c');
    ctx.fillStyle = grad;

    roundRect(ctx, b.x, b.y, b.w, b.h, 6);
    ctx.fill();

    // Неоновая окантовка титанового блина / кожаной подушки
    ctx.lineWidth = 2;
    ctx.strokeStyle = palette.stroke;
    ctx.stroke();

    // Вес блина и метки прочности
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 12px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tag = b.hp > 1 ? `${palette.label} ★${b.hp}` : palette.label;
    ctx.fillText(tag, b.x + b.w / 2, b.y + b.h / 2);

    ctx.restore();
  }

  function renderPaddle() {
    ctx.save();
    const px = paddle.x - paddle.width / 2;
    const py = paddle.y - paddle.height / 2;

    const glowColor = paddle.laserTimer > 0 ? '#ff0055' : paddle.widthTimer > 0 ? '#00f0ff' : '#ffd700';
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = 18;

    // Хромированный стальной пояс / гантель Gym
    const grad = ctx.createLinearGradient(px, py, px, py + paddle.height);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.25, '#d4af37');
    grad.addColorStop(0.5, '#475569');
    grad.addColorStop(0.85, '#1e293b');
    grad.addColorStop(1, '#0f172a');
    ctx.fillStyle = grad;

    roundRect(ctx, px, py, paddle.width, paddle.height, 10);
    ctx.fill();

    ctx.lineWidth = 2.5;
    ctx.strokeStyle = glowColor;
    ctx.stroke();

    // Хромированные набалдашники гантели по бокам платформы
    ctx.fillStyle = '#ffd700';
    ctx.beginPath();
    ctx.arc(px + 8, paddle.y, 7, 0, Math.PI * 2);
    ctx.arc(px + paddle.width - 8, paddle.y, 7, 0, Math.PI * 2);
    ctx.fill();

    // Неоновые пушки лазера если активен бонус
    if (paddle.laserTimer > 0) {
      ctx.fillStyle = '#ff0055';
      ctx.fillRect(px + 4, py - 8, 8, 10);
      ctx.fillRect(px + paddle.width - 12, py - 8, 8, 10);
    }

    ctx.restore();
  }

  function renderBall(b) {
    ctx.save();

    // Отрисовка хвоста
    for (let t of b.trail) {
      ctx.beginPath();
      ctx.arc(t.x, t.y, b.radius * 0.75, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0, 240, 255, ${t.alpha * 0.4})`;
      ctx.fill();
    }

    // Сам шар
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();
  }

  function renderPowerUp(p) {
    ctx.save();
    let col = '#00f0ff';
    let icon = '⚡';
    if (p.type === 'multi') { col = '#39ff14'; icon = '🟢'; }
    else if (p.type === 'wide') { col = '#00f0ff'; icon = '↔'; }
    else if (p.type === 'laser') { col = '#ff0055'; icon = '⚡'; }
    else if (p.type === 'slow') { col = '#ffbe0b'; icon = '⏱'; }

    ctx.shadowColor = col;
    ctx.shadowBlur = 14;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#060810';
    ctx.font = '900 14px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(icon, p.x, p.y);
    ctx.restore();
  }

  function renderLaser(l) {
    ctx.save();
    ctx.shadowColor = '#ff0055';
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#ff0055';
    ctx.fillRect(l.x - l.w / 2, l.y, l.w, l.h);
    ctx.restore();
  }

  function renderHUD() {
    ctx.save();
    ctx.fillStyle = 'rgba(5, 7, 12, 0.88)';
    ctx.fillRect(0, 0, CW, 70);

    ctx.strokeStyle = 'rgba(255, 215, 0, 0.3)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 70);
    ctx.lineTo(CW, 70);
    ctx.stroke();

    // Очки
    ctx.textAlign = 'left';
    ctx.font = '900 22px -apple-system, sans-serif';
    ctx.fillStyle = '#ffd700';
    ctx.shadowColor = 'rgba(255, 215, 0, 0.6)';
    ctx.shadowBlur = 8;
    ctx.fillText(`⚡ BUCKS: ${score}`, 24, 44);

    // Уровень качалки
    ctx.textAlign = 'center';
    ctx.font = '800 18px -apple-system, sans-serif';
    ctx.fillStyle = '#00f0ff';
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 6;
    ctx.fillText(`DUNGEON УРОВЕНЬ ${level}`, CW / 2, 44);

    // Жизни / Сила
    ctx.textAlign = 'right';
    ctx.font = '22px -apple-system, sans-serif';
    ctx.fillStyle = '#ff0055';
    let hearts = '';
    for (let i = 0; i < lives; i++) hearts += '💪 ';
    ctx.fillText(hearts, CW - 24, 44);

    ctx.restore();
  }

  function renderStartOverlay() {
    ctx.save();
    ctx.fillStyle = 'rgba(5, 7, 12, 0.88)';
    ctx.fillRect(0, 0, CW, CH);

    ctx.textAlign = 'center';
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur = 24;
    ctx.font = '900 48px -apple-system, sans-serif';
    ctx.fillStyle = '#ffd700';
    ctx.fillText('SMASH THE JABRONI', CW / 2, 440);
    ctx.fillStyle = '#00f0ff';
    ctx.fillText('КИБЕР-ДРОБИЛКА', CW / 2, 500);

    ctx.shadowBlur = 0;
    ctx.font = '600 20px -apple-system, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
    ctx.fillText('Круши титановые блины хромированной гантелью!', CW / 2, 560);
    ctx.fillText('Лови 300 BUCKS бонусы и активируй MAXIMUM POWER!', CW / 2, 595);

    // Кнопка Старт
    const btnW = 340;
    const btnH = 74;
    const btnX = (CW - btnW) / 2;
    const btnY = 660;

    const grad = ctx.createLinearGradient(btnX, btnY, btnX + btnW, btnY);
    grad.addColorStop(0, '#d4af37');
    grad.addColorStop(0.5, '#ffd700');
    grad.addColorStop(1, '#ff9100');

    ctx.shadowColor = 'rgba(255, 215, 0, 0.6)';
    ctx.shadowBlur = 20;
    ctx.fillStyle = grad;
    roundRect(ctx, btnX, btnY, btnW, btnH, 18);
    ctx.fill();

    ctx.fillStyle = '#05070c';
    ctx.font = '900 24px -apple-system, sans-serif';
    ctx.shadowBlur = 0;
    ctx.fillText('НАЧАТЬ ДРОБЛЕНИЕ 💥', CW / 2, btnY + 46);

    ctx.restore();
  }

  function renderGameOverOverlay() {
    ctx.save();
    ctx.fillStyle = 'rgba(5, 7, 12, 0.92)';
    ctx.fillRect(0, 0, CW, CH);

    ctx.textAlign = 'center';
    ctx.shadowColor = '#ff0055';
    ctx.shadowBlur = 22;
    ctx.font = '900 50px -apple-system, sans-serif';
    ctx.fillStyle = '#ff0055';
    ctx.fillText('JABRONI DOWN!', CW / 2, 420);

    ctx.shadowBlur = 0;
    ctx.font = '700 22px -apple-system, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.fillText('ЗАРАБОТАНО BUCKS', CW / 2, 480);

    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur = 18;
    ctx.font = '900 80px -apple-system, sans-serif';
    ctx.fillStyle = '#ffd700';
    ctx.fillText(score.toString(), CW / 2, 565);

    ctx.shadowBlur = 0;
    ctx.font = '700 22px -apple-system, sans-serif';
    ctx.fillStyle = '#00f0ff';
    ctx.fillText(`🏆 Лучший силовой рекорд: ${bestScore}`, CW / 2, 625);

    // Кнопка Еще раз
    const btnW = 340;
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
    roundRect(ctx, btnX, btnY, btnW, btnH, 18);
    ctx.fill();

    ctx.fillStyle = '#05070c';
    ctx.font = '900 26px -apple-system, sans-serif';
    ctx.shadowBlur = 0;
    ctx.fillText('ПОВТОРИТЬ ПОДХОД ↺', CW / 2, btnY + 47);

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

  // --- Управление (Touch & Drag) ---
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
    initAudio();

    if (gameState === 'START' || gameState === 'GAMEOVER') {
      startGame();
      return;
    }

    // Если шарик приклеен (подача), отпускаем его по тапу
    balls.forEach(b => {
      if (b.stuck) b.stuck = false;
    });

    const pos = getCanvasCoords(e);
    paddle.targetX = pos.x;
  }

  function handlePointerMove(e) {
    if (gameState !== 'PLAYING') return;
    const pos = getCanvasCoords(e);
    paddle.targetX = pos.x;
  }

  const container = document.getElementById('game-container');
  container.addEventListener('touchstart', handlePointerDown, { passive: false });
  container.addEventListener('touchmove', (e) => {
    e.preventDefault();
    handlePointerMove(e);
  }, { passive: false });

  container.addEventListener('pointerdown', handlePointerDown);
  container.addEventListener('pointermove', handlePointerMove);

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
  function gameLoop() {
    update();
    render();
    requestAnimationFrame(gameLoop);
  }

  requestAnimationFrame(gameLoop);
})();
