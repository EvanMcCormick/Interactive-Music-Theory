using System.ComponentModel.DataAnnotations;

namespace MusicTheory.API.Models.DTOs.Auth;

public class RefreshTokenRequest
{
    [Required]
    public string RefreshToken { get; set; } = string.Empty;
}
