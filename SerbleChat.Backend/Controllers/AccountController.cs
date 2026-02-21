using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SerbleChat.Backend.Database.Repos;
using SerbleChat.Backend.Database.Structs;
using SerbleChat.Backend.Schemas;

namespace SerbleChat.Backend.Controllers;

[Route("/account")]
[ApiController]
[Authorize]
public class AccountController(IUserRepo users) : ControllerBase {
    
    [HttpGet]
    public async Task<ActionResult<UserAccountResponse>> Get() {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        ChatUser? user = await users.GetUserById(userId);
        if (user == null) {
            return NotFound("User not found in local database");
        }
        
        return Ok(UserAccountResponse.FromChatUser(user));
    }

    [HttpGet("{id}")]
    public async Task<ActionResult<PublicUserResponse>> GetPublic(string id) {
        ChatUser? user = await users.GetUserById(id);
        if (user == null) {
            return NotFound("User not found");
        }
        
        return Ok(PublicUserResponse.FromChatUser(user));
    }

    [HttpGet("from-username/{username}")]
    public async Task<ActionResult<PublicUserResponse>> GetByUsername(string username) {
        ChatUser? user = await users.GetUserByUsername(username);
        if (user == null) {
            return NotFound("User not found");
        }

        return Ok(PublicUserResponse.FromChatUser(user));
    }
}