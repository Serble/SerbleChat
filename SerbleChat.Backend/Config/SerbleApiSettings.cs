namespace SerbleChat.Backend.Config;

public class SerbleApiSettings {
    public string BaseUrl { get; set; } = null!;
    public string ClientId { get; set; } = null!;
    public string ClientSecret { get; set; } = null!;

    /// <summary>
    /// The Serble Files app's client id: the audience of the cross-app sign-in that connects a
    /// chat user to Files without a second login.
    /// </summary>
    public string FilesClientId { get; set; } = "0a5cad39-9a81-4ac2-baac-0c37585fd75c";
}
