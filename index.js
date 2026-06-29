const express = require("express");
const rateLimit = require("express-rate-limit");
const app = express();
app.use(express.json());

const verificationCodes = new Map();
const verificationAttempts = new Map();
const monthlyUsage = new Map();

const ipLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { success: false, error: "Too many requests, please try again later." }
});
app.use(ipLimiter);

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

app.post("/send-email", async (req, res) => {
  const { to, subject, body } = req.body;
  if (!to || !subject || !body) return res.status(400).json({ success: false, error: "Missing required fields" });
  if (!checkMonthlyLimit(to)) return res.status(429).json({ success: false, error: "Monthly limit reached" });
  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": process.env.BREVO_API_KEY },
      body: JSON.stringify({ sender: { name: "Hi Myself", email: "hi@himyself.com" }, to: [{ email: to }], subject, textContent: body }),
    });
    if (!response.ok) { const error = await response.json(); throw new Error(JSON.stringify(error)); }
    res.json({ success: true });
  } catch (err) { console.error("Brevo error:", err); res.status(500).json({ success: false, error: err.message }); }
});

app.post("/send-verification", async (req, res) => {
  const { email, firstName } = req.body;
  if (!email || !firstName) return res.status(400).json({ success: false, error: "Missing required fields" });
  if (!checkVerificationLimit(email)) return res.status(429).json({ success: false, error: "Too many verification attempts. Try again in an hour." });
  const code = String(Math.floor(1000 + Math.random() * 9000));
  verificationCodes.set(email, { code, expiresAt: Date.now() + 10 * 60 * 1000 });
  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": process.env.BREVO_API_KEY },
      body: JSON.stringify({ sender: { name: "Hi Myself", email: "hi@himyself.com" }, to: [{ email }], subject: "Your verification code", textContent: `Hi ${firstName},\n\nYour verification code is: ${code}\n\nThe code expires in 10 minutes.` }),
    });
    if (!response.ok) { const error = await response.json(); throw new Error(JSON.stringify(error)); }
    res.json({ success: true });
  } catch (err) { console.error("Brevo error:", err); res.status(500).json({ success: false, error: err.message }); }
});

app.post("/verify-code", (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ success: false, error: "Missing required fields" });
  const entry = verificationCodes.get(email);
  if (!entry) return res.status(400).json({ success: false, error: "No verification code found for this email" });
  if (Date.now() > entry.expiresAt) { verificationCodes.delete(email); return res.status(400).json({ success: false, error: "Verification code has expired" }); }
  if (entry.code !== String(code)) return res.status(400).json({ success: false, error: "Invalid verification code" });
  verificationCodes.delete(email);
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`HiMyself backend running on port ${PORT}`));