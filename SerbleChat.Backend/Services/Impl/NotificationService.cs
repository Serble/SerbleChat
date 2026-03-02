using System.Threading.Channels;
using Lib.Net.Http.WebPush;
using Microsoft.AspNetCore.SignalR;
using Newtonsoft.Json;
using SerbleChat.Backend.Database.Repos;
using SerbleChat.Backend.Database.Structs;
using SerbleChat.Backend.Schemas;
using SerbleChat.Backend.SocketHubs;
using StackExchange.Redis;
using Channel = SerbleChat.Backend.Database.Structs.Channel;
using ThreadingChannel = System.Threading.Channels.Channel;

namespace SerbleChat.Backend.Services.Impl;

public class NotificationService(IServiceProvider serviceProvider) : INotificationService {
    private readonly Channel<Func<Task>> _work = ThreadingChannel.CreateUnbounded<Func<Task>>();
    
    public void EnqueueMessageProcessing(Channel channel, Message message, IEnumerable<string> userMentions) {
        _work.Writer.TryWrite(() => ProcessMessageAsync(channel, message, userMentions));
    }

    public async Task<Func<Task>> DequeueWork(CancellationToken token) {
        return await _work.Reader.ReadAsync(token);
    }

    private async Task ProcessMessageAsync(Channel channel, Message message, IEnumerable<string> mentions) {
        using IServiceScope scope = serviceProvider.CreateScope();
        ILogger<NotificationService> logger = scope.ServiceProvider.GetRequiredService<ILogger<NotificationService>>();
        IChannelRepo channels = scope.ServiceProvider.GetRequiredService<IChannelRepo>();
        IUserRepo users = scope.ServiceProvider.GetRequiredService<IUserRepo>();
        PushServiceClient pushClient = scope.ServiceProvider.GetRequiredService<PushServiceClient>();
        IConnectionMultiplexer redis = scope.ServiceProvider.GetRequiredService<IConnectionMultiplexer>();
        IHubContext<ChatHub> updates = scope.ServiceProvider.GetRequiredService<IHubContext<ChatHub>>();
        
        logger.LogInformation("Processing message {MessageId} in channel {ChannelId} for notifications", message.Id, channel.Id);
            
        // this prologue is expensive but constant time so should scale fine
        Dictionary<string, ChatUser> userData = (await channels.GetChannelMembers(channel))
            .ToDictionary(v => v.Id);
            
        // get actual notif endpoints
        Dictionary<string, IEnumerable<UserWebNotificationHook>> endpoints = 
            await users.GetUsersWebNotificationSubscriptions(userData.Keys);
        
        // get all prefs from db
        Dictionary<string, UserChannelNotificationPreferences> channelPrefs =
            await users.GetUsersChannelNotificationPreferences(userData.Keys, message.ChannelId);
        Dictionary<string, UserGuildNotificationPreferences> guildPrefs = channel.GuildId.HasValue
            ? await users.GetUsersGuildNotificationPreferences(userData.Keys, channel.GuildId.Value)
            : new Dictionary<string, UserGuildNotificationPreferences>();

        if (message.AuthorNavigation == null!) {
            // try and load using our list of users (they should be a member of the channel if they sent a message in it, so they should be in the list)
            if (userData.TryGetValue(message.AuthorId, out ChatUser? author)) {
                message.AuthorNavigation = author;
            }
        }

        if (message.ChannelNavigation == null!) {
            // we should have the channel already, but just in case, try and load it
            message.ChannelNavigation = channel;
        }
        
        object content = new {
            type = "message",
            message
        };
        PushMessage notif = new(JsonConvert.SerializeObject(content)) {
            Urgency = PushMessageUrgency.Normal,
            Topic = "message:" + message.Id
        };

        List<long> badEndpoints = [];
        
        //ASDASDASDSA
        
        HashSet<string> mentionedUsers = mentions.ToHashSet();

        foreach ((string userId, IEnumerable<UserWebNotificationHook> hooks) in endpoints) {
            if (message.AuthorId == userId) {
                continue;  // don't send notifications to the author of the message
            }
            
            ChatUser user = userData[userId];
            bool onlyClientNotif = false;
            if (!user.NotificationsWhileOnline) {
                bool isOnline = redis.GetDatabase().StringGet("status:" + userId).HasValue;
                if (isOnline) {
                    onlyClientNotif = true;  // if they're online, don't send a notification; they can see the message in real time
                }
            }
            
            NotificationPreferences prefs = channelPrefs.TryGetValue(userId, out UserChannelNotificationPreferences? cp)
                ? cp.Preferences
                : NotificationPreferences.DefaultPreferences;
            
            NotificationPreferences userGuildPrefs = guildPrefs.TryGetValue(userId, out UserGuildNotificationPreferences? gp)
                ? gp.Preferences
                : NotificationPreferences.DefaultPreferences;
            
            NotificationPreferences userPrefs = channel.Type switch {
                ChannelType.Guild => user.DefaultGuildNotificationPreferences,
                ChannelType.Dm => user.DefaultDmNotificationPreferences,
                ChannelType.Group => user.DefaultGroupNotificationPreferences,
                _ => throw new ArgumentOutOfRangeException()
            };

            prefs = prefs
                .ApplyOverride(userGuildPrefs)
                .ApplyOverride(userPrefs);
            
            // okay, now we have their actual preferences
            switch (prefs.Notifications) {
                case NotificationPreference.AllMessages:
                    break;  // continue to send
                
                case NotificationPreference.MentionsOnly:
                    if (!mentionedUsers.Contains(userId)) {
                        continue;  // if they weren't mentioned don't trigger
                    }
                    break;
                
                case NotificationPreference.Inherit:
                case NotificationPreference.Nothing:
                    continue;  // don't send at all
                
                default:
                    throw new ArgumentOutOfRangeException();
            }
            
            // if we got here, then send
            
            // first off, send a real-time update to their clients
            await updates.Clients.User(userId).SendAsync("ReceiveNotification", content);
            
            // then web push notifications
            if (onlyClientNotif) continue;
            foreach (UserWebNotificationHook hook in hooks) {
                // cool, we need to send a notification to this user, let's do it
                try {
                    logger.LogInformation("Sending notification to user {UserId} for message {MessageId} in channel {ChannelId}", hook.UserId, message.Id, channel.Id);
                    await pushClient.RequestPushMessageDeliveryAsync(hook.ToPushSubscription(), notif);
                }
                catch (Exception) {
                    // if this fails, we should just delete the subscription; it's probably invalid
                    badEndpoints.Add(hook.Id);
                }
            }
        }
        
        //ASDASDASDASDAS
            
        // finally, delete any bad endpoints we found
        if (badEndpoints.Count > 0) {
            await users.DeleteWebNotificationSubscriptions(badEndpoints.ToArray());
        }
    }
}
