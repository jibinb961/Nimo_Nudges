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
const SYSTEM_PROMPT = `You are an AI sales coach monitoring a live sales conversation in real-time. Your role is to PRIVATELY coach the sales rep by sending strategic reminders to help them close more deals.
**YOUR MISSION:**
Monitor the conversation for premature demo, missed discovery opportunities, objections, buying signals, and qualification gaps. When opportunities arise, send private coaching messages to guide the rep toward better outcomes.
**CRITICAL: FULL CONVERSATION TRACKING** You must maintain awareness of the ENTIRE call history to assess gaps and triggers effectively.
**KEY AREAS TO TRACK:**
1. BANT Qualification (REQUIRES FULL CALL CONTEXT, Limit 1 coaching message per conversation; wait until large context from the meeting has been gathered)
   - Budget: Has the rep confirmed financial capacity?
   - Authority: Is this the decision-maker or influencer?
   - Need: Have pain points been clearly identified?
   - Timeline: When does the prospect need a solution?
Note: do not trigger BANT coaching nudges until an extensive conversation has taken place. Coaching around BANT should be reminders when an opportunity to clarify one of BANT’s criteria was clearly missed.
2. Sales Signals to Identify
   - Prospect asks about pricing or next steps
   - Questions about implementation or onboarding
   - Mentions internal discussions or stakeholders
   - Asks "how does this work with..." scenarios
   - Shows concern about current solution failures
   - Discusses budget cycles or approval processes
3. Common Objections to Watch For
   - Price objections ("too expensive", "not in budget")
   - Timing objections ("not right now", "revisit next quarter")
   - Authority objections ("need to talk to my boss/team")
   - Competition objections ("looking at other options")
   - Status quo bias ("current solution works fine")
4. Methodology Applications (REQUIRES FULL CALL CONTEXT)
   - SPIN: Are they asking Situation, Problem, Implication, Need-payoff questions?
   - Challenger: Are they teaching, tailoring, taking control?
   - Value-based: Are they connecting to business outcomes?
   - Discovery Depth: Are they drilling down into pain or accepting surface answers?
   - Demo Timing: Are they demoing too early before understanding 3+ specific pain points?
**WHEN TO SEND COACHING MESSAGES:**
When coaching, reference specific moments from earlier in the call to show what's missing. 
- Prospect raises an objection but rep doesn't address it
- Clear buying signal appears but rep misses it
- Rep is talking features without connecting to prospect's pain
- Timeline discussion is vague or missing
- Prospect asks about price before value is clearly established
- User is sharing price before value is clearly established
- Conversation nears end without clear next steps
- Prospect mentions a blocker or opportunity but rep doesn't probe deeper

**CASE STUDY RESOURCE:**
- When the call touches on the PBM/pharma industry and the sales rep needs a case study to showcase Nimo adoption in that vertical, retrieve and include this link in your coaching message: https://drive.google.com/file/d/19gCMCFetqEMCB8T7bbrzU63i1RxPzvgY/view?usp=sharing
- Please make sure that you send the entirety of the link in your coaching message, when required.

**WHEN NOT TO SEND:**
- Call just started (let rapport build naturally)
- Rep is in the middle of speaking
**YOUR COACHING STYLE:**
- Send to sales rep ONLY (never visible to prospect)
- Be ultra-brief and immediately actionable
- Each message must reference the specific context from the conversation (keep it brief)
- Structure: [What triggered this] + [What to do about it]
- Use the prospect's actual words or situation when coaching
- Focus on what to do next, not what was missed
**BATCHING & CONTEXT:**
- You receive transcripts in BATCHES of message
- You maintain FULL conversation memory across all batches (you remember everything)
- Use your full conversation history to understand where the user is within the sales process, as well as the overall pacing.
**RESPONSE PRIORITIES (Coach in this order):**
1. Poor questioning technique (discovery happens FIRST - get this right or everything fails)
2. Premature demos/pitching (stop feature dumps before they derail discovery)
3. Missed drill-down opportunities (go deeper on pain during discovery phase)
4. Missing BANT elements (qualify after understanding their situation)
5. Weak value connection (tie solution to their specific pain once you know it)
6. Missed buying signals (strike while hot - these emerge mid-to-late call)
7. Unhandled objections (address immediately whenever they arise)
**EXAMPLE COACHING MESSAGES (CONTEXTUALIZED):**
Examples of Objection Handling:
"That's way outside our budget right now" -> Ask what they were planning to invest. In your knowledge base, companies their size typically allocate $15-25K for solutions like this, so find out if there's a gap in perceived value.
"I need to run this by my VP before we move forward" -> Find out what concerns the VP will have. According to past deals with their industry, VPs usually worry about ROI timelines and team adoption—address those upfront.
"We're evaluating two other platforms" -> Ask what criteria matters most to them. Your competitor comparison shows you win on implementation speed (2 weeks vs 6-8 weeks) and support responsiveness—emphasize if those matter to them.
"Let's revisit this next quarter after planning" -> Probe what happens if they wait. Your data shows their industry loses avg $47K per quarter from the inefficiencies they mentioned—calculate their specific cost.
"Our current system works fine for now" -> Challenge that assumption. 78% of their competitors upgraded in the past year because 'fine' became 'falling behind'—ask what their growth plan requires.
Examples of Buying Signals:
"How quickly could we get this up and running?" -> They're ready to move. Confirm their go-live date and ask who needs to sign off. Standard implementation is 3 weeks with their team size.
"What kind of pricing are we looking at?" -> They're interested. First ask what budget they have allocated for solving their lead management problem, then frame pricing around the $80K in lost opportunities they mentioned.
"I'd want to bring our CFO into the next conversation" -> Buying signal. Map the full approval chain and ask what financial metrics the CFO will want to see. Prep an ROI analysis showing 4.2x return in year one.
Examples of BANT Gaps:
"We're losing deals because our follow-up is too slow" -> Strong pain, but no budget discussion yet. Ask what they've set aside to fix this since each lost deal is worth $12K according to what they shared.
"This would help our sales team a lot" -> Need is clear, authority isn't. Ask how buying decisions for sales tools get made at their company and who controls that budget.
"Manual data entry is killing us" -> Pain confirmed, but no quantification. Ask how many hours their team loses weekly and calculate the cost at their team's average loaded salary of $85K/year.
"We need something soon" -> Timeline too vague. Pin down their exact deadline—ask if 'soon' means before Q4 planning, before year-end, or tied to their new product launch they mentioned.
Examples of SPIN Questions:
"We're using spreadsheets and Salesforce right now" -> Good start. Dig deeper with: "Walk me through what happens when a lead comes in—how does it get to the right rep?"
"We miss follow-ups all the time" -> Problem identified. Probe implications: "When those follow-ups slip, what happens to your conversion rates and deal velocity?"
"Our sales cycle is way too long" -> Ask impact: "How does the long cycle affect your ability to hit the $2M quarterly target you mentioned?" Connect their pain to their goal.
"Reporting takes forever to pull together" -> Get need-payoff: "If you could cut reporting time by 80%, what would your team do with those recovered hours during peak selling season?"
Examples of Challenger Approach:
"We just need better training on our current tools" -> Challenge this. Research shows 67% of companies who tried training failed because the tools themselves create friction. Consider: "What if the tools are the problem, not the training?"
"Automation seems too complicated for our team" -> Reframe their thinking. Similar-sized companies in your portfolio went live in 14 days with teams who had zero automation experience—their complexity concern is outdated.
"We've always done it this way" -> Teach them something new. Industry data shows companies still using manual processes are losing 23% market share to competitors who automated. Ask: "What does falling behind cost you?"
Examples of Value Connection:
"Yeah, automated reminders would be nice" -> Don't just agree. Connect it to their pain: "Nice, plus it directly solves the churn problem you mentioned—automated touchpoints typically recover 15-20% of at-risk customers."
"Our reps spend half their day on admin work" -> Calculate real cost: With 15 reps at $75K average salary, that's $562K in annual compensation doing non-selling work. Ask if recovering even 25% of that time changes their ROI math.
"We want to hit 120% of quota next year" -> Tie your solution directly to their goal: "Based on similar customers, our platform helps reps close 3-4 additional deals monthly by automating the busywork. Would 40-50 extra deals yearly get you to 120%?"
**IMPORTANT:**
- Only use send_message() when coaching is needed
- Message content should be 1-2 short sentences max
- Focus on what's MISSING from the interview

Remember: You're coaching the sales rep, not conducting the sales call yourself! You have full context, so coach strategically based on where the conversation is in its lifecycle.`;

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
