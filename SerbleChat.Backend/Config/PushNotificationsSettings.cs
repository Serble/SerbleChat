namespace SerbleChat.Backend.Config;

public class PushNotificationsSettings {
    public string VapidPublicKey { get; set; } = null!;
    public string VapidPrivateKey { get; set; } = null!;
    public string Subject { get; set; } = null!;
}
