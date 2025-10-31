/**
 * NIMO Live Nudges - Microsoft Teams Integration Prototype
 * 
 * This prototype demonstrates:
 * 1. Sending private (1:1) messages to the host/sales rep in Teams
 * 2. Using Bot Framework SDK for proactive messaging
 * 3. Storing conversation references for direct messaging
 * 
 * Prerequisites:
 * 1. Register bot in Azure Portal (get App ID + Password)
 * 2. Enable Teams channel in Azure Bot
 * 3. Create Teams App Manifest and upload to Teams
 * 4. User must "install" or interact with bot once to enable private messaging
 * 
 * Key Differences from Slack:
 * - Slack: Simple threaded messages in a channel (visible to team)
 * - Teams: Private 1:1 messages to individual user (like Zoom DM)
 */

const { BotFrameworkAdapter, TurnContext, CardFactory } = require('botbuilder');

// Initialize Bot Framework Adapter
const adapter = new BotFrameworkAdapter({
  appId: process.env.TEAMS_APP_ID,
  appPassword: process.env.TEAMS_APP_PASSWORD
});

// Error handler
adapter.onTurnError = async (context, error) => {
  console.error('❌ Teams Bot Error:', error);
  await context.sendActivity('Sorry, an error occurred while processing your message.');
};

/**
 * TeamsMessageManager - Manages private messaging to users in Microsoft Teams
 * 
 * IMPORTANT: Unlike Slack threads, Teams uses 1:1 private messages
 * - Each coaching message is sent directly to the sales rep
 * - Messages appear in the bot's personal chat with the user
 * - Similar to Zoom DM experience (private, host-only)
 */
class TeamsMessageManager {
  constructor() {
    this.conversationReferences = new Map(); // Store user conversation refs
    this.nudgeCount = 0;
    this.sessionStartTime = null;
    this.hostUserId = null;
    this.sessionInfo = {};
  }

  /**
   * Store conversation reference when user interacts with bot
   * This MUST happen before we can send proactive messages
   */
  storeConversationReference(activity) {
    const conversationReference = TurnContext.getConversationReference(activity);
    const userId = activity.from.id;
    
    this.conversationReferences.set(userId, conversationReference);
    console.log(`✅ Stored conversation reference for user: ${activity.from.name} (${userId})`);
    
    return userId;
  }

  /**
   * Set the host (sales rep) who will receive coaching messages
   */
  setHost(userId, userName) {
    this.hostUserId = userId;
    console.log(`👔 Host identified: ${userName} (${userId})`);
  }

  /**
   * Start a new coaching session
   * Sends an initial welcome message to the sales rep
   */
  async startSession(sessionInfo) {
    this.sessionInfo = sessionInfo;
    this.sessionStartTime = Date.now();
    this.nudgeCount = 0;

    if (!this.hostUserId) {
      console.error('⚠️ Cannot start session: No host user ID set');
      return;
    }

    const conversationRef = this.conversationReferences.get(this.hostUserId);
    if (!conversationRef) {
      console.error('⚠️ No conversation reference for host. User must interact with bot first.');
      return;
    }

    try {
      const { memberName, meetingTitle, platform, botType, startTime } = sessionInfo;

      // Create Adaptive Card for session start
      const card = CardFactory.adaptiveCard({
        type: 'AdaptiveCard',
        version: '1.4',
        body: [
          {
            type: 'TextBlock',
            text: '🎯 NIMO Live Coach Activated',
            weight: 'Bolder',
            size: 'Large',
            wrap: true
          },
          {
            type: 'FactSet',
            facts: [
              { title: 'Meeting:', value: meetingTitle },
              { title: 'Platform:', value: platform },
              { title: 'Coach Type:', value: botType },
              { title: 'Started:', value: startTime }
            ]
          },
          {
            type: 'TextBlock',
            text: '💬 I\'ll send you private coaching nudges during this call. Only you can see these messages.',
            wrap: true,
            isSubtle: true,
            size: 'Small'
          }
        ]
      });

      // Send proactive message to host
      await adapter.continueConversation(conversationRef, async (context) => {
        await context.sendActivity({ attachments: [card] });
      });

      console.log(`✅ Teams session started for: ${memberName}`);

    } catch (error) {
      console.error('❌ Error starting Teams session:', error.message);
      throw error;
    }
  }

  /**
   * Send coaching message to the sales rep
   * This is the equivalent of Slack's sendCoachingReply
   */
  async sendCoachingMessage(coachingData) {
    if (!this.hostUserId) {
      console.error('⚠️ Cannot send coaching: No host user ID');
      return;
    }

    const conversationRef = this.conversationReferences.get(this.hostUserId);
    if (!conversationRef) {
      console.error('⚠️ No conversation reference for host');
      return;
    }

    try {
      this.nudgeCount++;
      const { reason, message, timestamp, batchNumber, messagesAnalyzed } = coachingData;

      console.log(`📤 Sending coaching nudge #${this.nudgeCount} to Teams...`);

      // Create Adaptive Card for coaching message
      const card = CardFactory.adaptiveCard({
        type: 'AdaptiveCard',
        version: '1.4',
        body: [
          {
            type: 'Container',
            style: 'emphasis',
            items: [
              {
                type: 'ColumnSet',
                columns: [
                  {
                    type: 'Column',
                    width: 'auto',
                    items: [
                      {
                        type: 'TextBlock',
                        text: '💡',
                        size: 'Large'
                      }
                    ]
                  },
                  {
                    type: 'Column',
                    width: 'stretch',
                    items: [
                      {
                        type: 'TextBlock',
                        text: `Nudge #${this.nudgeCount}`,
                        weight: 'Bolder',
                        size: 'Medium'
                      },
                      {
                        type: 'TextBlock',
                        text: timestamp,
                        size: 'Small',
                        isSubtle: true
                      }
                    ]
                  }
                ]
              }
            ]
          },
          {
            type: 'FactSet',
            facts: [
              { title: 'Opportunity:', value: reason },
              { title: 'Batch:', value: `#${batchNumber} (${messagesAnalyzed} messages)` }
            ]
          },
          {
            type: 'Container',
            style: 'accent',
            items: [
              {
                type: 'TextBlock',
                text: '**Coaching:**',
                weight: 'Bolder',
                size: 'Small'
              },
              {
                type: 'TextBlock',
                text: message,
                wrap: true
              }
            ]
          }
        ]
      });

      // Send proactive message to host
      await adapter.continueConversation(conversationRef, async (context) => {
        await context.sendActivity({ attachments: [card] });
      });

      console.log(`✅ Coaching nudge #${this.nudgeCount} sent to Teams!`);

    } catch (error) {
      console.error('❌ Error sending Teams coaching message:', error.message);
    }
  }

  /**
   * End the coaching session with a summary
   */
  async endSession() {
    if (!this.hostUserId) {
      console.error('⚠️ Cannot end session: No host user ID');
      return;
    }

    const conversationRef = this.conversationReferences.get(this.hostUserId);
    if (!conversationRef) {
      console.error('⚠️ No conversation reference for host');
      return;
    }

    try {
      const duration = Math.round((Date.now() - this.sessionStartTime) / 60000);
      const endTime = new Date().toLocaleTimeString();

      console.log('📤 Ending Teams coaching session...');

      // Create summary card
      const card = CardFactory.adaptiveCard({
        type: 'AdaptiveCard',
        version: '1.4',
        body: [
          {
            type: 'TextBlock',
            text: '✅ Coaching Session Ended',
            weight: 'Bolder',
            size: 'Large',
            color: 'Good',
            wrap: true
          },
          {
            type: 'FactSet',
            facts: [
              { title: 'Meeting:', value: this.sessionInfo.meetingTitle },
              { title: 'Duration:', value: `${duration} minutes` },
              { title: 'Ended:', value: endTime },
              { title: 'Total Nudges:', value: this.nudgeCount.toString() }
            ]
          },
          {
            type: 'TextBlock',
            text: '📝 Great work! Review the coaching insights above to improve your next call.',
            wrap: true,
            isSubtle: true
          }
        ]
      });

      // Send proactive message to host
      await adapter.continueConversation(conversationRef, async (context) => {
        await context.sendActivity({ attachments: [card] });
      });

      console.log('✅ Teams coaching session ended!');

      // Reset state
      this.nudgeCount = 0;
      this.sessionStartTime = null;

    } catch (error) {
      console.error('❌ Error ending Teams session:', error.message);
    }
  }

  /**
   * Send a simple text message (for testing)
   */
  async sendSimpleMessage(userId, text) {
    const conversationRef = this.conversationReferences.get(userId);
    if (!conversationRef) {
      console.error('⚠️ No conversation reference for user:', userId);
      return;
    }

    try {
      await adapter.continueConversation(conversationRef, async (context) => {
        await context.sendActivity(text);
      });
      console.log(`✅ Simple message sent to user ${userId}`);
    } catch (error) {
      console.error('❌ Error sending simple message:', error.message);
    }
  }

  /**
   * Get info about stored conversation references
   */
  getInfo() {
    return {
      hostUserId: this.hostUserId,
      nudgeCount: this.nudgeCount,
      sessionActive: this.sessionStartTime !== null,
      storedUsers: Array.from(this.conversationReferences.keys())
    };
  }
}

/**
 * Integration with NIMO Backend (server.js)
 * 
 * Usage pattern:
 */

// Initialize Teams message manager globally
const teamsManager = new TeamsMessageManager();

// Webhook endpoint to receive messages from Teams
// This is REQUIRED for storing conversation references
async function handleTeamsWebhook(req, res) {
  try {
    // Process incoming activity from Teams
    await adapter.processActivity(req, res, async (context) => {
      const activityType = context.activity.type;

      // Store conversation reference when user messages the bot
      if (activityType === 'message') {
        const userId = teamsManager.storeConversationReference(context.activity);
        
        // If this is the first interaction, welcome the user
        if (!teamsManager.conversationReferences.has(userId)) {
          await context.sendActivity('👋 Welcome! I\'m your NIMO Live Coach. I\'ll send you private coaching nudges during your calls.');
        }
        
        // Echo back for testing
        const userMessage = context.activity.text;
        if (userMessage) {
          await context.sendActivity(`You said: ${userMessage}`);
        }
      }

      // Handle bot installation
      if (activityType === 'installationUpdate') {
        if (context.activity.action === 'add') {
          await context.sendActivity('Thanks for installing NIMO Live Coach! I\'m ready to help you improve your sales calls.');
        }
      }

      // Handle conversation updates (user joins/leaves)
      if (activityType === 'conversationUpdate') {
        // Store reference when members are added
        if (context.activity.membersAdded) {
          for (const member of context.activity.membersAdded) {
            if (member.id !== context.activity.recipient.id) {
              teamsManager.storeConversationReference(context.activity);
            }
          }
        }
      }
    });
  } catch (error) {
    console.error('❌ Teams webhook error:', error);
    res.status(500).send('Internal server error');
  }
}

// Example: When coaching session starts (Teams platform detected)
async function onSessionStart(sessionData, orgSettings) {
  // Check if platform is Teams and org has Teams integration
  if (sessionData.platform === 'teams' && orgSettings.teamsIntegration) {
    const { hostUserId } = sessionData;

    // Set the host who will receive coaching
    teamsManager.setHost(hostUserId, sessionData.memberName);

    // Start session and send welcome message
    await teamsManager.startSession({
      memberName: sessionData.memberName,
      meetingTitle: sessionData.meetingTitle,
      platform: 'Microsoft Teams',
      botType: sessionData.botType,
      startTime: new Date().toLocaleTimeString()
    });

    // Store manager in session for later use
    sessionData.teamsManager = teamsManager;

    console.log(`🎯 Teams coaching session started: ${sessionData.id}`);
  }
}

// Example: When AI sends coaching message
async function onCoachingMessage(sessionData, coachingMessage) {
  // Check if we have Teams manager for this session
  if (sessionData.teamsManager) {
    await sessionData.teamsManager.sendCoachingMessage({
      reason: coachingMessage.reason,
      message: coachingMessage.message,
      timestamp: new Date().toLocaleTimeString(),
      batchNumber: coachingMessage.batchNumber,
      messagesAnalyzed: 6 // From batch size
    });

    console.log(`💡 Coaching sent via Teams for session: ${sessionData.id}`);
  } else if (sessionData.slackThread && sessionData.slackThread.threadTs) {
    // Fallback to Slack for non-Zoom platforms
    await sessionData.slackThread.sendCoachingReply({
      nudgeNumber: coachingMessage.nudgeNumber,
      timestamp: new Date().toLocaleTimeString(),
      reason: coachingMessage.reason,
      message: coachingMessage.message,
      batchNumber: coachingMessage.batchNumber,
      messagesAnalyzed: 6
    });
  } else {
    // Zoom platform - use Recall.ai private DM
    await sendPrivateChatMessage(
      sessionData.botId,
      sessionData.hostParticipantId,
      coachingMessage.message
    );
  }
}

// Example: When session ends
async function onSessionEnd(sessionData) {
  if (sessionData.teamsManager) {
    await sessionData.teamsManager.endSession();
    console.log(`✅ Teams coaching session ended: ${sessionData.id}`);
  }
}

/**
 * DEMO: Test the Teams integration
 * 
 * NOTE: This demo won't work without actual Teams setup!
 * You need to:
 * 1. Register bot in Azure
 * 2. Create Teams app manifest
 * 3. Install bot in Teams
 * 4. Have a user interact with the bot first
 */
async function runDemo() {
  console.log('\n🚀 Starting Teams Integration Demo...\n');
  console.log('⚠️  This demo requires a real Teams setup to work.\n');

  // Simulate a user ID (in reality, this comes from Teams activity)
  const mockUserId = 'user123';
  const mockUserName = 'John Doe';

  // In reality, this would be set when user interacts with bot
  console.log('ℹ️  In production: User must message bot first to enable private messaging\n');

  console.log('Demo Flow:');
  console.log('1. User installs NIMO bot in Teams');
  console.log('2. User sends message to bot → stores conversation reference');
  console.log('3. Meeting starts → bot sends welcome message');
  console.log('4. AI analyzes → bot sends coaching nudges');
  console.log('5. Meeting ends → bot sends summary\n');

  console.log('✅ See implementation in TeamsMessageManager class above');
  console.log('✅ See integration examples in onSessionStart/onCoachingMessage/onSessionEnd\n');
}

// Export for use in server.js
module.exports = {
  TeamsMessageManager,
  handleTeamsWebhook,
  onSessionStart,
  onCoachingMessage,
  onSessionEnd,
  adapter
};

// If running directly (node teams-integration-prototype.js)
if (require.main === module) {
  runDemo().catch(console.error);
}



