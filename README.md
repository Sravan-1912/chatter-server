# 🌐 Chatter Real-Time Online Backend & OTP Gateway

Production-grade real-time online gateway for the **Chatter (StealthChat)** mobile application. Built with pure Node.js (zero external dependencies), ready for 1-click deployment on **Render.com**.

---

## 🚀 1-Click Render.com Deployment

When deploying to [Render Dashboard](https://dashboard.render.com/web/new):

1. Connect this GitHub repository (`chatter-server`).
2. Render will automatically detect the settings:
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: `Free ($0/month)`
3. Click **Create Web Service**.
4. Once deployed (typically ~30 seconds), Render provides your permanent public HTTPS URL:
   ```
   https://chatter-server-xxxx.onrender.com
   ```

---

## 📱 Real SMS Carrier Gateway Configuration

To deliver live SMS verification codes directly to real mobile devices:

### Option A: Fast2SMS (Recommended for India `+91`)
1. Create a free account at [fast2sms.com](https://www.fast2sms.com/).
2. Copy your **API Key** from the Fast2SMS Dev API dashboard.
3. In your **Render Dashboard** ➔ Select your `chatter-server` service ➔ **Environment** tab.
4. Add Environment Variable:
   - **Key**: `FAST2SMS_API_KEY`
   - **Value**: `your_fast2sms_api_key_here`
5. Save changes. Render will auto-reload. All `+91` numbers will receive live carrier SMS immediately!

### Option B: Twilio (Global Worldwide)
1. Add the following in your **Render Environment** tab:
   - `TWILIO_ACCOUNT_SID`: `ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`
   - `TWILIO_AUTH_TOKEN`: `your_auth_token`
   - `TWILIO_PHONE_NUMBER`: `+1xxxxxxxxxx`
2. Save changes. International carrier SMS will be dispatched globally!

> **Note**: If no external SMS key is set, Chatter logs the dispatched SMS code securely in the **Render Web Service Logs** (`https://dashboard.render.com`) so you can test instantly.

---

## 📲 Connecting Mobile App (Across Any Network)

1. Open **Chatter** on any phone (on 4G/5G mobile data or Wi-Fi).
2. Go to **Settings (gear icon) ➔ Real-Time Gateway Server**.
3. Enter your Render URL:
   ```
   https://chatter-server-xxxx.onrender.com
   ```
4. Tap **Test Connection** (returns `200 OK`) and tap **Save & Apply**.
5. All phones connected to this URL can now chat, send voice notes, react with emojis, and view red ticks globally from anywhere in the world!

---

## 📡 API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` or `/api/health` | Health check & service latency ping |
| `POST` | `/api/auth/send-otp` | Real-time OTP generation with SMS dispatch |
| `POST` | `/api/auth/verify-otp` | Validates entered 6-digit OTP code |
| `GET` | `/api/users/registered` | Discovers registered users on Chatter |
| `POST` | `/api/messages/send` | Dispatches real-time text & voice messages |
| `GET` | `/api/messages/poll` | Long-poll / fetch pending incoming messages & delivery acks |
| `POST` | `/api/messages/ack` | Delivers seen/read status (triggers RED ticks) |
| `GET` | `/api/status/feed` | Fetches active 24-hour Status/Stories |
| `POST` | `/api/status/post` | Publishes new 24-hour text status story |
| `POST` | `/api/contacts/sync` | Syncs device contacts against registered accounts |
