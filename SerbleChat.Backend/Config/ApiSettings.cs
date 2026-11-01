namespace SerbleChat.Backend.Config;

public class ApiSettings {
    public string[] AllowedOrigins { get; set; } = null!;
    public int MaxImageUploadSizeBytes { get; set; } = 5 * 1024 * 1024;

    /// <summary>
    /// Public URL of the web client, e.g. https://chat.serble.net. Used for links in notifications
    /// that are rendered outside the app (ntfy). Leave unset to omit those links.
    /// </summary>
    public string? FrontendUrl { get; set; }
}
