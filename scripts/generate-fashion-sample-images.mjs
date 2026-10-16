// Generates one original SVG illustration per Fashion sample product.
//
// Run: node scripts/generate-fashion-sample-images.mjs
//
// The sample catalogue is read through esbuild, so the images always match
// src/content/fashionSampleProducts.ts. Each image is an original vector
// drawing (no photographs, no brand marks). The owner replaces them with
// supplier photography later; the paths stay the same.

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'images', 'fashion', 'samples');

const bundle = await build({
  entryPoints: [join(root, 'src/content/fashionSampleProducts.ts')],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'neutral',
  logLevel: 'silent',
});
const { FASHION_SAMPLE_PRODUCTS } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);

const INK = '#2b2420';
const GOLD = '#c9a25a';

const HEX = {
  'Blue Floral': '#6f8fc4',
  'Pink Floral': '#e9a6b8',
  Black: '#1f1d1b',
  Cream: '#f1e6cc',
  Emerald: '#1f7a5c',
  Champagne: '#e6d3a8',
  White: '#fbfbf7',
  'Sky Blue': '#9fd3ee',
  Sage: '#9aae8a',
  Nude: '#dcb89c',
  Terracotta: '#b5603c',
  Navy: '#1f2e4d',
  Olive: '#6e6b3a',
  Sand: '#d8c4a0',
  Oatmeal: '#d6c9b2',
  'Light Wash': '#a9cde6',
  'Dark Wash': '#34507a',
  Camel: '#c49a6c',
  'Light Blue': '#c4e0f2',
  'Heather Grey': '#b9b9bd',
  Khaki: '#c4b28f',
  Stone: '#aea794',
  Charcoal: '#4a4f55',
  Brown: '#6e4b2f',
  Tan: '#cfa882',
  Burgundy: '#6e1f30',
  'Gold-Tone': '#d4af37',
  'Ivory Pearl': '#f6f1e4',
  'Silver-Tone Pearl': '#dedede',
  'Silver-Tone': '#c3c6cc',
  Silver: '#c3c6cc',
  'Rose Gold': '#d19a86',
  Rose: '#d98c9a',
  'Brick Red': '#a8402a',
  Tortoise: '#8c5b2c',
  Light: '#f2cba8',
  Medium: '#d69f73',
  Deep: '#8c5a3a',
  Neutral: '#b59a80',
  Warm: '#c8703f',
};

// Eyeshadow palettes are drawn as four shades, not one colour.
const SHADES = {
  Neutral: ['#d9c6ac', '#a88e74', '#6d5846', '#3d3129'],
  Warm: ['#f2b08a', '#d7703e', '#a2442a', '#5b2519'],
};

// Used when a sample lists no colour of its own.
const DEFAULT_COLOR = { Mascara: 'Black', Brushes: 'Tan', Belts: 'Black' };

const shade = (hex, amount) => {
  const n = parseInt(hex.slice(1), 16);
  const channels = [n >> 16, (n >> 8) & 255, n & 255].map((c) => {
    const target = amount < 0 ? 0 : 255;
    return Math.round(c + (target - c) * Math.abs(amount));
  });
  return `#${channels.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
};

const shape = (d, fill, attrs = '') =>
  `<path d="${d}" fill="${fill}" stroke="${INK}" stroke-opacity="0.45" stroke-width="5" stroke-linejoin="round"${attrs}/>`;
const line = (d, color, width, opacity = 1) =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-opacity="${opacity}" stroke-linecap="round" stroke-linejoin="round"/>`;
const strap = (d, fill, width) => line(d, INK, width + 10, 0.45) + line(d, fill, width, 1);
const circle = (cx, cy, r, fill, stroke = INK, sw = 5) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-opacity="0.45" stroke-width="${sw}"/>`;
const rect = (x, y, w, h, fill, stroke = INK) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-opacity="0.45" stroke-width="5"/>`;

const dress = (hemY, hemHalf, hex) =>
  shape(`M410,220 L550,220 L532,430 L${480 + hemHalf},${hemY} L${480 - hemHalf},${hemY} L428,430 Z`, hex) +
  line('M440,222 Q480,270 520,222', INK, 5, 0.45);

const top = ({ hem, hex, placket = false, collar = false, crew = false }) => {
  let s = shape(
    `M368,240 L404,206 Q480,256 556,206 L592,240 L652,392 L604,414 L588,${hem} L372,${hem} L356,414 L308,392 Z`,
    hex,
  );
  if (crew) s += line('M420,214 Q480,266 540,214', INK, 5, 0.45);
  if (collar) s += line('M420,214 L450,268 L480,236 L510,268 L540,214', INK, 5, 0.45);
  if (placket) {
    s += line(`M480,262 L480,${hem - 20}`, INK, 4, 0.35);
    s += [300, 370, 440].map((y) => `<circle cx="480" cy="${y}" r="7" fill="#ffffff" fill-opacity="0.8"/>`).join('');
  }
  return s;
};

const hoodie = (hex) =>
  top({ hem: 740, hex }) +
  shape('M404,236 Q480,96 556,236 L520,250 Q480,160 440,250 Z', hex) +
  shape('M420,600 L540,600 L552,680 L408,680 Z', 'rgba(0,0,0,0.12)') +
  line('M456,262 L452,350', INK, 4, 0.5) +
  line('M504,262 L508,350', INK, 4, 0.5);

const cup = (cx, hex) =>
  shape(`M${cx - 72},380 Q${cx},300 ${cx + 72},380 Q${cx + 62},460 ${cx},456 Q${cx - 62},460 ${cx - 72},380 Z`, hex);

const bralette = (hex) =>
  cup(400, hex) +
  cup(560, hex) +
  shape('M330,458 Q480,500 630,458 L632,486 Q480,530 328,486 Z', hex) +
  shape('M372,520 L588,520 L556,650 Q480,678 404,650 Z', hex);

const shapewear = (hex) =>
  shape('M380,220 L580,220 L560,400 Q640,500 600,700 L560,980 L400,980 L360,700 Q320,500 400,400 Z', hex);

const sleepSet = (hex) =>
  shape('M410,220 L550,220 L578,470 L382,470 Z', hex) +
  line('M430,222 L420,120', hex, 14) +
  line('M530,222 L540,120', hex, 14) +
  shape('M370,540 L590,540 L578,700 L490,700 L480,610 L470,700 L382,700 Z', shade(hex, -0.08));

const bikini = (hex) =>
  shape('M340,330 L440,440 L340,520 Z', hex) +
  shape('M620,330 L520,440 L620,520 Z', hex) +
  shape('M380,580 Q480,680 580,580 L580,650 Q480,740 380,650 Z', shade(hex, -0.08)) +
  line('M340,330 L300,300', INK, 4, 0.5) +
  line('M620,330 L660,300', INK, 4, 0.5);

const onePiece = (hex) =>
  shape('M400,220 L560,220 L578,300 L564,520 Q566,650 548,760 L412,760 Q394,650 396,520 L382,300 Z', hex) +
  line('M480,260 L480,520', INK, 4, 0.35) +
  line('M420,540 Q480,560 540,540', INK, 4, 0.35) +
  line('M414,620 Q480,640 546,620', INK, 4, 0.35);

const coverUp = (hex) =>
  shape('M322,220 L638,220 L690,990 L270,990 Z', hex) +
  line('M440,236 L440,990', INK, 5, 0.4) +
  line('M520,236 L520,990', INK, 5, 0.25);

const jacket = (bottomY, hex, trench) => {
  let s = shape(
    `M330,220 L420,200 L440,260 L520,260 L540,200 L630,220 L680,620 L620,640 L600,460 L600,${bottomY} L360,${bottomY} L360,460 L340,640 L280,620 Z`,
    hex,
  );
  s += line('M440,260 L480,400 L520,260', INK, 5, 0.45);
  if (trench) {
    s += shape('M362,560 L598,560 L598,590 L362,590 Z', shade(hex, -0.18));
  } else {
    s += [430, 520, 610].map((y) => circle(480, y, 9, '#ffffff')).join('');
  }
  return s;
};

const blazerSuit = (hex) =>
  shape('M340,220 L420,200 L480,310 L540,200 L620,220 L650,520 L600,540 L590,470 L585,560 L375,560 L370,470 L310,520 Z', hex) +
  line('M420,200 L480,310 L540,200', INK, 5, 0.45) +
  shape('M380,560 L580,560 L600,980 L500,980 L480,640 L460,980 L360,980 Z', shade(hex, -0.22));

const coordSet = (hex) =>
  top({ hem: 560, hex }) +
  shape('M380,560 L580,560 L600,980 L500,980 L480,640 L460,980 L360,980 Z', shade(hex, -0.12));

const pants = (hex) =>
  shape('M372,240 L588,240 L604,460 L574,980 L500,980 L480,560 L460,980 L386,980 L356,460 Z', hex) +
  line('M372,262 L588,262', INK, 4, 0.4) +
  line('M480,300 L480,560', INK, 4, 0.35);

const sneaker = (hex) =>
  shape('M200,700 Q220,560 400,560 L560,600 Q640,640 700,700 L720,780 Q740,820 700,830 L230,830 Q190,820 200,780 Z', hex) +
  shape('M196,790 L736,790 L742,828 L202,830 Z', '#f7f6f2') +
  line('M430,610 L470,650', INK, 5, 0.45) +
  line('M480,600 L520,640', INK, 5, 0.45) +
  line('M530,612 L570,650', INK, 5, 0.45);

const sandal = (hex) =>
  shape('M240,760 Q330,700 720,760 Q760,790 700,830 L260,830 Q220,810 240,760 Z', shade(hex, -0.15)) +
  strap('M300,745 L380,600 L430,600 L360,745', hex, 18) +
  strap('M520,745 L600,600 L650,600 L580,745', hex, 18);

const boot = (hex) =>
  shape('M380,200 L560,200 L580,640 L740,700 L740,860 L360,860 Z', hex) +
  shape('M360,840 L740,840 L740,870 L360,870 Z', shade(hex, -0.3));

const tote = (hex) =>
  shape('M270,380 L690,380 L700,960 L260,960 Z', hex) +
  line('M380,380 Q480,190 580,380', INK, 22, 0.55) +
  line('M270,460 L690,460', INK, 4, 0.3) +
  shape('M450,520 L510,520 L510,570 L450,570 Z', GOLD);

const crossbody = (hex) =>
  shape('M330,520 L630,520 L640,820 Q480,850 320,820 Z', hex) +
  shape('M330,520 L630,520 L620,640 Q480,670 340,640 Z', shade(hex, -0.12)) +
  line('M360,520 Q480,120 600,520', INK, 20, 0.55) +
  shape('M466,630 L494,630 L494,664 L466,664 Z', GOLD);

const wallet = (hex) =>
  shape('M250,460 L710,460 L710,740 L250,740 Z', hex) +
  line('M270,470 L690,470', INK, 4, 0.3) +
  shape('M452,580 L508,580 L508,640 L452,640 Z', GOLD);

const necklace = (hex) =>
  line('M200,300 Q480,760 760,300', GOLD, 9) +
  line('M480,530 L480,560', GOLD, 4) +
  circle(480, 600, 56, hex, INK, 5);

const earrings = (hex) =>
  [360, 600]
    .map(
      (x) =>
        line(`M${x},200 Q${x - 8},300 ${x},336`, GOLD, 6) +
        circle(x, 380, 44, hex) +
        `<circle cx="${x - 14}" cy="366" r="12" fill="#ffffff" fill-opacity="0.6"/>`,
    )
    .join('');

const ring = (hex) =>
  `<circle cx="480" cy="640" r="170" fill="none" stroke="${INK}" stroke-opacity="0.45" stroke-width="66"/>` +
  `<circle cx="480" cy="640" r="170" fill="none" stroke="${hex}" stroke-width="56"/>` +
  circle(480, 430, 56, '#e8f4fb');

const bracelet = (hex) => {
  let s = `<ellipse cx="480" cy="600" rx="270" ry="170" fill="none" stroke="${INK}" stroke-opacity="0.45" stroke-width="56"/>`;
  s += `<ellipse cx="480" cy="600" rx="270" ry="170" fill="none" stroke="${hex}" stroke-width="46"/>`;
  for (let i = 0; i < 8; i += 1) {
    const a = (i * Math.PI) / 4;
    s += circle(Math.round(480 + 270 * Math.cos(a)), Math.round(600 + 170 * Math.sin(a)), 14, '#ffffff');
  }
  return s;
};

const jewelrySet = (hex) =>
  necklace(hex) +
  [340, 620]
    .map((x) => line(`M${x},800 L${x},830`, GOLD, 5) + circle(x, 870, 34, hex))
    .join('');

const lipstick = (hex) =>
  shape('M380,560 L580,560 L580,980 L380,980 Z', '#e9e4dc') +
  shape('M380,700 L580,700 L580,760 L380,760 Z', shade(hex, -0.1)) +
  shape('M392,560 L402,372 Q480,300 558,372 L568,560 Z', hex);

const foundation = (hex) =>
  shape('M352,400 L608,400 L608,980 Q608,1004 584,1004 L376,1004 Q352,1004 352,980 Z', hex) +
  shape('M380,620 L580,620 L580,800 L380,800 Z', '#ffffff', ' fill-opacity="0.7"') +
  shape('M440,400 L440,300 L520,300 L520,400', INK) +
  shape('M404,300 L556,300 L556,266 L404,266 Z', INK) +
  `<rect x="368" y="430" width="22" height="520" fill="#ffffff" fill-opacity="0.25"/>`;

const eyeshadow = (colorName) => {
  const shades = SHADES[colorName];
  let s = shape('M200,400 L760,400 L760,820 L200,820 Z', '#e6dfd6');
  [
    [232, 440],
    [500, 440],
    [232, 630],
    [500, 630],
  ].forEach(([x, y], i) => {
    s += rect(x, y, 248, 170, shades[i], 'none');
  });
  return s;
};

const mascara = (hex) =>
  line('M480,260 L480,140', INK, 22, 0.6) +
  shape('M412,380 L548,380 L566,980 L394,980 Z', hex) +
  shape('M420,260 L540,260 L548,380 L412,380 Z', '#e9e4dc') +
  shape('M400,600 L560,600 L564,700 L396,700 Z', GOLD);

const brushes = (hex) =>
  [0, 1, 2]
    .map((i) => {
      const x = 230 + i * 130;
      const d = `M${x},960 L${x + 100},340`;
      return strap(d, hex, 26) + circle(x + 100, 300, 48, '#f3e7d6');
    })
    .join('');

const watch = (hex, radius, strapWidth) => {
  const x = 480 - strapWidth / 2;
  let s = rect(x, 110, strapWidth, 600 - radius - 110 + 20, hex);
  s += rect(x, 600 + radius - 20, strapWidth, 1080 - (600 + radius - 20), hex);
  s += circle(480, 600, radius, '#faf8f3', hex, 34);
  for (let h = 0; h < 12; h += 1) {
    const a = (h * Math.PI) / 6;
    const x1 = 480 + Math.sin(a) * (radius - 40);
    const y1 = 600 - Math.cos(a) * (radius - 40);
    const x2 = 480 + Math.sin(a) * (radius - 18);
    const y2 = 600 - Math.cos(a) * (radius - 18);
    s += line(`M${x1.toFixed(1)},${y1.toFixed(1)} L${x2.toFixed(1)},${y2.toFixed(1)}`, INK, 6, 0.7);
  }
  s += line(`M480,600 L480,${Math.round(600 - radius * 0.6)}`, INK, 8);
  s += line(`M480,600 L${Math.round(480 + radius * 0.45)},${Math.round(600 + radius * 0.25)}`, INK, 6);
  s += circle(480, 600, 8, INK, INK, 2);
  return s;
};

const sunglasses = (hex) =>
  shape('M190,480 Q200,380 330,360 Q420,360 430,460 Q420,570 300,570 Q196,570 190,480 Z', hex, ' fill-opacity="0.85"') +
  shape('M530,460 Q540,360 630,360 Q760,380 770,480 Q764,570 660,570 Q540,570 530,460 Z', hex, ' fill-opacity="0.85"') +
  line('M430,450 Q480,420 530,450', INK, 10) +
  line('M190,450 L120,420', INK, 12) +
  line('M770,450 L840,420', INK, 12);

const belt = (hex) =>
  shape('M110,500 L850,500 L850,600 L110,600 Z', hex) +
  line('M130,520 L830,520', '#ffffff', 3, 0.35) +
  shape('M410,470 L550,470 L550,630 L410,630 Z', GOLD) +
  shape('M458,520 L502,520 L502,580 L458,580 Z', INK);

// Subcategory name -> drawing. Every sample subcategory must appear here.
function silhouette(subcategory, { hex, colorName, name }) {
  switch (subcategory) {
    case 'Midi':
      return dress(860, 170, hex);
    case 'Bodycon':
      return dress(660, 118, hex);
    case 'Maxi':
      return dress(1010, 212, hex);
    case 'Blouses':
      return top({ hem: 780, hex, placket: true });
    case 'Crop Tops':
      return top({ hem: 560, hex });
    case 'Shirts':
      return top({ hem: 760, hex, collar: true, placket: true });
    case 'T-Shirts':
      return top({ hem: 720, hex, crew: true });
    case 'Hoodies':
      return hoodie(hex);
    case 'Bralettes':
      return bralette(hex);
    case 'Shapewear':
      return shapewear(hex);
    case 'Satin Sleepwear':
      return sleepSet(hex);
    case 'Bikinis':
      return bikini(hex);
    case 'One-Piece Swimsuits':
      return onePiece(hex);
    case 'Cover-Ups':
      return coverUp(hex);
    case 'Business Suits':
      return blazerSuit(hex);
    case 'Two-Piece Sets':
      return coordSet(hex);
    case 'Jackets':
      return jacket(1000, hex, false);
    case 'Trench Coats':
      return jacket(1100, hex, true);
    case 'Pants':
      return pants(hex);
    case "Women's Sneakers":
    case "Men's Sneakers":
      return sneaker(hex);
    case 'Sandals':
      return sandal(hex);
    case 'Boots':
      return boot(hex);
    case 'Tote Bags':
      return tote(hex);
    case 'Crossbody Bags':
      return crossbody(hex);
    case 'Wallets':
      return wallet(hex);
    case 'Necklaces':
      return necklace(hex);
    case 'Earrings':
      return earrings(hex);
    case 'Rings':
      return ring(hex);
    case 'Bracelets':
      return bracelet(hex);
    case 'Jewelry Sets':
      return jewelrySet(hex);
    case 'Lipstick':
      return lipstick(hex);
    case 'Foundation':
      return foundation(hex);
    case 'Eyeshadow':
      return eyeshadow(colorName);
    case 'Mascara':
      return mascara(hex);
    case 'Brushes':
      return brushes(hex);
    case "Women's Watches":
      return watch(hex, 190, 130);
    case "Men's Watches":
      return watch(hex, 240, 150);
    case 'Sunglasses':
      return sunglasses(hex);
    case 'Belts':
      return belt(hex);
    default:
      throw new Error(`No illustration for subcategory "${subcategory}" (${name})`);
  }
}

const escapeXml = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function render(product, body, hex) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 1200" role="img">
<title>${escapeXml(product.name)}</title>
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#faf7f2"/>
<stop offset="1" stop-color="#ebe3d6"/>
</linearGradient>
</defs>
<rect width="960" height="1200" fill="url(#bg)"/>
<circle cx="480" cy="560" r="380" fill="${hex}" fill-opacity="0.14"/>
<ellipse cx="480" cy="1010" rx="300" ry="26" fill="${INK}" fill-opacity="0.12"/>
${body}
<text x="480" y="1150" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="26" fill="#6b6259" letter-spacing="3">SAMPLE ILLUSTRATION</text>
</svg>
`;
}

const slugs = new Set(FASHION_SAMPLE_PRODUCTS.map((p) => p.slug));
if (slugs.size !== FASHION_SAMPLE_PRODUCTS.length) throw new Error('Sample slugs are not unique');

const bodies = new Set();
const files = new Map();
for (const product of FASHION_SAMPLE_PRODUCTS) {
  const colorName = product.colors[0] ?? DEFAULT_COLOR[product.subcategory] ?? 'Black';
  const hex = HEX[colorName];
  if (!hex) throw new Error(`No palette entry for "${colorName}" (${product.name})`);
  const body = silhouette(product.subcategory, { hex, colorName, name: product.name });
  if (bodies.has(body)) throw new Error(`Duplicate illustration body for ${product.name}`);
  bodies.add(body);
  files.set(`${product.slug}.svg`, render(product, body, hex));
}

mkdirSync(outDir, { recursive: true });
for (const existing of readdirSync(outDir)) {
  if (existing.endsWith('.svg') && !files.has(existing)) rmSync(join(outDir, existing));
}
for (const [name, content] of files) {
  writeFileSync(join(outDir, name), content);
}
console.log(`Wrote ${files.size} unique sample illustrations to ${outDir}`);
