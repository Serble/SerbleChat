# Updates SignalR Protocol

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

