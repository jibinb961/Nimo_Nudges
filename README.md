# 🤖 AI-Powered Meeting Assistant

An intelligent Node.js application that sends an AI-powered bot to Zoom meetings. The bot uses Google's Gemini 2.0 Flash to analyze conversations in real-time and proactively engage with participants through intelligent chat messages.

## ✨ Key Features

- 🎙️ **Real-time Transcription**: Live transcript streaming from Zoom/Meet/Teams meetings
- 🧠 **AI Sales Coach**: Gemini 2.0 Flash analyzes sales conversations and provides coaching
- 🔧 **Function Calling**: AI autonomously decides when to send coaching messages
- 💬 **Multi-Platform Support**: Send coaching to Zoom DM, Slack, SMS, or Teams simultaneously
- 📊 **Live Dashboard**: Beautiful web interface to monitor transcripts
- 🔄 **Batch Processing**: Smart batching (every 6 messages) prevents AI overload
- 🧵 **Threaded Messages**: Slack/Teams integration with session-based threading

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Create a `.env` file (copy from `.env.example`):
```bash
cp .env.example .env
```

Then edit `.env` and add your API keys:
```env
RECALL_API_KEY=your_actual_recall_api_key_here
GEMINI_API_KEY=your_actual_gemini_api_key_here
RECALL_REGION=us-east-1
PORT=3000
WEBHOOK_SECRET=random_secret_123
WEBHOOK_BASE_URL=http://localhost:3000
```

**Get your Gemini API Key:**
1. Go to [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Sign in with your Google account
3. Click "Create API Key"
4. Copy and paste into your `.env` file

### 3. Setup ngrok (Required for Webhooks)
Recall.ai needs to send webhooks to your server. Use ngrok to expose your local server:

```bash
ngrok http 3000
```

Copy the HTTPS URL (e.g., `https://abc123.ngrok.io`)

### 4. Update Webhook URL
In your `.env` file, update the `WEBHOOK_BASE_URL`:
```env
WEBHOOK_BASE_URL=https://abc123.ngrok.io
```

### 5. Start the Server
```bash
npm start
```

### 6. Open the App
Open your browser and navigate to:
```
http://localhost:3000
```

## 🎯 How to Use

1. **Enter Meeting URL**: Paste a Zoom/Meet/Teams meeting URL
2. **Enter Phone Numbers** (Optional): Add comma-separated phone numbers for SMS (e.g., `+16179349090, +12025551234`)
3. **Click Start**: The bot will join the meeting
4. **Watch Transcripts**: Live transcripts will appear in real-time as people speak
5. **AI Coaching**: Coaching messages sent automatically to configured platforms (Zoom DM, Slack, SMS)
6. **Click Stop**: When done, stop the bot
7. **New Session**: Click "🆕 New Session" to clear all data and start fresh (perfect for demos!)

## 📱 Multi-Platform Support

Send coaching to **multiple platforms simultaneously**!

### Quick Setup

Set the `INTEGRATION` environment variable to a comma-separated list:

```bash
# Single platform
INTEGRATION=ZOOM_DM

# Multiple platforms (coaching sent to multiple!)
INTEGRATION=ZOOM_DM,SLACK

# With SMS
INTEGRATION=ZOOM_DM,SMS

# All platforms
INTEGRATION=ZOOM_DM,SLACK,SMS,TEAMS
```

### Supported Platforms

| Platform | Value | Status | Description |
|----------|-------|--------|-------------|
| Zoom DM | `ZOOM_DM` | ✅ Ready | Private messages in Zoom chat |
| Slack | `SLACK` | ✅ Ready | Threaded messages in Slack channel |
| SMS | `SMS` | ✅ Ready | Text messages via Twilio (multiple numbers) |
| Teams | `TEAMS` | 🚧 Coming Soon | Threaded messages in Teams channel |

### Example Configurations

**Zoom DM Only (Default)**
```bash
INTEGRATION=ZOOM_DM
```

**Slack Only**
```bash
INTEGRATION=SLACK
SLACK_BOT_TOKEN=xoxb-your-token
SLACK_CHANNEL_ID=C01234567890
```

**Both Zoom DM AND Slack** ⭐
```bash
INTEGRATION=ZOOM_DM,SLACK
SLACK_BOT_TOKEN=xoxb-your-token
SLACK_CHANNEL_ID=C01234567890
```
**Use Case:** Sales rep gets private coaching in Zoom + team can review in Slack!

**SMS Notifications** 📱
```bash
INTEGRATION=SMS
TWILIO_ACCOUNT_SID=ACxxx...
TWILIO_AUTH_TOKEN=xxx...
TWILIO_MESSAGING_SERVICE_SID=MGxxx...
```
**Use Case:** Send coaching to sales managers or multiple team members via text!

**All Platforms** 🚀 (Maximum Reach)
```bash
INTEGRATION=ZOOM_DM,SLACK,SMS
# Configure all platform credentials
```
**Use Case:** Rep gets Zoom DMs, team reviews in Slack, manager gets SMS!

**📚 For detailed setup instructions:**
- [MULTI_PLATFORM_SETUP.md](./MULTI_PLATFORM_SETUP.md) - Zoom, Slack, Teams
- [SMS_INTEGRATION_SETUP.md](./SMS_INTEGRATION_SETUP.md) - Twilio SMS setup

## 🤖 How the AI Agent Works

The AI agent is an autonomous system that:

1. **Listens Continuously**: Monitors all conversation transcripts in real-time
2. **Contextual Analysis**: Uses Gemini 2.0 Flash to understand conversation context
3. **Intelligent Decision Making**: Decides when to engage based on:
   - Participant introductions (e.g., "My name is...")
   - Questions or requests for help
   - Confusion or need for clarification
   - Important information that should be acknowledged
4. **Function Calling**: Uses Gemini's function calling to trigger `send_message()` when appropriate
5. **Private Responses**: Sends contextually relevant private messages to specific participants

### AI Agent Behavior

**Will Respond When:**
- Someone introduces themselves
- A participant asks a question
- There's confusion that needs clarification
- Important context should be acknowledged

**Won't Respond When:**
- Natural conversation is flowing well
- No intervention is needed
- It would interrupt the discussion

## 📋 Features

- ✅ **AI-Powered Intelligence**: Gemini 2.0 Flash for real-time conversation analysis
- ✅ **Autonomous Function Calling**: AI decides when to send messages
- ✅ **Real-time Transcription**: Live streaming via Server-Sent Events (SSE)
- ✅ **Private Messaging**: Context-aware private chat messages
- ✅ **Beautiful UI**: Modern dashboard with gradient design
- ✅ **Speaker Identification**: Tracks who said what
- ✅ **Conversation Memory**: AI maintains context throughout the session

## 🛠️ Tech Stack

- **Backend**: Node.js + Express
- **AI**: Google Gemini 2.0 Flash (with function calling)
- **Frontend**: Vanilla HTML/CSS/JavaScript
- **Real-time**: Server-Sent Events (SSE)
- **Bot API**: Recall.ai
- **LLM SDK**: @google/generative-ai

## 📁 Project Structure

```
ZoomBot/
├── .env                 # Environment variables (create this)
├── .env.example         # Environment template
├── .gitignore          # Git ignore rules
├── package.json        # Node.js dependencies
├── server.js           # Express backend server
├── index.html          # Frontend UI
└── README.md           # This file
```

## 🔧 API Endpoints

- `POST /api/start-bot` - Start a new AI-powered bot for a Zoom meeting
- `POST /api/webhook` - Receive webhooks from Recall.ai (transcripts, events)
- `GET /api/stream` - SSE endpoint for real-time transcript streaming
- `GET /api/ai-history/:botId` - Get AI conversation history for a session
- `GET /api/bot-status/:botId` - Get bot status and configuration
- `POST /api/stop-bot/:botId` - Stop a bot and cleanup session

## 📝 Expected Terminal Output

```
=================================
🤖 AI-Powered Meeting Assistant
=================================
📍 Server: http://localhost:3000
🧠 AI Model: Gemini 2.0 Flash
=================================

📞 Starting bot for: https://zoom.us/j/123456789
✅ Bot created: abc-123-def
🤖 AI Agent activated and ready!
📡 Client connected. Total: 1

👋 John Smith joined the meeting
🧠 AI analyzing transcript...
👂 AI listening... (no action needed)

💬 [John Smith]: Hello, my name is John
🧠 AI analyzing transcript...
🎯 AI decided to take action: send_message
📋 Function call details: {
  "participant_id": "100",
  "participant_name": "John Smith",
  "message": "Hi John! Welcome to the meeting. Nice to meet you! 👋",
  "reason": "Participant introduced themselves"
}
💡 Reason: Participant introduced themselves
📤 Sending PRIVATE chat message to participant 100
📝 Message: "Hi John! Welcome to the meeting. Nice to meet you! 👋"
🔒 Sending privately to participant ID: 100
✅ Private chat message sent successfully!
```

## 🔒 Security Notes

- Never commit your `.env` file (already in `.gitignore`)
- Keep your `RECALL_API_KEY` secret
- Use a strong `WEBHOOK_SECRET` in production
- Use HTTPS in production (ngrok provides this for testing)

## 🚀 Deployment (Production)

Want to deploy this for your team or CEO to access?

### Quick Deploy Options

| Platform | Time | Cost | Link |
|----------|------|------|------|
| **Railway** (Easiest) | 5 min | $5-10/mo | [Deploy Guide](./DEPLOY_RAILWAY.md) |
| **Render** (Free) | 5 min | FREE | [Full Guide](./DEPLOYMENT_GUIDE.md) |
| **Heroku** | 10 min | $7/mo | [Full Guide](./DEPLOYMENT_GUIDE.md) |

### 📚 Documentation

- **[DEPLOY_RAILWAY.md](./DEPLOY_RAILWAY.md)** - Deploy in 5 minutes (recommended)
- **[DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)** - All deployment options

**After deployment**, you'll get a public URL like:
```
https://nimo-bot-production.up.railway.app
```

Share this with your team and they can access it from anywhere!

---

## 🐛 Troubleshooting

**Transcripts not appearing?**
- Ensure ngrok is running and `WEBHOOK_BASE_URL` is updated in `.env`
- Check that your Recall.ai API key is valid
- Verify the bot successfully joined the meeting

**Bot not joining?**
- Check the Zoom meeting URL is correct
- Ensure the meeting allows bots/external participants
- Check your Recall.ai account has sufficient credits

**Connection issues?**
- Restart the server after changing `.env`
- Check ngrok tunnel is still active
- Verify your firewall isn't blocking connections

## 📄 License

MIT

---

**Built with ❤️ using Recall.ai**

