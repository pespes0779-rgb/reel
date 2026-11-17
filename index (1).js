const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { createCanvas, loadImage } = require("canvas");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");

// ---------- الإعدادات العامة ----------
const W = 1080;
const H = 1920;
const FPS = 30;
const COUNTDOWN = 10; // ثواني المؤقت
const REVEAL = 3; // ثواني عرض الإجابة الصحيحة
const TOTAL = COUNTDOWN + REVEAL;
const OUTPUT = "quiz_output.mp4";
const TMP_DIR = path.join(__dirname, "tmp");

// ---------- الألوان ----------
const COLORS = {
  bgTop: "#33adff",
  bgBottom: "#1a86ee",
  dot: "rgba(255,255,255,0.12)",
  navy: "#0b1d3a",
  white: "#ffffff",
  shadow: "#0e63c2",
  correct: "#22c55e",
  correctDark: "#15803d",
  ringTrack: "rgba(255,255,255,0.30)",
  ringYellow: "#facc15",
  ringOrange: "#fb923c",
  ringRed: "#ef4444",
};

const FONT_FAMILY = '"Noto Sans Arabic", "Noto Sans", "DejaVu Sans", sans-serif';
const NUM_FONT = '"DejaVu Sans", "Noto Sans", sans-serif';

// صورة الخلفية (شعار BAC): ضع الملف في جذر المشروع باسم bac.jpg
// opacity = الشفافية (0 = مخفية، 1 = كاملة). جرّب 0.10 إلى 0.30
const BG_LOGO = { files: ["bac.jpg", "bac.jpeg", "bac.png"], opacity: 0.16 };

// ---------- مواضع العناصر ----------
const BRAIN = { cx: 540, cy: 270, scale: 1.05 };
const CARD = { x: 90, y: 480, w: 900, h: 330 };
const PILL = { x: 130, w: 820, h: 124, gap: 34, firstY: 880 };
const RING = { size: 340, cx: 540, cy: 1690, r: 128 };

// ---------- أدوات الرسم ----------
function hasArabic(text) {
  return /[\u0600-\u06FF]/.test(text);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// مستطيل دائري الزوايا مائل قليلاً (مثل القالب)
function fillSkewed(ctx, x, y, w, h, r, k, style) {
  ctx.save();
  ctx.transform(1, 0, -k, 1, k * (y + h / 2), 0);
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = style;
  ctx.fill();
  ctx.restore();
}

function wrapText(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const test = current ? current + " " + word : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// يرسم نصاً في المنتصف داخل مساحة محددة مع تصغير الخط تلقائياً ليتناسب
function drawFittedText(ctx, text, area, startSize, minSize, color) {
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.direction = hasArabic(text) ? "rtl" : "ltr";

  let size = startSize;
  let lines = [];
  let lineHeight = 0;
  while (size >= minSize) {
    ctx.font = `bold ${size}px ${FONT_FAMILY}`;
    lines = wrapText(ctx, text, area.w);
    lineHeight = size * 1.35;
    if (lines.length * lineHeight <= area.h) break;
    size -= 2;
  }

  const totalHeight = lines.length * lineHeight;
  let y = area.y + area.h / 2 - totalHeight / 2 + lineHeight / 2;
  for (const line of lines) {
    ctx.fillText(line, area.x + area.w / 2, y);
    y += lineHeight;
  }
}

function drawCheck(ctx, cx, cy, size, color, width) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width || 12;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.45, cy + size * 0.02);
  ctx.lineTo(cx - size * 0.1, cy + size * 0.38);
  ctx.lineTo(cx + size * 0.5, cy - size * 0.32);
  ctx.stroke();
  ctx.restore();
}

function drawGear(ctx, x, y, r, teeth) {
  const inner = r * 0.78;
  ctx.beginPath();
  for (let i = 0; i < teeth * 2; i++) {
    const a = (Math.PI * i) / teeth;
    const rad = i % 2 === 0 ? r : inner;
    const px = x + Math.cos(a) * rad;
    const py = y + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, r * 0.32, 0, Math.PI * 2);
  ctx.stroke();
}

// أيقونة الدماغ (رسم خطي) في أعلى الفيديو
function drawBrainIcon(ctx, cx, cy, s) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.strokeStyle = COLORS.navy;
  ctx.fillStyle = COLORS.navy;
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // الفص الأيسر
  ctx.beginPath();
  ctx.moveTo(0, -125);
  ctx.bezierCurveTo(-40, -145, -95, -130, -105, -85);
  ctx.bezierCurveTo(-150, -80, -160, -20, -125, 5);
  ctx.bezierCurveTo(-150, 40, -125, 95, -85, 92);
  ctx.bezierCurveTo(-75, 130, -20, 140, 0, 115);
  ctx.stroke();

  // خط المنتصف
  ctx.beginPath();
  ctx.moveTo(0, -125);
  ctx.lineTo(0, 115);
  ctx.stroke();

  // تفاصيل داخلية
  ctx.beginPath();
  ctx.moveTo(-100, -85);
  ctx.bezierCurveTo(-70, -70, -60, -100, -35, -85);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-125, 5);
  ctx.bezierCurveTo(-95, -10, -75, 15, -50, -5);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-85, 92);
  ctx.bezierCurveTo(-70, 60, -45, 70, -30, 45);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-60, -30);
  ctx.bezierCurveTo(-45, -45, -25, -35, -20, -15);
  ctx.stroke();

  // علامة الاستفهام
  ctx.direction = "ltr";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `bold 110px ${NUM_FONT}`;
  ctx.fillText("?", 55, -85);

  // ترسان
  drawGear(ctx, 128, -40, 26, 8);
  drawGear(ctx, 105, 92, 28, 8);

  // دائرة كهربائية
  ctx.beginPath();
  ctx.moveTo(18, -5);
  ctx.lineTo(55, 25);
  ctx.lineTo(95, 5);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(55, 25, 7, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(95, 5, 7, 0, Math.PI * 2);
  ctx.stroke();

  // علامة التعجب
  ctx.font = `bold 80px ${NUM_FONT}`;
  ctx.fillText("!", 32, 75);

  ctx.restore();
}

// الخلفية: تدرج أزرق + نقاط خفيفة + شعار بشفافية
function paintBackground(ctx, bgImage) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, COLORS.bgTop);
  g.addColorStop(1, COLORS.bgBottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // نقاط خفيفة (نمط القالب)
  ctx.fillStyle = COLORS.dot;
  for (let y = 14, row = 0; y < H; y += 30, row++) {
    for (let x = row % 2 ? 29 : 14; x < W; x += 30) {
      ctx.beginPath();
      ctx.arc(x, y, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // الشعار كخلفية شفافة (multiply يخفي اللون الأبيض ويُبقي الرسم فقط)
  if (bgImage) {
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = BG_LOGO.opacity;
    const s = Math.max(W / bgImage.width, H / bgImage.height);
    const dw = bgImage.width * s;
    const dh = bgImage.height * s;
    ctx.drawImage(bgImage, (W - dw) / 2, (H - dh) / 2, dw, dh);
    ctx.restore();
  }
}

function drawLine(ctx, x1, y1, x2, y2) {
  ctx.save();
  ctx.strokeStyle = COLORS.navy;
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

function drawFrame(question, options, correctIndex, showAnswer, bgImage) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  paintBackground(ctx, bgImage);
  drawBrainIcon(ctx, BRAIN.cx, BRAIN.cy, BRAIN.scale);

  // بطاقة السؤال
  fillSkewed(ctx, CARD.x + 12, CARD.y + 14, CARD.w, CARD.h, 64, 0.05, COLORS.shadow);
  fillSkewed(ctx, CARD.x, CARD.y, CARD.w, CARD.h, 64, 0.05, COLORS.white);
  drawLine(ctx, -10, CARD.y + 24, CARD.x + 250, CARD.y + 24);
  drawLine(ctx, CARD.x + 150, CARD.y + CARD.h - 24, W + 10, CARD.y + CARD.h - 24);

  drawFittedText(
    ctx,
    question,
    { x: CARD.x + 50, y: CARD.y + 55, w: CARD.w - 100, h: CARD.h - 110 },
    66,
    34,
    COLORS.navy
  );

  // الخيارات
  const letters = ["A", "B", "C", "D"];
  for (let i = 0; i < 4; i++) {
    const y = PILL.firstY + i * (PILL.h + PILL.gap);
    const cy = y + PILL.h / 2;
    const isCorrect = showAnswer && i === correctIndex;
    const isDimmed = showAnswer && i !== correctIndex;

    // خط الزينة
    if (i % 2 === 0) drawLine(ctx, PILL.x + PILL.w, cy, W + 10, cy);
    else drawLine(ctx, -10, cy, PILL.x, cy);

    ctx.save();
    if (isDimmed) ctx.globalAlpha = 0.45;

    fillSkewed(ctx, PILL.x + 10, y + 12, PILL.w, PILL.h, 40, 0.08, COLORS.shadow);
    fillSkewed(
      ctx,
      PILL.x,
      y,
      PILL.w,
      PILL.h,
      40,
      0.08,
      isCorrect ? COLORS.correct : COLORS.white
    );

    // الحرف
    ctx.fillStyle = isCorrect ? COLORS.white : COLORS.navy;
    ctx.direction = "ltr";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = `bold 54px ${FONT_FAMILY}`;
    ctx.fillText(`${letters[i]}:`, PILL.x + 50, cy + 3);

    // نص الخيار
    drawFittedText(
      ctx,
      options[i],
      { x: PILL.x + 130, y: y + 8, w: PILL.w - 130 - 100, h: PILL.h - 16 },
      54,
      26,
      isCorrect ? COLORS.white : COLORS.navy
    );

    // علامة الصح
    if (isCorrect) {
      const kx = PILL.x + PILL.w - 62;
      ctx.fillStyle = COLORS.white;
      ctx.beginPath();
      ctx.arc(kx, cy, 34, 0, Math.PI * 2);
      ctx.fill();
      drawCheck(ctx, kx, cy, 34, COLORS.correctDark, 9);
    }

    ctx.restore();
  }

  return canvas.toBuffer("image/png");
}

// ---------- العداد الدائري المتحرك (سلسلة صور شفافة) ----------
function drawRingFrame(index) {
  const t = index / FPS;
  const done = t >= COUNTDOWN;
  const remaining = Math.max(0, COUNTDOWN - t);
  const secondsLeft = Math.ceil(remaining);

  // نبضة صغيرة عند كل ثانية وعند الكشف
  let pulse;
  if (done) pulse = Math.max(0, 1 - (t - COUNTDOWN) * 3);
  else pulse = Math.max(0, 1 - (t - Math.floor(t)) * 4);
  const scale = 1 + 0.12 * pulse;

  let color;
  if (done) color = COLORS.correct;
  else if (remaining > 6) color = COLORS.ringYellow;
  else if (remaining > 3) color = COLORS.ringOrange;
  else color = COLORS.ringRed;

  const canvas = createCanvas(RING.size, RING.size);
  const ctx = canvas.getContext("2d");
  ctx.translate(RING.size / 2, RING.size / 2);
  ctx.scale(scale, scale);

  // القرص الأبيض في الوسط
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.30)";
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = COLORS.white;
  ctx.beginPath();
  ctx.arc(0, 0, RING.r - 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // مسار الحلقة
  ctx.lineWidth = 24;
  ctx.lineCap = "round";
  ctx.strokeStyle = COLORS.ringTrack;
  ctx.beginPath();
  ctx.arc(0, 0, RING.r, 0, Math.PI * 2);
  ctx.stroke();

  // التقدم
  ctx.strokeStyle = color;
  ctx.beginPath();
  if (done) {
    ctx.arc(0, 0, RING.r, 0, Math.PI * 2);
  } else if (remaining > 0) {
    ctx.arc(0, 0, RING.r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (remaining / COUNTDOWN));
  }
  ctx.stroke();

  // الرقم أو علامة الصح
  if (done) {
    drawCheck(ctx, 0, 0, 70, COLORS.correct, 18);
  } else {
    ctx.fillStyle = secondsLeft <= 3 ? COLORS.ringRed : COLORS.navy;
    ctx.direction = "ltr";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `bold 120px ${NUM_FONT}`;
    ctx.fillText(String(secondsLeft), 0, 8);
  }

  return canvas.toBuffer("image/png");
}

function writeRingFrames() {
  const count = TOTAL * FPS;
  for (let i = 0; i < count; i++) {
    const name = `ring_${String(i).padStart(4, "0")}.png`;
    fs.writeFileSync(path.join(TMP_DIR, name), drawRingFrame(i));
  }
}

async function loadBackgroundImage() {
  for (const file of BG_LOGO.files) {
    const p = path.join(__dirname, file);
    if (fs.existsSync(p)) {
      console.log(`Using background image: ${file}`);
      return loadImage(p);
    }
  }
  console.log("No background image (bac.jpg) found. Continuing without it.");
  return null;
}

// ---------- Google Sheets ----------
// يقرأ ملف JSON كاملاً من السر GOOGLE_CREDENTIALS
async function loadSheet() {
  const { GOOGLE_SHEET_ID, GOOGLE_CREDENTIALS } = process.env;

  if (!GOOGLE_SHEET_ID || !GOOGLE_CREDENTIALS) {
    throw new Error("Missing env vars: GOOGLE_SHEET_ID, GOOGLE_CREDENTIALS");
  }

  let creds;
  try {
    creds = JSON.parse(GOOGLE_CREDENTIALS);
  } catch (e) {
    throw new Error(
      "GOOGLE_CREDENTIALS is not valid JSON. Paste the full content of the JSON key file."
    );
  }

  const auth = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID, auth);
  await doc.loadInfo();

  const sheetName = process.env.SHEET_NAME;
  const sheet = sheetName ? doc.sheetsByTitle[sheetName] : doc.sheetsByIndex[0];
  if (!sheet) throw new Error(`Sheet not found: ${sheetName || "(first sheet)"}`);
  return sheet;
}

function isPending(row) {
  const status = String(row.get("Status") || "").trim().toLowerCase();
  return status === "pending" || status === "";
}

// ---------- FFmpeg ----------
function buildVideo(basePng, answerPng, outPath) {
  const SR = 44100;
  const musicPath = path.join(__dirname, "music.mp3");
  const hasMusic = fs.existsSync(musicPath);
  const ringX = Math.round(RING.cx - RING.size / 2);
  const ringY = Math.round(RING.cy - RING.size / 2);

  // ----- فلاتر الفيديو -----
  const videoFilter = [
    `[0:v][1:v]overlay=enable='gte(t,${COUNTDOWN})'[v1]`,
    `[v1][2:v]overlay=x=${ringX}:y=${ringY}:format=auto[v2]`,
    `[v2]format=yuv420p[vout]`,
  ];

  // ----- فلاتر الصوت -----
  const audioFilter = [
    // تكّة كل ثانية طوال العد التنازلي
    `sine=frequency=1000:duration=0.08:sample_rate=${SR},afade=t=out:st=0.03:d=0.05,apad=whole_dur=1,aloop=loop=${COUNTDOWN - 1}:size=${SR},volume=4,aformat=channel_layouts=stereo[tick]`,
    // نغمة النصر عند كشف الإجابة
    `sine=frequency=523:duration=0.15:sample_rate=${SR}[n1]`,
    `sine=frequency=659:duration=0.15:sample_rate=${SR}[n2]`,
    `sine=frequency=784:duration=0.15:sample_rate=${SR}[n3]`,
    `sine=frequency=1047:duration=0.7:sample_rate=${SR}[n4]`,
    `[n1][n2][n3][n4]concat=n=4:v=0:a=1,afade=t=out:st=0.8:d=0.35,volume=4.5,adelay=${COUNTDOWN * 1000},aformat=channel_layouts=stereo[win]`,
  ];

  if (hasMusic) {
    audioFilter.push(
      `[3:a]volume=0.3,atrim=0:${TOTAL},asetpts=PTS-STARTPTS,aresample=${SR},aformat=channel_layouts=stereo[mus]`
    );
  }

  const mixInputs = hasMusic ? "[tick][win][mus]" : "[tick][win]";
  audioFilter.push(
    `${mixInputs}amix=inputs=${hasMusic ? 3 : 2}:duration=longest:normalize=0,apad=whole_dur=${TOTAL},atrim=0:${TOTAL},aformat=sample_rates=${SR}:channel_layouts=stereo[aout]`
  );

  const filter = videoFilter.concat(audioFilter).join(";");

  // ----- أمر FFmpeg -----
  const args = [
    "-y",
    "-loop", "1", "-framerate", String(FPS), "-t", String(TOTAL), "-i", basePng,
    "-loop", "1", "-framerate", String(FPS), "-t", String(TOTAL), "-i", answerPng,
    "-framerate", String(FPS), "-i", path.join(TMP_DIR, "ring_%04d.png"),
  ];

  if (hasMusic) {
    args.push("-stream_loop", "-1", "-i", musicPath);
  }

  args.push(
    "-filter_complex", filter,
    "-map", "[vout]",
    "-map", "[aout]",
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "20",
    "-r", String(FPS),
    "-c:a", "aac",
    "-b:a", "192k",
    "-t", String(TOTAL),
    "-movflags", "+faststart",
    outPath
  );

  execFileSync("ffmpeg", args, { stdio: "inherit" });
}

// ---------- البرنامج الرئيسي ----------
async function main() {
  console.log("Connecting to Google Sheets...");
  const sheet = await loadSheet();
  const rows = await sheet.getRows();

  const row = rows.find(isPending);
  if (!row) {
    console.log("No pending questions found. Nothing to do.");
    return;
  }

  const question = String(row.get("Question") || "").trim();
  const options = [
    String(row.get("OptionA") || "").trim(),
    String(row.get("OptionB") || "").trim(),
    String(row.get("OptionC") || "").trim(),
    String(row.get("OptionD") || "").trim(),
  ];
  const correctLetter = String(row.get("CorrectAnswer") || "")
    .trim()
    .toUpperCase();
  const correctIndex = ["A", "B", "C", "D"].indexOf(correctLetter);

  if (!question || options.some((o) => !o) || correctIndex === -1) {
    throw new Error(
      `Invalid row (row number ${row.rowNumber}): check Question, Options and CorrectAnswer (A/B/C/D).`
    );
  }

  console.log(`Generating video for row ${row.rowNumber}: ${question}`);

  fs.mkdirSync(TMP_DIR, { recursive: true });
  const bgImage = await loadBackgroundImage();

  const basePng = path.join(TMP_DIR, "base.png");
  const answerPng = path.join(TMP_DIR, "answer.png");
  fs.writeFileSync(basePng, drawFrame(question, options, correctIndex, false, bgImage));
  fs.writeFileSync(answerPng, drawFrame(question, options, correctIndex, true, bgImage));
  writeRingFrames();

  buildVideo(basePng, answerPng, path.join(__dirname, OUTPUT));

  // تحديث الحالة بعد نجاح التوليد فقط
  row.set("Status", "Done");
  await row.save();

  console.log(`Done. Video saved as ${OUTPUT} and row ${row.rowNumber} marked as Done.`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
