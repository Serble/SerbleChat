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

    public async Task UploadImage(IFormFile file, string key) {
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
            InputStream = ms
        };
        await s3.PutObjectAsync(request);
    }

    public Task DeleteImage(string key) {
        DeleteObjectRequest request = new() {
            BucketName = s3Settings.Value.BucketName,
            Key = key
        };

        return s3.DeleteObjectAsync(request);
    }
}
