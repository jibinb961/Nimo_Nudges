/**
 * NIMO Live Nudges - Microsoft Teams CHANNEL Integration Prototype
 * 
 * This is the BETTER approach - similar to Slack!
 * 
 * How it works:
 * 1. Org admin connects Teams workspace via OAuth
 * 2. Org admin selects a channel (e.g., #live-coaching)
 * 3. Bot posts to that channel when session starts
 * 4. Coaching messages appear as REPLIES to the parent message
 * 5. Session ends with summary reply
 * 
 * Result: Each session = one conversation thread in the channel
 * 
 * Prerequisites:
 * 1. Register app in Azure AD (Microsoft 365 app, not Bot)
 * 2. Add Microsoft Graph API permissions:
 *    - ChannelMessage.Send
 *    - Channel.ReadBasic.All
 *    - Team.ReadBasic.All
 * 3. Get OAuth token from org admin
 * 4. Store: team_id, channel_id, access_token
 */

const { Client } = require('@microsoft/microsoft-graph-client');
require('isomorphic-fetch'); // Required for Graph client

/**
 * TeamsChannelManager - Manages threaded messages in Teams channels
 * Similar to SlackThreadManager
 */
class TeamsChannelManager {
  constructor(accessToken, teamId, channelId) {
    // Initialize Microsoft Graph client
    this.client = Client.init({
      authProvider: (done) => {
        done(null, accessToken);
      }
    });
    
    this.teamId = teamId;
    this.channelId = channelId;
    this.parentMessageId = null; // Like Slack's thread_ts
    this.nudgeCount = 0;
    this.sessionStartTime = null;
    this.sessionInfo = {};
  }

  /**
   * Start a new coaching session thread
   * Posts initial message to channel
   */
  async startSessionThread(sessionInfo) {
    try {
      this.sessionInfo = sessionInfo;
      this.sessionStartTime = Date.now();
      this.nudgeCount = 0;

      const { memberName, meetingTitle, platform, botType, startTime } = sessionInfo;

      console.log('📤 Creating Teams channel thread for new session...');

      // Create rich message using HTML (Teams supports HTML in messages)
      const messageBody = {
        body: {
          contentType: 'html',
          content: `
            <h2>🎯 ${meetingTitle}</h2>
            <p><strong>Member:</strong> ${memberName}<br/>
            <strong>Platform:</strong> ${platform}<br/>
            <strong>Bot Type:</strong> ${botType}<br/>
            <strong>Started:</strong> ${startTime}</p>
            <p><em>💬 Live coaching messages will appear as replies below</em></p>
          `
        }
      };

      // Post message to channel
      const response = await this.client
        .api(`/teams/${this.teamId}/channels/${this.channelId}/messages`)
        .post(messageBody);

      // Store parent message ID for threading
      this.parentMessageId = response.id;
      
      console.log(`✅ Teams channel thread created! Message ID: ${this.parentMessageId}`);
      return this.parentMessageId;

    } catch (error) {
      console.error('❌ Error creating Teams channel thread:', error.message);
      if (error.statusCode === 401) {
        console.error('⚠️  Access token expired or invalid. Need to refresh OAuth token.');
      }
      throw error;
    }
  }

  /**
   * Send coaching message as a REPLY to the parent message
   * This creates threaded conversation (like Slack)
   */
  async sendCoachingReply(coachingData) {
    if (!this.parentMessageId) {
      console.error('⚠️ No active session thread. Call startSessionThread() first.');
      return;
    }

    try {
      this.nudgeCount++;
      const { reason, message, timestamp, batchNumber, messagesAnalyzed } = coachingData;

      console.log(`📤 Sending coaching nudge #${this.nudgeCount} to Teams channel...`);

      // Create reply message with rich formatting
      const replyBody = {
        body: {
          contentType: 'html',
          content: `
            <h3>💡 Nudge #${this.nudgeCount} <small>(${timestamp})</small></h3>
            <p><strong>Opportunity:</strong> ${reason}<br/>
            <strong>Batch:</strong> #${batchNumber} (${messagesAnalyzed} messages analyzed)</p>
            <div style="background: #f0f8ff; padding: 10px; border-left: 4px solid #667eea; margin-top: 10px;">
              <strong>Coaching:</strong><br/>
              ${message}
            </div>
          `
        }
      };

      // Post as REPLY to parent message (this is the key for threading!)
      await this.client
        .api(`/teams/${this.teamId}/channels/${this.channelId}/messages/${this.parentMessageId}/replies`)
        .post(replyBody);

      console.log(`✅ Coaching nudge #${this.nudgeCount} sent to Teams channel!`);

    } catch (error) {
      console.error('❌ Error sending Teams coaching reply:', error.message);
      throw error;
    }
  }

  /**
   * End the session with a summary reply
   */
  async endSessionThread() {
    if (!this.parentMessageId) {
      console.error('⚠️ No active session thread to end.');
      return;
    }

    try {
      const duration = Math.round((Date.now() - this.sessionStartTime) / 60000);
      const endTime = new Date().toLocaleTimeString();

      console.log('📤 Ending Teams session thread with summary...');

      // Create summary reply
      const summaryBody = {
        body: {
          contentType: 'html',
          content: `
            <h3 style="color: #10b981;">✅ Session Ended</h3>
            <p><strong>Meeting:</strong> ${this.sessionInfo.meetingTitle}<br/>
            <strong>Duration:</strong> ${duration} minutes<br/>
            <strong>Ended:</strong> ${endTime}<br/>
            <strong>Total Nudges:</strong> ${this.nudgeCount}</p>
            <p><em>📝 Review the coaching insights above to improve the next call.</em></p>
          `
        }
      };

      // Post summary as final reply
      await this.client
        .api(`/teams/${this.teamId}/channels/${this.channelId}/messages/${this.parentMessageId}/replies`)
        .post(summaryBody);

      console.log('✅ Teams session thread ended with summary!');

      // Reset state
      this.parentMessageId = null;
      this.nudgeCount = 0;
      this.sessionStartTime = null;

    } catch (error) {
      console.error('❌ Error ending Teams session thread:', error.message);
      throw error;
    }
  }

  /**
   * Get available teams for the org (for OAuth setup)
   */
  static async getTeams(accessToken) {
    try {
      const client = Client.init({
        authProvider: (done) => done(null, accessToken)
      });

      const teams = await client.api('/me/joinedTeams').get();
      
      return teams.value.map(team => ({
        id: team.id,
        name: team.displayName,
        description: team.description
      }));
    } catch (error) {
      console.error('❌ Error fetching teams:', error.message);
      throw error;
    }
  }

  /**
   * Get available channels in a team (for OAuth setup)
   */
  static async getChannels(accessToken, teamId) {
    try {
      const client = Client.init({
        authProvider: (done) => done(null, accessToken)
      });

      const channels = await client.api(`/teams/${teamId}/channels`).get();
      
      return channels.value.map(channel => ({
        id: channel.id,
        name: channel.displayName,
        description: channel.description
      }));
    } catch (error) {
      console.error('❌ Error fetching channels:', error.message);
      throw error;
    }
  }

  /**
   * Get thread info (for debugging)
   */
  getThreadInfo() {
    return {
      teamId: this.teamId,
      channelId: this.channelId,
      parentMessageId: this.parentMessageId,
      nudgeCount: this.nudgeCount,
      sessionActive: this.parentMessageId !== null
    };
  }
}

/**
 * OAuth Helper Functions
 */

// Generate OAuth URL for org admin to authorize
function getTeamsOAuthUrl(clientId, redirectUri) {
  const scopes = [
    'ChannelMessage.Send',
    'Channel.ReadBasic.All',
    'Team.ReadBasic.All'
  ].join(' ');

  const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?` +
    `client_id=${clientId}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&response_mode=query`;

  return authUrl;
}

// Exchange auth code for access token
async function getAccessToken(clientId, clientSecret, code, redirectUri) {
  const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
  
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code: code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code'
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`OAuth error: ${error.error_description}`);
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in
  };
}

/**
 * Integration with NIMO Backend
 */

// Example: When session starts (Teams meeting detected)
async function onSessionStart(sessionData, orgSettings) {
  // Check if platform is Teams and org has Teams channel integration
  if (sessionData.platform === 'teams' && orgSettings.teamsChannelIntegration) {
    const { accessToken, teamId, channelId } = orgSettings.teamsChannelIntegration;

    // Initialize Teams channel manager
    const teamsChannel = new TeamsChannelManager(accessToken, teamId, channelId);

    // Store in session
    sessionData.teamsChannel = teamsChannel;

    // Start thread
    const parentMessageId = await teamsChannel.startSessionThread({
      memberName: sessionData.memberName,
      meetingTitle: sessionData.meetingTitle,
      platform: 'Microsoft Teams',
      botType: sessionData.botType,
      startTime: new Date().toLocaleTimeString()
    });

    // Store in database
    await db.coaching_sessions.update(sessionData.id, {
      teams_parent_message_id: parentMessageId
    });

    console.log(`🎯 Teams channel thread created for session: ${sessionData.id}`);
  }
}

// Example: When AI sends coaching
async function onCoachingMessage(sessionData, coachingMessage) {
  if (sessionData.teamsChannel && sessionData.teamsChannel.parentMessageId) {
    // Send to Teams channel
    await sessionData.teamsChannel.sendCoachingReply({
      reason: coachingMessage.reason,
      message: coachingMessage.message,
      timestamp: new Date().toLocaleTimeString(),
      batchNumber: coachingMessage.batchNumber,
      messagesAnalyzed: 6
    });

    console.log(`💡 Coaching sent to Teams channel for session: ${sessionData.id}`);
  } else if (sessionData.slackThread && sessionData.slackThread.threadTs) {
    // Fallback to Slack
    await sessionData.slackThread.sendCoachingReply({ ... });
  } else {
    // Zoom DM
    await sendPrivateChatMessage(sessionData.botId, sessionData.hostId, message);
  }
}

// Example: When session ends
async function onSessionEnd(sessionData) {
  if (sessionData.teamsChannel && sessionData.teamsChannel.parentMessageId) {
    await sessionData.teamsChannel.endSessionThread();
    console.log(`✅ Teams channel thread ended for session: ${sessionData.id}`);
  }
}

/**
 * DEMO: Test Teams Channel Integration
 */
async function runDemo() {
  console.log('\n🚀 Starting Teams Channel Integration Demo...\n');

  // Check for required env variables
  if (!process.env.TEAMS_ACCESS_TOKEN || !process.env.TEAMS_TEAM_ID || !process.env.TEAMS_CHANNEL_ID) {
    console.error('❌ Missing required environment variables!');
    console.log('\nPlease set in .env:');
    console.log('TEAMS_ACCESS_TOKEN=your-access-token');
    console.log('TEAMS_TEAM_ID=your-team-id');
    console.log('TEAMS_CHANNEL_ID=your-channel-id\n');
    console.log('See TEAMS_CHANNEL_SETUP.md for instructions.\n');
    return;
  }

  const accessToken = process.env.TEAMS_ACCESS_TOKEN;
  const teamId = process.env.TEAMS_TEAM_ID;
  const channelId = process.env.TEAMS_CHANNEL_ID;

  // Initialize manager
  const teamsChannel = new TeamsChannelManager(accessToken, teamId, channelId);

  try {
    // Step 1: Start session thread
    console.log('Step 1: Starting session thread in Teams channel...');
    await teamsChannel.startSessionThread({
      memberName: 'John Doe',
      meetingTitle: 'Acme Corp Sales Demo',
      platform: 'Microsoft Teams',
      botType: 'Sales Coach',
      startTime: new Date().toLocaleTimeString()
    });
    console.log('✅ Thread created! Check your Teams channel.\n');

    // Wait 2 seconds
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 2: Send first coaching nudge
    console.log('Step 2: Sending first coaching nudge...');
    await teamsChannel.sendCoachingReply({
      reason: 'Missing budget qualification',
      message: 'They mentioned pricing concerns but you haven\'t explored their budget yet. Ask: "What budget have you allocated for solving this problem?" This is critical for qualifying the opportunity.',
      timestamp: new Date().toLocaleTimeString(),
      batchNumber: 2,
      messagesAnalyzed: 6
    });
    console.log('✅ First nudge sent!\n');

    // Wait 2 seconds
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 3: Send second coaching nudge
    console.log('Step 3: Sending second coaching nudge...');
    await teamsChannel.sendCoachingReply({
      reason: 'Buying signal detected',
      message: 'They asked "How quickly can we get started?" - that\'s a strong buying signal! Confirm their timeline and map the approval process. Ask: "When would you ideally want to go live? And who needs to sign off?"',
      timestamp: new Date().toLocaleTimeString(),
      batchNumber: 3,
      messagesAnalyzed: 6
    });
    console.log('✅ Second nudge sent!\n');

    // Wait 2 seconds
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 4: Send third coaching nudge
    console.log('Step 4: Sending third coaching nudge...');
    await teamsChannel.sendCoachingReply({
      reason: 'Authority unclear',
      message: 'They mentioned needing VP approval. You need to understand the decision process. Ask: "Walk me through how decisions like this typically get made at your company? What concerns will your VP have?" This helps you get ahead of objections.',
      timestamp: new Date().toLocaleTimeString(),
      batchNumber: 4,
      messagesAnalyzed: 6
    });
    console.log('✅ Third nudge sent!\n');

    // Wait 2 seconds
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 5: End session
    console.log('Step 5: Ending session with summary...');
    await teamsChannel.endSessionThread();
    console.log('✅ Session ended!\n');

    console.log('🎉 Demo completed! Check your Teams channel for the complete thread.\n');

  } catch (error) {
    console.error('\n❌ Demo failed:', error.message);
    if (error.statusCode === 401) {
      console.error('\n⚠️  Your access token has expired. Please generate a new one.');
      console.error('See TEAMS_CHANNEL_SETUP.md for instructions.\n');
    }
  }
}

// Export for use in server.js
module.exports = {
  TeamsChannelManager,
  getTeamsOAuthUrl,
  getAccessToken,
  onSessionStart,
  onCoachingMessage,
  onSessionEnd
};

// If running directly (node teams-channel-integration-prototype.js)
if (require.main === module) {
  runDemo().catch(console.error);
}



