// index.js
import express from "express";
import qrcode from "qrcode";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import pkg from "whatsapp-web.js";      // ✅ Importación correcta (CommonJS → ESM)
const { Client, LocalAuth } = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3001;

// === PERFIL DE CHROME (persistente y limpio) ===
const PROFILE_DIR =
  process.env.PUPPETEER_PROFILE_DIR || path.join(__dirname, "chrome-profile");

function ensureProfileAndCleanLocks() {
  try {
    if (!fs.existsSync(PROFILE_DIR)) fs.mkdirSync(PROFILE_DIR, { recursive: true });

    // Borrar locks comunes
    const lockFiles = ["SingletonLock", "SingletonCookie"];
    for (const f of lockFiles) {
      const p = path.join(PROFILE_DIR, f);
      if (fs.existsSync(p)) fs.rmSync(p, { force: true });
    }

    // Borrar sockets dinámicos
    const files = fs.readdirSync(PROFILE_DIR);
    for (const f of files) {
      if (f.startsWith("SingletonSocket")) {
        fs.rmSync(path.join(PROFILE_DIR, f), { force: true });
      }
    }

    console.log(`🧹 Locks de Chrome limpiados en: ${PROFILE_DIR}`);
  } catch (e) {
    console.warn("⚠️ No se pudieron limpiar locks del perfil:", e.message);
  }
}

// === Buscar ruta de Chrome ===
function resolveChromePath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  const candidates = [
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {}
  }
  return undefined;
}

// === Variables de estado global ===
let lastQr = null;
let isReady = false;
let isAuthenticated = false;
let lastAuthFailure = null;
let lastDisconnect = null;

// Limpieza inicial
ensureProfileAndCleanLocks();

// === Cliente WhatsApp ===
const client = new Client({
  authStrategy: new LocalAuth({ clientId: "session" }),
  puppeteer: {
    executablePath: resolveChromePath(),
    headless: true, // 👈 sin interfaz gráfica
    dumpio: false,
    args: [
      `--user-data-dir=${PROFILE_DIR}`,
      "--profile-directory=Default",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--disable-extensions",
      "--remote-debugging-port=9222",
    ],
  },
});

// === Eventos WhatsApp ===
client.on("qr", async (qr) => {
  console.log("🔄 Nuevo QR generado. Escanéalo con tu WhatsApp.");
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
  console.log("✅ WhatsApp conectado y listo para usarse.");
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
  ensureProfileAndCleanLocks();
  setTimeout(() => client.initialize(), 5000);
});

// === Endpoints Express ===
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_, res) => {
  res.json({
    ok: true,
    ready: isReady,
    authenticated: isAuthenticated,
    auth_failure: lastAuthFailure,
  });
});

app.get("/status", (_, res) => {
  res.json({
    ready: isReady,
    authenticated: isAuthenticated,
    auth_failure: lastAuthFailure,
    disconnected: lastDisconnect,
    qr_available: !!lastQr,
  });
});

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

app.get("/", (_, res) => res.send("📡 Microservicio WhatsApp activo y listo!"));

// === Inicialización ===
const server = app.listen(port, "0.0.0.0", () => {
  console.log(`🚀 Servicio WhatsApp corriendo en http://0.0.0.0:${port}`);
  setTimeout(() => {
    try {
      client.initialize();
    } catch (e) {
      console.error("❌ Error iniciando cliente:", e);
    }
  }, 0);
});

// === Manejo de apagado limpio ===
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
