# SerbleChat Stress Testing Tool

A comprehensive stress testing tool for SerbleChat that simulates multiple bot clients performing various actions to test server load and stability.

## Features

- **Multiple Bot Simulation**: Run multiple authenticated bot clients simultaneously
- **Configurable Actions**: Enable/disable specific actions and set their weights
- **Real-time Statistics**: Monitor actions per second, success rates, and per-bot metrics
- **Comprehensive API Coverage**: Tests all major endpoints including:
  - Message sending and deletion
  - Friend requests and management
  - Guild creation, deletion, and updates
  - Channel management and reordering
  - Role creation and assignment
  - Invite creation and acceptance
  - Group chat management
  - DM channel creation
  - Permission overrides
- **SignalR Support**: Real-time updates via WebSocket connections
- **Smart Rate Limiting**: Configurable delays and actions per minute
- **Retry Logic**: Automatic retry of failed actions
- **Detailed Logging**: Verbose logging options for debugging

## Installation

### Standard Installation

```bash
npm install
```

### Docker Installation

```bash
# Build the Docker image
docker build -t serblechat-stress-test .

# Or use docker-compose
docker-compose build
```

## Configuration

Create a `config.json` file based on `config.example.json`:

```bash
cp config.example.json config.json
```

### Configuration Options

#### Basic Settings

- **`apiBaseUrl`**: The base URL of your SerbleChat API (e.g., `http://localhost:5000`)
- **`tokens`**: Array of authentication tokens for your test bots
- **`additionalUserIds`**: Optional array of additional valid user IDs to include in the user ID pool for social operations (friend requests, DMs, group chats). Bots automatically add their own IDs to this pool upon connection
- **`messagesPerMinute`**: Target number of actions per minute (distributed across all bots)

#### Enabled Actions

Enable or disable specific actions:

```json
{
  "enabledActions": {
    "sendMessage": true,
    "deleteMessage": true,
    "sendFriendRequest": true,
    // ... etc
  }
}
```

#### Action Weights

Control how frequently each action is performed (higher = more frequent):

```json
{
  "actionWeights": {
    "sendMessage": 40,
    "createGuild": 3,
    "deleteGuild": 1,
    // ... etc
  }
}
```

#### Limits

Prevent bots from creating too many entities:

```json
{
  "limits": {
    "maxGuildsPerBot": 10,
    "maxChannelsPerGuild": 20,
    "maxRolesPerGuild": 15,
    "maxMessagesPerChannel": 100,
    "maxGroupChats": 5,
    "maxFriends": 20
  }
}
```

#### Templates

Customize message and entity name generation:

```json
{
  "messageTemplates": [
    "Hello from bot!",
    "Testing message #{count}",
    "Random number: {random}"
  ],
  "guildNameTemplates": [
    "Test Guild {random}",
    "Bot Server #{count}"
  ]
}
```

Available template variables:
- `{count}` - Action counter or entity count
- `{random}` - Random 4-digit number

#### Logging Options

- **`verboseLogging`**: Enable detailed logging
- **`logActions`**: Log each action as it's performed
- **`logErrors`**: Log error messages

#### Timing

- **`delayBetweenActionsMs`**: Random delay range between actions
  ```json
  {
    "delayBetweenActionsMs": {
      "min": 100,
      "max": 2000
    }
  }
  ```

#### Retry Settings

- **`retryFailedActions`**: Enable automatic retry of failed actions
- **`maxRetries`**: Maximum number of retry attempts

## Usage

### Basic Usage

```bash
npm start
```

Or with a custom config file:

```bash
node index.js ./my-config.json
```

### Debug Mode

Enable debug mode to get detailed information when message sending fails:

```bash
DEBUG=true npm start
```

When DEBUG is enabled and a bot fails to send a message, the application will:
- Dump comprehensive state information (channels, guilds, user IDs, etc.)
- Exit immediately to help diagnose the issue
- Show exactly why the message failed

This is useful for troubleshooting configuration or connection issues.

### Docker Usage

```bash
# Using docker run
docker run -v $(pwd)/config.json:/app/config/config.json serblechat-stress-test

# Using docker-compose
docker-compose up

# Run in detached mode
docker-compose up -d

# View logs
docker-compose logs -f

# Stop the test
docker-compose down
```

### Getting Auth Tokens

You'll need valid SerbleChat authentication tokens for your test bots. These are JWT tokens obtained after authenticating through the SerbleChat auth flow.

1. Create test accounts on your Serble instance
2. Authenticate through the normal OAuth flow
3. Extract the JWT token from the authenticated session
4. Add tokens to your `config.json`

### User ID Pool for Social Operations

The stress tester automatically maintains a pool of valid user IDs for social operations (friend requests, DMs, group chats). Here's how it works:

1. **Bot Self-Registration**: When each bot connects, it fetches its own user ID from the `/account` endpoint and adds it to the shared user ID pool
2. **Automatic Population**: The pool automatically fills with valid user IDs from all connected bots
3. **Valid Operations**: Social actions like `sendFriendRequest`, `createGroupChat`, `addMembersToGroup`, and `createDm` use IDs from this pool, ensuring they're always valid
4. **Additional IDs**: You can add extra user IDs via the `additionalUserIds` config option if you want to include real users or test across multiple instances

**Example Configuration**:
```json
{
  "tokens": ["token1", "token2", "token3"],
  "additionalUserIds": ["user-id-from-another-instance", "real-user-id"],
  "messagesPerMinute": 60
}
```

With this config:
- Bot 1, 2, 3 auto-register their IDs (3 IDs)
- You add 2 additional IDs
- Total pool: 5 valid user IDs for social operations

## Performance Analysis

The stress tester automatically records request timing data to help identify performance issues and slowdowns.

### How It Works

All API requests are timed and recorded to `timings.csv` as they execute:
- Every message send, message fetch, and other operation is timed
- Data includes timestamp, bot ID, query type, duration, and success status
- File grows as the test runs (one line per request)

### Analyzing Results

**Quick statistics:**
```bash
python3 timing_stats.py
```

Shows min/max/mean/median/P95/P99 durations for each query type and bot.

**Visual analysis:**
```bash
python3 plot_timings.py
```

Generates `plot.png` with:
- Scatter plot of all request durations over time
- Box plots comparing query types
- Rolling average trend line to spot slowdowns
- Statistics summary table

**Custom output:**
```bash
python3 plot_timings.py timings.csv analysis.html
```

Saves as interactive HTML instead of PNG.

### Identifying Issues

Look for:
- **Upward trends** in rolling average = performance degradation
- **Spike outliers** = intermittent slowness or bottlenecks
- **High P95/P99** = occasional extreme slowdowns
- **Pattern changes** = behavior change over time

See [TIMING_ANALYSIS.md](TIMING_ANALYSIS.md) for detailed interpretation guide.


### Running the Test

```bash
$ npm start

╔═══════════════════════════════════════════════════════════════╗
║         SerbleChat Stress Testing Tool v1.0                  ║
╚═══════════════════════════════════════════════════════════════╝

✓ Configuration loaded successfully
✓ Configuration validated

Configuration:
  API URL:              http://localhost:5000
  Bots:                 3
  Actions/Minute:       60
  Verbose Logging:      true

🚀 Starting 3 bot(s)...

Bot 1: Connected successfully
Bot 2: Connected successfully
Bot 3: Connected successfully

✓ 3/3 bot(s) started successfully

Press Ctrl+C to stop the stress test

================================================================================
📊 STRESS TEST STATISTICS - Runtime: 10s
================================================================================
Total Actions:     25
Successful:        23 (92.0%)
Failed:            2 (8.0%)
Actions/Second:    2.50
--------------------------------------------------------------------------------
Bot 1:
  Actions:    9 (8 ✓, 1 ✗) - 88.89%
  Entities:   Guilds: 2, Channels: 5, Friends: 1, Groups: 0
Bot 2:
  Actions:    8 (7 ✓, 1 ✗) - 87.50%
  Entities:   Guilds: 1, Channels: 3, Friends: 2, Groups: 1
Bot 3:
  Actions:    8 (8 ✓, 0 ✗) - 100.00%
  Entities:   Guilds: 2, Channels: 4, Friends: 1, Groups: 0
================================================================================
```

### Stopping the Test

Press `Ctrl+C` to gracefully stop all bots and display final statistics:

```bash
⚠️  Shutdown signal received...

🛑 Stopping bots...

Bot 1: Disconnected
Bot 2: Disconnected
Bot 3: Disconnected

✓ All bots stopped

████████████████████████████████████████████████████████████████████████████████
🏁 FINAL STRESS TEST RESULTS
████████████████████████████████████████████████████████████████████████████████

Test Duration:     2m 15s
Total Bots:        3
Total Actions:     150
Successful:        142 (94.7%)
Failed:            8 (5.3%)
Avg Actions/Sec:   1.11
Avg Actions/Bot:   50.00
```

## Action Types

### Message Actions
- **sendMessage**: Send a random message to a random channel
- **deleteMessage**: Delete a previously sent message

### Friend Actions
- **sendFriendRequest**: Send friend request to another bot
- **acceptFriendRequest**: Accept pending friend requests
- **removeFriend**: Remove an existing friend

### Guild Actions
- **createGuild**: Create a new guild
- **deleteGuild**: Delete an owned guild
- **updateGuild**: Update guild properties (name, permissions)
- **leaveGuild**: Leave a joined guild

### Channel Actions
- **createChannel**: Create a new channel in a guild
- **deleteChannel**: Delete a channel
- **updateChannel**: Update channel properties
- **reorderChannels**: Change channel order

### Role Actions
- **createRole**: Create a new role
- **deleteRole**: Delete a role
- **updateRole**: Update role properties
- **assignRole**: Assign a role to a user
- **removeRole**: Remove a role from a user

### Invite Actions
- **createInvite**: Create a guild invite
- **acceptInvite**: Accept an invite from another bot
- **deleteInvite**: Delete an existing invite

### Group Chat Actions
- **createGroupChat**: Create a group chat with other bots
- **deleteGroupChat**: Delete an owned group chat
- **addMembersToGroup**: Add members to a group chat

### DM Actions
- **createDm**: Create or get a DM channel with another bot

### Permission Actions
- **createPermissionOverride**: Create a channel permission override
- **deletePermissionOverride**: Delete a permission override
- **updatePermissionOverride**: Update a permission override

## Architecture

The tool consists of several components:

### `client.js` - SerbleChatClient
Low-level API client that handles:
- HTTP requests to the REST API
- SignalR WebSocket connections
- State management (guilds, channels, friends, etc.)
- Real-time event handling

### `bot.js` - StressTestBot
Bot simulation logic that:
- Manages a single bot instance
- Selects random actions based on weights
- Executes actions with retry logic
- Tracks statistics

### `index.js` - StressTestManager
Orchestration layer that:
- Loads and validates configuration
- Manages multiple bots
- Displays real-time statistics
- Handles graceful shutdown

## Tips for Effective Stress Testing

1. **Start Small**: Begin with 2-3 bots and gradually increase
2. **Monitor Server**: Watch server CPU, memory, and database performance
3. **Adjust Weights**: Increase weights for actions you want to stress test more
4. **Use Realistic Rates**: Don't exceed what real users would do
5. **Check Logs**: Enable verbose logging to debug issues
6. **Database Cleanup**: Clean up test data periodically
7. **Network Latency**: Consider adding delays that simulate real network conditions

## Troubleshooting

### Bots fail to connect
- Verify `apiBaseUrl` is correct
- Check that auth tokens are valid
- Ensure the API server is running

### High error rates
- Check server logs for errors
- Reduce `messagesPerMinute`
- Increase `delayBetweenActionsMs.min`
- Verify database connections

### Actions not performing
- Check `enabledActions` configuration
- Verify action weights are > 0
- Ensure bots have necessary permissions
- Check entity limits aren't reached
