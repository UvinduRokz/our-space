(function () {
  const TapFX = {};
  let canvas, ctx, dpr;
  let particles = [];
  let rings = [];
  let running = false;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function rand(min, max) { return min + Math.random() * (max - min); }

  // Each side's effect is confined to its own half of the screen so it can
  // never visually bleed into the other person's color.
  function halfRect(side) {
    const cx = window.innerWidth / 2;
    return side === 'blue'
      ? [0, 0, cx, window.innerHeight]
      : [cx, 0, window.innerWidth - cx, window.innerHeight];
  }

  function spawnParticles(x, y, color, side) {
    const scale = Math.min(window.innerWidth, window.innerHeight) / 420;
    const count = 220;
    for (let i = 0; i < count; i++) {
      const angle = rand(0, Math.PI * 2);
      const speed = rand(2, 8) * scale;
      const heartShaped = Math.random() < 0.35;
      particles.push({
        x, y, side,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - rand(0, 1.5),
        life: 0,
        maxLife: rand(60, 110),
        size: heartShaped ? rand(7, 16) : rand(2, 7),
        color: Math.random() < 0.25 ? '#ffffff' : color,
        heart: heartShaped,
        rotation: rand(0, Math.PI * 2),
        spin: rand(-0.12, 0.12),
        drag: rand(0.955, 0.975),
      });
    }
  }

  function spawnRings(x, y, color, side) {
    const maxRadius = Math.min(window.innerWidth, window.innerHeight) * 0.55;
    for (let i = 0; i < 3; i++) {
      rings.push({
        x, y, side,
        life: -i * 9,
        maxLife: 65,
        maxRadius,
        color,
      });
    }
  }

  function drawHeart(cx, cy, size, rotation, color, alpha) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotation);
    ctx.scale(size / 20, size / 20);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, 6);
    ctx.bezierCurveTo(-10, -6, -20, 4, 0, 16);
    ctx.bezierCurveTo(20, 4, 10, -6, 0, 6);
    ctx.fill();
    ctx.restore();
  }

  function drawRing(r) {
    const t = r.life / r.maxLife;
    ctx.save();
    ctx.globalAlpha = (1 - t) * 0.45;
    ctx.strokeStyle = r.color;
    ctx.lineWidth = 3 * (1 - t) + 1;
    ctx.shadowColor = r.color;
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.arc(r.x, r.y, t * r.maxRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawParticle(p) {
    const t = p.life / p.maxLife;
    const alpha = 1 - t;
    if (p.heart) {
      drawHeart(p.x, p.y, p.size, p.rotation, p.color, alpha);
    } else {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1 - t * 0.4), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function step() {
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    rings = rings.filter((r) => r.life < r.maxLife);
    rings.forEach((r) => { r.life++; });

    particles = particles.filter((p) => p.life < p.maxLife);
    particles.forEach((p) => {
      p.life++;
      p.vx *= p.drag;
      p.vy *= p.drag;
      p.vy += 0.04;
      p.x += p.vx;
      p.y += p.vy;
      p.rotation += p.spin;
    });

    ['blue', 'pink'].forEach((side) => {
      const [rx, ry, rw, rh] = halfRect(side);
      ctx.save();
      ctx.beginPath();
      ctx.rect(rx, ry, rw, rh);
      ctx.clip();
      rings.filter((r) => r.side === side && r.life > 0).forEach(drawRing);
      particles.filter((p) => p.side === side).forEach(drawParticle);
      ctx.restore();
    });

    if (particles.length || rings.length) {
      requestAnimationFrame(step);
    } else {
      running = false;
    }
  }

  TapFX.init = function (canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
  };

  TapFX.trigger = function (x, y, color, side) {
    spawnParticles(x, y, color, side);
    spawnRings(x, y, color, side);
    if (!running) {
      running = true;
      requestAnimationFrame(step);
    }
  };

  window.TapFX = TapFX;
})();
