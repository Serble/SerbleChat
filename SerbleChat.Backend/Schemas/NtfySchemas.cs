using System.ComponentModel.DataAnnotations;
using SerbleChat.Backend.Database.Structs;

namespace SerbleChat.Backend.Schemas;

public class NtfySubscriptionCreateRequest {
    [Required, MaxLength(512)]
    public string ServerUrl { get; set; } = null!;

    [Required, MaxLength(64)]
    public string Topic { get; set; } = null!;

    [MaxLength(255)]
    public string? AccessToken { get; set; }

    public bool IncludeContent { get; set; } = false;
}

public class NtfySubscriptionUpdateRequest {
    [MaxLength(512)]
    public string? ServerUrl { get; set; }

    [MaxLength(64)]
    public string? Topic { get; set; }

    /// <summary>Null leaves the token unchanged, an empty string removes it.</summary>
    [MaxLength(255)]
    public string? AccessToken { get; set; }

    public bool? IncludeContent { get; set; }

    public bool? Enabled { get; set; }
}

/// <summary>The access token is write-only; only whether one is set is exposed.</summary>
public record NtfySubscriptionResponse(
    long Id, string ServerUrl, string Topic, bool HasAccessToken, bool IncludeContent, bool Enabled,
    DateTime CreatedAt, DateTime? LastSuccessAt, DateTime? LastFailureAt, string? LastError, int ConsecutiveFailures) {
    public static NtfySubscriptionResponse From(UserNtfySubscription s) => new(
        s.Id, s.ServerUrl, s.Topic, !string.IsNullOrEmpty(s.AccessToken), s.IncludeContent, s.Enabled,
        s.CreatedAt, s.LastSuccessAt, s.LastFailureAt, s.LastError, s.ConsecutiveFailures);
}

public record NtfyTestResponse(bool Success, string? Error);
