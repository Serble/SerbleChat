using System.Text;
using System.Text.Json;

namespace SerbleChat.Backend.Services.Webhooks;

/// <summary>
/// A card of structured content (a Discord embed, a Slack attachment, a GitHub event).
/// We don't render cards, so <see cref="ToMarkdown"/> turns it into a quoted markdown block.
/// </summary>
public class RichEmbed {
    /// <summary>Plain text shown above the card (Slack's <c>pretext</c>).</summary>
    public string? Pretext { get; set; }
    public string? AuthorName { get; set; }
    public string? AuthorUrl { get; set; }
    public string? Title { get; set; }
    public string? Url { get; set; }
    public string? Description { get; set; }
    public List<(string Name, string Value)> Fields { get; } = [];
    public string? ImageUrl { get; set; }
    public string? Footer { get; set; }
    public DateTimeOffset? Timestamp { get; set; }

    public string? ToMarkdown() {
        List<string> lines = [];
        if (Has(AuthorName)) lines.Add(Link(AuthorName!.Trim(), AuthorUrl));
        if (Has(Title)) lines.Add("**" + Link(Title!.Trim(), Url) + "**");
        if (Has(Description)) lines.Add(Description!.Trim());

        foreach ((string name, string value) in Fields) {
            string n = Clean(name), v = Clean(value);
            if (n.Length == 0 && v.Length == 0) continue;
            if (n.Length == 0) lines.Add(v);
            else if (v.Length == 0) lines.Add($"**{n}**");
            else if (!v.Contains('\n')) lines.Add($"**{n}:** {v}");
            else lines.Add($"**{n}**\n{v}");
        }

        // Its own paragraph, so no line break hangs off the image
        if (IsHttpUrl(ImageUrl)) lines.Add($"\n![image](<{ImageUrl!.Trim()}>)\n");

        List<string> footer = [];
        if (Has(Footer)) footer.Add(Footer!.Trim());
        if (Timestamp != null) footer.Add(Timestamp.Value.UtcDateTime.ToString("yyyy-MM-dd HH:mm 'UTC'"));
        if (footer.Count > 0) lines.Add("_" + string.Join(" • ", footer) + "_");

        StringBuilder sb = new();
        if (Has(Pretext)) sb.Append(Pretext!.Trim()).Append("\n\n");
        if (lines.Count > 0) {
            // Quote every line so the whole card sits behind one bar, like an embed
            IEnumerable<string> quoted = string.Join("\n", lines).Split('\n').Select(l => l.Length == 0 ? ">" : "> " + l);
            sb.Append(string.Join("\n", quoted));
        }
        string result = sb.ToString().Trim();
        return result.Length == 0 ? null : result;
    }

    /// <summary>
    /// Message text from a body and its cards. Files can't be stored yet, so they get a note instead
    /// of disappearing silently. Overlong results are cut short rather than rejected.
    /// </summary>
    public static string Compose(string? content, IEnumerable<RichEmbed> embeds, int droppedFiles, int maxLength) {
        List<string> parts = [];
        if (Has(content)) parts.Add(content!.Trim());
        parts.AddRange(embeds.Select(e => e.ToMarkdown()).OfType<string>());
        if (droppedFiles > 0) {
            parts.Add($"_📎 {droppedFiles} attachment{(droppedFiles == 1 ? "" : "s")} not shown (webhook attachments aren't supported yet)_");
        }
        string text = string.Join("\n\n", parts);
        return text.Length <= maxLength ? text : text[..(maxLength - 1)] + "…";
    }

    /// <summary>[text](url) when the url is usable, else just the text.</summary>
    public static string Link(string text, string? url) {
        if (!IsHttpUrl(url)) return text;
        string label = text.Replace("[", "\\[").Replace("]", "\\]");
        return $"[{label}](<{url!.Trim()}>)";
    }

    public static bool IsHttpUrl(string? url) {
        return !string.IsNullOrWhiteSpace(url)
               && Uri.TryCreate(url.Trim(), UriKind.Absolute, out Uri? uri)
               && (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp)
               && !url.Contains('>');  // would break out of <...>
    }

    /// <summary>First line of <paramref name="s"/>, at most <paramref name="max"/> characters.</summary>
    public static string FirstLine(string? s, int max) {
        string line = (s ?? "").Split('\n')[0].Trim();
        return Clip(line, max)!;
    }

    public static string? Clip(string? s, int max) {
        if (s == null) return null;
        s = s.Trim();
        return s.Length <= max ? s : s[..(max - 1)].TrimEnd() + "…";
    }

    private static bool Has(string? s) => Clean(s).Length > 0;

    /// <summary>Discord payloads often use zero-width spaces as "empty" field names.</summary>
    private static string Clean(string? s) => (s ?? "").Replace("​", "").Trim();
}

/// <summary>Lenient readers for loosely-typed webhook JSON.</summary>
public static class JsonRead {
    /// <summary>The value at <paramref name="path"/>, or null if missing or null.</summary>
    public static JsonElement? Get(this JsonElement e, params string[] path) {
        JsonElement cur = e;
        foreach (string key in path) {
            if (cur.ValueKind != JsonValueKind.Object || !cur.TryGetProperty(key, out JsonElement next)) return null;
            cur = next;
        }
        return cur.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined ? null : cur;
    }

    /// <summary>Strings, numbers and booleans as text; anything else is null.</summary>
    public static string? Str(this JsonElement e, params string[] path) {
        JsonElement? v = e.Get(path);
        return v?.ValueKind switch {
            JsonValueKind.String => v.Value.GetString(),
            JsonValueKind.Number or JsonValueKind.True or JsonValueKind.False => v.Value.GetRawText(),
            _ => null
        };
    }

    public static bool Bool(this JsonElement e, params string[] path) {
        JsonElement? v = e.Get(path);
        return v?.ValueKind == JsonValueKind.True || (v?.ValueKind == JsonValueKind.String && v.Value.GetString() == "true");
    }

    public static IEnumerable<JsonElement> Arr(this JsonElement e, params string[] path) {
        JsonElement? v = e.Get(path);
        return v?.ValueKind == JsonValueKind.Array ? v.Value.EnumerateArray() : [];
    }
}
