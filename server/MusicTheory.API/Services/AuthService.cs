using System.Text.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using MusicTheory.API.Data;
using MusicTheory.API.Models.DTOs.Auth;
using MusicTheory.API.Models.DTOs.User;
using MusicTheory.API.Models.Entities;
using MusicTheory.API.Models.Enums;

namespace MusicTheory.API.Services;

public class AuthService : IAuthService
{
    private readonly UserManager<User> _userManager;
    private readonly MusicTheoryDbContext _context;
    private readonly IJwtService _jwtService;

    public AuthService(
        UserManager<User> userManager,
        MusicTheoryDbContext context,
        IJwtService jwtService)
    {
        _userManager = userManager;
        _context = context;
        _jwtService = jwtService;
    }

    public async Task<AuthResponse> RegisterAsync(RegisterRequest request)
    {
        // Check if user exists
        var existingUser = await _userManager.FindByEmailAsync(request.Email);
        if (existingUser != null)
        {
            throw new InvalidOperationException("User with this email already exists");
        }

        // Handle invitation code if provided
        Invitation? invitation = null;
        if (!string.IsNullOrEmpty(request.InvitationCode))
        {
            invitation = await _context.Invitations
                .FirstOrDefaultAsync(i => i.Code == request.InvitationCode
                    && i.Email.ToLower() == request.Email.ToLower()
                    && i.AcceptedAt == null
                    && i.ExpiresAt > DateTime.UtcNow);

            if (invitation == null)
            {
                throw new InvalidOperationException("Invalid or expired invitation code");
            }
        }

        // Create user
        var user = new User
        {
            Id = Guid.NewGuid(),
            UserName = request.Email,
            Email = request.Email,
            DisplayName = request.DisplayName,
            Role = request.Role,
            CreatedAt = DateTime.UtcNow
        };

        var result = await _userManager.CreateAsync(user, request.Password);
        if (!result.Succeeded)
        {
            var errors = string.Join(", ", result.Errors.Select(e => e.Description));
            throw new InvalidOperationException($"Failed to create user: {errors}");
        }

        // Create profile based on role
        if (user.Role == UserRole.Teacher)
        {
            var teacherProfile = new TeacherProfile
            {
                Id = Guid.NewGuid(),
                UserId = user.Id
            };
            _context.TeacherProfiles.Add(teacherProfile);
        }

        // Always create student profile (teachers can also be students)
        var studentProfile = new StudentProfile
        {
            Id = Guid.NewGuid(),
            UserId = user.Id
        };
        _context.StudentProfiles.Add(studentProfile);

        // Handle invitation acceptance
        if (invitation != null)
        {
            invitation.AcceptedAt = DateTime.UtcNow;

            // Create enrollment
            var teacher = await _context.TeacherProfiles
                .FirstOrDefaultAsync(t => t.Id == invitation.TeacherId);

            if (teacher != null)
            {
                var enrollment = new Enrollment
                {
                    Id = Guid.NewGuid(),
                    TeacherId = teacher.Id,
                    StudentId = studentProfile.Id,
                    Status = EnrollmentStatus.Active
                };
                _context.Enrollments.Add(enrollment);
            }
        }

        await _context.SaveChangesAsync();

        return await GenerateAuthResponseAsync(user);
    }

    public async Task<AuthResponse> LoginAsync(LoginRequest request)
    {
        var user = await _userManager.FindByEmailAsync(request.Email);
        if (user == null)
        {
            throw new InvalidOperationException("Invalid email or password");
        }

        var isValidPassword = await _userManager.CheckPasswordAsync(user, request.Password);
        if (!isValidPassword)
        {
            throw new InvalidOperationException("Invalid email or password");
        }

        user.LastLoginAt = DateTime.UtcNow;
        await _userManager.UpdateAsync(user);

        return await GenerateAuthResponseAsync(user);
    }

    public async Task<AuthResponse> RefreshTokenAsync(string refreshToken)
    {
        var storedToken = await _context.RefreshTokens
            .Include(r => r.User)
            .FirstOrDefaultAsync(r => r.Token == refreshToken);

        if (storedToken == null || !storedToken.IsActive)
        {
            throw new InvalidOperationException("Invalid refresh token");
        }

        // Revoke old token
        storedToken.RevokedAt = DateTime.UtcNow;

        // Generate new tokens
        var response = await GenerateAuthResponseAsync(storedToken.User);

        storedToken.ReplacedByToken = response.RefreshToken;
        await _context.SaveChangesAsync();

        return response;
    }

    public async Task RevokeTokenAsync(string refreshToken)
    {
        var storedToken = await _context.RefreshTokens
            .FirstOrDefaultAsync(r => r.Token == refreshToken);

        if (storedToken == null)
        {
            throw new InvalidOperationException("Token not found");
        }

        storedToken.RevokedAt = DateTime.UtcNow;
        await _context.SaveChangesAsync();
    }

    private async Task<AuthResponse> GenerateAuthResponseAsync(User user)
    {
        var accessToken = _jwtService.GenerateAccessToken(user);
        var refreshToken = _jwtService.GenerateRefreshToken(user.Id);

        _context.RefreshTokens.Add(refreshToken);
        await _context.SaveChangesAsync();

        // Load profiles
        var userWithProfiles = await _context.Users
            .Include(u => u.TeacherProfile)
            .Include(u => u.StudentProfile)
            .FirstAsync(u => u.Id == user.Id);

        return new AuthResponse
        {
            AccessToken = accessToken,
            RefreshToken = refreshToken.Token,
            ExpiresAt = DateTime.UtcNow.AddMinutes(15),
            User = MapToUserDto(userWithProfiles)
        };
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
