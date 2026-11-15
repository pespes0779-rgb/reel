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

const COLORS = {
  bg: "#0f172a",
  box: "#1e293b",
  boxBorder: "#475569",
  text: "#ffffff",
  badge: "#3b82f6",
  correct: "#16a34a",
  correctBorder: "#4ade80",
  timerBar: "#f59e0b",
  timerTrack: "#334155",
};

const FONT_FAMILY = '"Noto Sans Arabic", "Noto Sans", "DejaVu Sans", sans-serif';
const TIMER_FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

// مواضع العناصر
const QUESTION_AREA = { x: 80, y: 120, w: 920, h: 400 };
const BOX = { x: 80, w: 920, h: 200, gap: 30, firstY: 580 };
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

function drawFrame(question, options, correctIndex, showAnswer) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // الخلفية (لون موحد لأن شريط المؤقت يعتمد عليه)
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, W, H);

  // السؤال
  drawFittedText(ctx, question, QUESTION_AREA, 72, 38, COLORS.text);

  // الخيارات
  const letters = ["A", "B", "C", "D"];
  for (let i = 0; i < 4; i++) {
    const y = BOX.firstY + i * (BOX.h + BOX.gap);
    const isCorrect = showAnswer && i === correctIndex;

    ctx.fillStyle = isCorrect ? COLORS.correct : COLORS.box;
    roundRect(ctx, BOX.x, y, BOX.w, BOX.h, 36);
    ctx.fill();

    ctx.lineWidth = 6;
    ctx.strokeStyle = isCorrect ? COLORS.correctBorder : COLORS.boxBorder;
    roundRect(ctx, BOX.x, y, BOX.w, BOX.h, 36);
    ctx.stroke();

    // دائرة الحرف
    ctx.fillStyle = isCorrect ? "#14532d" : COLORS.badge;
    ctx.beginPath();
    ctx.arc(BOX.x + 90, y + BOX.h / 2, 55, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = COLORS.text;
    ctx.direction = "ltr";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `bold 62px ${FONT_FAMILY}`;
    ctx.fillText(letters[i], BOX.x + 90, y + BOX.h / 2 + 4);

    // نص الخيار
    const textArea = { x: BOX.x + 170, y: y + 10, w: BOX.w - 200, h: BOX.h - 20 };
    drawFittedText(ctx, options[i], textArea, 56, 28, COLORS.text);
  }

  // شريط المؤقت (في الصورة الأساسية فقط)
  if (!showAnswer) {
    ctx.fillStyle = COLORS.timerTrack;
    ctx.fillRect(BAR.x - 6, BAR.y - 6, BAR.w + 12, BAR.h + 12);
    ctx.fillStyle = COLORS.timerBar;
    ctx.fillRect(BAR.x, BAR.y, BAR.w, BAR.h);
  }

  return canvas.toBuffer("image/png");
}

// ---------- Google Sheets ----------
async function loadSheet() {
  const { GOOGLE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY } =
    process.env;

  if (!GOOGLE_SHEET_ID || !GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) {
    throw new Error(
      "Missing env vars: GOOGLE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY"
    );
  }

  const auth = new JWT({
    email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
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

  // ----- فلاتر الفيديو -----
  const videoFilter = [
    `[0:v][1:v]overlay=enable='gte(t,${COUNTDOWN})'[v1]`,
    `[v1][2:v]overlay=x='${BAR.x + BAR.w}-${BAR.w}*min(t,${COUNTDOWN})/${COUNTDOWN}':y=${BAR.y}:enable='lt(t,${COUNTDOWN})'[v2]`,
    `[v2]drawtext=fontfile=${TIMER_FONT}:text='%{eif\\:ceil(${COUNTDOWN}-t)\\:d}':fontsize=170:fontcolor=white:x=(w-text_w)/2:y=1600:enable='lt(t,${COUNTDOWN})',` +
      `drawtext=fontfile=${TIMER_FONT}:text='0':fontsize=170:fontcolor=0x4ade80:x=(w-text_w)/2:y=1600:enable='gte(t,${COUNTDOWN})',` +
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
    "-f", "lavfi", "-i",
    `color=c=${COLORS.bg.replace("#", "0x")}:s=${BAR.w}x${BAR.h}:r=${FPS}:d=${TOTAL}`,
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

  fs.writeFileSync(basePng, drawFrame(question, options, correctIndex, false));
  fs.writeFileSync(answerPng, drawFrame(question, options, correctIndex, true));

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
