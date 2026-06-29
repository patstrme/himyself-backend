const express = require("express");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const app = express();

app.use(helmet());
app.use(express.json({ limit: "10kb" }));

const verificationCodes = new Map();
const verificationAttempts = new Map();
const monthlyUsage = new Map();
const failedVerifyAttempts = new Map();

const ipLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { success: false, error: "Too many requests, please try again later." }
});
app.use(ipLimiter);

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function log(action, email, success, detail = "") {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), action, email, success, detail }));
}

function checkMonthlyLimit(email) {
  const now = Date.now();
  const windowMs = 30 * 24 * 60 * 60 * 1000;
  const entry = monthlyUsage.get(email) || { count: 0, windowStart: now };
  if (now - entry.windowStart > windowMs) { entry.count = 0; entry.windowStart = now; }
  if (entry.count >= 100) return false;
  entry.count++;
  monthlyUsage.set(email, entry);
  return true;
}

function checkVerificationLimit(email) {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const entry = verificationAttempts.get(email) || { count: 0, windowStart: now };
  if (now - entry.windowStart > windowMs) { entry.count = 0; entry.windowStart = now; }
  if (entry.count >= 3) return false;
  entry.count++;
  verificationAttempts.set(email, entry);
  return true;
}

function checkFailedVerifyAttempts(email) {
  const entry = failedVerifyAttempts.get(email) || { count: 0 };
  if (entry.count >= 5) return false;
  return true;
}

function incrementFailedVerify(email) {
  const entry = failedVerifyAttempts.get(email) || { count: 0 };
  entry.count++;
  failedVerifyAttempts.set(email, entry);
}

app.post("/send-email", async (req, res) => {
  const { to, subject, body } = req.body;
  if (!to || !subject || !body) {
    return res.status(400).json({ success: false, error: "Missing required fields" });
  }
  if (typeof to !== "string" || typeof subject !== "string" || typeof body !== "string") {
    return res.status(400).json({ success: false, error: "Invalid field types" });
  }
  if (subject.length > 200 || body.length > 10000) {
    return res.status(400).json({ success: false, error: "Content too long" });
  }
  if (!isValidEmail(to)) {
    log("send-email", to, false, "Invalid email");
    return res.status(400).json({ success: false, error: "Invalid email address" });
  }
  if (!checkMonthlyLimit(to)) {
    log("send-email", to, false, "Monthly limit reached");
    return res.status(429).json({ success: false, error: "Monthly limit reached" });
  }
  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": process.env.BREVO_API_KEY },
      body: JSON.stringify({ sender: { name: "Hi Myself", email: "hi@himyself.com" }, to: [{ email: to }], subject, textContent: body }),
    });
    if (!response.ok) { const error = await response.json(); throw new Error(JSON.stringify(error)); }
    log("send-email", to, true);
    res.json({ success: true });
  } catch (err) {
    log("send-email", to, false, err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/send-verification", async (req, res) => {
  const { email, firstName } = req.body;
  if (!email || !firstName) {
    return res.status(400).json({ success: false, error: "Missing required fields" });
  }
  if (typeof email !== "string" || typeof firstName !== "string") {
    return res.status(400).json({ success: false, error: "Invalid field types" });
  }
  if (firstName.length > 100) {
    return res.status(400).json({ success: false, error: "Content too long" });
  }
  if (!isValidEmail(email)) {
    log("send-verification", email, false, "Invalid email");
    return res.status(400).json({ success: false, error: "Invalid email address" });
  }
  if (!checkVerificationLimit(email)) {
    log("send-verification", email, false, "Rate limit exceeded");
    return res.status(429).json({ success: false, error: "Too many verification attempts. Try again in an hour." });
  }
  const code = String(Math.floor(1000 + Math.random() * 9000));
  verificationCodes.set(email, { code, expiresAt: Date.now() + 10 * 60 * 1000 });
  failedVerifyAttempts.delete(email);
  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": process.env.BREVO_API_KEY },
      body: JSON.stringify({ sender: { name: "Hi Myself", email: "hi@himyself.com" }, to: [{ email }], subject: "Your verification code", textContent: `Hi ${firstName},\n\nYour verification code is: ${code}\n\nThe code expires in 10 minutes.` }),
    });
    if (!response.ok) { const error = await response.json(); throw new Error(JSON.stringify(error)); }
    log("send-verification", email, true);
    res.json({ success: true });
  } catch (err) {
    log("send-verification", email, false, err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/verify-code", (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) {
    return res.status(400).json({ success: false, error: "Missing required fields" });
  }
  if (!checkFailedVerifyAttempts(email)) {
    log("verify-code", email, false, "Too many failed attempts");
    return res.status(429).json({ success: false, error: "Too many failed attempts. Request a new code." });
  }
  const entry = verificationCodes.get(email);
  if (!entry) {
    log("verify-code", email, false, "No code found");
    return res.status(400).json({ success: false, error: "No verification code found for this email" });
  }
  if (Date.now() > entry.expiresAt) {
    verificationCodes.delete(email);
    log("verify-code", email, false, "Code expired");
    return res.status(400).json({ success: false, error: "Verification code has expired" });
  }
  if (entry.code !== String(code)) {
    incrementFailedVerify(email);
    log("verify-code", email, false, "Invalid code");
    return res.status(400).json({ success: false, error: "Invalid verification code" });
  }
  verificationCodes.delete(email);
  failedVerifyAttempts.delete(email);
  log("verify-code", email, true);
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`HiMyself backend running on port ${PORT}`));