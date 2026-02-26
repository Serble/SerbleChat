namespace SerbleChat.Backend.Services;

public interface IImagesService {
    bool IsFileValid(IFormFile file, out string? msg);
    Task UploadImage(IFormFile file, string key);
    Task DeleteImage(string key);
}
