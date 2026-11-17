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
