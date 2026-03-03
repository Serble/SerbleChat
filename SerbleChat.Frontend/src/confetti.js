// Adapted confetti utility for React pages.
export function startConfetti(canvas, options = {}) {
  if (!canvas) return () => {};

  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};

  const particleCount = options.particleCount ?? 220;
  const gravity = options.gravity ?? 0.45;
  const terminalVelocity = options.terminalVelocity ?? 5;
  const drag = options.drag ?? 0.075;
  const durationMs = options.durationMs ?? 2600;
  const shouldLoop = options.loop ?? true;

  const colors = [
    { front: '#ef4444', back: '#7f1d1d' },
    { front: '#22c55e', back: '#166534' },
    { front: '#3b82f6', back: '#1e3a8a' },
    { front: '#eab308', back: '#854d0e' },
    { front: '#f97316', back: '#9a3412' },
    { front: '#ec4899', back: '#9d174d' },
    { front: '#a855f7', back: '#6b21a8' },
    { front: '#14b8a6', back: '#115e59' },
  ];

  let particles = [];
  let rafId = null;
  let stopped = false;
  const startTime = Date.now();

  const randomRange = (min, max) => Math.random() * (max - min) + min;

  const resizeCanvas = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  };

  const initParticles = () => {
    for (let i = 0; i < particleCount; i++) {
      particles.push({
        color: colors[Math.floor(randomRange(0, colors.length))],
        dimensions: {
          x: randomRange(8, 16),
          y: randomRange(8, 22),
        },
        position: {
          x: randomRange(0, canvas.width),
          y: canvas.height - 1,
        },
        rotation: randomRange(0, 2 * Math.PI),
        scale: { x: 1, y: 1 },
        velocity: {
          x: randomRange(-20, 20),
          y: randomRange(-44, -18),
        },
      });
    }
  };

  const render = () => {
    if (stopped) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    particles.forEach((particle, index) => {
      const width = particle.dimensions.x * particle.scale.x;
      const height = particle.dimensions.y * particle.scale.y;

      ctx.translate(particle.position.x, particle.position.y);
      ctx.rotate(particle.rotation);

      particle.velocity.x -= particle.velocity.x * drag;
      particle.velocity.y = Math.min(particle.velocity.y + gravity, terminalVelocity);
      particle.velocity.x += Math.random() > 0.5 ? Math.random() : -Math.random();

      particle.position.x += particle.velocity.x;
      particle.position.y += particle.velocity.y;

      if (particle.position.y >= canvas.height) particles.splice(index, 1);

      if (particle.position.x > canvas.width) particle.position.x = 0;
      if (particle.position.x < 0) particle.position.x = canvas.width;

      particle.scale.y = Math.cos(particle.position.y * 0.1);
      ctx.fillStyle = particle.scale.y > 0 ? particle.color.front : particle.color.back;
      ctx.fillRect(-width / 2, -height / 2, width, height);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    });

    const elapsed = Date.now() - startTime;
    if (particles.length <= 12 && shouldLoop && elapsed < durationMs) initParticles();

    if (elapsed >= durationMs && particles.length === 0) {
      stop();
      return;
    }

    rafId = window.requestAnimationFrame(render);
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (rafId !== null) window.cancelAnimationFrame(rafId);
    window.removeEventListener('resize', resizeCanvas);
    particles = [];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  resizeCanvas();
  initParticles();
  render();
  window.addEventListener('resize', resizeCanvas);

  return stop;
}