namespace SerbleChat.Backend.Services;

public interface IImagesService {
    bool IsFileValid(IFormFile file, out string? msg);

    /// <summary>
    /// Converts the image to a 256px WebP and stores it under <paramref name="key"/>.
    /// </summary>
    /// <returns>
    /// A new version for the image, for the owner's <c>AvatarVersion</c>/<c>IconVersion</c>: clients put it in
    /// the URL, so the old picture can never be served for the new one.
    /// </returns>
    Task<long> UploadImage(IFormFile file, string key);

    Task DeleteImage(string key);

    /// <summary>Every stored image whose key starts with <paramref name="prefix"/>, with when it was last written.</summary>
    Task<Dictionary<string, DateTime>> ListImages(string prefix, CancellationToken ct = default);

    /// <summary>The version an image written at <paramref name="writtenAt"/> gets: milliseconds since the epoch.</summary>
    static long VersionFor(DateTime writtenAt) => new DateTimeOffset(writtenAt.ToUniversalTime()).ToUnixTimeMilliseconds();
}
