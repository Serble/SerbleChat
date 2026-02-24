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
    
    [HttpPost("blocks/{id}")]
    public async Task<ActionResult> BlockUser(string id) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        if (userId == id) {
            return BadRequest("Cannot block yourself");
        }
        
        ChatUser? userToBlock = await users.GetUserById(id);
        if (userToBlock == null) {
            return NotFound("User to block not found");
        }
        
        await users.BlockUser(userId, id);
        return Ok();
    }

    [HttpDelete("blocks/{id}")]
    public async Task<ActionResult> UnblockUser(string id) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        if (userId == id) {
            return BadRequest("Cannot unblock yourself");
        }
        
        ChatUser? userToUnblock = await users.GetUserById(id);
        if (userToUnblock == null) {
            return NotFound("User to unblock not found");
        }
        
        await users.UnblockUser(userId, id);
        return Ok();
    }

    [HttpGet("blocks")]
    public async Task<ActionResult<PublicUserResponse[]>> GetBlockedUsers() {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        UserBlock[] blocks = await users.GetBlockedUsers(userId);
        PublicUserResponse[] response = new PublicUserResponse[blocks.Length];
        for (int i = 0; i < blocks.Length; i++) {
            response[i] = await users.CompilePublicUserResponse(blocks[i].BlockedUserNavigation);
        }
        
        return Ok(response);
    }
}
