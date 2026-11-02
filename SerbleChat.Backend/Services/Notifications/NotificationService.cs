using System.Diagnostics;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using SerbleChat.Backend.Config;
using SerbleChat.Backend.Database.Repos;
using SerbleChat.Backend.Database.Structs;
using SerbleChat.Backend.Schemas;
using SerbleChat.Backend.Services.Ntfy;
using SerbleChat.Backend.SocketHubs;
using StackExchange.Redis;
using Channel = SerbleChat.Backend.Database.Structs.Channel;
using Role = SerbleChat.Backend.Database.Structs.Role;

namespace SerbleChat.Backend.Services.Notifications;

/// <summary>
/// Decides who gets notified about what, and gets it to them.
/// </summary>
/// <remarks>
/// A message becomes a <see cref="FanOutJob"/>, which loads the audience in one parallel database round trip and
/// queues a <see cref="DeliveryJob"/> per push endpoint or ntfy topic. Deliveries run in parallel across the workers,
/// time out after a few seconds, and transient failures (network, 429, 5xx) are retried with backoff. Everything is
/// queued in Redis (<see cref="NotificationQueue"/>), so a restart doesn't lose anything.
/// <para/>
/// Users who are connected get an in-app notification over the socket instead of a push, unless they asked for both.
/// Their client acknowledges it; if none does within a few seconds the connection was dead (a phone that lost signal
/// with the app open looks connected until the server times it out) and the push goes out after all.
/// </remarks>
public partial class NotificationService(
    IServiceScopeFactory scopes,
    IServiceProvider services,
    NotificationQueue queue,
    NotificationAudienceLoader audiences,
    WebPushSender webPush,
    DeliveryRecorder recorder,
    IHubContext<ChatHub> hub,
    IConnectionMultiplexer redis,
    IMemoryCache cache,
    IOptions<NotificationSettings> settings,
    IOptions<NtfySettings> ntfySettings,
    IOptions<ApiSettings> apiSettings,
    ILogger<NotificationService> logger) : INotificationService {

    /// <summary>How long we remember that a native device was sent a channel's notifications, so reading it can clear them.</summary>
    private static readonly TimeSpan PushedTtl = TimeSpan.FromDays(7);

    private static readonly TimeSpan[] RetryDelays = [
        TimeSpan.FromSeconds(2), TimeSpan.FromSeconds(10), TimeSpan.FromSeconds(30),
        TimeSpan.FromMinutes(2), TimeSpan.FromMinutes(10), TimeSpan.FromMinutes(30)
    ];

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
    private static RedisKey SocketAckKey(string ackId) => "nq:sack:" + ackId;
    private static RedisKey HostFailuresKey(string host) => "nq:hostfail:" + host;
    private static RedisKey HostDownKey(string host) => "nq:hostdown:" + host;
    private static string MessageCacheKey(long messageId) => "notify-message:" + messageId;

    private NotificationSettings Settings => settings.Value;

    // ── Entry points ────────────────────────────────────────────────────────────────────

    public async Task EnqueueMessageProcessing(Channel channel, Message message, IEnumerable<string> userMentions) {
        // The fan-out usually runs on this instance within milliseconds, so keep what we already have in memory
        // rather than load it again; after a restart, or on another instance, it comes from the database.
        message.ChannelNavigation ??= channel;
        cache.Set(MessageCacheKey(message.Id), message, TimeSpan.FromMinutes(5));

        string[] mentions = userMentions.Distinct().ToArray();
        bool important = channel.Type != ChannelType.Guild || mentions.Length > 0
                         || NotificationFormatter.HasRoleMentions(message.Content);
        try {
            await queue.Enqueue(new FanOutJob {
                ChannelId = channel.Id,
                MessageId = message.Id,
                Mentions = mentions,
                Lane = important ? NotificationLane.High : NotificationLane.Normal
            });
        }
        catch (Exception e) {
            // The message is saved and sent to connected clients already; failing the request now would only make
            // the sender retry and post it twice
            logger.LogError(e, "Couldn't queue notifications for message {MessageId}", message.Id);
        }
    }

    public async Task EnqueueReadSync(string userId, long channelId, long messageId) {
        try {
            await queue.Enqueue(new ReadSyncJob { UserId = userId, ChannelId = channelId, MessageId = messageId });
        }
        catch (Exception e) {
            logger.LogWarning(e, "Couldn't queue read sync for channel {ChannelId}", channelId);
        }
    }

    public async Task AckSocketNotification(string ackId) {
        if (!IsId(ackId)) return;
        await redis.GetDatabase().StringSetAsync(SocketAckKey(ackId), DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            TimeSpan.FromMinutes(2), When.NotExists);
    }

    public async Task AckDeviceDelivery(string deliveryId, long? shownAt) {
        if (!IsId(deliveryId)) return;
        await recorder.AckFromDevice(deliveryId, shownAt);
    }

    private static bool IsId(string? id) => id is { Length: 32 } && id.All(char.IsAsciiHexDigitLower);

    // ── Worker side ─────────────────────────────────────────────────────────────────────

    public async Task Process(ClaimedJob claimed) {
        try {
            switch (claimed.Job) {
                case DeliveryJob job:
                    await ProcessDelivery(claimed, job);
                    return;  // completes or reschedules itself
                case FanOutJob job:
                    await ProcessFanOut(job);
                    break;
                case SocketFallbackJob job:
                    await ProcessSocketFallback(job);
                    break;
                case ReadSyncJob job:
                    await ProcessReadSync(job);
                    break;
            }
            await queue.Complete(claimed);
        }
        catch (Exception e) {
            // Most likely the database or Redis is unavailable. Try again a few times before giving up on it.
            NotificationJob job = claimed.Job;
            if (job.Crashes < 5) {
                logger.LogWarning(e, "Notification job {JobType} failed, will retry", job.GetType().Name);
                await queue.Reschedule(claimed, job with { Crashes = job.Crashes + 1 }, TimeSpan.FromSeconds(Math.Pow(3, job.Crashes + 1)));
            }
            else {
                logger.LogError(e, "Notification job {JobType} failed {Crashes} times, dropping it", job.GetType().Name, job.Crashes + 1);
                await queue.Complete(claimed);
            }
        }
    }

    // ── Fan-out ─────────────────────────────────────────────────────────────────────────

    private async Task<Message?> GetMessage(long channelId, long messageId) {
        if (cache.TryGetValue(MessageCacheKey(messageId), out Message? cached) && cached != null) {
            return cached;
        }
        using IServiceScope scope = scopes.CreateScope();
        Message? message = await scope.ServiceProvider.GetRequiredService<IMessageRepo>().GetMessage(messageId);
        if (message == null || message.ChannelId != channelId) return null;
        message.ChannelNavigation ??= (await scope.ServiceProvider.GetRequiredService<IChannelRepo>().GetChannel(channelId))!;
        return message.ChannelNavigation == null ? null : message;
    }

    private async Task ProcessFanOut(FanOutJob job) {
        Message? message = await GetMessage(job.ChannelId, job.MessageId);
        if (message == null) return;  // deleted before we got to it
        Channel channel = message.ChannelNavigation;

        NotificationAudience audience = await audiences.Load(channel);
        if (message.AuthorNavigation == null && message.AuthorId != null
            && audience.Members.TryGetValue(message.AuthorId, out ChatUser? author)) {
            message.AuthorNavigation = author;
        }

        // Role mentions count as mentions for everyone holding a mentionable role
        HashSet<string> mentioned = job.Mentions.ToHashSet();
        HashSet<long> mentionedRoles = MentionedRoleIds(message.Content);
        List<string> mentionedByRole = [];
        if (mentionedRoles.Count > 0) {
            foreach ((string userId, List<Role> roles) in audience.Roles) {
                if (userId != message.AuthorId && roles.Any(r => r.Mentionable && mentionedRoles.Contains(r.Id))
                    && mentioned.Add(userId)) {
                    mentionedByRole.Add(userId);
                }
            }
        }

        DateTime now = DateTime.UtcNow;
        DateTime messageCreatedAt = AsUtc(message.CreatedAt);
        MessagePayloads payloads = new(channel, message, audience);
        List<NotificationJob> deliveries = [];
        List<NotificationJob> fallbacks = [];
        List<(string UserId, string? AckId)> socketSends = [];
        List<string> unifiedPushUsers = [];

        foreach ((string userId, ChatUser user) in audience.Members) {
            if (userId == message.AuthorId) continue;
            UserStatusType status = user.EffectiveStatusType();
            if (status == UserStatusType.DoNotDisturb) continue;  // DND silences everything, including the in-app sound

            bool isMentioned = mentioned.Contains(userId);
            if (!WantsNotification(user, userId, channel, audience, isMentioned)) continue;

            // When connected they can see the message in real time, so push/ntfy only goes out if they asked for it.
            // Invisible users are connected and at their client, so they follow the online setting.
            bool connected = audience.Connected.Contains(userId);
            bool onlyInApp = connected && !(status == UserStatusType.Away ? user.NotificationsWhileAway : user.NotificationsWhileOnline);

            NotificationLane lane = channel.Type != ChannelType.Guild || isMentioned ? NotificationLane.High : NotificationLane.Normal;
            DeliveryJob[] userDeliveries = BuildDeliveries(userId, user, isMentioned, lane, payloads, audience, now, messageCreatedAt);

            if (onlyInApp) {
                string ackId = NewId();
                socketSends.Add((userId, ackId));
                fallbacks.Add(new SocketFallbackJob {
                    AckId = ackId, UserId = userId, ChannelId = channel.Id, MessageId = message.Id,
                    SentAt = now, MessageCreatedAt = messageCreatedAt, Deliveries = userDeliveries, Lane = lane
                });
                continue;
            }

            socketSends.Add((userId, null));
            deliveries.AddRange(userDeliveries);
            if (userDeliveries.Any(d => d.Transport == NotificationTransport.UnifiedPush)) unifiedPushUsers.Add(userId);
        }

        // Pushes first: they're the slow path, so get them moving before the in-app sends
        await queue.Enqueue(deliveries);

        foreach ((string userId, string? ackId) in socketSends) {
            await hub.Clients.User(userId).SendAsync("ReceiveNotification", new { type = "message", message, ackId });
        }
        await queue.Schedule(fallbacks, TimeSpan.FromSeconds(Settings.SocketAckTimeoutSeconds));

        await RememberPushed(unifiedPushUsers, channel.Id, message.Id);

        if (mentionedByRole.Count > 0) {
            // what MessageSender does for user mentions: unread mention counts and the live badge
            using IServiceScope scope = scopes.CreateScope();
            await scope.ServiceProvider.GetRequiredService<IUnreadsRepo>().AddUserMentions(channel.Id, message.Id, mentionedByRole);
            await hub.Clients.Users(mentionedByRole).SendAsync("MentionedInMessage", new { MessageId = message.Id, ChannelId = channel.Id });
        }
    }

    private static bool WantsNotification(ChatUser user, string userId, Channel channel, NotificationAudience audience, bool mentioned) {
        NotificationPreferences prefs = audience.ChannelPrefs.TryGetValue(userId, out UserChannelNotificationPreferences? cp)
            ? cp.Preferences
            : NotificationPreferences.DefaultPreferences;
        NotificationPreferences guildPrefs = audience.GuildPrefs.TryGetValue(userId, out UserGuildNotificationPreferences? gp)
            ? gp.Preferences
            : NotificationPreferences.DefaultPreferences;
        NotificationPreferences userPrefs = channel.Type switch {
            ChannelType.Guild => user.DefaultGuildNotificationPreferences,
            ChannelType.Dm => user.DefaultDmNotificationPreferences,
            ChannelType.Group => user.DefaultGroupNotificationPreferences,
            _ => throw new ArgumentOutOfRangeException()
        };
        prefs = prefs.ApplyOverride(guildPrefs).ApplyOverride(userPrefs);
        return prefs.Notifications switch {
            NotificationPreference.AllMessages => true,
            NotificationPreference.MentionsOnly => mentioned,
            _ => false
        };
    }

    private DeliveryJob[] BuildDeliveries(string userId, ChatUser user, bool mentioned, NotificationLane lane,
        MessagePayloads payloads, NotificationAudience audience, DateTime now, DateTime messageCreatedAt) {
        List<DeliveryJob> jobs = [];
        DateTime expires = now.AddHours(Settings.MessageTtlHours);

        if (audience.Hooks.TryGetValue(userId, out UserWebNotificationHook[]? hooks)) {
            foreach (UserWebNotificationHook hook in hooks) {
                string id = NewId();
                jobs.Add(new DeliveryJob {
                    Id = id,
                    Lane = lane,
                    Purpose = NotificationPurpose.Message,
                    Transport = hook.Kind == PushSubscriptionKind.UnifiedPush ? NotificationTransport.UnifiedPush : NotificationTransport.WebPush,
                    UserId = userId,
                    ChannelId = payloads.Channel.Id,
                    MessageId = payloads.Message.Id,
                    SubscriptionId = hook.Id,
                    Host = HostOf(hook.Url),
                    Endpoint = hook.Url,
                    P256dh = hook.P256dh,
                    Auth = hook.Auth,
                    Payload = WithAck(payloads.WebPush(user.WebPushIncludeContent), id),
                    // Everything that shows a notification is time-sensitive. Normal urgency lets FCM hold it until
                    // the phone's next Doze maintenance window, which can be hours away.
                    HighUrgency = true,
                    Topic = "message-" + payloads.Message.Id,  // topics must be URL-safe base64 characters, so no colon
                    QueuedAt = now,
                    MessageCreatedAt = messageCreatedAt,
                    ExpiresAt = expires,
                    Ackable = true,
                    SubscriptionFailures = hook.ConsecutiveFailures,
                    SubscriptionLastSuccessAt = hook.LastSuccessAt
                });
            }
        }

        if (audience.Ntfy.TryGetValue(userId, out UserNtfySubscription[]? subs)) {
            (string title, string body) = payloads.NtfyText();
            foreach (UserNtfySubscription sub in subs) {
                NtfyNotification n = NotificationFormatter.BuildNtfy(title, sub.IncludeContent ? body : null, mentioned,
                    payloads.Channel, apiSettings.Value.FrontendUrl);
                jobs.Add(new DeliveryJob {
                    Lane = lane,
                    Purpose = NotificationPurpose.Message,
                    Transport = NotificationTransport.Ntfy,
                    UserId = userId,
                    ChannelId = payloads.Channel.Id,
                    MessageId = payloads.Message.Id,
                    SubscriptionId = sub.Id,
                    Host = HostOf(sub.ServerUrl),
                    NtfyServer = sub.ServerUrl,
                    NtfyTopic = sub.Topic,
                    NtfyToken = sub.AccessToken,
                    NtfyTitle = n.Title,
                    NtfyMessage = n.Message,
                    NtfyPriority = n.Priority,
                    NtfyClick = n.Click,
                    QueuedAt = now,
                    MessageCreatedAt = messageCreatedAt,
                    ExpiresAt = expires,
                    Ackable = false,
                    SubscriptionFailures = sub.ConsecutiveFailures,
                    SubscriptionLastSuccessAt = sub.LastSuccessAt
                });
            }
        }
        return jobs.ToArray();
    }

    /// <summary>The message's notification payloads, each built at most once however many recipients there are.</summary>
    private class MessagePayloads(Channel channel, Message message, NotificationAudience audience) {
        public Channel Channel => channel;
        public Message Message => message;
        private string? _full, _hidden;
        private (string, string)? _ntfy;

        public string WebPush(bool includeContent) {
            object content = new { type = "message", message };
            return includeContent
                ? _full ??= NotificationFormatter.BuildWebPushPayload(content, true)
                : _hidden ??= NotificationFormatter.BuildWebPushPayload(content, false);
        }

        public (string Title, string Body) NtfyText() {
            if (_ntfy is { } done) return done;
            Dictionary<long, string> roleNames = audience.Roles.Values.SelectMany(r => r)
                .DistinctBy(r => r.Id).ToDictionary(r => r.Id, r => r.Name);
            string title = NotificationFormatter.BuildTitle(message, channel, audience.GuildName);
            string body = NotificationFormatter.ResolveMentions(message.Content, audience.Members, roleNames, channel);
            _ntfy = (title, body);
            return (title, body);
        }
    }

    /// <summary>Adds the delivery's ID to a JSON payload, so the client can acknowledge it.</summary>
    private static string WithAck(string payload, string deliveryId) =>
        payload.EndsWith('}') ? string.Concat(payload.AsSpan(0, payload.Length - 1), ",\"ack\":\"", deliveryId, "\"}") : payload;

    private async Task RememberPushed(List<string> userIds, long channelId, long messageId) {
        if (userIds.Count == 0) return;
        // remember it so reading the channel elsewhere can clear the notification on their devices
        IDatabase db = redis.GetDatabase();
        await Task.WhenAll(userIds.Select(u => db.StringSetAsync(PushedKey(u, channelId), messageId, PushedTtl)));
    }

    [GeneratedRegex("<@role:(\\d+)>")]
    private static partial Regex RoleMentionMatcher();

    private static HashSet<long> MentionedRoleIds(string content) =>
        RoleMentionMatcher().Matches(content).Select(m => long.Parse(m.Groups[1].Value)).ToHashSet();

    // ── Socket fallback ─────────────────────────────────────────────────────────────────

    private async Task ProcessSocketFallback(SocketFallbackJob job) {
        RedisValue acked = await redis.GetDatabase().StringGetAsync(SocketAckKey(job.AckId));
        DateTime now = DateTime.UtcNow;
        NotificationDelivery row = new() {
            CreatedAt = job.SentAt,
            Purpose = NotificationPurpose.Message,
            Transport = NotificationTransport.Socket,
            HighPriority = job.Lane == NotificationLane.High,
            UserId = job.UserId,
            ChannelId = job.ChannelId,
            MessageId = job.MessageId,
            Host = "socket",
            MessageCreatedAt = job.MessageCreatedAt,
            FirstAttemptAt = job.SentAt,
            CompletedAt = now,
            Attempts = 1,
            QueueMs = DeliveryRecorder.Ms(job.SentAt - job.MessageCreatedAt)
        };

        if (acked.HasValue) {
            DateTime ackAt = DateTimeOffset.FromUnixTimeMilliseconds((long)acked).UtcDateTime;
            row.Outcome = NotificationOutcome.Acked;
            row.CompletedAt = ackAt;
            row.AcceptedMs = DeliveryRecorder.Ms(ackAt - job.MessageCreatedAt);
            row.DeviceAckAt = ackAt;
            row.DeviceAckMs = row.AcceptedMs;
            recorder.Record(row);
            return;
        }

        // Nobody answered: the connection is dead even though the server hasn't noticed yet
        row.Outcome = NotificationOutcome.NotAcked;
        row.Error = $"No acknowledgement within {Settings.SocketAckTimeoutSeconds}s";
        recorder.Record(row);
        if (job.Deliveries.Length == 0) return;
        logger.LogInformation("In-app notification for message {MessageId} to user {UserId} wasn't acknowledged, pushing instead",
            job.MessageId, job.UserId);
        await queue.Enqueue(job.Deliveries);
        if (job.Deliveries.Any(d => d.Transport == NotificationTransport.UnifiedPush)) {
            await RememberPushed([job.UserId], job.ChannelId, job.MessageId);
        }
    }

    // ── Read sync ───────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Tells a user's native devices they read a channel up to a message somewhere, so they can clear its
    /// notifications. Only sent if one of those devices was pushed a message from that channel since the last read,
    /// and never to browsers, which have to show a notification for every push.
    /// </summary>
    private async Task ProcessReadSync(ReadSyncJob job) {
        RedisResult pushed = await redis.GetDatabase().ScriptEvaluateAsync(TakePushedScript,
            new { key = PushedKey(job.UserId, job.ChannelId), readUpTo = job.MessageId });
        if ((long)pushed < 0) return;

        using IServiceScope scope = scopes.CreateScope();
        UserWebNotificationHook[] hooks = (await scope.ServiceProvider.GetRequiredService<IUserRepo>().GetWebNotificationSubscriptions(job.UserId))
            .Where(h => h.Kind == PushSubscriptionKind.UnifiedPush)
            .ToArray();
        if (hooks.Length == 0) return;

        DateTime now = DateTime.UtcNow;
        string payload = NotificationFormatter.BuildReadPayload(job.ChannelId, job.MessageId);
        await queue.Enqueue(hooks.Select(hook => (NotificationJob)new DeliveryJob {
            Lane = NotificationLane.Normal,
            Purpose = NotificationPurpose.ReadSync,
            Transport = NotificationTransport.UnifiedPush,
            UserId = job.UserId,
            ChannelId = job.ChannelId,
            MessageId = job.MessageId,
            SubscriptionId = hook.Id,
            Host = HostOf(hook.Url),
            Endpoint = hook.Url,
            P256dh = hook.P256dh,
            Auth = hook.Auth,
            Payload = payload,
            HighUrgency = false,  // nothing to show, so it can wait for the phone to wake
            Topic = "read-" + job.ChannelId,  // a newer read for the channel replaces one that's still queued
            QueuedAt = now,
            ExpiresAt = now.AddDays(1),
            Ackable = false,
            SubscriptionFailures = hook.ConsecutiveFailures,
            SubscriptionLastSuccessAt = hook.LastSuccessAt
        }).ToArray());
    }

    // ── Delivery ────────────────────────────────────────────────────────────────────────

    private async Task ProcessDelivery(ClaimedJob claimed, DeliveryJob job) {
        DateTime start = DateTime.UtcNow;
        if (start > job.ExpiresAt) {
            Finish(job, NotificationOutcome.Expired, start, job.Attempt, null, "Expired before it could be delivered");
            await queue.Complete(claimed);
            return;
        }

        DateTime firstAttempt = job.FirstAttemptAt ?? start;
        int attempt = job.Attempt + 1;
        IDatabase redisDb = redis.GetDatabase();
        SendResult result;
        if (await redisDb.KeyExistsAsync(HostDownKey(job.Host))) {
            // Recently timing out or refusing connections: don't spend a worker waiting on it again yet
            result = new SendResult(SendStatus.Transient, null, "Host temporarily skipped after repeated timeouts", TimeSpan.Zero,
                TimeSpan.FromSeconds(Settings.HostCooldownSeconds));
        }
        else {
            result = job.Transport == NotificationTransport.Ntfy
                ? await SendNtfy(job)
                : await webPush.Send(job.Endpoint!, job.P256dh!, job.Auth!, job.Payload!, job.HighUrgency, job.Topic,
                    job.ExpiresAt - start, CancellationToken.None);
            if (result is { Status: SendStatus.Transient, StatusCode: null }) {
                await NoteHostFailure(redisDb, job.Host);
            }
        }
        DateTime end = DateTime.UtcNow;
        DeliveryJob attempted = job with { Attempt = attempt, FirstAttemptAt = firstAttempt };

        switch (result.Status) {
            case SendStatus.Success:
                Finish(attempted, NotificationOutcome.Delivered, end, attempt, result);
                await queue.Complete(claimed);
                await NoteSuccess(job);
                return;

            case SendStatus.Gone when job.Transport != NotificationTransport.Ntfy:
                Finish(attempted, NotificationOutcome.SubscriptionGone, end, attempt, result);
                await queue.Complete(claimed);
                using (IServiceScope scope = scopes.CreateScope()) {
                    await scope.ServiceProvider.GetRequiredService<IUserRepo>().DeleteWebNotificationSubscriptions(job.SubscriptionId);
                }
                return;

            case SendStatus.Transient when attempt < Settings.MaxAttempts: {
                TimeSpan delay = RetryDelays[Math.Min(attempt - 1, RetryDelays.Length - 1)];
                if (result.RetryAfter is { } asked && asked > delay) {
                    delay = asked > TimeSpan.FromHours(1) ? TimeSpan.FromHours(1) : asked;
                }
                if (end + delay < job.ExpiresAt) {
                    logger.LogInformation("Delivery to {Host} failed ({Error}), retry {Attempt} in {Delay}",
                        job.Host, result.Error, attempt, delay);
                    await queue.Reschedule(claimed, attempted, delay);
                    return;
                }
                goto default;
            }

            default:
                Finish(attempted, end >= job.ExpiresAt ? NotificationOutcome.Expired : NotificationOutcome.Failed, end, attempt, result);
                await queue.Complete(claimed);
                await NoteFailure(job, result);
                return;
        }
    }

    /// <summary>Counts a timeout or connection failure against the host, and benches it if they're piling up.</summary>
    private async Task NoteHostFailure(IDatabase db, string host) {
        long failures = await db.StringIncrementAsync(HostFailuresKey(host));
        if (failures == 1) await db.KeyExpireAsync(HostFailuresKey(host), TimeSpan.FromMinutes(1));
        if (failures >= Settings.HostFailureThreshold
            && await db.StringSetAsync(HostDownKey(host), 1, TimeSpan.FromSeconds(Settings.HostCooldownSeconds), When.NotExists)) {
            await db.KeyDeleteAsync(HostFailuresKey(host));
            logger.LogWarning("Push host {Host} keeps timing out or refusing connections; skipping it for {Seconds}s",
                host, Settings.HostCooldownSeconds);
        }
    }

    private async Task<SendResult> SendNtfy(DeliveryJob job) {
        INtfyClient ntfy = services.GetRequiredService<INtfyClient>();
        UserNtfySubscription sub = new() {
            Id = job.SubscriptionId,
            ServerUrl = job.NtfyServer!,
            Topic = job.NtfyTopic!,
            AccessToken = job.NtfyToken
        };
        Stopwatch watch = Stopwatch.StartNew();
        NtfyPublishResult r = await ntfy.Publish(sub,
            new NtfyNotification(job.NtfyTitle ?? "", job.NtfyMessage ?? "", job.NtfyPriority, job.NtfyClick));
        int? code = r.Error != null && Regex.Match(r.Error, @"returned (\d{3})") is { Success: true } m ? int.Parse(m.Groups[1].Value) : null;
        return r.Outcome switch {
            NtfyPublishOutcome.Success => new SendResult(SendStatus.Success, 200, null, watch.Elapsed),
            NtfyPublishOutcome.Failed or NtfyPublishOutcome.RateLimited => new SendResult(SendStatus.Transient, code, r.Error, watch.Elapsed, r.RetryAfter),
            _ => new SendResult(SendStatus.Permanent, code, r.Error, watch.Elapsed)
        };
    }

    private async Task NoteSuccess(DeliveryJob job) {
        // Only touch the database when it changes something: after failures, or to refresh a day-old success time
        if (job.SubscriptionFailures == 0 && job.SubscriptionLastSuccessAt > DateTime.UtcNow.AddDays(-1)) return;
        using IServiceScope scope = scopes.CreateScope();
        IUserRepo users = scope.ServiceProvider.GetRequiredService<IUserRepo>();
        if (job.Transport == NotificationTransport.Ntfy) {
            await users.RecordNtfyDeliveryResults([job.SubscriptionId], [], ntfySettings.Value.DisableAfterFailures);
        }
        else {
            await users.RecordWebPushSuccess(job.SubscriptionId);
        }
    }

    private async Task NoteFailure(DeliveryJob job, SendResult result) {
        using IServiceScope scope = scopes.CreateScope();
        IUserRepo users = scope.ServiceProvider.GetRequiredService<IUserRepo>();
        string error = result.Error ?? result.Status.ToString();
        if (job.Transport == NotificationTransport.Ntfy) {
            NtfyPublishOutcome outcome = result.StatusCode == 429 ? NtfyPublishOutcome.RateLimited
                : result.Status == SendStatus.Transient ? NtfyPublishOutcome.Failed
                : NtfyPublishOutcome.Rejected;
            await users.RecordNtfyDeliveryResults([], [new NtfyDeliveryFailure(job.SubscriptionId, outcome, error)],
                ntfySettings.Value.DisableAfterFailures);
            return;
        }
        bool deleted = await users.RecordWebPushFailure(job.SubscriptionId, error, Settings.DeleteEndpointAfterFailures, TimeSpan.FromDays(7));
        if (deleted) {
            logger.LogInformation("Deleted push subscription {SubscriptionId} at {Host} after repeated failures", job.SubscriptionId, job.Host);
        }
    }

    private void Finish(DeliveryJob job, NotificationOutcome outcome, DateTime completedAt, int attempts,
        SendResult? result, string? error = null) {
        DateTime origin = job.MessageCreatedAt ?? job.QueuedAt;
        NotificationDelivery row = new() {
            CreatedAt = job.QueuedAt,
            Purpose = job.Purpose,
            Transport = job.Transport,
            Outcome = outcome,
            HighPriority = job.Lane == NotificationLane.High,
            UserId = job.UserId,
            ChannelId = job.ChannelId,
            MessageId = job.MessageId,
            Host = job.Host.Length > 255 ? job.Host[..255] : job.Host,
            SubscriptionId = job.SubscriptionId,
            MessageCreatedAt = job.MessageCreatedAt,
            FirstAttemptAt = job.FirstAttemptAt,
            CompletedAt = completedAt,
            Attempts = attempts,
            StatusCode = result?.StatusCode,
            Error = Truncate(error ?? result?.Error, 255),
            QueueMs = job.FirstAttemptAt.HasValue ? DeliveryRecorder.Ms(job.FirstAttemptAt.Value - origin) : null,
            PushServiceMs = result == null ? null : DeliveryRecorder.Ms(result.Duration),
            AcceptedMs = outcome == NotificationOutcome.Delivered ? DeliveryRecorder.Ms(completedAt - origin) : null
        };
        recorder.Record(row, outcome == NotificationOutcome.Delivered && job.Ackable ? job.Id : null);
    }

    // ── Helpers ─────────────────────────────────────────────────────────────────────────

    private static string NewId() => Guid.NewGuid().ToString("N");

    private static string? Truncate(string? s, int max) => s == null || s.Length <= max ? s : s[..max];

    private static DateTime AsUtc(DateTime t) => t.Kind switch {
        DateTimeKind.Utc => t,
        DateTimeKind.Local => t.ToUniversalTime(),
        _ => DateTime.SpecifyKind(t, DateTimeKind.Utc)
    };

    /// <summary>The host, plus the port when it isn't the default, e.g. fcm.googleapis.com or ntfy.example.com:8443.</summary>
    private static string HostOf(string url) =>
        Uri.TryCreate(url, UriKind.Absolute, out Uri? uri)
            ? (uri.IsDefaultPort ? uri.Host : uri.Host + ":" + uri.Port).ToLowerInvariant()
            : "unknown";
}
