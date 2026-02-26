using Microsoft.AspNetCore.Mvc;

namespace SerbleChat.Backend.Controllers;

[ApiController]
[Route("/")]
public class RootController : ControllerBase {
    
    [HttpGet("/")]
    public IActionResult Get() {
        return Ok("Serble Chat Backend is running!");
    }
}
