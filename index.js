const express = require("express");
const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");

const app = express();
app.use(express.json());

const ses = new SESClient({ region: "eu-north-1" });

app.post("/send-email", async (req, res) => {
  const { to, subject, body } = req.body;

  if (!to || !subject || !body) {
    return res.status(400).json({ success: false, error: "Missing required fields: to, subject, body" });
  }

  const command = new SendEmailCommand({
    Source: "no-reply@himyself.se",
    Destination: {
      ToAddresses: [to],
    },
    Message: {
      Subject: { Data: subject },
      Body: {
        Text: { Data: body },
      },
    },
  });

  try {
    await ses.send(command);
    res.json({ success: true });
  } catch (err) {
    console.error("SES error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`HiMyself backend running on port ${PORT}`);
});
