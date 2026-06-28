const express = require("express");
const Brevo = require("@getbrevo/brevo");

const app = express();
app.use(express.json());

const BREVO_API_KEY = "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";
const SENDER_EMAIL = "no-reply@himyself.com";
const SENDER_NAME = "Hi Myself";

// In-memory store for verification codes: { email -> { code, expiresAt } }
const verificationCodes = {};

function getBrevoClient() {
  const apiInstance = new Brevo.TransactionalEmailsApi();
  apiInstance.authentications["api-key"].apiKey = BREVO_API_KEY;
  return apiInstance;
}

app.post("/send-email", async (req, res) => {
  const { to, subject, body } = req.body;

  if (!to || !subject || !body) {
    return res.status(400).json({ success: false, error: "Missing required fields: to, subject, body" });
  }

  const apiInstance = getBrevoClient();
  const sendSmtpEmail = new Brevo.SendSmtpEmail();

  sendSmtpEmail.sender = { name: SENDER_NAME, email: SENDER_EMAIL };
  sendSmtpEmail.to = [{ email: to }];
  sendSmtpEmail.subject = subject;
  sendSmtpEmail.textContent = body;

  try {
    await apiInstance.sendTransacEmail(sendSmtpEmail);
    res.json({ success: true });
  } catch (err) {
    console.error("Brevo error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/send-verification", async (req, res) => {
  const { firstName, email } = req.body;

  if (!firstName || !email) {
    return res.status(400).json({ success: false, error: "Missing required fields: firstName, email" });
  }

  const code = Math.floor(1000 + Math.random() * 9000).toString();
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

  verificationCodes[email] = { code, expiresAt };

  const apiInstance = getBrevoClient();
  const sendSmtpEmail = new Brevo.SendSmtpEmail();

  sendSmtpEmail.sender = { name: SENDER_NAME, email: SENDER_EMAIL };
  sendSmtpEmail.to = [{ email }];
  sendSmtpEmail.subject = "Din verifieringskod";
  sendSmtpEmail.textContent = `Hej ${firstName}!\n\nDin verifieringskod är: ${code}\n\nKoden är giltig i 10 minuter.`;

  try {
    await apiInstance.sendTransacEmail(sendSmtpEmail);
    res.json({ success: true });
  } catch (err) {
    console.error("Brevo error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/verify-code", async (req, res) => {
  const { email, code } = req.body;

  if (!email || !code) {
    return res.status(400).json({ success: false, error: "Missing required fields: email, code" });
  }

  const entry = verificationCodes[email];

  if (!entry) {
    return res.status(400).json({ success: false, error: "No verification code found for this email" });
  }

  if (Date.now() > entry.expiresAt) {
    delete verificationCodes[email];
    return res.status(400).json({ success: false, error: "Verification code has expired" });
  }

  if (entry.code !== code) {
    return res.status(400).json({ success: false, error: "Invalid verification code" });
  }

  delete verificationCodes[email];
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`HiMyself backend running on port ${PORT}`);
});
