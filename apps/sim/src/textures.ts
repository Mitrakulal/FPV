import * as THREE from 'three';

export function canvasTexture(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  repeat?: [number, number],
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) draw(ctx, width, height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
  }
  return tex;
}

/** Worn paint, skid marks and stains for the asphalt. */
export function markingsTexture(): THREE.CanvasTexture {
  return canvasTexture(1024, 1024, (g, w, h) => {
    g.clearRect(0, 0, w, h);

    const line = (x1: number, y1: number, x2: number, y2: number, width: number, alpha: number) => {
      g.globalAlpha = alpha;
      g.strokeStyle = '#e8e2d0';
      g.lineWidth = width;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(x1, y1);
      g.lineTo(x2, y2);
      g.stroke();
    };

    // start box
    line(300, 860, 724, 860, 10, 0.75);
    line(300, 940, 724, 940, 6, 0.5);
    line(300, 860, 300, 990, 6, 0.55);
    line(724, 860, 724, 990, 6, 0.55);

    // dashed centre line running up the course
    for (let i = 0; i < 13; i++) {
      const y = 840 - i * 62;
      line(512, y, 512, y - 34, 7, 0.5 - i * 0.02);
    }

    // lane edges
    line(190, 1000, 190, 120, 5, 0.28);
    line(834, 1000, 834, 120, 5, 0.28);

    // direction arrows
    for (const [ax, ay] of [
      [420, 720],
      [600, 500],
      [430, 300],
    ] as const) {
      line(ax, ay + 40, ax, ay - 30, 9, 0.45);
      line(ax, ay - 30, ax - 22, ay + 2, 9, 0.45);
      line(ax, ay - 30, ax + 22, ay + 2, 9, 0.45);
    }

    // faded FPV lettering
    g.globalAlpha = 0.18;
    g.fillStyle = '#f0e9d6';
    g.font = 'bold 150px Impact, Arial Black, sans-serif';
    g.save();
    g.translate(300, 560);
    g.rotate(-0.12);
    g.fillText('FPV', 0, 0);
    g.restore();

    // tyre marks
    g.globalAlpha = 1;
    for (let i = 0; i < 7; i++) {
      g.strokeStyle = `rgba(10, 10, 12, ${0.1 + Math.random() * 0.18})`;
      g.lineWidth = 6 + Math.random() * 14;
      g.beginPath();
      const x = 120 + Math.random() * 780;
      const y = 160 + Math.random() * 820;
      g.moveTo(x, y);
      g.bezierCurveTo(
        x + 60 + Math.random() * 130,
        y - 80,
        x + 40 - Math.random() * 160,
        y - 200,
        x + 120 * (Math.random() - 0.5),
        y - 300,
      );
      g.stroke();
    }

    // grime patches
    for (let i = 0; i < 30; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const r = 20 + Math.random() * 90;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(15, 14, 12, ${0.05 + Math.random() * 0.12})`);
      grad.addColorStop(1, 'rgba(15, 14, 12, 0)');
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  });
}

/** Spray can tags on transparent canvas, for the bando walls. */
export function graffitiTexture(seed: number): THREE.CanvasTexture {
  const words = [
    ['RIP', '#ff4d6d'],
    ['FLY', '#35d0ff'],
    ['ACRO', '#ffd23f'],
  ] as const;
  const [word, color] = words[seed % words.length] ?? ['FPV', '#35e08a'];

  return canvasTexture(512, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.translate(w / 2, h / 2);
    g.rotate((seed % 2 === 0 ? -1 : 1) * 0.06);
    g.textAlign = 'center';
    g.textBaseline = 'middle';

    g.font = 'bold 150px Impact, Arial Black, sans-serif';
    g.lineWidth = 14;
    g.strokeStyle = 'rgba(8, 8, 10, 0.85)';
    g.strokeText(word, 0, 0);

    const grad = g.createLinearGradient(-200, -80, 200, 80);
    grad.addColorStop(0, color);
    grad.addColorStop(1, '#f4f4f4');
    g.fillStyle = grad;
    g.fillText(word, 0, 0);

    // drips
    g.strokeStyle = color;
    g.lineWidth = 5;
    for (let i = 0; i < 7; i++) {
      const x = -170 + i * 55 + Math.random() * 20;
      const len = 20 + Math.random() * 60;
      g.beginPath();
      g.moveTo(x, 50);
      g.lineTo(x, 50 + len);
      g.stroke();
    }

    // overspray
    for (let i = 0; i < 90; i++) {
      g.fillStyle = `rgba(255,255,255,${Math.random() * 0.06})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
  });
}

export function chainLinkTexture(): THREE.CanvasTexture {
  const tex = canvasTexture(
    128,
    128,
    (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.strokeStyle = 'rgba(190, 200, 210, 0.95)';
      g.lineWidth = 2;
      for (let i = -1; i <= 1; i++) {
        g.beginPath();
        g.moveTo(i * w, 0);
        g.lineTo((i + 1) * w, h);
        g.stroke();
        g.beginPath();
        g.moveTo((i + 1) * w, 0);
        g.lineTo(i * w, h);
        g.stroke();
      }
    },
    [1, 1],
  );
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Dense forested ridge for the horizon, wrapped around a big cylinder. */
export function treelineTexture(): THREE.CanvasTexture {
  return canvasTexture(1024, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#33423a';

    const baseY = (x: number) =>
      h * 0.64 + Math.sin(x * 0.011) * 10 + Math.sin(x * 0.029 + 1.7) * 6;

    // solid ridge body
    g.beginPath();
    g.moveTo(0, h);
    for (let x = 0; x <= w; x += 8) g.lineTo(x, baseY(x));
    g.lineTo(w, h);
    g.closePath();
    g.fill();

    // bumpy canopy along the crest, no gaps
    for (let x = -24; x < w + 24; x += 11) {
      const r = 9 + Math.random() * 17;
      g.beginPath();
      g.arc(x, baseY(x) + (Math.random() - 0.5) * 8, r, 0, Math.PI * 2);
      g.fill();
    }

    // a few emergent trees
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * w;
      const r = 10 + Math.random() * 10;
      g.beginPath();
      g.arc(x, baseY(x) - 12 - Math.random() * 14, r, 0, Math.PI * 2);
      g.fill();
    }
  });
}

/** Single runway centreline dash tile (repeat along the runway). */
export function runwayDashTexture(): THREE.CanvasTexture {
  return canvasTexture(64, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#ffffff';
    g.fillRect(w * 0.18, 0, w * 0.64, h * 0.55);
  });
}

/** A printed event sign: dark panel, big type, sponsor strip. */
export function signTexture(title: string, subtitle: string, accent: string): THREE.CanvasTexture {
  return canvasTexture(1024, 512, (g, w, h) => {
    g.fillStyle = '#14171b';
    g.fillRect(0, 0, w, h);

    // diagonal stripes in the corner
    g.save();
    g.translate(w, 0);
    g.rotate(Math.PI / 4);
    g.fillStyle = accent;
    for (let i = 0; i < 8; i++) {
      g.fillRect(i * 60, -h, 26, h * 2);
    }
    g.restore();

    g.fillStyle = '#f2f4f6';
    g.font = 'bold 168px Impact, Arial Black, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(title, w / 2, h * 0.38);

    g.fillStyle = accent;
    g.fillRect(w * 0.18, h * 0.58, w * 0.64, 10);

    g.fillStyle = '#c9d3dc';
    g.font = 'bold 62px "Segoe UI", Arial, sans-serif';
    g.fillText(subtitle, w / 2, h * 0.72);

    // grime + fade
    for (let i = 0; i < 260; i++) {
      g.fillStyle = `rgba(0,0,0,${Math.random() * 0.16})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 40, 1 + Math.random() * 3);
    }
  });
}

/** Long fabric banner for the start gantry. */
export function bannerTexture(text: string, accent: string): THREE.CanvasTexture {
  return canvasTexture(1024, 128, (g, w, h) => {
    g.fillStyle = '#f0ede4';
    g.fillRect(0, 0, w, h);

    g.fillStyle = accent;
    g.fillRect(0, 0, w, 12);
    g.fillRect(0, h - 12, w, 12);

    g.fillStyle = '#15181c';
    g.font = 'bold 72px Impact, Arial Black, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 2);

    // checkered ends
    for (const side of [0, w - 120]) {
      for (let yy = 12; yy < h - 12; yy += 18) {
        for (let xx = 0; xx < 120; xx += 18) {
          if ((xx / 18 + yy / 18) % 2 === 0) {
            g.fillStyle = '#15181c';
            g.fillRect(side + xx, yy, 18, 18);
          }
        }
      }
    }

    for (let i = 0; i < 90; i++) {
      g.fillStyle = `rgba(90,80,60,${Math.random() * 0.09})`;
      g.fillRect(Math.random() * w, Math.random() * h, 30, 2);
    }
  });
}

export function grassBladeTexture(): THREE.CanvasTexture {
  return canvasTexture(64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 9; i++) {
      const x = 6 + Math.random() * (w - 12);
      const lean = (Math.random() - 0.5) * 22;
      const top = 6 + Math.random() * 18;
      g.strokeStyle = `hsl(${88 + Math.random() * 28}, ${38 + Math.random() * 25}%, ${
        26 + Math.random() * 18
      }%)`;
      g.lineWidth = 1.6 + Math.random() * 1.6;
      g.beginPath();
      g.moveTo(x, h);
      g.quadraticCurveTo(x + lean * 0.4, h * 0.55, x + lean, top);
      g.stroke();
    }
  });
}

export function gateNumberTexture(n: number, accent: string): THREE.CanvasTexture {
  return canvasTexture(256, 128, (g, w, h) => {
    g.fillStyle = '#f4f1e6';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = accent;
    g.lineWidth = 14;
    g.strokeRect(7, 7, w - 14, h - 14);
    g.fillStyle = '#16181c';
    g.font = 'bold 86px Impact, Arial Black, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(n), w / 2, h / 2 + 4);
  });
}
