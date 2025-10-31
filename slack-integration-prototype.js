/**
 * NIMO Live Nudges - Slack Integration Prototype
 * 
 * This prototype demonstrates:
 * 1. Posting initial message when bot joins (with meeting info)
 * 2. Replying to that thread with coaching messages
 * 3. Ending the thread with session summary
 * 
 * Prerequisites:
 * 1. Create Slack App at https://api.slack.com/apps
 * 2. Add OAuth scopes: chat:write, chat:write.public, channels:read
 * 3. Install app to workspace and get Bot Token (xoxb-...)
 * 4. Add bot to your channel: /invite @YourBotName
 */

const { WebClient } = require('@slack/web-api');

// Initialize Slack client
const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

/**
 * SlackThreadManager - Manages threaded messages for coaching sessions
 */
class SlackThreadManager {
  constructor(channelId) {
    this.channelId ="C09NV48GYCB"; // e.g., "C123ABC456" or "#live-nudges"
    this.threadTs = null; // Stores parent message timestamp for threading
    this.messageCount = 0;
  }

  /**
   * Start a new session thread
   * This is called when the bot joins a meeting
   */
  async startSessionThread(sessionInfo) {
    try {
      const { memberName, meetingTitle, platform, botType, startTime } = sessionInfo;

      console.log('📤 Creating Slack thread for new session...');

      // Post initial message with rich formatting (Slack Block Kit)
      const response = await slack.chat.postMessage({
        channel: this.channelId,
        text: `🎯 ${memberName} started: ${meetingTitle}`, // Fallback text
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
              {
                type: 'mrkdwn',
                text: `*Member:*\n${memberName}`
              },
              {
                type: 'mrkdwn',
                text: `*Platform:*\n${platform}`
              },
              {
                type: 'mrkdwn',
                text: `*Bot Type:*\n${botType}`
              },
              {
                type: 'mrkdwn',
                text: `*Started:*\n${startTime}`
              }
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

      // Store thread timestamp - this is the KEY for threading!
      this.threadTs = response.ts;
      console.log(`✅ Session thread created! Thread ID: ${this.threadTs}`);

      return this.threadTs;

    } catch (error) {
      console.error('❌ Error creating session thread:', error.message);
      throw error;
    }
  }

  /**
   * Send coaching message as a reply to the thread
   * This is called each time AI generates a coaching nudge
   */
  async sendCoachingReply(coachingData) {
    if (!this.threadTs) {
      throw new Error('No active thread. Call startSessionThread() first.');
    }

    try {
      const { nudgeNumber, timestamp, reason, message, batchNumber, messagesAnalyzed } = coachingData;

      this.messageCount++;

      console.log(`📤 Sending coaching nudge #${nudgeNumber} to thread...`);

      // Post reply to the thread
      const response = await slack.chat.postMessage({
        channel: this.channelId,
        thread_ts: this.threadTs, // ← THIS is what makes it a reply!
        text: `💡 Nudge #${nudgeNumber}: ${message}`, // Fallback text
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*💡 Nudge #${nudgeNumber}* (${timestamp})`
            }
          },
          {
            type: 'section',
            fields: [
              {
                type: 'mrkdwn',
                text: `*Reason:*\n${reason}`
              },
              {
                type: 'mrkdwn',
                text: `*Batch:*\n#${batchNumber}`
              }
            ]
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Coaching:*\n${message}`
            }
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `📊 Analyzed ${messagesAnalyzed} messages in this batch`
              }
            ]
          },
          {
            type: 'divider'
          }
        ]
      });

      console.log(`✅ Coaching nudge #${nudgeNumber} sent to thread!`);

      return response.ts;

    } catch (error) {
      console.error('❌ Error sending coaching reply:', error.message);
      throw error;
    }
  }

  /**
   * End the session thread with summary
   * This is called when the meeting ends
   */
  async endSessionThread(summary) {
    if (!this.threadTs) {
      throw new Error('No active thread to end.');
    }

    try {
      const { duration, totalNudges, addressed, notAddressed, endTime } = summary;

      console.log('📤 Ending session thread with summary...');

      // Post final summary to thread
      const response = await slack.chat.postMessage({
        channel: this.channelId,
        thread_ts: this.threadTs,
        text: `✅ Session ended - ${duration} min, ${totalNudges} nudges`, // Fallback
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
              {
                type: 'mrkdwn',
                text: `*Duration:*\n${duration} minutes`
              },
              {
                type: 'mrkdwn',
                text: `*Ended:*\n${endTime}`
              },
              {
                type: 'mrkdwn',
                text: `*Total Nudges:*\n${totalNudges}`
              },
              {
                type: 'mrkdwn',
                text: `*Addressed:*\n✅ ${addressed} | ⏸️ ${notAddressed}`
              }
            ]
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: addressed === totalNudges 
                  ? '🎉 All coaching points addressed! Great session!' 
                  : '📝 Some coaching points not addressed - good follow-up opportunity'
              }
            ]
          }
        ]
      });

      console.log('✅ Session thread ended with summary!');

      // Reset thread state
      this.threadTs = null;
      this.messageCount = 0;

      return response.ts;

    } catch (error) {
      console.error('❌ Error ending session thread:', error.message);
      throw error;
    }
  }

  /**
   * Send a simple text reply (for testing or quick updates)
   */
  async sendSimpleReply(text) {
    if (!this.threadTs) {
      throw new Error('No active thread.');
    }

    try {
      const response = await slack.chat.postMessage({
        channel: this.channelId,
        thread_ts: this.threadTs,
        text: text
      });

      return response.ts;

    } catch (error) {
      console.error('❌ Error sending simple reply:', error.message);
      throw error;
    }
  }

  /**
   * Get thread info (for debugging)
   */
  getThreadInfo() {
    return {
      channelId: this.channelId,
      threadTs: this.threadTs,
      messageCount: this.messageCount,
      isActive: this.threadTs !== null
    };
  }
}

/**
 * Integration with NIMO Backend
 * 
 * Usage in server.js:
 */

// Example: When coaching session starts (non-Zoom platform)
async function onSessionStart(sessionData, orgSettings) {
  // Check if platform requires Slack integration
  if (sessionData.platform !== 'zoom' && orgSettings.slackIntegration) {
    const { channelId, botToken } = orgSettings.slackIntegration;

    // Initialize Slack thread manager
    const slackThread = new SlackThreadManager(channelId);

    // Store in session object
    sessionData.slackThread = slackThread;

    // Start thread
    const threadTs = await slackThread.startSessionThread({
      memberName: sessionData.memberName,
      meetingTitle: sessionData.meetingTitle,
      platform: sessionData.platform,
      botType: sessionData.botType,
      startTime: new Date().toLocaleTimeString()
    });

    // Store threadTs in database
    await db.coaching_sessions.update(sessionData.id, {
      slack_thread_ts: threadTs
    });

    console.log(`🎯 Slack thread created for session: ${sessionData.id}`);
  }
}

// Example: When AI sends coaching message
async function onCoachingMessage(sessionData, coachingMessage) {
  // Check if we have active Slack thread
  if (sessionData.slackThread && sessionData.slackThread.threadTs) {
    await sessionData.slackThread.sendCoachingReply({
      nudgeNumber: coachingMessage.nudgeNumber,
      timestamp: new Date().toLocaleTimeString(),
      reason: coachingMessage.reason,
      message: coachingMessage.message,
      batchNumber: coachingMessage.batchNumber,
      messagesAnalyzed: 6 // From batch size
    });

    console.log(`💡 Coaching sent to Slack thread for session: ${sessionData.id}`);
  } else {
    // Zoom platform - use Recall.ai private DM
    await sendPrivateChatMessage(
      sessionData.botId,
      sessionData.hostParticipantId,
      coachingMessage.message
    );

    console.log(`💡 Coaching sent via Zoom DM for session: ${sessionData.id}`);
  }
}

// Example: When session ends
async function onSessionEnd(sessionData, analytics) {
  if (sessionData.slackThread && sessionData.slackThread.threadTs) {
    await sessionData.slackThread.endSessionThread({
      duration: Math.round(analytics.duration / 60), // Convert to minutes
      totalNudges: analytics.totalNudges,
      addressed: analytics.nudgesAddressed,
      notAddressed: analytics.totalNudges - analytics.nudgesAddressed,
      endTime: new Date().toLocaleTimeString()
    });

    console.log(`✅ Slack thread ended for session: ${sessionData.id}`);
  }
}

/**
 * DEMO: Test the Slack integration
 */
async function runDemo() {
  console.log('\n🚀 Starting Slack Integration Demo...\n');

  // Initialize thread manager
  const threadManager = new SlackThreadManager('#live-nudges');

  try {
    // Step 1: Start a session thread
    console.log('Step 1: Starting session thread...');
    await threadManager.startSessionThread({
      memberName: 'John Doe',
      meetingTitle: 'Demo Call - Acme Prospect',
      platform: 'Google Meet',
      botType: 'Sales',
      startTime: '2:00 PM'
    });

    console.log('\n✅ Thread created! Check your Slack channel.\n');

    // Wait 2 seconds
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 2: Send first coaching nudge
    console.log('Step 2: Sending first coaching nudge...');
    await threadManager.sendCoachingReply({
      nudgeNumber: 1,
      timestamp: '2:15 PM',
      reason: 'Missing budget qualification',
      message: 'They mentioned pricing concerns but you haven\'t explored their budget yet. Ask: "What budget have you allocated for solving this problem?" This is critical for qualifying the opportunity.',
      batchNumber: 2,
      messagesAnalyzed: 6
    });

    console.log('\n✅ First nudge sent!\n');

    // Wait 2 seconds
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 3: Send second coaching nudge
    console.log('Step 3: Sending second coaching nudge...');
    await threadManager.sendCoachingReply({
      nudgeNumber: 2,
      timestamp: '2:22 PM',
      reason: 'Buying signal detected',
      message: 'They asked "How quickly can we get started?" - that\'s a strong buying signal! Confirm their timeline and map the approval process. Ask: "When would you ideally want to go live? And who needs to sign off?"',
      batchNumber: 3,
      messagesAnalyzed: 6
    });

    console.log('\n✅ Second nudge sent!\n');

    // Wait 2 seconds
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 4: Send third coaching nudge
    console.log('Step 4: Sending third coaching nudge...');
    await threadManager.sendCoachingReply({
      nudgeNumber: 3,
      timestamp: '2:30 PM',
      reason: 'Authority unclear',
      message: 'They mentioned needing VP approval. You need to understand the decision process. Ask: "Walk me through how decisions like this typically get made at your company? What concerns will your VP have?" This helps you get ahead of objections.',
      batchNumber: 4,
      messagesAnalyzed: 6
    });

    console.log('\n✅ Third nudge sent!\n');

    // Wait 2 seconds
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 5: End session with summary
    console.log('Step 5: Ending session with summary...');
    await threadManager.endSessionThread({
      duration: 45,
      totalNudges: 3,
      addressed: 3,
      notAddressed: 0,
      endTime: '2:45 PM'
    });

    console.log('\n✅ Session ended! Check your Slack for the complete thread.\n');

    // Show thread info
    console.log('Thread Info:', threadManager.getThreadInfo());

    console.log('\n🎉 Demo completed successfully!\n');

  } catch (error) {
    console.error('\n❌ Demo failed:', error.message);
    console.error('Full error:', error);
  }
}

// Export for use in server.js
module.exports = {
  SlackThreadManager,
  onSessionStart,
  onCoachingMessage,
  onSessionEnd
};

// If running directly (node slack-integration-prototype.js)
if (require.main === module) {
  if (!process.env.SLACK_BOT_TOKEN) {
    console.error('\n❌ Error: SLACK_BOT_TOKEN environment variable not set!');
    console.log('\nPlease set your Slack Bot Token:');
    console.log('export SLACK_BOT_TOKEN="xoxb-your-token-here"\n');
    process.exit(1);
  }

  runDemo().catch(console.error);
}

