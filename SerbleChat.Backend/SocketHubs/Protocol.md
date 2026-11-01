# Updates SignalR Protocol
Keep in mind that int refers to a 64bit integer (or a long) when
it comes to IDs of things.

## To Client
`FriendRequestReceived`:
```json
{
    "fromUserId": "string"
}
```

`NewMessage`:
```json
{
    "id": int,
    "channelId": int,
    "createdAt": "DateTime",
    "authorId": "string",
    "content": "string"
}
```

Messages may carry a `poll` (see `PollUpdated` for its shape); it's `null` on
ordinary messages.

`PollUpdated`: someone voted, changed or removed a vote, or ended a poll.
Sent to the poll's channel group with the full poll, so it can replace the
client's copy. Votes are public: each option lists who voted for it. A poll
has ended when `closedAt` is set or `expiresAt` has passed; nothing is sent
when a poll expires on its own.
```json
{
    "id": int,
    "messageId": int,
    "channelId": int,
    "authorId": "string",
    "question": "string",
    "allowMultiple": bool,
    "createdAt": "DateTime",
    "expiresAt": "DateTime?",
    "closedAt": "DateTime?",
    "options": [
        { "id": int, "text": "string", "voterIds": ["string"] }
    ]
}
```

`NewChannel`:
```json
{
    "id": int,
    "createdAt": "DateTime",
    "guildId": int?,
    "type": int,
    "name": "string",
    "voiceCapable": bool
}
```

`DeleteMessage`:
```json
{
    "id": int
}
```

`ChannelDeleted`:
```json
{
    "channelId": int
}
```

`UserLeft`:
```json
{
    "userId": "string",
    "channelId": int
}
```

`RolesUpdated`:
```json
{
    "guildId": int
}
```

`UserUpdated`:
```json
{
    "id": "string"
}
```

`UserStatusUpdated`: a user came online, went offline, or changed their status.
Sent to every guild, DM and group chat group the user is in, so a connection
can get it more than once. `status` is `online`, `away`, `dnd` or `offline`;
Invisible users are always `offline`. The message is shown even when offline.
When `statusExpiresAt` passes, treat the user as `online` (or `offline` if they
were offline) with no message: nothing is sent at expiry. Ignore it for
yourself and use `OwnStatusUpdated` instead.
```json
{
    "userId": "string",
    "status": "online" | "away" | "dnd" | "offline",
    "statusMessage": "string",          // "" when there's none
    "statusExpiresAt": "DateTime" | null
}
```

`OwnStatusUpdated`: your own status changed (from any of your clients).
`statusType` is what you picked, including `invisible`. When `statusExpiresAt`
passes, call `POST /account/status/expire` so others are told.
```json
{
    "statusType": "online" | "away" | "dnd" | "invisible",
    "statusMessage": "string",
    "statusExpiresAt": "DateTime" | null
}
```

`ClientJoinVoice`:
```json
{
    "userId": "string",
    "channelId": int
}
```

`ClientLeaveVoice`:
```json
{
    "userId": "string",
    "channelId": int
}
```

`ClientVoiceStateUpdated`: a user in a voice channel muted/unmuted or deafened/undeafened.
Sent to everyone who can see the channel, not just people in the call.
```json
{
    "userId": "string",
    "channelId": int,
    "muted": bool,
    "deafened": bool
}
```

`GuildUpdated`:
```json
{
    "guildId": int
}
```

`ChannelUpdated`:
```json
{
    "channelId": int
}
```

`UserTyping`:
```json
{
    "userId": string,
    "channelId": int
}
```

`ReceiveNotification`: a message you'd be notified about. Not sent while
you're in Do Not Disturb.
```json
{
    "type": "message",
    "message": messagedata
}
```

`LeftGuild`:
For when the user leaves a guild.
```json
{
    "guildId": int
}
```

`MessageEdited`:
```json
{
    "id": int,
    "channelId": int,
    "message": messagedata
}
```

## To Server
`UpdateStatus()`:
Presence heartbeat; send it every 30 seconds. You count as connected while
heartbeats keep arriving (one missed beat is tolerated).

`UpdateVoiceState(channelId: int, muted: bool, deafened: bool)`:
Report your own mute/deafen state while in a voice channel. Ignored if you
aren't in that channel's call. Broadcast to others as `ClientVoiceStateUpdated`.
