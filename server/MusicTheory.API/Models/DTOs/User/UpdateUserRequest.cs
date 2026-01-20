using System.ComponentModel.DataAnnotations;

namespace MusicTheory.API.Models.DTOs.User;

public class UpdateUserRequest
{
    [MinLength(2)]
    [MaxLength(100)]
    public string? DisplayName { get; set; }

    public string? AvatarUrl { get; set; }
}
