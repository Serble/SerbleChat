using Amazon.S3;
using Amazon.S3.Model;
using ImageMagick;
using Microsoft.Extensions.Options;
using SerbleChat.Backend.Config;

namespace SerbleChat.Backend.Services.Impl;

public class ImagesService(IAmazonS3 s3, IOptions<ApiSettings> apiSettings, IOptions<S3Settings> s3Settings) : IImagesService {
    
    public bool IsFileValid(IFormFile file, out string? msg) {
        if (file == null! || file.Length == 0) {
            msg = "No file uploaded.";
            return false;
        }

        // prelim type checking
        if (!file.ContentType.StartsWith("image/")) {
            msg = "Uploaded file is not an image.";
            return false;
        }

        if (file.Length > apiSettings.Value.MaxImageUploadSizeBytes) {
            msg = $"Uploaded file is too large. Max size is {apiSettings.Value.MaxImageUploadSizeBytes} bytes.";
            return false;
        }
        
        msg = null;
        return true;
    }

    /// <summary>
    /// How long browsers and proxies may reuse an image without asking again. Clients that know an image's version
    /// put it in the URL, so for them a new picture is a new URL and this never makes them stale; it bounds how
    /// stale a client that uses the bare URL (an old app version, a webhook avatar) can be. After it runs out
    /// the ETag makes the check cheap.
    /// </summary>
    private const string CacheControl = "public, max-age=3600";

    public async Task<long> UploadImage(IFormFile file, string key) {
        await using Stream inputStream = file.OpenReadStream();
        using MagickImage image = new(inputStream);

        image.Resize(new MagickGeometry(256, 256) {
            IgnoreAspectRatio = false,
            FillArea = true
        });
        image.Crop(256, 256, Gravity.Center);
        image.Strip();

        // now let's go webp
        image.Format = MagickFormat.WebP;
        image.Quality = 80;
        
        // upload to s3
        using MemoryStream ms = new();
        await image.WriteAsync(ms);
        ms.Position = 0;
        
        PutObjectRequest request = new() {
            BucketName = s3Settings.Value.BucketName,
            Key = key,
            InputStream = ms,
            ContentType = "image/webp"
        };
        request.Headers.CacheControl = CacheControl;
        await s3.PutObjectAsync(request);
        return IImagesService.VersionFor(DateTime.UtcNow);
    }

    public Task DeleteImage(string key) {
        DeleteObjectRequest request = new() {
            BucketName = s3Settings.Value.BucketName,
            Key = key
        };

        return s3.DeleteObjectAsync(request);
    }

    public async Task<Dictionary<string, DateTime>> ListImages(string prefix, CancellationToken ct = default) {
        Dictionary<string, DateTime> result = new();
        ListObjectsV2Request request = new() {
            BucketName = s3Settings.Value.BucketName,
            Prefix = prefix
        };
        ListObjectsV2Response response;
        do {
            response = await s3.ListObjectsV2Async(request, ct);
            foreach (S3Object o in response.S3Objects ?? []) {
                result[o.Key] = o.LastModified ?? DateTime.UtcNow;
            }
            request.ContinuationToken = response.NextContinuationToken;
        } while (response.IsTruncated == true);
        return result;
    }
}
