using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SerbleChat.Backend.Database.Repos;
using SerbleChat.Backend.Database.Structs;
using SerbleChat.Backend.Schemas;
using SerbleChat.Backend.Services;

namespace SerbleChat.Backend.Controllers;

[Route("/auth")]
[ApiController]
public class AuthController(IUserRepo users, ISerbleApiClient serbleApi, IJwtManager jwt) : ControllerBase {
    
    [HttpPost]
    public async Task<ActionResult<AuthResponse>> Post(AuthenticateRequest request) {
        TokenResponse? tokenResponse = await serbleApi.Authenticate(request.Code);
        if (tokenResponse == null) {
            return BadRequest("Invalid code");
        }
        
        SerbleUser info = await serbleApi.GetUserInfo(tokenResponse.AccessToken) ?? throw new Exception("Failed to get user info");
        if (info.Username == null!) {
            throw new Exception("User info does not contain a username: " + JsonSerializer.Serialize(info));
        }
        
        ChatUser? user = await users.GetUserById(info.Id);
        if (user == null) {
            user = new ChatUser {
                Id = info.Id,
                Username = info.Username,
                RefreshToken = tokenResponse.RefreshToken,
                CreatedAt = DateTime.UtcNow
            };
            await users.CreateUser(user);
        }
        else {
            user.Username = info.Username;
            user.RefreshToken = tokenResponse.RefreshToken;
            await users.UpdateUser(user);
        }

        if (user.IsBanned) {
            return StatusCode(StatusCodes.Status403Forbidden, "User is banned");
        }

        string backendToken = jwt.GenerateToken(user);
        return Ok(new AuthResponse(true, backendToken));
    }

    [Authorize]
    [HttpGet]
    public ActionResult Get() {
        return Ok();
    }
}
