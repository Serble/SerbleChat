using System.ComponentModel.DataAnnotations;

namespace SerbleChat.Backend.Schemas;

public class WebNotificationHookAddRequest {
    [Required, MaxLength(1024)]
    public string Url { get; set; } = null!;

    [Required, MaxLength(128)]
    public string P256dh { get; set; } = null!;

    [Required, MaxLength(64)]
    public string Auth { get; set; } = null!;

    /// <summary><c>browser</c> (the default) or <c>unifiedpush</c> for the native app.</summary>
    public string? Kind { get; set; }
}

public class WebNotificationHookRemoveRequest {
    [Required, MaxLength(1024)]
    public string Url { get; set; } = null!;
}
