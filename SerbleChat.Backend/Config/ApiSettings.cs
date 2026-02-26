namespace SerbleChat.Backend.Config;

public class ApiSettings {
    public string[] AllowedOrigins { get; set; } = null!;
    public int MaxImageUploadSizeBytes { get; set; } = 5 * 1024 * 1024;
}
