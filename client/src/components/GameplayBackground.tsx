import React, { useEffect, useRef } from "react";

interface BgCat {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  targetAngle: number;
  color: string;
  name: string;
  weapon: string;
  shootTimer: number;
  rollTimer: number;
  isRolling: boolean;
  rollAngle: number;
}

interface BgBullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  life: number;
  radius: number;
}

interface BgParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  life: number;
  maxLife: number;
  size: number;
}

interface BgShape {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vRot: number;
  type: "crate" | "barrel" | "poly";
  size: number;
  hp: number;
}

export const GameplayBackground: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoLoaded, setVideoLoaded] = React.useState(false);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.play().catch(() => {});
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId = 0;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", handleResize);

    // Initial autonomous bots
    const catColors = ["#10b981", "#ef4444", "#8b5cf6", "#f97316", "#06b6d4", "#eab308"];
    const catNames = ["Alpha", "Shadow", "Garfield", "Blaze", "Viper", "Ghost"];
    const weapons = ["LASER", "SHOTGUN", "SNIPER"];

    const cats: BgCat[] = Array.from({ length: 6 }).map((_, i) => ({
      x: 100 + Math.random() * (width - 200),
      y: 100 + Math.random() * (height - 200),
      vx: (Math.random() - 0.5) * 1.5,
      vy: (Math.random() - 0.5) * 1.5,
      angle: Math.random() * Math.PI * 2,
      targetAngle: Math.random() * Math.PI * 2,
      color: catColors[i % catColors.length],
      name: catNames[i % catNames.length],
      weapon: weapons[i % weapons.length],
      shootTimer: Math.random() * 60,
      rollTimer: 180 + Math.random() * 240,
      isRolling: false,
      rollAngle: 0,
    }));

    const bullets: BgBullet[] = [];
    const particles: BgParticle[] = [];

    // Floating shapes & crates (diep.io + battlecats style)
    const shapes: BgShape[] = Array.from({ length: 14 }).map(() => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      rot: Math.random() * Math.PI * 2,
      vRot: (Math.random() - 0.5) * 0.02,
      type: Math.random() > 0.5 ? "crate" : Math.random() > 0.5 ? "barrel" : "poly",
      size: 18 + Math.random() * 14,
      hp: 100,
    }));

    let gridOffset = 0;

    const spawnSparks = (x: number, y: number, color: string, count = 6) => {
      for (let i = 0; i < count; i++) {
        const ang = Math.random() * Math.PI * 2;
        const spd = 1.5 + Math.random() * 3.5;
        particles.push({
          x,
          y,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd,
          color,
          life: 20 + Math.random() * 15,
          maxLife: 35,
          size: 2 + Math.random() * 2.5,
        });
      }
    };

    const render = () => {
      // 1. Clear & Background diep.io arena style (soft slate-900 / grid)
      ctx.fillStyle = "#0a0f1d";
      ctx.fillRect(0, 0, width, height);

      // 2. Subtle diep.io square grid
      const gridSize = 40;
      gridOffset = (gridOffset + 0.15) % gridSize;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
      ctx.lineWidth = 1;

      ctx.beginPath();
      for (let x = -gridOffset; x < width; x += gridSize) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
      }
      for (let y = -gridOffset; y < height; y += gridSize) {
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
      }
      ctx.stroke();

      // 3. Update & Draw Shapes (Crates / Barrels / Polygons)
      shapes.forEach((s) => {
        s.x += s.vx;
        s.y += s.vy;
        s.rot += s.vRot;
        if (s.x < -30) s.x = width + 30;
        if (s.x > width + 30) s.x = -30;
        if (s.y < -30) s.y = height + 30;
        if (s.y > height + 30) s.y = -30;

        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(s.rot);

        if (s.type === "crate") {
          // Wooden crate style
          ctx.fillStyle = "rgba(103, 75, 36, 0.75)";
          ctx.fillRect(-s.size, -s.size, s.size * 2, s.size * 2);
          ctx.strokeStyle = "rgba(158, 116, 55, 0.9)";
          ctx.lineWidth = 2.5;
          ctx.strokeRect(-s.size, -s.size, s.size * 2, s.size * 2);
          ctx.beginPath();
          ctx.moveTo(-s.size, -s.size);
          ctx.lineTo(s.size, s.size);
          ctx.stroke();
        } else if (s.type === "barrel") {
          // Red explosive barrel
          ctx.fillStyle = "rgba(185, 28, 28, 0.75)";
          ctx.beginPath();
          ctx.arc(0, 0, s.size, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "#facc15";
          ctx.lineWidth = 2;
          ctx.stroke();
        } else {
          // Diep.io style geometric polygon (triangle/pentagon)
          ctx.fillStyle = "rgba(56, 189, 248, 0.4)";
          ctx.strokeStyle = "rgba(14, 165, 233, 0.8)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          for (let p = 0; p < 5; p++) {
            const pa = (p * Math.PI * 2) / 5;
            const px = Math.cos(pa) * s.size;
            const py = Math.sin(pa) * s.size;
            if (p === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
        ctx.restore();
      });

      // 4. Update & Draw Bullets
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x += b.vx;
        b.y += b.vy;
        b.life--;

        // Glow trail
        ctx.fillStyle = b.color;
        ctx.shadowColor = b.color;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Check collision with shapes
        for (let s of shapes) {
          const dist = Math.hypot(b.x - s.x, b.y - s.y);
          if (dist < s.size + b.radius) {
            spawnSparks(b.x, b.y, b.color, 5);
            b.life = 0;
            break;
          }
        }

        if (b.life <= 0 || b.x < 0 || b.x > width || b.y < 0 || b.y > height) {
          bullets.splice(i, 1);
        }
      }

      // 5. Update & Draw Autonomous Cats
      cats.forEach((cat, idx) => {
        // Wandering AI
        cat.x += cat.vx;
        cat.y += cat.vy;

        // Bounce on borders
        if (cat.x < 60) { cat.x = 60; cat.vx = Math.abs(cat.vx); }
        if (cat.x > width - 60) { cat.x = width - 60; cat.vx = -Math.abs(cat.vx); }
        if (cat.y < 60) { cat.y = 60; cat.vy = Math.abs(cat.vy); }
        if (cat.y > height - 60) { cat.y = height - 60; cat.vy = -Math.abs(cat.vy); }

        // Find nearest target to aim
        const target = shapes[idx % shapes.length];
        if (target) {
          const targetAng = Math.atan2(target.y - cat.y, target.x - cat.x);
          cat.angle += (targetAng - cat.angle) * 0.05;
        }

        // Shoot timer
        cat.shootTimer++;
        if (cat.shootTimer > 45 + (idx % 3) * 20) {
          cat.shootTimer = 0;
          const spd = 7;
          const bx = cat.x + Math.cos(cat.angle) * 24;
          const by = cat.y + Math.sin(cat.angle) * 24;
          bullets.push({
            x: bx,
            y: by,
            vx: Math.cos(cat.angle) * spd,
            vy: Math.sin(cat.angle) * spd,
            color: cat.color,
            life: 80,
            radius: 3.5,
          });
          spawnSparks(bx, by, cat.color, 2);
        }

        // Roll timer
        cat.rollTimer--;
        if (cat.rollTimer <= 0) {
          cat.rollTimer = 220 + Math.random() * 180;
          cat.isRolling = true;
          cat.rollAngle = 0;
        }
        if (cat.isRolling) {
          cat.rollAngle += 0.25;
          if (cat.rollAngle >= Math.PI * 2) {
            cat.isRolling = false;
            cat.rollAngle = 0;
          }
        }

        // Draw Cat
        ctx.save();
        ctx.translate(cat.x, cat.y);
        ctx.rotate(cat.angle + (cat.isRolling ? cat.rollAngle : 0));

        // Hands / Paws
        ctx.fillStyle = cat.color;
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(16, -11, 5, 0, Math.PI * 2);
        ctx.arc(16, 11, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Gun barrel
        ctx.fillStyle = "#334155";
        ctx.fillRect(8, -4, 18, 8);
        ctx.strokeRect(8, -4, 18, 8);

        // Body Circle (Diep / Suroi style)
        ctx.fillStyle = cat.color;
        ctx.beginPath();
        ctx.arc(0, 0, 19, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Cat Ears
        ctx.fillStyle = cat.color;
        ctx.beginPath();
        ctx.moveTo(-10, -16);
        ctx.lineTo(-4, -26);
        ctx.lineTo(4, -18);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(-10, 16);
        ctx.lineTo(-4, 26);
        ctx.lineTo(4, 18);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Face details
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(7, -5, 3.5, 0, Math.PI * 2);
        ctx.arc(7, 5, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#000000";
        ctx.beginPath();
        ctx.arc(8, -5, 1.8, 0, Math.PI * 2);
        ctx.arc(8, 5, 1.8, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();

        // Cat Name tag
        ctx.font = "bold 10px Outfit, Inter, sans-serif";
        ctx.fillStyle = "rgba(255, 255, 255, 0.65)";
        ctx.textAlign = "center";
        ctx.fillText(cat.name, cat.x, cat.y - 28);
      });

      // 6. Draw Sparks / Particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life--;
        const alpha = Math.max(0, p.life / p.maxLife);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        if (p.life <= 0) particles.splice(i, 1);
      }

      animId = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(animId);
    };
  }, []);

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-0 select-none">
      {/* 1. Procedural 60 FPS Canvas Background as Instant Fallback Base */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

      {/* 2. Video Loop Background de Gameplay Real de BattleCats */}
      <video
        ref={videoRef}
        autoPlay
        loop
        muted
        playsInline
        onCanPlay={() => setVideoLoaded(true)}
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-1000 ${
          videoLoaded ? "opacity-75" : "opacity-0"
        }`}
      >
        <source src="/gameplay.mp4" type="video/mp4" />
        <source src="/gameplay.webm" type="video/webm" />
      </video>

      {/* 3. Cuadrícula diep.io sutil superpuesta para textura milimetrada perfecta */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:36px_36px] pointer-events-none" />

      {/* 4. Viñeta y Gradiente Suave para Máximo Contraste del Menú Central */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(10,15,29,0.22)_0%,rgba(10,15,29,0.72)_65%,rgba(2,6,23,0.95)_100%)] pointer-events-none" />

      {/* 5. Glow Perimetral Oscuro Diep.io */}
      <div className="absolute inset-0 shadow-[inset_0_0_140px_rgba(0,0,0,0.85)] pointer-events-none" />
    </div>
  );
};
