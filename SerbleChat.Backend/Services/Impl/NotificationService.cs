using System.Collections.Concurrent;
using System.Net;
using System.Threading.Channels;
using Lib.Net.Http.WebPush;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;
using SerbleChat.Backend.Config;
using SerbleChat.Backend.Database.Repos;
using SerbleChat.Backend.Database.Structs;
using SerbleChat.Backend.Schemas;
using SerbleChat.Backend.Services.Ntfy;
using SerbleChat.Backend.SocketHubs;
using StackExchange.Redis;
using Channel = SerbleChat.Backend.Database.Structs.Channel;
using ThreadingChannel = System.Threading.Channels.Channel;

namespace SerbleChat.Backend.Services.Impl;

public class NotificationService(IServiceProvider serviceProvider) : INotificationService {
    /// <summary>How many ntfy requests a single message fans out to at once.</summary>
    private const int NtfyParallelism = 16;

    /// <summary>How long we remember that a native device was sent a channel's notifications, so reading it can clear them.</summary>
    private static readonly TimeSpan PushedTtl = TimeSpan.FromDays(7);

    /// <summary>
    /// Returns the last pushed message ID for the channel (-1 if nothing was pushed), and forgets it when the
    /// read covers it, so later reads don't send more clears.
    /// </summary>
    private static readonly LuaScript TakePushedScript = LuaScript.Prepare("""
        local v = redis.call('GET', @key)
        if not v then return -1 end
        if tonumber(v) <= tonumber(@readUpTo) then redis.call('DEL', @key) end
        return tonumber(v)
        """);

    private static RedisKey PushedKey(string userId, long channelId) => $"pushed:{userId}:{channelId}";

    private readonly Channel<Func<Task>> _work = ThreadingChannel.CreateUnbounded<Func<Task>>();
    
    public void EnqueueMessageProcessing(Channel channel, Message message, IEnumerable<string> userMentions) {
        _work.Writer.TryWrite(() => ProcessMessageAsync(channel, message, userMentions));
    }

    public void EnqueueReadSync(string userId, long channelId, long messageId) {
        _work.Writer.TryWrite(() => ProcessReadAsync(userId, channelId, messageId));
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
        IPresenceService presence = scope.ServiceProvider.GetRequiredService<IPresenceService>();
        IHubContext<ChatHub> updates = scope.ServiceProvider.GetRequiredService<IHubContext<ChatHub>>();
        NtfySettings ntfySettings = scope.ServiceProvider.GetRequiredService<IOptions<NtfySettings>>().Value;
        string? frontendUrl = scope.ServiceProvider.GetRequiredService<IOptions<ApiSettings>>().Value.FrontendUrl;
        
        logger.LogInformation("Processing message {MessageId} in channel {ChannelId} for notifications", message.Id, channel.Id);
            
        // this prologue is expensive but constant time so should scale fine
        Dictionary<string, ChatUser> userData = (await channels.GetChannelMembers(channel))
            .ToDictionary(v => v.Id);
            
        // get actual notif endpoints
        Dictionary<string, IEnumerable<UserWebNotificationHook>> endpoints = 
            await users.GetUsersWebNotificationSubscriptions(userData.Keys);
        Dictionary<string, UserNtfySubscription[]> ntfyEndpoints =
            await users.GetUsersEnabledNtfySubscriptions(userData.Keys);
        
        // get all prefs from db
        Dictionary<string, UserChannelNotificationPreferences> channelPrefs =
            await users.GetUsersChannelNotificationPreferences(userData.Keys, message.ChannelId);
        Dictionary<string, UserGuildNotificationPreferences> guildPrefs = channel.GuildId.HasValue
            ? await users.GetUsersGuildNotificationPreferences(userData.Keys, channel.GuildId.Value)
            : new Dictionary<string, UserGuildNotificationPreferences>();
        HashSet<string> connected = await presence.GetConnected(userData.Keys);

        if (message.AuthorNavigation == null && message.AuthorId != null) {
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
        // Web Push payloads come in two flavours, depending on the recipient's include-content setting
        // and DMs and mentions go out as high urgency, so push services deliver them straight away even in Doze
        Dictionary<(bool IncludeContent, bool High), PushMessage> pushMessages = [];
        PushMessage GetPushMessage(bool includeContent, bool high) {
            if (!pushMessages.TryGetValue((includeContent, high), out PushMessage? push)) {
                push = CreatePushMessage(content, message, includeContent, high);
                pushMessages[(includeContent, high)] = push;
            }
            return push;
        }
        IDatabase redisDb = scope.ServiceProvider.GetRequiredService<IConnectionMultiplexer>().GetDatabase();

        // ntfy is plaintext and rendered by the ntfy app, so it gets a pre-formatted title and body
        Lazy<Task<(string Title, string Body)>> ntfyText = new(() => BuildNtfyText(scope.ServiceProvider, channel, message, userData));
        List<(UserNtfySubscription Sub, NtfyNotification Notification)> ntfyJobs = [];

        List<long> badEndpoints = [];
        
        HashSet<string> mentionedUsers = mentions.ToHashSet();

        foreach (string userId in userData.Keys) {
            if (message.AuthorId == userId) {
                continue;  // don't send notifications to the author of the message
            }
            
            ChatUser user = userData[userId];
            UserStatusType status = user.EffectiveStatusType();
            if (status == UserStatusType.DoNotDisturb) {
                continue;  // DND silences everything, including the in-app sound
            }
            
            // When connected they can see the message in real time, so push/ntfy only goes out if they asked for it.
            // Invisible users are connected and at their client, so they follow the online setting.
            bool onlyClientNotif = connected.Contains(userId) && !(status == UserStatusType.Away
                ? user.NotificationsWhileAway
                : user.NotificationsWhileOnline);
            
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
            
            if (onlyClientNotif) continue;

            // queue ntfy, sent concurrently after the loop since it's a plain HTTP call to a server of the user's choice
            if (ntfyEndpoints.TryGetValue(userId, out UserNtfySubscription[]? ntfySubs)) {
                (string title, string body) = await ntfyText.Value;
                bool mentioned = mentionedUsers.Contains(userId);
                foreach (UserNtfySubscription sub in ntfySubs) {
                    ntfyJobs.Add((sub, NotificationFormatter.BuildNtfy(
                        title, sub.IncludeContent ? body : null, mentioned, channel, frontendUrl)));
                }
            }

            // then web push notifications (browser push, and UnifiedPush once a native client registers one)
            if (!endpoints.TryGetValue(userId, out IEnumerable<UserWebNotificationHook>? hooks)) {
                continue;  // no endpoints, skip
            }

            bool important = mentionedUsers.Contains(userId) || channel.Type == ChannelType.Dm;
            PushMessage notif = GetPushMessage(user.WebPushIncludeContent, important);
            if (hooks.Any(h => h.Kind == PushSubscriptionKind.UnifiedPush)) {
                // remember it so reading the channel elsewhere can clear the notification on their devices
                await redisDb.StringSetAsync(PushedKey(userId, channel.Id), message.Id, PushedTtl);
            }
            foreach (UserWebNotificationHook hook in hooks) {
                // cool, we need to send a notification to this user, let's do it
                try {
                    logger.LogInformation("Sending notification to user {UserId} for message {MessageId} in channel {ChannelId}", hook.UserId, message.Id, channel.Id);
                    await pushClient.RequestPushMessageDeliveryAsync(hook.ToPushSubscription(), notif);
                }
                catch (PushServiceClientException e) when (IsSubscriptionGone(e.StatusCode)) {
                    // the push service says this subscription is dead (expired, unsubscribed, keys no longer valid)
                    badEndpoints.Add(hook.Id);
                }
                catch (Exception e) {
                    // Network errors, rate limits and 5xx are transient: keep the subscription.
                    logger.LogWarning(e, "Web push to subscription {HookId} failed", hook.Id);
                }
            }
        }
            
        // delete any bad endpoints we found
        if (badEndpoints.Count > 0) {
            await users.DeleteWebNotificationSubscriptions(badEndpoints.ToArray());
        }

        if (ntfyJobs.Count > 0) {
            await SendNtfy(scope.ServiceProvider, users, ntfySettings, ntfyJobs, logger, message);
        }
    }

    private static bool IsSubscriptionGone(HttpStatusCode status) => status is
        HttpStatusCode.NotFound or HttpStatusCode.Gone or HttpStatusCode.BadRequest or HttpStatusCode.Forbidden;

    /// <summary>
    /// Tells a user's native devices they read a channel up to a message somewhere, so they can clear its
    /// notifications. Only sent if one of those devices was pushed a message from that channel since the last read,
    /// and never to browsers, which have to show a notification for every push.
    /// </summary>
    private async Task ProcessReadAsync(string userId, long channelId, long messageId) {
        using IServiceScope scope = serviceProvider.CreateScope();
        IConnectionMultiplexer redis = scope.ServiceProvider.GetRequiredService<IConnectionMultiplexer>();
        RedisResult pushed = await redis.GetDatabase().ScriptEvaluateAsync(TakePushedScript,
            new { key = PushedKey(userId, channelId), readUpTo = messageId });
        if ((long)pushed < 0) return;

        IUserRepo users = scope.ServiceProvider.GetRequiredService<IUserRepo>();
        UserWebNotificationHook[] hooks = (await users.GetWebNotificationSubscriptions(userId))
            .Where(h => h.Kind == PushSubscriptionKind.UnifiedPush)
            .ToArray();
        if (hooks.Length == 0) return;

        PushServiceClient pushClient = scope.ServiceProvider.GetRequiredService<PushServiceClient>();
        ILogger<NotificationService> logger = scope.ServiceProvider.GetRequiredService<ILogger<NotificationService>>();
        PushMessage push = new(NotificationFormatter.BuildReadPayload(channelId, messageId)) {
            Urgency = PushMessageUrgency.Normal,
            Topic = "read-" + channelId,  // a newer read for the channel replaces one that's still queued
            TimeToLive = (int)TimeSpan.FromDays(1).TotalSeconds
        };

        List<long> badEndpoints = [];
        foreach (UserWebNotificationHook hook in hooks) {
            try {
                await pushClient.RequestPushMessageDeliveryAsync(hook.ToPushSubscription(), push);
            }
            catch (PushServiceClientException e) when (IsSubscriptionGone(e.StatusCode)) {
                badEndpoints.Add(hook.Id);
            }
            catch (Exception e) {
                logger.LogWarning(e, "Read sync push to subscription {HookId} failed", hook.Id);
            }
        }
        if (badEndpoints.Count > 0) {
            await users.DeleteWebNotificationSubscriptions(badEndpoints.ToArray());
        }
    }

    private static PushMessage CreatePushMessage(object content, Message message, bool includeContent, bool high) {
        return new PushMessage(NotificationFormatter.BuildWebPushPayload(content, includeContent)) {
            Urgency = high ? PushMessageUrgency.High : PushMessageUrgency.Normal,
            Topic = "message-" + message.Id  // topics must be URL-safe base64 characters, so no colon
        };
    }

    private static async Task<(string Title, string Body)> BuildNtfyText(IServiceProvider services, Channel channel,
        Message message, IReadOnlyDictionary<string, ChatUser> members) {
        string? guildName = null;
        Dictionary<long, string> roleNames = [];
        if (channel.GuildId.HasValue) {
            guildName = (await services.GetRequiredService<IGuildRepo>().GetGuild(channel.GuildId.Value))?.Name;
            if (NotificationFormatter.HasRoleMentions(message.Content)) {
                roleNames = (await services.GetRequiredService<IRoleRepo>().GetGuildRoles(channel.GuildId.Value))
                    .ToDictionary(r => r.Id, r => r.Name);
            }
        }

        string title = NotificationFormatter.BuildTitle(message, channel, guildName);
        string body = NotificationFormatter.ResolveMentions(message.Content, members, roleNames, channel);
        return (title, body);
    }

    private static async Task SendNtfy(IServiceProvider services, IUserRepo users, NtfySettings settings,
        List<(UserNtfySubscription Sub, NtfyNotification Notification)> jobs, ILogger logger, Message message) {
        INtfyClient ntfy = services.GetRequiredService<INtfyClient>();
        ConcurrentBag<long> succeeded = [];
        ConcurrentBag<NtfyDeliveryFailure> failed = [];

        await Parallel.ForEachAsync(jobs, new ParallelOptions { MaxDegreeOfParallelism = NtfyParallelism }, async (job, token) => {
            NtfyPublishResult result = await ntfy.Publish(job.Sub, job.Notification, token);
            if (result.Success) {
                succeeded.Add(job.Sub.Id);
                return;
            }
            logger.LogInformation("ntfy subscription {SubId} failed for message {MessageId}: {Outcome} {Error}",
                job.Sub.Id, message.Id, result.Outcome, result.Error);
            failed.Add(new NtfyDeliveryFailure(job.Sub.Id, result.Outcome, result.Error ?? result.Outcome.ToString()));
        });

        await users.RecordNtfyDeliveryResults(succeeded, failed, settings.DisableAfterFailures);
    }
}
