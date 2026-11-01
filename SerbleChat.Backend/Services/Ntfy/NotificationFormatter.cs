using System.Text;
using System.Text.RegularExpressions;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using SerbleChat.Backend.Database.Structs;

namespace SerbleChat.Backend.Services.Ntfy;

/// <summary>Builds notification payloads for delivery channels outside the app.</summary>
public static partial class NotificationFormatter {
    /// <summary>
    /// Web Push (and UnifiedPush) payloads are capped at 4096 bytes after encryption, which leaves ~3993 bytes of
    /// plaintext. Push services reject anything bigger, so we stay well under.
    /// </summary>
    private const int WebPushMaxPayloadBytes = 3800;
    private const int WebPushMaxContentBytes = 2000;

    /// <summary>ntfy turns messages over 4096 bytes into attachments, which we don't want.</summary>
    private const int NtfyMaxMessageBytes = 3500;

    /// <summary>
    /// The JSON payload our own clients (service worker, future UnifiedPush app) render. With content hidden,
    /// <c>message.content</c> is null and <c>message.content_hidden</c> is true.
    /// </summary>
    public static string BuildWebPushPayload(object content, bool includeContent) {
        JObject payload = JObject.FromObject(content);
        if (payload["message"] is not JObject message) {
            return payload.ToString(Formatting.None);
        }

        if (includeContent && message["content"]?.Value<string>() is { } text) {
            message["content"] = TruncateUtf8(text, WebPushMaxContentBytes);
            string full = payload.ToString(Formatting.None);
            if (Encoding.UTF8.GetByteCount(full) <= WebPushMaxPayloadBytes) {
                return full;
            }
            // still too big (long names etc.), fall through and drop the content
        }

        message["content"] = null;
        message["content_hidden"] = true;
        return payload.ToString(Formatting.None);
    }

    /// <summary>The silent push that tells native clients a channel was read up to a message on another device.</summary>
    public static string BuildReadPayload(long channelId, long messageId) {
        return new JObject {
            ["type"] = "read",
            ["channel_id"] = channelId,
            ["message_id"] = messageId
        }.ToString(Formatting.None);
    }

    public static string BuildTitle(Message message, Channel channel, string? guildName) {
        string author = message.AuthorNavigation?.Username ?? message.WebhookUsername ?? "Someone";
        return channel.Type switch {
            ChannelType.Dm => author,
            ChannelType.Group => $"{author} in {channel.Name}",
            ChannelType.Guild when guildName != null => $"{author} in #{channel.Name} ({guildName})",
            ChannelType.Guild => $"{author} in #{channel.Name}",
            _ => author
        };
    }

    public static NtfyNotification BuildNtfy(string title, string? body, bool mentioned, Channel channel, string? frontendUrl) {
        string message = string.IsNullOrWhiteSpace(body)
            ? mentioned ? "Mentioned you" : "New message"
            : TruncateUtf8(body, NtfyMaxMessageBytes);

        // ntfy priorities: 3 is default, 4 is "high" (louder, may bypass do-not-disturb depending on the app)
        int priority = mentioned || channel.Type == ChannelType.Dm ? 4 : 3;

        string? click = string.IsNullOrWhiteSpace(frontendUrl)
            ? null
            : $"{frontendUrl.TrimEnd('/')}/app/channel/{channel.Id}";

        return new NtfyNotification(title, message, priority, click);
    }

    /// <summary>Replaces <c>&lt;@user:id&gt;</c>, <c>&lt;@role:id&gt;</c> and <c>&lt;@channel:id&gt;</c> with readable names.</summary>
    public static string ResolveMentions(string content, IReadOnlyDictionary<string, ChatUser> users,
        IReadOnlyDictionary<long, string> roleNames, Channel currentChannel) {
        return MentionMatcher().Replace(content, m => {
            string kind = m.Groups[1].Value;
            string id = m.Groups[2].Value;
            switch (kind) {
                case "user":
                    return users.TryGetValue(id, out ChatUser? u) ? "@" + u.Username : "@unknown-user";
                case "role":
                    return long.TryParse(id, out long roleId) && roleNames.TryGetValue(roleId, out string? role)
                        ? "@" + role
                        : "@unknown-role";
                case "channel":
                    // Only name the current channel: other channels might be ones this recipient can't see.
                    return long.TryParse(id, out long channelId) && channelId == currentChannel.Id
                        ? "#" + currentChannel.Name
                        : "#channel";
                default:
                    return m.Value;
            }
        });
    }

    public static bool HasRoleMentions(string content) => content.Contains("<@role:", StringComparison.Ordinal);

    /// <summary>Truncates to at most <paramref name="maxBytes"/> UTF-8 bytes without splitting a character, adding an ellipsis if cut.</summary>
    public static string TruncateUtf8(string text, int maxBytes) {
        if (Encoding.UTF8.GetByteCount(text) <= maxBytes) {
            return text;
        }

        const string ellipsis = "…";
        int budget = maxBytes - Encoding.UTF8.GetByteCount(ellipsis);
        StringBuilder sb = new();
        int used = 0;
        foreach (Rune rune in text.EnumerateRunes()) {
            int size = rune.Utf8SequenceLength;
            if (used + size > budget) break;
            sb.Append(rune.ToString());
            used += size;
        }
        return sb.Append(ellipsis).ToString();
    }

    [GeneratedRegex("<@(user|channel|role):([^>\\s]+)>")]
    private static partial Regex MentionMatcher();
}
