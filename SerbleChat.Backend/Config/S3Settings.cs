namespace SerbleChat.Backend.Config;

public class S3Settings {
    public string ServiceUrl { get; set; } = null!;
    public bool PathStyleAccess { get; set; }
    public string AccessKey { get; set; } = null!;
    public string SecretKey { get; set; } = null!;
    public string BucketName { get; set; } = null!;
    public int PresignExpiryMinutes { get; set; } = 10;
}
