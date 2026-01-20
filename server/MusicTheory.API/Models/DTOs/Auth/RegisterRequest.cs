using System.ComponentModel.DataAnnotations;
using MusicTheory.API.Models.Enums;

namespace MusicTheory.API.Models.DTOs.Auth;

public class RegisterRequest
{
    [Required]
    [EmailAddress]
    public string Email { get; set; } = string.Empty;

    [Required]
    [MinLength(8)]
    public string Password { get; set; } = string.Empty;

    [Required]
    [MinLength(2)]
    [MaxLength(100)]
    public string DisplayName { get; set; } = string.Empty;

    [Required]
    public UserRole Role { get; set; } = UserRole.Student;

    public string? InvitationCode { get; set; }
}
