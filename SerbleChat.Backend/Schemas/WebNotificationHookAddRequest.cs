namespace SerbleChat.Backend.Schemas;

public class WebNotificationHookAddRequest {
    public string Url { get; set; } = null!;
    public string P256dh { get; set; } = null!;
    public string Auth { get; set; } = null!;
}
