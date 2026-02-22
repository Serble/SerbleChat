using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SerbleChat.Backend.Database.Repos;
using SerbleChat.Backend.Database.Structs;
using SerbleChat.Backend.Schemas;
using StackExchange.Redis;

namespace SerbleChat.Backend.Controllers;

[Route("/account")]
[ApiController]
[Authorize]
public class AccountController(IUserRepo users, IConnectionMultiplexer redis) : ControllerBase {
    
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
        
        RedisValue result = await redis.GetDatabase().StringGetAsync("status:" + id);
        return Ok(PublicUserResponse.FromChatUser(user, result.HasValue));
    }

    [HttpGet("from-username/{username}")]
    public async Task<ActionResult<PublicUserResponse>> GetByUsername(string username) {
        ChatUser? user = await users.GetUserByUsername(username);
        if (user == null) {
            return NotFound("User not found");
        }

        RedisValue result = await redis.GetDatabase().StringGetAsync("status:" + user.Id);
        return Ok(PublicUserResponse.FromChatUser(user, result.HasValue));
    }
}
