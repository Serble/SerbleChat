using System.Text;
using System.Text.Json;

namespace SerbleChat.Backend.Services.Webhooks;

/// <summary>
/// Turns GitHub repository webhook events into a card, like Discord's <c>/github</c> endpoint.
/// Only the common, human-interesting events are shown; everything else is ignored (null).
/// </summary>
public static class GitHubEvents {
    private const int MaxCommits = 5;
    private const int MaxBody = 500;

    public static RichEmbed? Format(string eventName, JsonElement p) {
        string repo = p.Str("repository", "full_name") ?? "unknown repository";
        RichEmbed? embed = eventName switch {
            "push" => Push(p, repo),
            "create" => RefChange(p, repo, "created"),
            "delete" => RefChange(p, repo, "deleted"),
            "pull_request" => PullRequest(p, repo),
            "pull_request_review" => Review(p, repo),
            "pull_request_review_comment" => Comment(p, repo, p.Get("pull_request"), "pull request"),
            "issues" => Issue(p, repo),
            "issue_comment" => Comment(p, repo, p.Get("issue"), p.Get("issue", "pull_request") != null ? "pull request" : "issue"),
            "commit_comment" => CommitComment(p, repo),
            "release" => Release(p, repo),
            "star" => p.Str("action") == "created"
                ? new RichEmbed { Title = $"[{repo}] New star added", Url = p.Str("repository", "html_url") }
                : null,
            "fork" => new RichEmbed {
                Title = $"[{repo}] Fork created: {p.Str("forkee", "full_name")}",
                Url = p.Str("forkee", "html_url")
            },
            _ => null  // ping, workflow runs, labels, etc.
        };
        if (embed == null) return null;

        // Who did it, as the card's author line
        embed.AuthorName ??= p.Str("sender", "login");
        embed.AuthorUrl ??= p.Str("sender", "html_url");
        return embed;
    }

    private static RichEmbed? Push(JsonElement p, string repo) {
        List<JsonElement> commits = p.Arr("commits").ToList();
        if (commits.Count == 0) return null;  // branch/tag created or deleted: the create/delete events cover those

        string branch = ShortRef(p.Str("ref"));
        StringBuilder sb = new();
        foreach (JsonElement c in commits.Take(MaxCommits)) {
            string sha = (c.Str("id") ?? "").PadRight(7)[..7];
            string author = c.Str("author", "username") ?? c.Str("author", "name") ?? "unknown";
            sb.Append(RichEmbed.Link($"`{sha}`", c.Str("url")))
              .Append(' ').Append(RichEmbed.FirstLine(c.Str("message"), 70))
              .Append(" - ").Append(author).Append('\n');
        }
        if (commits.Count > MaxCommits) sb.Append($"…and {commits.Count - MaxCommits} more\n");

        string plural = commits.Count == 1 ? "" : "s";
        return new RichEmbed {
            Title = $"[{repo}:{branch}] {commits.Count} new commit{plural}{(p.Bool("forced") ? " (force-pushed)" : "")}",
            Url = p.Str("compare"),
            Description = sb.ToString().TrimEnd()
        };
    }

    private static RichEmbed RefChange(JsonElement p, string repo, string verb) {
        string type = p.Str("ref_type") == "tag" ? "tag" : "branch";
        string name = p.Str("ref") ?? "";
        return new RichEmbed {
            Title = $"[{repo}] New {type} {verb}: {name}",
            Url = verb == "created" ? $"{p.Str("repository", "html_url")}/tree/{Uri.EscapeDataString(name)}" : null
        };
    }

    private static RichEmbed? PullRequest(JsonElement p, string repo) {
        JsonElement? pr = p.Get("pull_request");
        if (pr == null) return null;
        string? verb = p.Str("action") switch {
            "opened" => "opened",
            "reopened" => "reopened",
            "ready_for_review" => "ready for review",
            "closed" => pr.Value.Bool("merged") ? "merged" : "closed",
            _ => null  // synchronize, labeled, assigned, …
        };
        if (verb == null) return null;
        return new RichEmbed {
            Title = $"[{repo}] Pull request {verb}: #{pr.Value.Str("number")} {pr.Value.Str("title")}",
            Url = pr.Value.Str("html_url"),
            Description = verb == "opened" ? RichEmbed.Clip(pr.Value.Str("body"), MaxBody) : null
        };
    }

    private static RichEmbed? Review(JsonElement p, string repo) {
        if (p.Str("action") != "submitted") return null;
        string? body = p.Str("review", "body");
        string? verb = p.Str("review", "state")?.ToLowerInvariant() switch {
            "approved" => "approved",
            "changes_requested" => "changes requested",
            "commented" when !string.IsNullOrWhiteSpace(body) => "submitted",
            _ => null  // an empty "commented" review just wraps line comments, which arrive separately
        };
        if (verb == null) return null;
        return new RichEmbed {
            Title = $"[{repo}] Pull request review {verb}: #{p.Str("pull_request", "number")} {p.Str("pull_request", "title")}",
            Url = p.Str("review", "html_url"),
            Description = RichEmbed.Clip(body, MaxBody)
        };
    }

    private static RichEmbed? Issue(JsonElement p, string repo) {
        string? verb = p.Str("action") switch {
            "opened" => "opened",
            "closed" => "closed",
            "reopened" => "reopened",
            _ => null
        };
        if (verb == null) return null;
        return new RichEmbed {
            Title = $"[{repo}] Issue {verb}: #{p.Str("issue", "number")} {p.Str("issue", "title")}",
            Url = p.Str("issue", "html_url"),
            Description = verb == "opened" ? RichEmbed.Clip(p.Str("issue", "body"), MaxBody) : null
        };
    }

    private static RichEmbed? Comment(JsonElement p, string repo, JsonElement? target, string kind) {
        if (p.Str("action") != "created" || target == null) return null;
        return new RichEmbed {
            Title = $"[{repo}] New comment on {kind} #{target.Value.Str("number")}: {target.Value.Str("title")}",
            Url = p.Str("comment", "html_url"),
            Description = RichEmbed.Clip(p.Str("comment", "body"), MaxBody)
        };
    }

    private static RichEmbed? CommitComment(JsonElement p, string repo) {
        if (p.Str("action") != "created") return null;
        string sha = (p.Str("comment", "commit_id") ?? "").PadRight(7)[..7];
        return new RichEmbed {
            Title = $"[{repo}] New comment on commit `{sha}`",
            Url = p.Str("comment", "html_url"),
            Description = RichEmbed.Clip(p.Str("comment", "body"), MaxBody)
        };
    }

    private static RichEmbed? Release(JsonElement p, string repo) {
        if (p.Str("action") != "published") return null;
        string name = p.Str("release", "name") is { Length: > 0 } n ? n : p.Str("release", "tag_name") ?? "";
        return new RichEmbed {
            Title = $"[{repo}] New release published: {name}",
            Url = p.Str("release", "html_url"),
            Description = RichEmbed.Clip(p.Str("release", "body"), MaxBody)
        };
    }

    private static string ShortRef(string? r) {
        if (r == null) return "";
        if (r.StartsWith("refs/heads/")) return r["refs/heads/".Length..];
        if (r.StartsWith("refs/tags/")) return r["refs/tags/".Length..];
        return r;
    }
}
