// index.js
import express from "express";
import qrcode from "qrcode";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import puppeteer from "puppeteer";
import pkg from "whatsapp-web.js";   // ✅ Importación CommonJS -> ESM
const { Client, LocalAuth } = pkg;

// ============================================================
// ⚙️ CONFIGURACIÓN BASE
// ============================================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3001;

const PROFILE_DIR =
  process.env.PUPPETEER_PROFILE_DIR || path.join(__dirname, "chrome-profile");

if (!fs.existsSync(PROFILE_DIR)) fs.mkdirSync(PROFILE_DIR, { recursive: true });

// ============================================================
// 🧠 CONFIGURACIÓN DE CHROMIUM (para Render)
// ============================================================
async function getExecutablePath() {
  try {
    const browserFetcher = puppeteer.createBrowserFetcher();
    const localRevisions = await browserFetcher.localRevisions();
    if (localRevisions.length > 0) {
      const revisionInfo = browserFetcher.revisionInfo(localRevisions[0]);
      return revisionInfo.executablePath;
    }
  } catch (e) {
    console.warn("⚠️ No se encontró Chromium local:", e.message);
  }
  return puppeteer.executablePath(); // fallback
}

let lastQr = null;
let isReady = false;
let isAuthenticated = false;
let lastAuthFailure = null;
let lastDisconnect = null;

const executablePath = await getExecutablePath();
console.log("🧠 Usando Chromium en:", executablePath);

// ============================================================
// 🤖 CLIENTE WHATSAPP
// ============================================================
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: PROFILE_DIR }),
  puppeteer: {
    executablePath,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-extensions",
      "--disable-gpu",
      "--no-first-run",
      "--no-zygote",
      "--single-process",
      "--disable-background-networking",
    ],
  },
});

client.on("qr", async (qr) => {
  console.log("📲 Nuevo QR generado. Escanéalo desde WhatsApp.");
  try {
    lastQr = await qrcode.toDataURL(qr);
    isAuthenticated = false;
    isReady = false;
  } catch (err) {
    console.error("❌ Error generando QR:", err);
  }
});

client.on("ready", () => {
  isReady = true;
  console.log("✅ WhatsApp conectado correctamente.");
});

client.on("authenticated", () => {
  isAuthenticated = true;
  lastAuthFailure = null;
  lastQr = null;
  console.log("🔑 Sesión autenticada con éxito.");
});

client.on("auth_failure", (msg) => {
  isAuthenticated = false;
  lastAuthFailure = msg || "unknown";
  console.error("❌ Error de autenticación:", msg);
});

client.on("disconnected", (reason) => {
  isReady = false;
  lastDisconnect = reason || "unknown";
  console.warn("⚠️ Cliente desconectado:", reason);
  setTimeout(() => client.initialize(), 5000);
});

// ============================================================
// 🌐 ENDPOINTS EXPRESS
// ============================================================
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_, res) =>
  res.json({
    ok: true,
    ready: isReady,
    authenticated: isAuthenticated,
    auth_failure: lastAuthFailure,
  })
);

app.get("/qr", (req, res) => {
  if (!lastQr) return res.json({ qr: "" });
  res.json({ qr: lastQr });
});

app.get("/chats", async (req, res) => {
  try {
    const chats = await client.getChats();
    res.json(
      chats.map((c) => ({
        id: c.id?._serialized,
        name: c.name || c.formattedTitle,
        isGroup: c.isGroup,
      }))
    );
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/", (_, res) => res.send("📡 Microservicio WhatsApp activo y listo 🚀"));

// ============================================================
// 🚀 INICIO DEL SERVICIO
// ============================================================
const server = app.listen(port, "0.0.0.0", async () => {
  console.log(`🚀 Servicio WhatsApp corriendo en puerto ${port}`);
  try {
    await client.initialize();
  } catch (e) {
    console.error("❌ Error inicializando cliente:", e);
  }
});

// ============================================================
// 🔚 APAGADO LIMPIO
// ============================================================
process.on("unhandledRejection", (r) => console.error("UNHANDLED REJECTION:", r));
process.on("uncaughtException", (e) => console.error("UNCAUGHT EXCEPTION:", e));

async function shutdown() {
  console.log("🛑 Apagando servicio WhatsApp...");
  try {
    await client.destroy();
  } catch {}
  try {
    server.close(() => process.exit(0));
  } catch {
    process.exit(0);
  }
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
