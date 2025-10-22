// index.js
import express from "express";
import qrcode from "qrcode";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import pkg from "whatsapp-web.js";   // ✅ Importación compatible CommonJS -> ESM
const { Client, LocalAuth } = pkg;

// ============================================================
// ⚙️ CONFIGURACIÓN BASE
// ============================================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3001;

// Directorio del perfil de Chrome
const PROFILE_DIR = process.env.PUPPETEER_PROFILE_DIR || path.join(__dirname, "chrome-profile");
if (!fs.existsSync(PROFILE_DIR)) fs.mkdirSync(PROFILE_DIR, { recursive: true });

// ============================================================
// 🔍 FUNCIÓN PARA ENCONTRAR CHROME/CHROMIUM
// ============================================================
function resolveChromePath() {
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;

  const candidates = [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  console.warn("⚠️ Ninguna instalación de Chromium encontrada, Render instalará una versión interna.");
  return undefined;
}

// ============================================================
// 🧠 VARIABLES DE ESTADO
// ============================================================
let lastQr = null;
let isReady = false;
let isAuthenticated = false;
let lastAuthFailure = null;
let lastDisconnect = null;

const executablePath = resolveChromePath();
console.log("🧠 Usando ejecutable Chromium en:", executablePath || "auto-managed");

// ============================================================
// 🤖 CLIENTE WHATSAPP
// ============================================================
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: PROFILE_DIR }),
  puppeteer: {
    executablePath: executablePath,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-first-run",
      "--no-zygote",
      "--single-process",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-sync",
      "--disable-features=TranslateUI",
    ],
  },
});

client.on("qr", async (qr) => {
  console.log("📲 Nuevo QR generado. Escanéalo con tu WhatsApp.");
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
  console.log("✅ WhatsApp conectado y listo.");
});

client.on("authenticated", () => {
  isAuthenticated = true;
  lastAuthFailure = null;
  lastQr = null;
  console.log("🔑 Sesión autenticada correctamente.");
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

app.get("/", (_, res) => {
  res.send("📡 Microservicio WhatsApp activo y funcionando correctamente 🚀");
});

app.get("/health", (_, res) =>
  res.json({
    ok: true,
    ready: isReady,
    authenticated: isAuthenticated,
    auth_failure: lastAuthFailure,
  })
);

app.get("/qr", (_, res) => {
  if (!lastQr) return res.json({ qr: "" });
  res.json({ qr: lastQr });
});

app.get("/chats", async (_, res) => {
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

console.log("✅ Deploy listo, Render lo levantará automáticamente.");
