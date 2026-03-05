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

`UserStatusUpdated`:
```json
{
    "userId": "string",
    "status": "string"
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

`ReceiveNotification`:
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
