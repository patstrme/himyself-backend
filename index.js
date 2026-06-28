const express = require("express");
const app = express();
app.use(express.json());

app.post("/send-email", async (req, res) => {
  const { to, subject, body } = req.body;

  if (!to || !subject || !body) {
    return res.status(400).json({ success: false, error: "Missing required fields: to, subject, body" });
  }

  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": process.env.BREVO_API_KEY,
      },
      body: JSON.stringify({
        sender: { name: "Hi Myself", email: "hi@himyself.com" },
        to: [{ email: to }],
        subject: subject,
        textContent: body,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(JSON.stringify(error));
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Brevo error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`HiMyself backend running on port ${PORT}`);
});
