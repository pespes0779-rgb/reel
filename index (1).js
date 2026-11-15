const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { createCanvas } = require("canvas");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");

// ---------- الإعدادات ----------
const W = 1080;
const H = 1920;
const FPS = 30;
const COUNTDOWN = 10; // ثواني المؤقت
const REVEAL = 3; // ثواني عرض الإجابة الصحيحة
const TOTAL = COUNTDOWN + REVEAL;
const OUTPUT = "quiz_output.mp4";
const TMP_DIR = path.join(__dirname, "tmp");

// ألوان زاهية (يمكنك تغييرها بسهولة)
const COLORS = {
  bgTop: "#2563eb", // أزرق
  bgMid: "#7c3aed", // بنفسجي
  bgBottom: "#ec4899", // وردي
  cardText: "#0f172a",
  white: "#ffffff",
  correct: "#22c55e",
  correctDark: "#15803d",
  badges: ["#2563eb", "#f97316", "#0d9488", "#9333ea"],
  barLeft: "#fde047",
  barRight: "#f97316",
};

const FONT_FAMILY = '"Noto Sans Arabic", "Noto Sans", "DejaVu Sans", sans-serif';
const TIMER_FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

// مواضع العناصر
const QUESTION_PANEL = { x: 60, y: 110, w: 960, h: 420 };
const QUESTION_AREA = { x: 100, y: 130, w: 880, h: 380 };
const BOX = { x: 70, w: 940, h: 200, gap: 30, firstY: 580 };
const BAR = { x: 80, y: 1520, w: 920, h: 24 };

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

// الخلفية: تدرج لوني عمودي (نفس اللون في كل سطر أفقي ليعمل المؤقت بشكل صحيح)
function paintBackground(ctx) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, COLORS.bgTop);
  g.addColorStop(0.5, COLORS.bgMid);
  g.addColorStop(1, COLORS.bgBottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

// زخارف دائرية شفافة (بعيدة عن منطقة شريط المؤقت)
function paintDecorations(ctx) {
  ctx.fillStyle = "rgba(255,255,255,0.10)";
  ctx.beginPath();
  ctx.arc(960, 120, 260, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(-40, 760, 200, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(1060, 1250, 170, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(120, 1880, 230, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(100, 90, 120, 0, Math.PI * 2);
  ctx.stroke();
}

function drawCheck(ctx, cx, cy, size, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 12;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.45, cy + size * 0.02);
  ctx.lineTo(cx - size * 0.1, cy + size * 0.38);
  ctx.lineTo(cx + size * 0.5, cy - size * 0.32);
  ctx.stroke();
}

function drawFrame(question, options, correctIndex, showAnswer) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  paintBackground(ctx);
  paintDecorations(ctx);

  // لوحة السؤال
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.25)";
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = "rgba(15,23,42,0.35)";
  roundRect(ctx, QUESTION_PANEL.x, QUESTION_PANEL.y, QUESTION_PANEL.w, QUESTION_PANEL.h, 48);
  ctx.fill();
  ctx.restore();

  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(255,255,255,0.45)";
  roundRect(ctx, QUESTION_PANEL.x, QUESTION_PANEL.y, QUESTION_PANEL.w, QUESTION_PANEL.h, 48);
  ctx.stroke();

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;
  drawFittedText(ctx, question, QUESTION_AREA, 74, 38, COLORS.white);
  ctx.restore();

  // الخيارات
  const letters = ["A", "B", "C", "D"];
  for (let i = 0; i < 4; i++) {
    const y = BOX.firstY + i * (BOX.h + BOX.gap);
    const isCorrect = showAnswer && i === correctIndex;
    const isDimmed = showAnswer && i !== correctIndex;

    ctx.save();
    if (isDimmed) ctx.globalAlpha = 0.4;

    // البطاقة
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.28)";
    ctx.shadowBlur = 26;
    ctx.shadowOffsetY = 10;
    ctx.fillStyle = isCorrect ? COLORS.correct : COLORS.white;
    roundRect(ctx, BOX.x, y, BOX.w, BOX.h, 44);
    ctx.fill();
    ctx.restore();

    if (isCorrect) {
      ctx.lineWidth = 8;
      ctx.strokeStyle = "#bbf7d0";
      roundRect(ctx, BOX.x, y, BOX.w, BOX.h, 44);
      ctx.stroke();
    }

    // دائرة الحرف
    const bx = BOX.x + 95;
    const by = y + BOX.h / 2;
    ctx.fillStyle = isCorrect ? COLORS.white : COLORS.badges[i];
    ctx.beginPath();
    ctx.arc(bx, by, 62, 0, Math.PI * 2);
    ctx.fill();

    if (isCorrect) {
      drawCheck(ctx, bx, by, 62, COLORS.correctDark);
    } else {
      ctx.fillStyle = COLORS.white;
      ctx.direction = "ltr";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `bold 66px ${FONT_FAMILY}`;
      ctx.fillText(letters[i], bx, by + 4);
    }

    // نص الخيار
    const textArea = { x: BOX.x + 190, y: y + 10, w: BOX.w - 230, h: BOX.h - 20 };
    drawFittedText(
      ctx,
      options[i],
      textArea,
      58,
      28,
      isCorrect ? COLORS.white : COLORS.cardText
    );

    ctx.restore();
  }

  // شريط المؤقت (في الصورة الأساسية فقط)
  if (!showAnswer) {
    const bg = ctx.createLinearGradient(BAR.x, 0, BAR.x + BAR.w, 0);
    bg.addColorStop(0, COLORS.barLeft);
    bg.addColorStop(1, COLORS.barRight);
    ctx.fillStyle = bg;
    ctx.fillRect(BAR.x, BAR.y, BAR.w, BAR.h);
  }

  return canvas.toBuffer("image/png");
}

// صورة تغطية المؤقت: قطعة من الخلفية بنفس مكان الشريط
function drawCover() {
  const c = createCanvas(BAR.w, BAR.h);
  const ctx = c.getContext("2d");
  ctx.translate(0, -BAR.y);
  paintBackground(ctx);
  return c.toBuffer("image/png");
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
function buildVideo(basePng, answerPng, coverPng, outPath) {
  const SR = 44100;
  const musicPath = path.join(__dirname, "music.mp3");
  const hasMusic = fs.existsSync(musicPath);

  // ----- فلاتر الفيديو -----
  const timerStyle = `fontsize=170:fontcolor=white:shadowcolor=black@0.35:shadowx=4:shadowy=4:x=(w-text_w)/2:y=1600`;
  const videoFilter = [
    `[0:v][1:v]overlay=enable='gte(t,${COUNTDOWN})'[v1]`,
    `[v1][2:v]overlay=x='${BAR.x + BAR.w}-${BAR.w}*min(t,${COUNTDOWN})/${COUNTDOWN}':y=${BAR.y}:enable='lt(t,${COUNTDOWN})'[v2]`,
    `[v2]drawtext=fontfile=${TIMER_FONT}:text='%{eif\\:ceil(${COUNTDOWN}-t)\\:d}':${timerStyle}:enable='lt(t,${COUNTDOWN})',` +
      `drawtext=fontfile=${TIMER_FONT}:text='0':${timerStyle}:enable='gte(t,${COUNTDOWN})',` +
      `format=yuv420p[vout]`,
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
    "-loop", "1", "-framerate", String(FPS), "-t", String(TOTAL), "-i", coverPng,
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
  const basePng = path.join(TMP_DIR, "base.png");
  const answerPng = path.join(TMP_DIR, "answer.png");
  const coverPng = path.join(TMP_DIR, "cover.png");

  fs.writeFileSync(basePng, drawFrame(question, options, correctIndex, false));
  fs.writeFileSync(answerPng, drawFrame(question, options, correctIndex, true));
  fs.writeFileSync(coverPng, drawCover());

  buildVideo(basePng, answerPng, coverPng, path.join(__dirname, OUTPUT));

  // تحديث الحالة بعد نجاح التوليد فقط
  row.set("Status", "Done");
  await row.save();

  console.log(`Done. Video saved as ${OUTPUT} and row ${row.rowNumber} marked as Done.`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
