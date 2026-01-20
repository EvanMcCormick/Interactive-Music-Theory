using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MusicTheory.API.Data;
using MusicTheory.API.Models.DTOs.User;
using MusicTheory.API.Models.Entities;

namespace MusicTheory.API.Services;

public class UserService : IUserService
{
    private readonly MusicTheoryDbContext _context;

    public UserService(MusicTheoryDbContext context)
    {
        _context = context;
    }

    public async Task<UserDto?> GetByIdAsync(Guid id)
    {
        var user = await _context.Users
            .Include(u => u.TeacherProfile)
            .Include(u => u.StudentProfile)
            .FirstOrDefaultAsync(u => u.Id == id);

        return user != null ? MapToUserDto(user) : null;
    }

    public async Task<UserDto> UpdateAsync(Guid id, UpdateUserRequest request)
    {
        var user = await _context.Users
            .Include(u => u.TeacherProfile)
            .Include(u => u.StudentProfile)
            .FirstOrDefaultAsync(u => u.Id == id);

        if (user == null)
        {
            throw new InvalidOperationException("User not found");
        }

        if (!string.IsNullOrEmpty(request.DisplayName))
        {
            user.DisplayName = request.DisplayName;
        }

        if (request.AvatarUrl != null)
        {
            user.AvatarUrl = request.AvatarUrl;
        }

        await _context.SaveChangesAsync();

        return MapToUserDto(user);
    }

    private static UserDto MapToUserDto(User user)
    {
        return new UserDto
        {
            Id = user.Id,
            Email = user.Email ?? string.Empty,
            DisplayName = user.DisplayName,
            AvatarUrl = user.AvatarUrl,
            Role = user.Role,
            CreatedAt = user.CreatedAt,
            TeacherProfile = user.TeacherProfile != null ? new TeacherProfileDto
            {
                Id = user.TeacherProfile.Id,
                Bio = user.TeacherProfile.Bio,
                IsPublic = user.TeacherProfile.IsPublic,
                Instruments = ParseJsonArray(user.TeacherProfile.Instruments),
                Specializations = ParseJsonArray(user.TeacherProfile.Specializations),
                HourlyRate = user.TeacherProfile.HourlyRate,
                HasStripeConnected = !string.IsNullOrEmpty(user.TeacherProfile.StripeConnectId)
            } : null,
            StudentProfile = user.StudentProfile != null ? new StudentProfileDto
            {
                Id = user.StudentProfile.Id,
                CurrentLevel = user.StudentProfile.CurrentLevel,
                TotalXP = user.StudentProfile.TotalXP,
                CurrentStreak = user.StudentProfile.CurrentStreak,
                Instruments = ParseJsonArray(user.StudentProfile.Instruments)
            } : null
        };
    }

    private static List<string> ParseJsonArray(string? json)
    {
        if (string.IsNullOrEmpty(json)) return new List<string>();
        try
        {
            return JsonSerializer.Deserialize<List<string>>(json) ?? new List<string>();
        }
        catch
        {
            return new List<string>();
        }
    }
}
