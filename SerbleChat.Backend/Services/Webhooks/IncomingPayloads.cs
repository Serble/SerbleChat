using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace SerbleChat.Backend.Services.Webhooks;

/// <summary>What an incoming webhook request asks us to post, whatever format it arrived in.</summary>
public record WebhookPost(string? Content, List<RichEmbed> Embeds, string? Username, string? AvatarUrl);

/// <summary>Discord's "Execute Webhook" body: content, overrides and up to 10 embeds.</summary>
public static class DiscordPayload {
    public static WebhookPost Parse(JsonElement root) {
        List<RichEmbed> embeds = root.Arr("embeds").Take(10).Select(ParseEmbed).ToList();
        return new WebhookPost(root.Str("content"), embeds, root.Str("username"), root.Str("avatar_url"));
    }

    private static RichEmbed ParseEmbed(JsonElement e) {
        RichEmbed embed = new() {
            AuthorName = e.Str("author", "name"),
            AuthorUrl = e.Str("author", "url"),
            Title = e.Str("title"),
            Url = e.Str("url"),
            Description = e.Str("description"),
            ImageUrl = e.Str("image", "url"),
            Footer = e.Str("footer", "text"),
            Timestamp = DateTimeOffset.TryParse(e.Str("timestamp"), out DateTimeOffset ts) ? ts : null
        };
        foreach (JsonElement f in e.Arr("fields").Take(25)) {
            embed.Fields.Add((f.Str("name") ?? "", f.Str("value") ?? ""));
        }
        return embed;
    }
}

/// <summary>
/// Slack's incoming webhook body: <c>text</c>, Block Kit <c>blocks</c> and legacy <c>attachments</c>,
/// all written in Slack's "mrkdwn" rather than markdown.
/// </summary>
public static partial class SlackPayload {
    public static WebhookPost Parse(JsonElement root) {
        // Blocks are the real message when present; text is then only a notification fallback
        string? content = RenderBlocks(root.Arr("blocks"));
        if (string.IsNullOrWhiteSpace(content)) content = Mrkdwn(root.Str("text"));

        List<RichEmbed> embeds = root.Arr("attachments").Take(20).Select(ParseAttachment).ToList();
        return new WebhookPost(content, embeds, root.Str("username"), root.Str("icon_url"));
    }

    private static RichEmbed ParseAttachment(JsonElement a) {
        RichEmbed embed = new() {
            Pretext = Mrkdwn(a.Str("pretext")),
            AuthorName = a.Str("author_name"),
            AuthorUrl = a.Str("author_link"),
            Title = a.Str("title"),
            Url = a.Str("title_link"),
            Description = Mrkdwn(a.Str("text")) ?? RenderBlocks(a.Arr("blocks")),
            ImageUrl = a.Str("image_url"),
            Footer = a.Str("footer"),
            Timestamp = double.TryParse(a.Str("ts"), System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture, out double ts)
                ? DateTimeOffset.FromUnixTimeMilliseconds((long)(ts * 1000))
                : null
        };
        foreach (JsonElement f in a.Arr("fields").Take(25)) {
            embed.Fields.Add((f.Str("title") ?? "", Mrkdwn(f.Str("value")) ?? ""));
        }
        // Fallback is the plain-text version; only use it if there's nothing better
        if (embed.ToMarkdown() == null) embed.Description = a.Str("fallback");
        return embed;
    }

    /// <summary>The readable parts of Block Kit blocks as markdown. Interactive elements are dropped.</summary>
    private static string? RenderBlocks(IEnumerable<JsonElement> blocks) {
        List<string> parts = [];
        foreach (JsonElement b in blocks.Take(50)) {
            switch (b.Str("type")) {
                case "header":
                    if (b.Str("text", "text") is { } header) parts.Add($"**{header.Trim()}**");
                    break;
                case "section": {
                    List<string> section = [];
                    if (b.Get("text") is { } text) section.Add(TextObject(text));
                    section.AddRange(b.Arr("fields").Select(TextObject));
                    parts.Add(string.Join("\n", section.Where(s => s.Length > 0)));
                    break;
                }
                case "context":
                    parts.Add(string.Join(" · ", b.Arr("elements")
                        .Where(el => el.Str("type") is "mrkdwn" or "plain_text")
                        .Select(TextObject)));
                    break;
                case "divider":
                    parts.Add("---");
                    break;
                case "image":
                    if (RichEmbed.IsHttpUrl(b.Str("image_url"))) parts.Add($"![{b.Str("alt_text") ?? "image"}](<{b.Str("image_url")}>)");
                    break;
                case "rich_text":
                    parts.Add(RichText(b.Arr("elements")));
                    break;
            }
        }
        string result = string.Join("\n\n", parts.Where(p => !string.IsNullOrWhiteSpace(p)));
        return result.Length == 0 ? null : result;
    }

    private static string TextObject(JsonElement t) {
        string text = t.Str("text") ?? "";
        return t.Str("type") == "mrkdwn" ? Mrkdwn(text) ?? "" : text;
    }

    /// <summary>Slack's structured rich text (what its own composer produces).</summary>
    private static string RichText(IEnumerable<JsonElement> elements) {
        StringBuilder sb = new();
        foreach (JsonElement el in elements) {
            switch (el.Str("type")) {
                case "rich_text_section":
                    sb.Append(RichText(el.Arr("elements")));
                    break;
                case "rich_text_list":
                    foreach (JsonElement item in el.Arr("elements")) {
                        sb.Append("\n- ").Append(RichText(item.Arr("elements")));
                    }
                    sb.Append('\n');
                    break;
                case "rich_text_quote":
                    sb.Append("\n> ").Append(RichText(el.Arr("elements")).Replace("\n", "\n> ")).Append('\n');
                    break;
                case "rich_text_preformatted":
                    sb.Append("\n```\n").Append(RichText(el.Arr("elements"))).Append("\n```\n");
                    break;
                case "text": {
                    string text = el.Str("text") ?? "";
                    if (el.Bool("style", "code")) text = $"`{text}`";
                    if (el.Bool("style", "bold")) text = $"**{text}**";
                    if (el.Bool("style", "italic")) text = $"_{text}_";
                    if (el.Bool("style", "strike")) text = $"~~{text}~~";
                    sb.Append(text);
                    break;
                }
                case "link":
                    sb.Append(RichEmbed.Link(el.Str("text") ?? el.Str("url") ?? "", el.Str("url")));
                    break;
                case "emoji":
                    sb.Append(el.Str("unicode") is { } hex ? EmojiFromHex(hex) : $":{el.Str("name")}:");
                    break;
            }
        }
        return sb.ToString().Trim('\n');
    }

    private static string EmojiFromHex(string hex) {
        try {
            return string.Concat(hex.Split('-').Select(h => char.ConvertFromUtf32(Convert.ToInt32(h, 16))));
        }
        catch (Exception) {
            return "";
        }
    }

    /// <summary>
    /// Slack mrkdwn to markdown: <c>&lt;url|label&gt;</c> links, single-star bold and single-tilde strike.
    /// Code spans and blocks are left alone.
    /// </summary>
    public static string? Mrkdwn(string? s) {
        if (string.IsNullOrWhiteSpace(s)) return null;
        string[] pieces = CodeSplitter().Split(s);
        for (int i = 0; i < pieces.Length; i++) {
            if (pieces[i].StartsWith('`')) continue;  // code: keep as-is
            string p = pieces[i];
            p = SlackLink().Replace(p, m => {
                string target = m.Groups[1].Value, label = m.Groups[3].Success ? m.Groups[3].Value : "";
                return target[0] switch {
                    '!' => "@" + (label.Length > 0 ? label.TrimStart('@') : target[1..].Split('^')[0]),  // <!here>, <!channel>, <!date^…|label>
                    '@' or '#' => label.Length > 0 ? (target[0] + label) : target,      // user / channel references
                    _ when target.StartsWith("mailto:") => label.Length > 0 ? label : target[7..],
                    _ => label.Length > 0 ? RichEmbed.Link(label, target) : target
                };
            });
            p = SlackBold().Replace(p, "**$1**");
            p = SlackStrike().Replace(p, "~~$1~~");
            pieces[i] = p.Replace("&lt;", "<").Replace("&gt;", ">").Replace("&amp;", "&");
        }
        return string.Concat(pieces);
    }

    [GeneratedRegex("(```[\\s\\S]*?```|`[^`\\n]*`)")]
    private static partial Regex CodeSplitter();

    [GeneratedRegex("<([^<>|\\s]+)(\\|([^<>]*))?>")]
    private static partial Regex SlackLink();

    [GeneratedRegex("(?<![*\\w])\\*(?=\\S)([^*\\n]+?)(?<=\\S)\\*(?![*\\w])")]
    private static partial Regex SlackBold();

    [GeneratedRegex("(?<![~\\w])~(?=\\S)([^~\\n]+?)(?<=\\S)~(?![~\\w])")]
    private static partial Regex SlackStrike();
}
