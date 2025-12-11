require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { WebClient } = require('@slack/web-api');
const twilio = require('twilio');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Parse integration modes (supports comma-separated values like "ZOOM_DM,SLACK")
const INTEGRATION_MODES = (process.env.INTEGRATION || 'ZOOM_DM')
  .split(',')
  .map(mode => mode.trim().toUpperCase());

console.log('📱 Enabled integration modes:', INTEGRATION_MODES);

// Initialize Slack client (if SLACK is in integration modes)
const slackClient = INTEGRATION_MODES.includes('SLACK') ? new WebClient(process.env.SLACK_BOT_TOKEN) : null;
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID;

// Initialize Twilio client (if SMS is in integration modes)
const twilioClient = INTEGRATION_MODES.includes('SMS') && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;
const TWILIO_MESSAGING_SERVICE_SID = process.env.TWILIO_MESSAGING_SERVICE_SID;

if (INTEGRATION_MODES.includes('SMS')) {
  if (twilioClient) {
    console.log('✅ Twilio SMS integration initialized');
  } else {
    console.log('⚠️  SMS integration requested but missing credentials (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)');
  }
}

// Store active sessions and SSE clients
const sessions = new Map();
const sseClients = new Set();

// ============================================
// AI Agent System Prompt - Recruiting Coach
// ============================================
const SYSTEM_PROMPT = `You are an AI sales coach monitoring a live sales conversation for LucyRx. Your role is to PRIVATELY coach the rep by sending strategic, ultra-concise reminders.

MISSION
Monitor for critical gaps, objections, and buying signals. Only intervene when necessary to salvage a moment or close a deal. Silence is better than noise.

CRITICAL: FULL CONVERSATION TRACKING
You must maintain awareness of the ENTIRE call history to assess gaps and triggers effectively. You receive transcripts in BATCHES and maintain FULL conversation memory across all batches. Use your full conversation history to understand where the user is within the sales process and overall pacing.

CRITICAL FORMATTING RULES
1. Prefix every message with the type: SIGNAL, OBJECTION, GAP, RESOURCE, or BANT.
2. Length Limit: Core coaching text must be UNDER 15 WORDS.
3. Links: When sending a resource link, the link itself does not count toward the word limit.
4. Function Call: Only use send_message() when coaching is needed.

HOW TO GENERATE NUDGES (KNOWLEDGE BASE LOGIC)
1. Contextualize: Listen to the conversation and find the matching category in the Knowledge Base below.
2. Extract the Reframe: Identify the specific "Truth" or "Reframe" needed.
3. Compress: Summarize that specific insight into a <15 word command.
   - Bad: "You should tell them that we have a higher NPS score of 65 compared to the industry average." (Too long)
   - Good: OBJECTION: Cite NPS of 65 vs Industry 6. Proves service quality. (Perfect)

LUCYRX KNOWLEDGE BASE (SOURCE OF TRUTH)

1. The LucyRx Narrative (The Story)
The industry is broken/opaque. Traditional PBMs optimize for their own profit (rebates/spread), not the client's. The LucyRx reframe is that we are not a "partner" or "vendor," but a Fiduciary. "Lucy" means "Light"—we shine a light on hidden costs. We demand a higher standard of care where contracts are face-up and incentives are 100% aligned.

2. Objection: Financial Value & Admin Fees
When prospects object to high admin fees, the truth is that "low admin fees" are a trap to hide spread pricing and retained rebates. The reframe is to shift the metric to Total Net Cost. We prove this via our 100% Pass-Through Model (every dollar saved goes to the client) and full audit rights down to the claim level.

3. Objection: Disruption & Implementation Fear
When prospects fear the "noise" of switching, the philosophy is "The best transition is one your people never notice." The reframe is our Zero-Disruption Transition Guarantee. We prove this by mirroring their existing formulary (keeping members on their current drugs) and using a team with 15+ years of experience, not a temp squad.

4. Objection: Service & Call Centers
When prospects claim "all PBM service is bad," the truth is we don't use call centers. We use a Prescription Care Team of certified pharmacy techs, not script readers. The proof is our NPS of 65 (vs industry avg 6) and 99% Client Retention Rate.

5. Objection: High-Cost Drugs (GLP-1s/Specialty)
When prospects ask about controlling specialty spend, the truth is that generic edits/blocks don't work anymore. The reframe is High-Cost Drug Category Master Plans. We use actionable, clinical strategies (wellness integration, biosimilar adoption) rather than blunt instruments.

6. Objection: Company Size (Risk)
When prospects say we are too small or new, the truth is LucyRx is a new name, but not a new business. The reframe is that we offer "The scale of a national player with the service of a boutique." Proof: $500M capital, 1,200+ clients, 15 years operational excellence.

7. Objection: Network & Access
When prospects worry about pharmacy access, the truth is we use a Connected Specialty Care Network (local), not forced mail-order. Proof: 100+ independent specialty pharmacies ensuring local access.

8. Discovery & Methodology (The Process)
- Methodology Gap: If the Rep accepts surface-level answers (e.g., "We need to save money"), they are failing. The coach must nudge them to Drill Down (SPIN).
- Premature Pitching: If the Rep starts demoing features before identifying 3+ pain points, they are failing. Stop them.
- Challenger: If the prospect says "Current system is fine," the Rep must Challenge the Status Quo by citing the cost of opacity/hidden fees.
- Value Connection: Rep must connect features to business outcomes (Total Net Cost, Fiduciary value), not just list capabilities.

SALES SIGNALS TO IDENTIFY
- Prospect asks about pricing or next steps
- Questions about implementation or onboarding
- Mentions internal discussions or stakeholders
- Asks "how does this work with..." scenarios
- Shows concern about current solution failures
- Discusses budget cycles or approval processes

COMMON OBJECTIONS TO WATCH FOR
- Price objections ("too expensive", "not in budget")
- Timing objections ("not right now", "revisit next quarter")
- Authority objections ("need to talk to my boss/team")
- Competition objections ("looking at other options")
- Status quo bias ("current solution works fine")

KEY AREAS TO TRACK (BANT)
Only trigger BANT coaching after significant context is gathered (extensive conversation has taken place). Coaching around BANT should be reminders when an opportunity to clarify one of BANT's criteria was clearly missed. Limit 1 BANT coaching message per conversation.

- Budget: Have they discussed Total Net Cost vs. current spend?
- Authority: Is the CFO or HR decision-maker involved? Who controls PBM buying decisions?
- Need: Have they admitted that opacity/service issues are hurting them? Have pain points been quantified?
- Timeline: When does their current PBM contract expire? Pin down exact deadline.

RESOURCE LIBRARY (TRIGGER THESE PRECISELY)

Trigger: Conversation touches on PBM/Pharma industry adoption/case studies.
Message: RESOURCE: Send PBM Case Study: https://drive.google.com/file/d/19gCMCFetqEMCB8T7bbrzU63i1RxPzvgY/view?usp=sharing

Trigger: Conversation touches on Women's Health impact/initiatives.
Message: RESOURCE: Send Women's Health Impact: https://drive.google.com/file/d/1G0jkG4CvjHNt5jmvfD5NbnYEERWMoFPJ/view?usp=drive_link

Trigger: Conversation touches on Large Employer potential impact/briefs.
Message: RESOURCE: Send Large Employer Brief: https://drive.google.com/file/d/18edpwZqzRPoNsJbEzsra-M8awFofA-lo/view?usp=drive_link

IMPORTANT: Send the entirety of the link in your coaching message when required.

WHEN TO SEND COACHING MESSAGES
When coaching, reference specific moments from earlier in the call to show what's missing.

Send when:
- Prospect raises an objection but rep doesn't address it (check KB Categories 2-7)
- Clear buying signal appears but rep misses it
- Rep is talking features without connecting to prospect's pain (Total Net Cost, Fiduciary value)
- Timeline discussion is vague or missing
- Prospect asks about price before value is clearly established
- User is sharing price before value is clearly established
- Conversation nears end without clear next steps
- Prospect mentions a blocker or opportunity but rep doesn't probe deeper

WHEN NOT TO SEND (STRICT FILTERS)
1. Rapport Building: Do not send messages during the first 3 minutes of intro/small talk.
2. Active Speaking: Do not send if the Rep is currently speaking (distraction risk).
3. Redundancy: Do not send if the Rep has already successfully addressed the point.
4. Recent Nudge: Do not send if you sent a message less than 20 seconds ago.
5. Flow State: Do not send if the conversation is moving positively and quickly.
6. Rep Handling Well: Do not send if the Rep is already handling the moment well according to the Knowledge Base.

YOUR COACHING STYLE
- Send to sales rep ONLY (never visible to prospect)
- Be ultra-brief and immediately actionable (<15 words core message)
- Each message must reference the specific context from the conversation (keep it brief)
- Structure: [TYPE PREFIX]: [What triggered this] + [What to do about it]
- Use the prospect's actual words or situation when coaching
- Focus on what to do next, not what was missed

RESPONSE PRIORITIES (Coach in this order)
1. Poor questioning technique (discovery happens FIRST - get this right or everything fails)
2. Premature demos/pitching (stop feature dumps before they derail discovery)
3. Missed drill-down opportunities (go deeper on pain during discovery phase)
4. Missed Objections (Use KB Categories 2-7 - apply specific reframes)
5. Resource Triggers (Exact links only when conversation matches trigger)
6. Missing BANT elements (qualify after understanding their situation)
7. Weak value connection (tie solution to Total Net Cost or Fiduciary status)
8. Missed buying signals (strike while hot - these emerge mid-to-late call)

EXAMPLE COACHING MESSAGES (CONTEXTUALIZED)

Objection Handling (Derived from KB)
OBJECTION: Reframe to Total Net Cost. Admin fees mask hidden profits.
OBJECTION: Guarantee Zero-Disruption. Mention we mirror their current formulary.
OBJECTION: Cite NPS of 65 vs Industry 6. We have experts, not call centers.
OBJECTION: Counter with Master Plans for GLP-1s. Generic edits fail.
OBJECTION: We aren't new. Cite 15 years experience and $500M capital.
OBJECTION: Mention Fiduciary status. We are contractually obligated to save money.
OBJECTION: Pitch Connected Specialty Care Network. 100+ independent pharmacies, not mail-order.

Buying Signals
SIGNAL: Implementation worry. Pitch Zero-Disruption Transition Guarantee.
SIGNAL: They're pricing. Ask budget for solving their Total Net Cost problem.
SIGNAL: CFO involvement mentioned. Map approval chain, prep ROI showing savings.
SIGNAL: Asking about onboarding. They're ready—confirm timeline and decision-makers.

BANT Gaps
BANT: Budget unclear. Ask about current spend vs. Total Net Cost.
BANT: Authority unclear. Who controls PBM buying decisions at their company?
BANT: Pain confirmed but not quantified. Calculate their hidden rebate costs.
BANT: Timeline vague. Pin down exact deadline tied to contract renewal.

Methodology Gaps
GAP: Stop pitching. Ask: "How does that hidden cost impact your bottom line?"
GAP: Challenge them. "Fine" is losing money. Ask about audit rights.
GAP: Stop feature dumping. Connect Transparency to their audit rights.
GAP: You missed "manual entry." Ask how that impacts team efficiency.
GAP: Surface answer. Drill deeper: "Walk me through what happens when..."
GAP: Feature list mode. Tie back to their Fiduciary concerns mentioned earlier.

IMPORTANT REMINDERS
- You're coaching the sales rep, not conducting the sales call yourself
- You have full context across all batches, so coach strategically based on where the conversation is in its lifecycle
- Silence is better than noise - only intervene when the rep misses a critical moment
- Message content should be <15 words (excluding resource links)
- Focus on what's MISSING from the conversation based on KB
- Only message when the Rep misses the moment - if they're handling it well, stay silent`;

// ============================================
// Function Definitions for Gemini
// ============================================
const functions = [
  {
    name: 'send_message',
    description: 'Send a PRIVATE coaching message to the sales rep (host) when they miss opportunities like objections, buying signals, or qualification gaps. Use this to guide them toward better sales outcomes.',
    parameters: {
      type: 'object',
      properties: {
        participant_id: {
          type: 'string',
          description: 'The ID of the SALES REP (host) to send the coaching message to. NEVER send to the prospect.'
        },
        participant_name: {
          type: 'string',
          description: 'The name of the sales rep (host) receiving the coaching'
        },
        message: {
          type: 'string',
          description: 'Detailed coaching message (3-5 sentences) providing context, specific recommendations, and reasoning. Structure: 1) What you noticed, 2) What\'s missing/opportunity, 3) Specific question to ask, 4) Why it matters. Example: "They mentioned slow follow-up costing them deals, but you haven\'t quantified the pain yet. This is a strong buying signal. Ask: \'How many deals do you estimate you lose monthly due to slow follow-up?\' This will help you calculate ROI and create urgency."'
        },
        reason: {
          type: 'string',
          description: 'What opportunity or gap triggered this coaching? Examples: "Missed buying signal" or "Price objection not addressed" or "No BANT qualification yet"'
        }
      },
      required: ['participant_id', 'participant_name', 'message', 'reason']
    }
  }
];

// ============================================
// Slack Thread Manager
// ============================================
class SlackThreadManager {
  constructor(channelId) {
    this.channelId = channelId;
    this.threadTs = null;
    this.nudgeCount = 0;
    this.sessionStartTime = null;
  }

  async startSessionThread(sessionInfo) {
    try {
      const { memberName, meetingTitle, platform, botType, startTime } = sessionInfo;
      this.sessionStartTime = Date.now();

      console.log('📤 Creating Slack thread for new session...');

      const response = await slackClient.chat.postMessage({
        channel: this.channelId,
        text: `🎯 ${memberName} started: ${meetingTitle}`,
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: `🎯 ${meetingTitle}`,
              emoji: true
            }
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Member:*\n${memberName}` },
              { type: 'mrkdwn', text: `*Platform:*\n${platform}` },
              { type: 'mrkdwn', text: `*Bot Type:*\n${botType}` },
              { type: 'mrkdwn', text: `*Started:*\n${startTime}` }
            ]
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: '💬 Live coaching messages will appear as replies to this thread'
              }
            ]
          }
        ]
      });

      this.threadTs = response.ts;
      console.log(`✅ Slack thread created! Thread ID: ${this.threadTs}`);
      return this.threadTs;

    } catch (error) {
      console.error('❌ Error creating Slack thread:', error.message);
      throw error;
    }
  }

  async sendCoachingReply(coachingData) {
    if (!this.threadTs) {
      console.error('⚠️ No active Slack thread');
      return;
    }

    try {
      this.nudgeCount++;
      const { timestamp, reason, message, batchNumber, messagesAnalyzed } = coachingData;

      console.log(`📤 Sending coaching nudge #${this.nudgeCount} to Slack thread...`);

      await slackClient.chat.postMessage({
        channel: this.channelId,
        thread_ts: this.threadTs,
        text: `💡 Nudge #${this.nudgeCount}: ${message}`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*💡 Nudge #${this.nudgeCount}* (${timestamp})\n\n*${reason}*\n${message}`
            }
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `Powered by Nimo`
              }
            ]
          },
          { type: 'divider' }
        ]
      });

      console.log(`✅ Coaching nudge #${this.nudgeCount} sent to Slack!`);

    } catch (error) {
      console.error('❌ Error sending Slack coaching reply:', error.message);
    }
  }

  async endSessionThread() {
    if (!this.threadTs) {
      console.error('⚠️ No active Slack thread to end');
      return;
    }

    try {
      const duration = Math.round((Date.now() - this.sessionStartTime) / 60000);
      const endTime = new Date().toLocaleTimeString();

      console.log('📤 Ending Slack session thread...');

      await slackClient.chat.postMessage({
        channel: this.channelId,
        thread_ts: this.threadTs,
        text: `✅ Session ended - ${duration} min, ${this.nudgeCount} nudges`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*✅ Session Ended*'
            }
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Duration:*\n${duration} minutes` },
              { type: 'mrkdwn', text: `*Ended:*\n${endTime}` },
              { type: 'mrkdwn', text: `*Total Nudges:*\n${this.nudgeCount}` }
            ]
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: '📝 Review the thread above for all coaching insights'
              }
            ]
          }
        ]
      });

      console.log('✅ Slack session thread ended!');
      this.threadTs = null;
      this.nudgeCount = 0;

    } catch (error) {
      console.error('❌ Error ending Slack thread:', error.message);
    }
  }
}

// ============================================
// SMS Manager Class - Twilio Integration
// ============================================
class SMSManager {
  constructor(phoneNumbers, messagingServiceSid) {
    this.phoneNumbers = phoneNumbers || [];
    this.messagingServiceSid = messagingServiceSid;
    this.nudgeCount = 0;
    this.sessionStartTime = Date.now();
    this.sessionActive = false;
    console.log(`📱 SMS Manager initialized for ${this.phoneNumbers.length} phone number(s)`);
  }

  async startSession(sessionInfo) {
    if (!twilioClient || this.phoneNumbers.length === 0) {
      console.log('⚠️  SMS: No Twilio client or phone numbers configured');
      return;
    }

    try {
      this.sessionActive = true;
      const { memberName, meetingTitle, platform, botType, startTime } = sessionInfo;
      
      const startMessage = `Nimo Live Nudges - Session Started

Rep: ${memberName || 'Sales Rep'}
Meeting: ${meetingTitle || 'Sales Call'}
Platform: ${platform || 'Unknown'}
Started: ${startTime}

You'll receive live coaching nudges via SMS during this call.

Learn more about Nimo: https://getnimo.com`;

      console.log(`📤 Sending session start SMS to ${this.phoneNumbers.length} number(s)...`);

      // Send to all phone numbers
      const sendPromises = this.phoneNumbers.map(phoneNumber => 
        this.sendSMS(phoneNumber, startMessage)
      );

      await Promise.all(sendPromises);
      console.log(`✅ Session start SMS sent to all numbers!`);

    } catch (error) {
      console.error('❌ Error starting SMS session:', error.message);
      throw error;
    }
  }

  async sendCoachingNudge(coachingData) {
    if (!twilioClient || this.phoneNumbers.length === 0 || !this.sessionActive) {
      console.log('⚠️  SMS: Not active or not configured');
      return;
    }

    try {
      this.nudgeCount++;
      const { timestamp, reason, message, batchNumber } = coachingData;

      const smsMessage = `Nimo Nudge #${this.nudgeCount} (${timestamp})

Reason: ${reason}

Coaching: ${message}

---
Powered by Nimo`;

      console.log(`📤 Sending coaching nudge #${this.nudgeCount} via SMS to ${this.phoneNumbers.length} number(s)...`);

      // Send to all phone numbers
      const sendPromises = this.phoneNumbers.map(phoneNumber => 
        this.sendSMS(phoneNumber, smsMessage)
      );

      await Promise.all(sendPromises);
      console.log(`✅ Coaching nudge #${this.nudgeCount} sent via SMS to all numbers!`);

    } catch (error) {
      console.error('❌ Error sending SMS coaching nudge:', error.message);
    }
  }

  async endSession() {
    if (!twilioClient || this.phoneNumbers.length === 0 || !this.sessionActive) {
      console.log('⚠️  SMS: No active session to end');
      return;
    }

    try {
      const duration = Math.round((Date.now() - this.sessionStartTime) / 60000);
      const endTime = new Date().toLocaleTimeString();

      const endMessage = `Nimo Live Nudges - Session Ended

Duration: ${duration} minutes
Total Nudges: ${this.nudgeCount}
Ended: ${endTime}

Review the coaching insights above for call improvement.

Elevate your sales training with Nimo: https://getnimo.com`;

      console.log('📤 Ending SMS session...');

      // Send to all phone numbers
      const sendPromises = this.phoneNumbers.map(phoneNumber => 
        this.sendSMS(phoneNumber, endMessage)
      );

      await Promise.all(sendPromises);
      console.log('SMS session ended!');
      
      this.sessionActive = false;
      this.nudgeCount = 0;

    } catch (error) {
      console.error('❌ Error ending SMS session:', error.message);
    }
  }

  // Helper method to send individual SMS
  async sendSMS(phoneNumber, message) {
    try {
      const result = await twilioClient.messages.create({
        messagingServiceSid: this.messagingServiceSid,
        body: message,
        to: phoneNumber
      });
      console.log(`SMS sent to ${phoneNumber} | SID: ${result.sid}`);
      return result;
    } catch (error) {
      console.error(`❌ Failed to send SMS to ${phoneNumber}:`, error.message);
      throw error;
    }
  }
}

// ============================================
// AI Agent Class - Sales Coach
// ============================================
class AIAgent {
  constructor(botId, meetingUrl, phoneNumbers = [], frequencyConfig = { mode: 'frequency', level: 'medium' }, salesRepName = null) {
    this.botId = botId;
    this.meetingUrl = meetingUrl;
    this.phoneNumbers = phoneNumbers;
    this.salesRepName = salesRepName; // User-specified sales rep name (optional)
    this.conversationHistory = [];
    this.interviewerId = null;
    this.interviewerName = null;
    this.questionsAsked = new Set(); // Track what was asked
    this.lastCoachingTime = null;
    
    // Batching configuration - dynamic based on frequency settings
    this.transcriptBuffer = [];
    this.frequencyConfig = frequencyConfig;
    this.timeBasedInterval = null; // Timer for time-based mode
    
    // Set buffer size based on mode
    if (frequencyConfig.mode === 'frequency') {
      const levels = { high: 10, medium: 20, low: 30 };
      this.batchSize = levels[frequencyConfig.level] || 20;
      console.log(`📊 Frequency Mode: ${frequencyConfig.level.toUpperCase()} (${this.batchSize} messages per batch)`);
    } else if (frequencyConfig.mode === 'time') {
      this.batchSize = 9999; // Large number, won't trigger by count
      this.timeIntervalMinutes = frequencyConfig.minutes;
      console.log(`⏱️  Time-based Mode: Every ${this.timeIntervalMinutes} minute(s)`);
      
      // Start time-based interval
      this.startTimeBasedFlushing();
    }
    
    this.batchCount = 0; // Track how many batches have been analyzed
    
    // Initialize integration managers for all enabled platforms
    this.slackThread = null;
    if (INTEGRATION_MODES.includes('SLACK') && slackClient) {
      this.slackThread = new SlackThreadManager(SLACK_CHANNEL_ID);
      console.log('Slack integration initialized');
    }
    
    this.smsManager = null;
    if (INTEGRATION_MODES.includes('SMS') && twilioClient && phoneNumbers.length > 0) {
      this.smsManager = new SMSManager(phoneNumbers, TWILIO_MESSAGING_SERVICE_SID);
      console.log('SMS integration initialized');
    }
    
    // TODO: Initialize Teams manager when TEAMS is in integration modes
    // this.teamsThread = null;
    // if (INTEGRATION_MODES.includes('TEAMS') && teamsClient) {
    //   this.teamsThread = new TeamsThreadManager(...);
    // }
    
    this.model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash-exp',
      systemInstruction: SYSTEM_PROMPT,
      tools: [{ functionDeclarations: functions }]
    });
    this.chat = this.model.startChat({
      history: [],
    });
    console.log('💼 AI Sales Coach initialized for bot:', botId);
    console.log(`📊 Integration Modes: ${INTEGRATION_MODES.join(', ')}`);
    if (this.salesRepName) {
      console.log(`👔 Sales Rep Identification: By name "${this.salesRepName}" (not by host)`);
    } else {
      console.log(`👔 Sales Rep Identification: Meeting host (default)`);
    }
    if (this.frequencyConfig.mode === 'frequency') {
      console.log(`📊 Batching: Analyzing every ${this.batchSize} messages (AI maintains full conversation context)`);
    }
  }
  
  startTimeBasedFlushing() {
    // Flush buffer every N minutes for time-based mode
    const intervalMs = this.timeIntervalMinutes * 60 * 1000;
    
    this.timeBasedInterval = setInterval(async () => {
      if (this.transcriptBuffer.length > 0) {
        console.log(`⏰ Time-based flush triggered (${this.timeIntervalMinutes} min interval)`);
        await this.analyzeBatch();
      } else {
        console.log(`⏰ Time interval reached but no transcripts to analyze yet`);
      }
    }, intervalMs);
    
    console.log(`⏱️  Time-based flushing started: Every ${this.timeIntervalMinutes} minute(s)`);
  }
  
  stopTimeBasedFlushing() {
    if (this.timeBasedInterval) {
      clearInterval(this.timeBasedInterval);
      this.timeBasedInterval = null;
      console.log('⏱️  Time-based flushing stopped');
    }
  }
  
  async initializeSlackThread(memberName) {
    if (this.slackThread && !this.slackThread.threadTs) {
      try {
        await this.slackThread.startSessionThread({
          memberName: memberName || 'Sales Rep',
          meetingTitle: this.extractMeetingTitle(this.meetingUrl),
          platform: this.detectPlatform(this.meetingUrl),
          botType: 'Sales Coach',
          startTime: new Date().toLocaleTimeString()
        });
      } catch (error) {
        console.error('❌ Failed to initialize Slack thread:', error.message);
      }
    }
  }
  
  extractMeetingTitle(url) {
    // Extract meeting title from URL or use default
    if (url.includes('zoom.us')) return 'Zoom Sales Call';
    if (url.includes('meet.google.com')) return 'Google Meet Sales Call';
    if (url.includes('teams.microsoft.com')) return 'Teams Sales Call';
    return 'Sales Call';
  }
  
  detectPlatform(url) {
    if (url.includes('zoom.us')) return 'Zoom';
    if (url.includes('meet.google.com')) return 'Google Meet';
    if (url.includes('teams.microsoft.com')) return 'Microsoft Teams';
    return 'Unknown Platform';
  }
  
  async setInterviewer(name, id) {
    if (!this.interviewerId) {
      this.interviewerId = id;
      this.interviewerName = name;
      console.log(`👔 Interviewer identified: ${name} (ID: ${id})`);
      
      // Initialize Slack thread when interviewer joins (if Slack is enabled)
      // Run in background to avoid blocking webhook response
      if (INTEGRATION_MODES.includes('SLACK') && this.slackThread) {
        this.initializeSlackThread(name).catch(err => {
          console.error('❌ Failed to initialize Slack thread:', err.message);
        });
      }
      
      // Initialize SMS session when interviewer joins (if SMS is enabled)
      // Run in background to avoid blocking webhook response
      if (INTEGRATION_MODES.includes('SMS') && this.smsManager) {
        this.smsManager.startSession({
          memberName: name || 'Sales Rep',
          meetingTitle: this.extractMeetingTitle(this.meetingUrl),
          platform: this.detectPlatform(this.meetingUrl),
          botType: 'Sales Coach',
          startTime: new Date().toLocaleTimeString()
        }).catch(err => {
          console.error('❌ Failed to start SMS session:', err.message);
        });
      }
    }
  }

  async processTranscript(speaker, participantId, isHost, text) {
    try {
      // Identify sales rep based on mode
      if (!this.interviewerId) {
        if (this.salesRepName) {
          // Mode 1: Identify by name match (case-insensitive, partial match)
          const speakerLower = speaker.toLowerCase();
          const salesRepLower = this.salesRepName.toLowerCase();
          if (speakerLower.includes(salesRepLower) || salesRepLower.includes(speakerLower)) {
            this.setInterviewer(speaker, participantId);
            console.log(`✅ Sales rep identified by name match: "${speaker}" matches "${this.salesRepName}"`);
          }
        } else {
          // Mode 2: Identify by host (default/fallback)
          if (isHost) {
            this.setInterviewer(speaker, participantId);
            console.log(`✅ Sales rep identified as meeting host: "${speaker}"`);
          }
        }
      }
      
      // Role assignment: check if this speaker is the identified sales rep
      const isSalesRep = (this.interviewerId && participantId === this.interviewerId);
      const role = isSalesRep ? 'SALES REP' : 'PROSPECT';
      const transcriptEntry = { role, speaker, text, timestamp: Date.now() };
      
      // Add to conversation history
      this.conversationHistory.push(transcriptEntry);
      
      // Add to buffer for batching
      this.transcriptBuffer.push(`[${role} - ${speaker}]: ${text}`);
      
      const bufferLength = this.transcriptBuffer.length;
      console.log(`📝 Buffered: ${bufferLength}/${this.batchSize}`);
      
      // ONLY analyze when buffer reaches exactly batchSize
      if (bufferLength >= this.batchSize) {
        console.log(`\n🧠 AI Coach analyzing batch #${this.batchCount + 1} (${bufferLength} transcripts)...`);
        await this.analyzeBatch();
      }
      
    } catch (error) {
      console.error('❌ AI processing error:', error.message);
    }
  }
  
  async analyzeBatch() {
    if (this.transcriptBuffer.length === 0) return;
    
    try {
      this.batchCount++; // Increment batch counter
      
      // Store buffer size before clearing
      const messagesInBatch = this.transcriptBuffer.length;
      
      // Combine buffered transcripts into one message
      const batchMessage = this.transcriptBuffer.join('\n');
      
      // Clear buffer and reset for next batch
      this.transcriptBuffer = [];
      
      console.log(`📊 Batch #${this.batchCount} | Messages in batch: ${messagesInBatch} | Total messages so far: ${this.conversationHistory.length}`);
      
      // Send batch to Gemini for analysis
      const result = await this.chat.sendMessage(batchMessage);
      const response = result.response;
      
      // Check if AI wants to call a function (coach the sales rep)
      const functionCall = response.functionCalls()?.[0];
      
      if (functionCall) {
        console.log('🎯 AI Coach taking action:', functionCall.name);
        console.log('📋 Coaching details:', JSON.stringify(functionCall.args, null, 2));
        
        if (functionCall.name === 'send_message') {
          const { participant_id, participant_name, message, reason } = functionCall.args;
          
          console.log(`💡 Opportunity: ${reason}`);
          console.log(`🔍 AI wants to send to: ${participant_name} (ID: ${participant_id})`);
          console.log(`🔍 Sales Rep is: ${this.interviewerName} (ID: ${this.interviewerId})`);
          
          // ALWAYS send to sales rep only (force override)
          if (this.interviewerId) {
            console.log(`✅ Sending coaching to sales rep: ${this.interviewerName}`);
            
            // Track coaching time
            this.lastCoachingTime = Date.now();
            
            // Send to ALL enabled platforms
            const sendPromises = [];
            
            // Send to Slack if enabled
            if (INTEGRATION_MODES.includes('SLACK') && this.slackThread) {
              console.log('📤 Sending to Slack...');
              sendPromises.push(
                this.slackThread.sendCoachingReply({
                  timestamp: new Date().toLocaleTimeString(),
                  reason: reason,
                  message: message,
                  batchNumber: this.batchCount,
                  messagesAnalyzed: messagesInBatch
                }).catch(err => {
                  console.error('❌ Slack send failed:', err.message);
                })
              );
            }
            
            // Send to Zoom DM if enabled
            if (INTEGRATION_MODES.includes('ZOOM_DM')) {
              console.log('📤 Sending to Zoom DM...');
              sendPromises.push(
                sendPrivateChatMessage(this.botId, this.interviewerId, message)
                  .catch(err => {
                    console.error('❌ Zoom DM send failed:', err.message);
                  })
              );
            }
            
            // Send to SMS if enabled
            if (INTEGRATION_MODES.includes('SMS') && this.smsManager) {
              console.log('📤 Sending to SMS...');
              sendPromises.push(
                this.smsManager.sendCoachingNudge({
                  timestamp: new Date().toLocaleTimeString(),
                  reason: reason,
                  message: message,
                  batchNumber: this.batchCount,
                  messagesAnalyzed: messagesInBatch
                }).catch(err => {
                  console.error('❌ SMS send failed:', err.message);
                })
              );
            }
            
            // Send to Teams if enabled (TODO: Implement Teams integration)
            if (INTEGRATION_MODES.includes('TEAMS') && this.teamsThread) {
              console.log('📤 Sending to Teams...');
              sendPromises.push(
                this.teamsThread.sendCoachingReply({
                  timestamp: new Date().toLocaleTimeString(),
                  reason: reason,
                  message: message,
                  batchNumber: this.batchCount,
                  messagesAnalyzed: messagesInBatch
                }).catch(err => {
                  console.error('❌ Teams send failed:', err.message);
                })
              );
            }
            
            // Wait for all platforms to complete
            await Promise.all(sendPromises);
            console.log(`✅ Coaching sent to ${sendPromises.length} platform(s)`);
            
            console.log('✅ Coaching delivered!\n');
          } else {
            console.log('⚠️  No sales rep identified yet - skipping message');
          }
        }
      } else {
        // AI decided not to coach yet
        const aiThought = response.text();
        if (aiThought && aiThought.length > 0) {
          console.log('🤔 Coach thinking:', aiThought.substring(0, 50));
        } else {
          console.log('👂 Monitoring...');
        }
      }
      
    } catch (error) {
      console.error('❌ AI batch analysis error:', error.message);
      // Clear buffer on error to prevent stuck state
      this.transcriptBuffer = [];
    }
  }

  async flushBuffer() {
    // Stop time-based flushing if active
    this.stopTimeBasedFlushing();
    
    // Analyze any remaining transcripts when session ends
    if (this.transcriptBuffer.length > 0) {
      console.log(`🔄 Flushing ${this.transcriptBuffer.length} remaining transcripts...`);
      await this.analyzeBatch();
    }
    
    // End sessions on all active platforms
    const endPromises = [];
    
    // End Slack thread if active
    if (INTEGRATION_MODES.includes('SLACK') && this.slackThread && this.slackThread.threadTs) {
      console.log('🔚 Ending Slack thread...');
      endPromises.push(
        this.slackThread.endSessionThread().catch(err => {
          console.error('❌ Failed to end Slack thread:', err.message);
        })
      );
    }
    
    // End SMS session if active
    if (INTEGRATION_MODES.includes('SMS') && this.smsManager && this.smsManager.sessionActive) {
      console.log('🔚 Ending SMS session...');
      endPromises.push(
        this.smsManager.endSession().catch(err => {
          console.error('❌ Failed to end SMS session:', err.message);
        })
      );
    }
    
    // End Teams thread if active (TODO: Implement when Teams integration is ready)
    if (INTEGRATION_MODES.includes('TEAMS') && this.teamsThread && this.teamsThread.threadId) {
      console.log('🔚 Ending Teams thread...');
      endPromises.push(
        this.teamsThread.endSessionThread().catch(err => {
          console.error('❌ Failed to end Teams thread:', err.message);
        })
      );
    }
    
    await Promise.all(endPromises);
    if (endPromises.length > 0) {
      console.log(`✅ Ended sessions on ${endPromises.length} platform(s)`);
    }
  }

  getConversationSummary() {
    return this.conversationHistory.slice(-10); // Last 10 messages
  }
}

// ============================================
// ROUTE 1: Start Bot
// ============================================
app.post('/api/start-bot', async (req, res) => {
  const { meeting_url, phone_numbers, frequency_config, sales_rep_name } = req.body;

  if (!meeting_url) {
    return res.status(400).json({ error: 'meeting_url is required' });
  }

  // Parse phone numbers (can be array or comma-separated string)
  let phoneNumbersArray = [];
  if (phone_numbers) {
    if (Array.isArray(phone_numbers)) {
      phoneNumbersArray = phone_numbers;
    } else if (typeof phone_numbers === 'string') {
      phoneNumbersArray = phone_numbers.split(',').map(num => num.trim()).filter(num => num);
    }
  }
  
  // Parse frequency config (default to medium if not provided)
  const frequencyConfig = frequency_config || { mode: 'frequency', level: 'medium' };
  
  // Parse sales rep name (optional)
  const salesRepName = sales_rep_name ? sales_rep_name.trim() : null;

  console.log('📞 Starting bot for:', meeting_url);
  if (salesRepName) {
    console.log(`👔 Sales Rep: ${salesRepName} (will identify by name)`);
  } else {
    console.log(`👔 Sales Rep: Meeting host (default)`);
  }
  if (phoneNumbersArray.length > 0) {
    console.log('📱 SMS notifications will be sent to:', phoneNumbersArray.join(', '));
  }
  if (frequencyConfig.mode === 'frequency') {
    console.log(`🎚️  Frequency: ${frequencyConfig.level}`);
  } else {
    console.log(`⏱️  Time-based: Every ${frequencyConfig.minutes} minute(s)`);
  }

  const webhookUrl = `${process.env.WEBHOOK_BASE_URL}/api/webhook?secret=${process.env.WEBHOOK_SECRET}`;

  try {
    const response = await fetch(`https://${process.env.RECALL_REGION}.recall.ai/api/v1/bot/`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${process.env.RECALL_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        meeting_url,
        bot_name: 'Nimo',
        recording_config: {
          transcript: {
            provider: {
              meeting_captions: {}
            }
          },
          realtime_endpoints: [{
            type: 'webhook',
            url: webhookUrl,
            events: ['transcript.data', 'transcript.partial_data']
          }]
        }
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(JSON.stringify(data));
    }

    // Initialize session with AI agent (include phone numbers, frequency config, and sales rep name)
    sessions.set(data.id, {
      botId: data.id,
      meetingUrl: meeting_url,
      phoneNumbers: phoneNumbersArray,
      frequencyConfig: frequencyConfig,
      salesRepName: salesRepName,
      transcripts: [],
      aiAgent: new AIAgent(data.id, meeting_url, phoneNumbersArray, frequencyConfig, salesRepName)
    });

    console.log('✅ Bot created:', data.id);
    console.log('🎓 AI Recruiting Coach activated and ready!');
    res.json({ success: true, bot_id: data.id, phone_numbers: phoneNumbersArray });

  } catch (error) {
    console.error('❌ Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ROUTE 2: Webhook Handler
// ============================================
app.post('/api/webhook', (req, res) => {
  if (req.query.secret !== process.env.WEBHOOK_SECRET) {
    return res.status(401).send('Unauthorized');
  }

  res.status(200).send('OK');

  setImmediate(async () => {
    const { event, data } = req.body;
    if (!event || !data) return;

    const botId = data.bot?.id;
    const session = sessions.get(botId);
    
    if (!session) {
      console.log('⚠️  No session found for bot:', botId);
      return;
    }

    // Handle transcript events
    if (event === 'transcript.data' || event === 'transcript.partial_data') {
      const transcript = data.data;
      
      if (!transcript) {
        console.log('⚠️  No transcript data');
        return;
      }

      // Only process final transcripts
      if (event === 'transcript.partial_data') {
        return;
      }

      // Extract speaker info from participant object
      const speaker = transcript.participant?.name || 'Unknown';
      const participantId = transcript.participant?.id;
      const isHost = transcript.participant?.is_host || false;
      
      // Extract text from words array
      let text = '';
      if (Array.isArray(transcript.words)) {
        text = transcript.words.map(w => w.text).join(' ');
      } else if (typeof transcript.words === 'string') {
        text = transcript.words;
      }

      // Determine actual role based on AI agent's identification
      let actualRole = 'PROSPECT'; // Default
      let isSalesRep = false;
      
      if (session.aiAgent && session.aiAgent.interviewerId) {
        // If we've already identified the sales rep, check if this is them
        isSalesRep = (participantId === session.aiAgent.interviewerId);
        actualRole = isSalesRep ? 'SALES REP' : 'PROSPECT';
      } else if (isHost && !session.aiAgent.salesRepName) {
        // Fallback: if no name specified and this is the host, assume sales rep
        isSalesRep = true;
        actualRole = 'SALES REP';
      }
      
      const message = {
        speaker: speaker,
        words: text,
        timestamp: new Date().toISOString(),
        isHost: isHost,
        isSalesRep: isSalesRep,
        role: actualRole
      };

      if (message.words) {
        const roleIcon = isSalesRep ? '👔' : '💼';
        console.log(`\n${roleIcon} [${message.speaker}]: ${message.words}`);
        session.transcripts.push(message);
        broadcast({ type: 'transcript', data: message });
        
        // Send to AI Recruiting Coach for analysis
        if (session.aiAgent && participantId) {
          await session.aiAgent.processTranscript(speaker, participantId, isHost, text);
        }
      }
    }

    // Handle participant join events
    if (event === 'participant_events.join') {
      const participant = data.data?.participant;
      if (participant) {
        const roleLabel = participant.is_host ? '(Host)' : '(Participant)';
        console.log(`\n👋 ${participant.name} joined ${roleLabel}`);
        
        // Note: Sales rep identification now happens in processTranscript based on name or host status
        // Don't automatically set as interviewer here anymore
        
        broadcast({ 
          type: 'participant_join', 
          data: { 
            name: participant.name, 
            id: participant.id, 
            isHost: participant.is_host
          }
        });
      }
    }
  });
});

// ============================================
// ROUTE 3: SSE Stream
// ============================================
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.add(res);
  console.log('📡 Client connected. Total:', sseClients.size);

  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  // Send keepalive ping every 15 seconds to prevent timeout
  const keepaliveInterval = setInterval(() => {
    res.write(`: keepalive\n\n`);
  }, 15000);

  req.on('close', () => {
    clearInterval(keepaliveInterval);
    sseClients.delete(res);
    console.log('📡 Client disconnected. Total:', sseClients.size);
  });
});

function broadcast(message) {
  const data = `data: ${JSON.stringify(message)}\n\n`;
  sseClients.forEach(client => client.write(data));
}

// ============================================
// Send Private Chat Message
// ============================================
async function sendPrivateChatMessage(botId, participantId, message) {
  try {
    console.log(`\n📤 === SENDING CHAT MESSAGE ===`);
    console.log(`🤖 Bot ID: ${botId}`);
    console.log(`👤 Participant ID: ${participantId}`);
    console.log(`📝 Message: "${message}"`);
    
    const requestBody = {
      message: message
    };
    
    // Only add 'to' field if we have a participant ID (for private message)
    if (participantId) {
      requestBody.to = String(participantId);
      console.log(`🔒 Mode: PRIVATE message to participant ${participantId}`);
    } else {
      console.log(`📢 Mode: PUBLIC message (no recipient specified)`);
    }
    
    const apiUrl = `https://${process.env.RECALL_REGION}.recall.ai/api/v1/bot/${botId}/send_chat_message/`;
    console.log(`🌐 API URL: ${apiUrl}`);
    console.log(`📦 Request Body:`, JSON.stringify(requestBody, null, 2));
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${process.env.RECALL_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });
    
    console.log(`📡 Response Status: ${response.status} ${response.statusText}`);
    
    if (!response.ok) {
      const errorData = await response.json();
      console.error('❌ API ERROR RESPONSE:', JSON.stringify(errorData, null, 2));
      console.error('❌ Failed to send chat message\n');
      return false;
    } else {
      const successData = await response.json();
      console.log('✅ API SUCCESS RESPONSE:', JSON.stringify(successData, null, 2));
      console.log('✅ Chat message delivered successfully!\n');
      return true;
    }
  } catch (error) {
    console.error('❌ EXCEPTION:', error.message);
    console.error('❌ Stack:', error.stack);
    return false;
  }
}

// ============================================
// ROUTE 4: Get Bot Status (DEBUG)
// ============================================
app.get('/api/bot-status/:botId', async (req, res) => {
  const { botId } = req.params;

  try {
    const response = await fetch(`https://${process.env.RECALL_REGION}.recall.ai/api/v1/bot/${botId}/`, {
      method: 'GET',
      headers: { 'Authorization': `Token ${process.env.RECALL_API_KEY}` }
    });

    const data = await response.json();
    console.log('🤖 Bot Status:', JSON.stringify(data, null, 2));
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ROUTE 5: Get AI Conversation History
// ============================================
app.get('/api/ai-history/:botId', (req, res) => {
  const { botId } = req.params;
  const session = sessions.get(botId);
  
  if (!session || !session.aiAgent) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  res.json({
    bot_id: botId,
    conversation_history: session.aiAgent.getConversationSummary()
  });
});

// ============================================
// ROUTE 6: Stop Bot
// ============================================
app.post('/api/stop-bot/:botId', async (req, res) => {
  const { botId } = req.params;

  try {
    const session = sessions.get(botId);
    
    // Flush any remaining buffered transcripts before stopping
    if (session && session.aiAgent) {
      await session.aiAgent.flushBuffer();
    }
    
    await fetch(`https://${process.env.RECALL_REGION}.recall.ai/api/v1/bot/${botId}/`, {
      method: 'DELETE',
      headers: { 'Authorization': `Token ${process.env.RECALL_API_KEY}` }
    });

    sessions.delete(botId);
    console.log('🛑 Bot stopped:', botId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ROUTE 7: Clear All Sessions
// ============================================
app.post('/api/clear-sessions', async (req, res) => {
  try {
    console.log('🗑️  Clearing all sessions...');
    
    const stopPromises = [];
    
    // Stop all active bots
    for (const [botId, session] of sessions.entries()) {
      console.log(`🛑 Stopping bot: ${botId}`);
      
      // Flush any remaining buffered transcripts
      if (session.aiAgent) {
        stopPromises.push(
          session.aiAgent.flushBuffer().catch(err => {
            console.error(`Error flushing buffer for bot ${botId}:`, err.message);
          })
        );
      }
      
      // Delete bot via Recall API
      stopPromises.push(
        fetch(`https://${process.env.RECALL_REGION}.recall.ai/api/v1/bot/${botId}/`, {
          method: 'DELETE',
          headers: { 'Authorization': `Token ${process.env.RECALL_API_KEY}` }
        }).catch(err => {
          console.error(`Error deleting bot ${botId}:`, err.message);
        })
      );
    }
    
    // Wait for all bots to stop
    await Promise.all(stopPromises);
    
    // Clear sessions map
    const sessionCount = sessions.size;
    sessions.clear();
    
    // Clear SSE clients
    sseClients.clear();
    
    console.log(`✅ Cleared ${sessionCount} session(s)`);
    res.json({ 
      success: true, 
      sessionsCleared: sessionCount,
      message: 'All sessions and bots cleared successfully'
    });
    
  } catch (error) {
    console.error('❌ Error clearing sessions:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Start Server
// ============================================
app.listen(PORT, () => {
  console.log('\n=================================');
  console.log('🎓 AI Sales Coach - NIMO');
  console.log('=================================');
  console.log(`📍 Server: http://localhost:${PORT}`);
  console.log(`🧠 AI Model: Gemini 2.0 Flash`);
  console.log(`📱 Integrations: ${INTEGRATION_MODES.join(', ')}`);
  if (INTEGRATION_MODES.includes('SLACK')) {
    console.log(`💬 Slack Channel: ${SLACK_CHANNEL_ID || 'NOT SET'}`);
  }
  if (INTEGRATION_MODES.includes('TEAMS')) {
    console.log(`💬 Teams: Ready (once configured)`);
  }
  console.log('=================================');
  console.log('⚠️  Update WEBHOOK_BASE_URL with ngrok URL');
  console.log('⚠️  Set GEMINI_API_KEY in .env file');
  if (INTEGRATION_MODES.includes('SLACK')) {
    console.log('⚠️  Set SLACK_BOT_TOKEN and SLACK_CHANNEL_ID');
  }
  if (INTEGRATION_MODES.includes('TEAMS')) {
    console.log('⚠️  Teams integration coming soon!');
  }
  console.log('=================================\n');
});
